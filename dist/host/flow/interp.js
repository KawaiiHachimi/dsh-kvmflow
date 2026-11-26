import { sha256 } from '../image.js';
import { actionEvents, describeAction, releaseAllEvents } from './actions.js';
import { deepRender, evaluateExpression, evaluateTruth, parseExpression } from './expr.js';
import { isActionType, portsForNode } from './schema.js';
import { normalizeCondition } from './normalize.js';
/** Conditions live in configs in their YAML shape; templates are already rendered. */
function toCondition(value, path) {
    return normalizeCondition(value, path);
}
const MAX_DEPTH = 4;
const MAX_TRACE = 500;
/** Thrown for a node-level failure that the retry policy should see. */
class NodeFailure extends Error {
    nodeId;
    constructor(nodeId, message) {
        super(message);
        this.name = 'NodeFailure';
        this.nodeId = nodeId;
    }
}
function aborted() {
    const error = new Error('aborted');
    error.name = 'AbortError';
    return error;
}
function maskSecrets(values, secretNames) {
    const out = {};
    for (const [key, value] of Object.entries(values)) {
        out[key] = secretNames.includes(key) ? '***' : value;
    }
    return out;
}
export class Interpreter {
    document;
    host;
    state;
    depth;
    secretInputs;
    loops = new Map();
    bodySets = new Map();
    visionCache = new Map();
    classifyCache = new Map();
    /** Node whose output `last` refers to: the node that ran before the current one. */
    lastNodeId;
    constructor(document, host, state, options = {}) {
        this.document = document;
        this.host = host;
        this.state = state;
        this.depth = options.depth ?? 0;
        this.secretInputs = options.secretInputs ?? [];
        if (options.inputs !== undefined)
            this.state.inputs = { ...options.inputs };
        for (const node of Object.values(document.nodes)) {
            if (node.type !== 'loop')
                continue;
            const body = new Set();
            const first = node.next.body;
            if (first === undefined)
                continue;
            const queue = [first];
            while (queue.length > 0) {
                const id = queue.shift();
                if (body.has(id) || id === node.id || !Object.hasOwn(document.nodes, id))
                    continue;
                body.add(id);
                for (const target of Object.values(document.nodes[id].next))
                    queue.push(target);
            }
            this.bodySets.set(node.id, body);
        }
    }
    /** The document this interpreter walks. */
    get flow() {
        return this.document;
    }
    /**
     * Run the graph from its start node.
     * @returns the terminal result.
     */
    async run() {
        let current = this.document.start;
        let previous;
        let iterations = 0;
        // Time spent waiting for a human does not count against the budget.
        const deadline = { at: Date.now() + this.document.limits.timeoutSec * 1000 };
        const decide = this.host.decide.bind(this.host);
        this.host = {
            ...this.host,
            decide: async (request) => {
                const paused = Date.now();
                try {
                    return await decide(request);
                }
                finally {
                    deadline.at += Date.now() - paused;
                }
            },
        };
        while (current !== undefined) {
            if (this.host.signal.aborted)
                throw aborted();
            if (Date.now() > deadline.at) {
                throw new Error(`stopped after ${this.document.limits.timeoutSec}s of execution; raise limits.timeoutSec for a longer flow`);
            }
            const node = this.document.nodes[current];
            if (node === undefined) {
                throw new Error(`node ${JSON.stringify(current)} does not exist`);
            }
            iterations += 1;
            if (iterations > this.document.limits.maxNodeVisits) {
                throw new Error(`stopped after ${this.document.limits.maxNodeVisits} node visits; raise limits.maxNodeVisits for a longer flow`);
            }
            const visit = (this.state.visits[current] ?? 0) + 1;
            // A loop node is re-entered once per iteration and bounds itself with
            // maxIterations; the document-wide visit limit still applies to it.
            if (visit > node.maxVisits && node.type !== 'loop') {
                const outcome = await this.failOverBudget(node, visit);
                if (outcome.result !== undefined)
                    return outcome.result;
                previous = current;
                current = outcome.next;
                continue;
            }
            this.state.visits[current] = visit;
            this.state.currentNodeId = current;
            this.state.phase = node.name !== '' ? node.name : node.type;
            this.bumpResult(current, { visits: visit, status: 'running' });
            await this.host.flush();
            const started = Date.now();
            const outcome = await this.runWithRetries(node, previous);
            const elapsed = Date.now() - started;
            this.lastNodeId = current;
            if (outcome.end !== undefined) {
                this.recordVisit(node, outcome.port ?? '', Date.now(), elapsed, outcome);
                await this.host.flush();
                return outcome.end;
            }
            this.bumpResult(current, {
                output: outcome.output,
                port: outcome.port,
                status: outcome.port === 'error' ? 'failed' : 'passed',
            });
            this.recordVisit(node, outcome.port ?? '', Date.now(), elapsed, outcome);
            const target = outcome.jump ?? node.next[outcome.port ?? ''];
            if (target === undefined) {
                const routed = await this.pauseForRoute(node, outcome);
                if (routed.end !== undefined)
                    return routed.end;
                previous = current;
                current = routed.next;
                await this.host.flush();
                continue;
            }
            previous = current;
            current = target;
            await this.host.flush();
        }
        // Walking off the graph is not a success: an `end` node decides the result.
        return { result: 'failure', reason: 'the flow ran out of connections; add an end node' };
    }
    bumpResult(nodeId, patch) {
        const current = this.state.results[nodeId] ?? { visits: 0, status: 'pending' };
        this.state.results[nodeId] = {
            ...current,
            ...(patch.output === undefined ? {} : { output: patch.output }),
            ...(patch.visits === undefined ? {} : { visits: patch.visits }),
            ...(patch.port === undefined ? {} : { port: patch.port }),
            ...(patch.status === undefined ? {} : { status: patch.status }),
        };
    }
    recordVisit(node, port, at, durationMs, outcome) {
        // Subflows append to the same trace, so the sequence continues from its tail.
        const seq = (this.state.trace[this.state.trace.length - 1]?.seq ?? 0) + 1;
        const entry = {
            seq,
            at,
            durationMs,
            workflowId: this.document.id,
            depth: this.depth,
            nodeId: node.id,
            nodeType: node.type,
            status: port === 'error' ? 'failed' : (outcome.retried === true ? 'retried' : 'ok'),
            port,
            ...(node.next[port] === undefined ? {} : { target: node.next[port] }),
            ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
            ...(outcome.before === undefined ? {} : { before: outcome.before }),
            ...(outcome.after === undefined ? {} : { after: outcome.after }),
            ...(outcome.output === undefined ? {} : { output: outcome.output }),
        };
        this.state.trace.push(entry);
        if (this.state.trace.length > MAX_TRACE)
            this.state.trace.splice(0, this.state.trace.length - MAX_TRACE);
    }
    /**
     * A node exceeded its own `maxVisits`: report it as a node failure instead of
     * looping forever.
     * @param node - the over-budget node.
     * @param visit - the visit count that tripped the limit.
     * @returns either a terminal result or the next node to enter.
     */
    async failOverBudget(node, visit) {
        const message = `node "${node.name}" was entered ${visit} times, over its maxVisits of ${node.maxVisits}`;
        this.host.log('warn', message);
        this.bumpResult(node.id, { status: 'failed', port: 'error' });
        const errorTarget = node.next.error;
        if (errorTarget !== undefined) {
            await this.host.flush();
            return { next: errorTarget };
        }
        const decision = await this.host.decide({
            nodeId: node.id,
            kind: 'failure',
            message,
            actions: ['retry', 'abort'],
            routes: Object.keys(node.next),
        });
        if (decision.action === 'abort')
            throw aborted();
        if (decision.action === 'route') {
            this.state.visits[node.id] = 0;
            return { next: node.next[decision.port] };
        }
        this.state.visits[node.id] = 0;
        return { next: node.id };
    }
    async pauseForRoute(node, outcome) {
        const ports = Object.keys(node.next);
        const message = `node "${node.name}" took port ${JSON.stringify(outcome.port ?? '')}, which has no connection`;
        this.host.log('warn', message);
        while (true) {
            const decision = await this.host.decide({
                nodeId: node.id,
                kind: 'unrouted',
                message,
                actions: ports.length > 0 ? ['retry', 'route', 'finish', 'abort'] : ['retry', 'finish', 'abort'],
                routes: ports,
            });
            if (decision.action === 'abort')
                throw aborted();
            if (decision.action === 'finish')
                return { end: { result: 'success', reason: 'the operator finished the run at an unconnected port' } };
            if (decision.action === 'retry' || decision.action === 'resume')
                return { next: node.id };
            if (decision.action === 'route' && node.next[decision.port] !== undefined)
                return { next: node.next[decision.port] };
            if (decision.action === 'skip') {
                const port = this.forwardPort(node);
                if (port !== undefined)
                    return { next: node.next[port] };
            }
            this.host.log('warn', `operator decision ${JSON.stringify(decision)} does not apply here`);
        }
    }
    async runWithRetries(node, previous) {
        let attempt = 0;
        while (true) {
            attempt += 1;
            try {
                const outcome = await this.runNode(node, previous, attempt);
                return attempt > 1 ? { ...outcome, retried: true } : outcome;
            }
            catch (error) {
                if (error.name === 'AbortError' || this.host.signal.aborted)
                    throw aborted();
                const message = error instanceof Error ? error.message : String(error);
                if (attempt <= node.retry.times) {
                    this.host.log('warn', `node "${node.name}" attempt ${attempt} failed: ${message}; retrying`);
                    if (node.retry.delayMs > 0)
                        await this.host.sleep(node.retry.delayMs);
                    await this.host.flush();
                    continue;
                }
                this.host.log('error', `node "${node.name}" failed: ${message}`);
                this.bumpResult(node.id, { status: 'failed' });
                const errorTarget = node.next.error;
                if (errorTarget !== undefined) {
                    return { port: 'error', reason: message, output: { error: message }, retried: attempt > 1 };
                }
                const routes = Object.keys(node.next);
                const forward = this.forwardPort(node);
                let chosen;
                while (chosen === undefined) {
                    const decision = await this.host.decide({
                        nodeId: node.id,
                        kind: 'failure',
                        message: `node "${node.name}" failed: ${message}`,
                        actions: ['retry', ...(forward === undefined ? [] : ['skip']), ...(routes.length > 0 ? ['route'] : []), 'abort'],
                        routes,
                    });
                    if (decision.action === 'abort')
                        throw aborted();
                    if (decision.action === 'retry' || decision.action === 'resume')
                        break;
                    if (decision.action === 'skip' && forward !== undefined)
                        chosen = forward;
                    else if (decision.action === 'route' && node.next[decision.port] !== undefined)
                        chosen = decision.port;
                    else
                        this.host.log('warn', `operator decision ${JSON.stringify(decision)} does not apply here`);
                }
                if (chosen === undefined) {
                    attempt = 0;
                    continue;
                }
                return { port: chosen, reason: `operator routed past the failure: ${message}`, output: { error: message }, retried: attempt > 1 };
            }
        }
    }
    /** The connected port a "skip" continues through: the node's main path. */
    forwardPort(node) {
        const order = ['next', 'ok', 'success', 'true', 'body', 'done', 'found', 'default'];
        return order.find(port => node.next[port] !== undefined)
            ?? Object.keys(node.next).find(port => port !== 'error');
    }
    /** Build the scope an expression or template can read. */
    scope(extra = {}) {
        const nodes = {};
        for (const [id, result] of Object.entries(this.state.results)) {
            nodes[id] = {
                output: result.output,
                visits: result.visits,
                port: result.port,
                status: result.status,
            };
        }
        return {
            vars: this.state.vars,
            inputs: this.state.inputs,
            nodes,
            last: this.lastNodeId === undefined ? undefined : this.state.results[this.lastNodeId]?.output,
            run: {
                visits: Object.values(this.state.visits).reduce((sum, count) => sum + count, 0),
                visionCalls: this.state.visionCalls,
                workflowId: this.document.id,
            },
            frame: this.state.lastFrameHash === undefined ? undefined : { hash: this.state.lastFrameHash },
            ...extra,
        };
    }
    renderConfig(node, extra = {}) {
        return deepRender(node.config, this.scope(extra));
    }
    async runNode(node, previous, attempt = 1) {
        const config = this.renderConfig(node);
        switch (node.type) {
            case 'key':
            case 'shortcut':
            case 'text':
            case 'click':
            case 'move':
            case 'scroll':
            case 'delay':
            case 'sequence':
                return this.runAction(node, { ...config, type: node.type }, config, previous, attempt);
            case 'if': {
                const result = await this.evaluateCondition(node, toCondition(config.condition, `${node.id}.condition`), {});
                return { port: result.passed ? 'true' : 'false', reason: result.reason, output: { result: result.passed } };
            }
            case 'switch': {
                const cases = (config.cases ?? {});
                for (const [port, condition] of Object.entries(cases)) {
                    const result = await this.evaluateCondition(node, toCondition(condition, `${node.id}.cases.${port}`), {});
                    if (result.passed)
                        return { port, reason: result.reason, output: { case: port } };
                }
                return { port: 'default', reason: 'no case matched', output: { case: 'default' } };
            }
            case 'wait_until':
                return this.runWaitUntil(node, {
                    condition: toCondition(config.condition, `${node.id}.condition`),
                    timeoutSec: Number(config.timeoutSec ?? 60),
                    pollMs: Number(config.pollMs ?? 1000),
                });
            case 'loop':
                return this.runLoop(node, config, previous);
            case 'human': {
                const options = (config.options ?? []);
                const decision = await this.host.decide({
                    nodeId: node.id,
                    kind: 'human',
                    message: String(config.message ?? 'Confirm to continue'),
                    actions: ['abort'],
                    options,
                });
                if (decision.action === 'abort')
                    throw aborted();
                const names = options.map(option => option.name);
                const option = decision.action === 'choose' && names.includes(decision.option)
                    ? decision.option
                    : decision.action === 'route' && names.includes(decision.port) ? decision.port : undefined;
                if (option === undefined)
                    throw new NodeFailure(node.id, `operator answer ${JSON.stringify(decision)} is not one of ${names.join(', ')}`);
                return { port: option, reason: `operator chose ${option}`, output: { option } };
            }
            case 'set': {
                const assign = (config.assign ?? {});
                const written = {};
                // `renderConfig` already resolved each template exactly once. Rendering the
                // result again would evaluate `{{…}}` that came from the screen as code.
                for (const [key, value] of Object.entries(assign)) {
                    this.state.vars[key] = value;
                    written[key] = value;
                }
                return { port: 'next', output: { assigned: maskSecrets(written, this.secretInputs) } };
            }
            case 'end': {
                const outputs = (config.outputs ?? {});
                const result = config.result === 'failure' ? 'failure' : 'success';
                return {
                    port: '',
                    end: {
                        result,
                        ...(typeof config.reason === 'string' && config.reason !== '' ? { reason: String(config.reason) } : {}),
                        ...(Object.keys(outputs).length === 0 ? {} : { outputs }),
                    },
                    reason: typeof config.reason === 'string' ? String(config.reason) : undefined,
                };
            }
            case 'vision_check': {
                const settle = Number(config.settleMs ?? 0);
                if (settle > 0)
                    await this.host.sleep(settle);
                const frame = await this.capture(`node-${node.id}`);
                const verdict = await this.visionCheck(frame, String(config.prompt ?? ''), typeof config.context === 'string' ? config.context : undefined);
                return {
                    port: verdict.passed ? 'true' : 'false',
                    reason: verdict.reason,
                    output: { passed: verdict.passed, reason: verdict.reason },
                    after: frame.rel,
                };
            }
            case 'vision_classify': {
                const settle = Number(config.settleMs ?? 0);
                if (settle > 0)
                    await this.host.sleep(settle);
                const frame = await this.capture(`node-${node.id}`);
                const labels = (config.labels ?? {});
                const verdict = await this.visionClassify(frame, labels, typeof config.prompt === 'string' ? config.prompt : undefined);
                return {
                    port: verdict.label,
                    reason: verdict.reason,
                    output: { label: verdict.label, reason: verdict.reason },
                    after: frame.rel,
                };
            }
            case 'vision_extract': {
                const settle = Number(config.settleMs ?? 0);
                if (settle > 0)
                    await this.host.sleep(settle);
                const frame = await this.capture(`node-${node.id}`);
                this.takeVisionBudget();
                const result = await this.host.vision.extract({
                    data: frame.data,
                    fields: (config.fields ?? []),
                    prompt: String(config.prompt ?? ''),
                });
                return { port: 'next', output: result.values, after: frame.rel, reason: 'extracted fields from the screen' };
            }
            case 'locate': {
                const frame = await this.capture(`node-${node.id}`);
                this.takeVisionBudget();
                const result = await this.host.vision.locate({
                    data: frame.data,
                    target: String(config.target ?? ''),
                    ...(typeof config.context === 'string' ? { context: config.context } : {}),
                });
                return {
                    port: result.found ? 'found' : 'not_found',
                    reason: result.reason,
                    output: result.found ? { x: result.x, y: result.y, reason: result.reason } : { reason: result.reason },
                    after: frame.rel,
                };
            }
            case 'image_match':
                return this.runImageMatch(node, config);
            case 'screen_change':
                return this.runScreenChange(node, config);
            case 'subflow':
                return this.runSubflow(node, config);
            default:
                throw new NodeFailure(node.id, `unsupported node type ${JSON.stringify(node.type)}`);
        }
    }
    async runAction(node, action, config, previous, attempt = 1) {
        const verifying = node.verify !== undefined && (node.verify.mode ?? 'none') !== 'none';
        const describe = this.describeActionSafely(node, action);
        // A retry must not repeat an action that already worked but was slow to
        // show: look first, act only when the expected screen is not there yet.
        if (attempt > 1 && verifying && (node.verify?.mode === 'vision' || node.verify?.mode === 'image')) {
            const frame = await this.capture(`node-${node.id}-recheck`);
            const verdict = await this.judgeSpec(node.verify, frame, undefined);
            if (verdict.passed) {
                return { port: 'next', reason: `${describe}; already done before the retry: ${verdict.reason}`, after: frame.rel };
            }
        }
        const looks = verifying || (node.precondition?.mode ?? 'none') !== 'none';
        if (action.type !== 'delay')
            await this.waitForStableScreen(action.type === 'text' || action.type === 'key' ? 1000 : undefined);
        let before;
        if (looks)
            before = await this.capture(`node-${node.id}-before`);
        if (node.precondition !== undefined && (node.precondition.mode ?? 'none') !== 'none') {
            const verdict = await this.pollVerify(node.precondition, before, `node-${node.id}-precondition`);
            if (!verdict.passed) {
                const recovered = await this.recoverFromMismatch(node, previous, verdict.frame, 'precondition');
                if (recovered !== undefined)
                    return recovered;
                throw new NodeFailure(node.id, `precondition failed: ${verdict.reason}`);
            }
            before = verdict.frame ?? before;
        }
        const send = async () => {
            if (action.type === 'delay') {
                await this.host.sleep(Number(config.ms ?? 500));
                return;
            }
            const events = actionEvents({ ...action }, this.host.device.viewMapping);
            if (events.length > 0)
                await this.host.device.control(events);
        };
        await send();
        if (!verifying) {
            return { port: 'next', reason: describe, ...(before === undefined ? {} : { before: before.rel }) };
        }
        let verdict = await this.pollVerify(node.verify, before, `node-${node.id}-after`);
        // Self-healing: the screen does not show what this node expected. Find out
        // where it really is before bothering the operator.
        let repeats = 0;
        const maxRepeats = action.type === 'text' ? 1 : 2;
        while (!verdict.passed && this.autoRecover && node.verify?.mode === 'vision') {
            // An identical frame needs no model to tell: nothing happened at all.
            const diagnosis = before !== undefined && verdict.frame !== undefined && verdict.frame.hash === before.hash
                ? { kind: 'before', reason: 'the screen did not change at all' }
                : await this.diagnose(node, previous, verdict.frame);
            if (diagnosis === undefined)
                break;
            if (diagnosis.kind === 'expected') {
                return {
                    port: 'next',
                    reason: `${describe}; auto-recovered: ${diagnosis.reason}`,
                    retried: true,
                    ...(before === undefined ? {} : { before: before.rel }),
                    ...(verdict.frame === undefined ? {} : { after: verdict.frame.rel }),
                };
            }
            if (diagnosis.kind === 'ahead') {
                this.host.log('warn', `node "${node.name}": the screen is already at "${diagnosis.nodeName}"; continuing from there (${diagnosis.reason})`);
                return {
                    port: 'next',
                    jump: diagnosis.jump,
                    reason: `${describe}; auto-recovered: screen already past "${diagnosis.nodeName}" — ${diagnosis.reason}`,
                    retried: true,
                    ...(before === undefined ? {} : { before: before.rel }),
                    ...(verdict.frame === undefined ? {} : { after: verdict.frame.rel }),
                };
            }
            // Still on the screen the action should have left: it did not take
            // (clicked during an animation, focus elsewhere). Do it again.
            if (repeats >= maxRepeats)
                break;
            repeats += 1;
            this.host.log('warn', `node "${node.name}": the action did not take effect (${diagnosis.reason}); repeating it (${repeats}/${maxRepeats})`);
            await this.waitForStableScreen();
            before = await this.capture(`node-${node.id}-before`);
            await send();
            verdict = await this.pollVerify(node.verify, before, `node-${node.id}-after`);
        }
        if (!verdict.passed)
            throw new NodeFailure(node.id, `verification failed: ${verdict.reason}`);
        return {
            port: 'next',
            reason: `${describe}; ${verdict.reason}${repeats > 0 ? ` (after ${repeats} automatic repeat${repeats > 1 ? 's' : ''})` : ''}`,
            ...(repeats > 0 ? { retried: true } : {}),
            ...(before === undefined ? {} : { before: before.rel }),
            ...(verdict.frame === undefined ? {} : { after: verdict.frame.rel }),
        };
    }
    get autoRecover() {
        return this.document.limits.autoRecover !== false;
    }
    /** Describe an action for the log without leaking a secret input it types. */
    describeActionSafely(node, action) {
        if (action.type === 'text' && this.secretInputs.length > 0) {
            const raw = String(node.config.text ?? '');
            if (this.secretInputs.some(name => raw.includes(`inputs.${name}`))) {
                return `text (secret, ${String(action.text ?? '').length} chars)`;
            }
        }
        return describeAction(action);
    }
    /**
     * Wait until two consecutive frames are identical, so an action does not land
     * while the target is still animating. Bounded; a blinking caret or a clock
     * simply runs the budget out.
     * @param capMs - optional tighter bound for keyboard actions.
     */
    async waitForStableScreen(capMs) {
        const budget = Math.min(capMs ?? Number.POSITIVE_INFINITY, this.document.limits.actionSettleMs ?? 2000);
        if (!(budget > 0))
            return;
        const deadline = Date.now() + budget;
        let previous = this.state.lastFrameHash;
        while (Date.now() < deadline) {
            if (this.host.signal.aborted)
                throw aborted();
            const snapshot = await this.host.device.snapshot();
            const hash = sha256(snapshot.data);
            if (hash === previous) {
                this.state.lastFrameHash = hash;
                return;
            }
            previous = hash;
            if (Date.now() + 250 >= deadline)
                break;
            await this.host.sleep(250);
        }
        if (previous !== undefined)
            this.state.lastFrameHash = previous;
    }
    /**
     * Action nodes reachable along the main path, for recognizing a screen that
     * is already a few steps ahead. Stops at the first non-action node so the
     * jump never skips a branch, a variable assignment, or a read.
     */
    lookahead(node, depth = 3) {
        const out = [];
        const seen = new Set([node.id]);
        let cursor = node;
        while (cursor !== undefined && out.length < depth) {
            const port = this.forwardPort(cursor);
            const nextId = port === undefined || port === 'error' ? undefined : cursor.next[port];
            if (nextId === undefined || seen.has(nextId))
                break;
            seen.add(nextId);
            const next = this.document.nodes[nextId];
            if (next === undefined || !isActionType(next.type))
                break;
            out.push(next);
            cursor = next;
        }
        return out;
    }
    /**
     * Ask the vision model which state the screen is really in when it does not
     * match a node's expectation.
     * @returns what to do, or undefined when the model cannot place the screen.
     */
    async diagnose(node, previous, frame) {
        const expected = node.verify?.mode === 'vision' ? node.verify.prompt?.trim() : undefined;
        if (expected === undefined || expected === '')
            return undefined;
        const labels = { expected };
        const beforeText = this.beforeDescription(node, previous);
        if (beforeText !== undefined)
            labels.before = beforeText;
        const ahead = this.lookahead(node).filter(candidate => candidate.verify?.mode === 'vision' && (candidate.verify.prompt ?? '').trim() !== '');
        ahead.forEach((candidate, index) => { labels[`ahead${index + 1}`] = String(candidate.verify?.prompt).trim(); });
        if (labels.before === undefined && ahead.length === 0)
            return undefined;
        const shot = frame ?? await this.capture(`node-${node.id}-diagnose`);
        let verdict;
        try {
            verdict = await this.visionClassify(shot, labels, `The workflow step "${node.name}" just ran. Decide which description the CURRENT screen matches best. Pick "unknown" when none clearly matches (a different page, an unexpected dialog, an error).`);
        }
        catch (error) {
            this.host.log('warn', `automatic diagnosis failed: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
        this.host.log('info', `diagnosis for "${node.name}": ${verdict.label} — ${verdict.reason}`);
        if (verdict.label === 'expected')
            return { kind: 'expected', reason: verdict.reason };
        if (verdict.label === 'before')
            return { kind: 'before', reason: verdict.reason };
        const match = /^ahead(\d+)$/.exec(verdict.label);
        if (match !== null) {
            const reached = ahead[Number(match[1]) - 1];
            const port = reached === undefined ? undefined : this.forwardPort(reached);
            const jump = reached === undefined || port === undefined ? undefined : reached.next[port];
            if (reached !== undefined && jump !== undefined) {
                // Nodes the target already passed count as visited, so the run panel
                // and `nodes.<id>` expressions reflect the skip.
                for (const skipped of [node, ...ahead.slice(0, Number(match[1]))]) {
                    if (skipped.id !== node.id)
                        this.bumpResult(skipped.id, { status: 'passed', port: 'next' });
                }
                return { kind: 'ahead', jump, nodeName: reached.name, reason: verdict.reason };
            }
        }
        return undefined;
    }
    /** What the screen looked like before this node acted, when the graph says. */
    beforeDescription(node, previous) {
        if (node.precondition?.mode === 'vision' && (node.precondition.prompt ?? '').trim() !== '')
            return node.precondition.prompt?.trim();
        const prior = previous === undefined ? undefined : this.document.nodes[previous];
        if (prior === undefined)
            return undefined;
        if (prior.verify?.mode === 'vision' && (prior.verify.prompt ?? '').trim() !== '')
            return prior.verify.prompt?.trim();
        if (prior.type !== 'wait_until')
            return undefined;
        try {
            const condition = toCondition(prior.config.condition, `${prior.id}.condition`);
            return condition.kind === 'vision' ? condition.prompt : undefined;
        }
        catch {
            return undefined;
        }
    }
    /** A failed precondition may mean the target is ahead; jump when it clearly is. */
    async recoverFromMismatch(node, previous, frame, _what) {
        if (!this.autoRecover)
            return undefined;
        const diagnosis = await this.diagnose(node, previous, frame);
        if (diagnosis?.kind === 'expected') {
            // The node's own effect is already on screen: it was done earlier.
            return { port: 'next', reason: `auto-recovered: ${diagnosis.reason}`, retried: true };
        }
        if (diagnosis?.kind === 'ahead') {
            this.host.log('warn', `node "${node.name}": the screen is already at "${diagnosis.nodeName}"; continuing from there`);
            return { port: 'next', jump: diagnosis.jump, reason: `auto-recovered: screen already past "${diagnosis.nodeName}" — ${diagnosis.reason}`, retried: true };
        }
        return undefined;
    }
    async runWaitUntil(node, config) {
        const timeoutSec = Number(config.timeoutSec ?? 60);
        const pollMs = Number(config.pollMs ?? 1000);
        const deadline = Date.now() + timeoutSec * 1000;
        let last = 'condition never evaluated';
        while (Date.now() <= deadline) {
            if (this.host.signal.aborted)
                throw aborted();
            const result = await this.evaluateCondition(node, config.condition, {});
            last = result.reason;
            if (result.passed)
                return { port: 'ok', reason: result.reason, output: { waitedMs: timeoutSec * 1000 - (deadline - Date.now()) } };
            if (Date.now() + pollMs > deadline)
                break;
            await this.host.sleep(pollMs);
        }
        return { port: 'timeout', reason: `timed out after ${timeoutSec}s: ${last}`, output: { timedOut: true, reason: last } };
    }
    async runLoop(node, config, previous) {
        const body = this.bodySets.get(node.id) ?? new Set();
        const reentry = previous !== undefined && body.has(previous);
        if (!reentry) {
            this.loops.set(node.id, 0);
            if (typeof config.indexVar === 'string')
                this.state.vars[config.indexVar] = 0;
        }
        const iteration = this.loops.get(node.id) ?? 0;
        // `count` is an exact repeat count; otherwise `maxIterations` caps a while-loop.
        const max = typeof config.count === 'number' ? config.count : Number(config.maxIterations ?? 10);
        if (iteration >= max) {
            return { port: 'done', reason: `finished after ${iteration} iteration(s)`, output: { iterations: iteration } };
        }
        if (config.while !== undefined && config.while !== null) {
            const condition = await this.evaluateCondition(node, toCondition(config.while, `${node.id}.while`), {});
            if (!condition.passed) {
                return { port: 'done', reason: `while condition ended the loop: ${condition.reason}`, output: { iterations: iteration } };
            }
        }
        const next = iteration + 1;
        this.loops.set(node.id, next);
        if (typeof config.indexVar === 'string')
            this.state.vars[config.indexVar] = next;
        return { port: 'body', reason: `iteration ${next}/${max}`, output: { iteration: next, total: max } };
    }
    async runImageMatch(node, config) {
        const reference = await this.host.readAsset(this.document.id, String(config.image ?? ''));
        const frame = await this.capture(`node-${node.id}`);
        const referenceHash = sha256(reference);
        const delta = Math.abs(reference.length - frame.bytes);
        const tolerance = Number(config.maxByteDelta ?? 0);
        const passed = referenceHash === frame.hash || (tolerance > 0 && delta <= tolerance);
        return {
            port: passed ? 'true' : 'false',
            reason: passed
                ? (referenceHash === frame.hash ? 'screen matches the reference image exactly' : `screen is within ${tolerance} bytes of the reference (${delta})`)
                : `screen differs from the reference image (${delta} byte delta)`,
            output: { passed, byteDelta: delta },
            after: frame.rel,
        };
    }
    async runScreenChange(node, config) {
        const compareWith = config.compareWith === 'run-start' ? 'run-start' : 'previous';
        const reference = compareWith === 'run-start' ? this.state.runStartHash : this.state.lastFrameHash;
        const frame = await this.capture(`node-${node.id}`);
        if (reference === undefined)
            return { port: 'true', reason: 'no earlier frame to compare with; treating as changed', output: { changed: true }, after: frame.rel };
        const changed = reference !== frame.hash;
        return {
            port: changed ? 'true' : 'false',
            reason: changed ? `screen changed since the ${compareWith} frame` : `screen is identical to the ${compareWith} frame`,
            output: { changed },
            after: frame.rel,
        };
    }
    async runSubflow(node, config) {
        if (this.depth + 1 > MAX_DEPTH)
            throw new NodeFailure(node.id, `subflow depth limit ${MAX_DEPTH} reached`);
        const id = String(config.workflow ?? '');
        const child = await this.host.loadSubflow(id);
        const inputs = (config.inputs ?? {});
        const missing = Object.entries(child.inputs)
            .filter(([name, spec]) => spec.required && inputs[name] === undefined && spec.default === undefined)
            .map(([name]) => name);
        if (missing.length > 0)
            throw new NodeFailure(node.id, `subflow ${id} needs inputs: ${missing.join(', ')}`);
        const resolved = {};
        for (const [name, spec] of Object.entries(child.inputs)) {
            resolved[name] = inputs[name] ?? spec.default;
        }
        const childState = {
            vars: { ...child.vars },
            inputs: resolved,
            visits: {},
            trace: this.state.trace,
            visionCalls: this.state.visionCalls,
            phase: '',
            results: {},
        };
        const interpreter = new Interpreter(child, this.host, childState, {
            depth: this.depth + 1,
            inputs: resolved,
            secretInputs: Object.entries(child.inputs).filter(([, spec]) => spec.type === 'secret').map(([name]) => name),
        });
        const outcome = await interpreter.run();
        this.state.visionCalls = childState.visionCalls;
        return {
            port: outcome.result === 'success' ? 'success' : 'failure',
            reason: outcome.reason ?? `subflow ${id} ${outcome.result}`,
            output: outcome.outputs ?? {},
        };
    }
    takeVisionBudget() {
        this.state.visionCalls += 1;
        if (this.state.visionCalls > this.document.limits.maxVisionCalls) {
            throw new Error(`vision budget exhausted after ${this.document.limits.maxVisionCalls} calls; raise limits.maxVisionCalls to allow more`);
        }
    }
    async capture(tag) {
        const snapshot = await this.host.device.snapshot();
        const hash = sha256(snapshot.data);
        const rel = await this.host.saveShot(tag, snapshot.data);
        if (this.state.runStartHash === undefined)
            this.state.runStartHash = hash;
        this.state.lastFrameHash = hash;
        return { data: snapshot.data, hash, bytes: snapshot.data.length, rel };
    }
    async visionCheck(frame, condition, context) {
        const key = `${frame.hash}|${condition}|${context ?? ''}`;
        const cached = this.visionCache.get(key);
        if (cached !== undefined)
            return { passed: cached.verdict, reason: `${cached.reason} (cached)` };
        this.takeVisionBudget();
        try {
            const verdict = await this.host.vision.check({ data: frame.data, condition, ...(context === undefined ? {} : { context }) });
            this.visionCache.set(key, { verdict: verdict.passed, reason: verdict.reason });
            return { passed: verdict.passed, reason: verdict.reason };
        }
        catch (error) {
            throw new Error(`vision check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async visionClassify(frame, labels, prompt) {
        const key = `${frame.hash}|${JSON.stringify(labels)}|${prompt ?? ''}`;
        const cached = this.classifyCache.get(key);
        if (cached !== undefined)
            return cached;
        this.takeVisionBudget();
        try {
            const verdict = await this.host.vision.classify({ data: frame.data, labels, ...(prompt === undefined ? {} : { prompt }) });
            const label = Object.hasOwn(labels, verdict.label) ? verdict.label : 'unknown';
            const value = { label, reason: verdict.reason };
            this.classifyCache.set(key, value);
            return value;
        }
        catch (error) {
            throw new Error(`vision classify failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Poll one verification spec until it passes or its budget runs out.
     * @param spec - the verification.
     * @param before - frame captured before the action, for `change`.
     * @param tag - run-shot tag.
     * @returns the verdict and the last frame.
     */
    async pollVerify(spec, before, tag) {
        const mode = spec.mode ?? 'none';
        if (mode === 'none')
            return { passed: true, reason: 'no verification requested' };
        const settleMs = Math.max(0, spec.settleMs ?? 800);
        if (settleMs > 0)
            await this.host.sleep(settleMs);
        const timeoutSec = Math.max(1, spec.timeoutSec ?? 12);
        const pollMs = Math.max(100, spec.pollMs ?? 600);
        const deadline = Date.now() + timeoutSec * 1000;
        let last = { passed: false, reason: 'no frame captured' };
        while (Date.now() <= deadline) {
            if (this.host.signal.aborted)
                throw aborted();
            const frame = await this.capture(tag);
            last = { ...(await this.judgeSpec(spec, frame, before)), frame };
            if (last.passed)
                return last;
            if (Date.now() + pollMs > deadline)
                break;
            await this.host.sleep(pollMs);
        }
        return last;
    }
    async judgeSpec(spec, frame, before) {
        const mode = spec.mode ?? 'none';
        if (mode === 'change') {
            const requireChange = spec.changed ?? true;
            const reference = before?.hash ?? this.state.lastFrameHash;
            if (reference === undefined)
                return { passed: requireChange, reason: 'no prior frame to compare; treating as passed' };
            // `state.lastFrameHash` was just replaced by this frame, so compare against
            // the explicit reference captured before the action.
            const changed = reference !== frame.hash;
            return { passed: changed === requireChange, reason: changed ? 'screen changed' : 'screen did not change' };
        }
        if (mode === 'image') {
            const reference = await this.host.readAsset(this.document.id, spec.image ?? '');
            const referenceHash = sha256(reference);
            if (referenceHash === frame.hash)
                return { passed: true, reason: 'screen matches the reference image' };
            const delta = Math.abs(reference.length - frame.bytes);
            if (spec.maxByteDelta !== undefined && delta <= spec.maxByteDelta) {
                return { passed: true, reason: `screen is similar to the reference image (${delta} byte delta)` };
            }
            return { passed: false, reason: `screen differs from the reference image (${delta} byte delta)` };
        }
        if (mode === 'vision') {
            const verdict = await this.visionCheck(frame, spec.prompt?.trim() || 'the screen shows progress away from the previous state', undefined);
            return { passed: verdict.passed, reason: verdict.reason };
        }
        return { passed: false, reason: `unsupported verification mode ${JSON.stringify(mode)}` };
    }
    async evaluateCondition(node, condition, extra) {
        switch (condition.kind) {
            case 'expr': {
                const parsed = parseExpression(condition.expr);
                const value = evaluateExpression(parsed, this.scope(extra));
                return { passed: evaluateTruth(parsed, this.scope(extra)), reason: `expression ${JSON.stringify(condition.expr)} = ${JSON.stringify(value)}` };
            }
            case 'vision': {
                if ((condition.settleMs ?? 0) > 0)
                    await this.host.sleep(condition.settleMs ?? 0);
                const frame = await this.capture(`node-${node.id}-check`);
                const verdict = await this.visionCheck(frame, condition.prompt, condition.context);
                return { passed: verdict.passed, reason: verdict.reason };
            }
            case 'image': {
                const frame = await this.capture(`node-${node.id}-check`);
                const verdict = await this.judgeSpec({ mode: 'image', image: condition.image, maxByteDelta: condition.maxByteDelta }, frame, undefined);
                return verdict;
            }
            case 'change': {
                const reference = this.state.lastFrameHash;
                const frame = await this.capture(`node-${node.id}-check`);
                if (reference === undefined)
                    return { passed: condition.changed, reason: 'no earlier frame to compare; treating as changed' };
                const changed = reference !== frame.hash;
                return { passed: changed === condition.changed, reason: changed ? 'screen changed' : 'screen did not change' };
            }
            case 'all': {
                for (const item of condition.items) {
                    const verdict = await this.evaluateCondition(node, item, extra);
                    if (!verdict.passed)
                        return { passed: false, reason: verdict.reason };
                }
                return { passed: true, reason: 'every condition held' };
            }
            case 'any': {
                let last = 'no condition held';
                for (const item of condition.items) {
                    const verdict = await this.evaluateCondition(node, item, extra);
                    if (verdict.passed)
                        return { passed: true, reason: verdict.reason };
                    last = verdict.reason;
                }
                return { passed: false, reason: last };
            }
            case 'not': {
                const verdict = await this.evaluateCondition(node, condition.item, extra);
                return { passed: !verdict.passed, reason: `not (${verdict.reason})` };
            }
            default:
                return { passed: false, reason: 'unsupported condition' };
        }
    }
}
/** Ports a node exposes; re-exported for the runner's awaiting UI. */
export function nodePorts(node) {
    return portsForNode(node.type, node.config).map(port => port.name);
}
/** Release events, re-exported so the runner does not import the action module. */
export function releaseEvents() {
    return releaseAllEvents();
}
