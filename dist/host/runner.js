/**
 * The run supervisor: one active run at a time, the BIOS prelude, the pause
 * protocol, and the run record the panel reads.
 *
 * Execution itself lives in `flow/interp.ts`; this file owns everything that
 * touches the store, the device client, DSH's model, and the human.
 */
import { LinkrError, keyTap, } from './linkr.js';
import { imageFacts } from './image.js';
import { classifyWithVision, extractWithVision, locateWithVision, verifyWithVision } from './model.js';
import { StoreError } from './store.js';
import { analyzeFlow, hasErrors } from './flow/graph.js';
import { Interpreter, releaseEvents } from './flow/interp.js';
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, Math.max(0, ms));
        const onAbort = () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
function describeError(error) {
    if (error instanceof LinkrError)
        return `${error.code}: ${error.message}`;
    if (error instanceof StoreError)
        return `${error.code}: ${error.message}`;
    return error instanceof Error ? error.message : String(error);
}
function isAbort(error) {
    return error instanceof Error && (error.name === 'AbortError' || error.message === 'aborted');
}
/** Node rows for the panel: every node in the document, plus their latest state. */
function initialNodes(document) {
    return Object.values(document.nodes).map((node, index) => ({
        index,
        id: node.id,
        name: node.name,
        type: node.type,
        status: 'pending',
        attempts: 0,
    }));
}
/** One workflow run at a time, with a deterministic, inspectable node trace. */
export class Runner {
    ctx;
    store;
    clientFor;
    onChange;
    runtimes = new Map();
    lastRunId;
    constructor(deps) {
        this.ctx = deps.ctx;
        this.store = deps.store;
        this.clientFor = deps.clientFor;
        this.onChange = deps.onChange;
    }
    activeRun() {
        for (const runtime of this.runtimes.values()) {
            if (!runtime.finished)
                return runtime.run;
        }
        return undefined;
    }
    async latestRun() {
        const active = this.activeRun();
        if (active !== undefined)
            return active;
        if (this.lastRunId !== undefined) {
            try {
                return await this.store.getRun(this.lastRunId);
            }
            catch {
                return undefined;
            }
        }
        return undefined;
    }
    /**
     * Start one workflow.
     * @param workflowId - workflow file id.
     * @param deviceId - optional device override.
     * @param options - BIOS arming and input values.
     * @returns the run record as soon as it is armed or running.
     */
    async start(workflowId, deviceId, options = {}) {
        const active = this.activeRun();
        if (active !== undefined) {
            throw new StoreError('RUN_ACTIVE', `run ${active.id} is still active; control it before starting another`);
        }
        const document = await this.store.loadFlow(workflowId);
        const issues = analyzeFlow(document);
        if (hasErrors(issues)) {
            const first = issues.find(issue => issue.severity === 'error');
            throw new StoreError('INVALID_FLOW', `workflow ${workflowId} has errors: ${first?.message ?? 'unknown'}`);
        }
        const device = this.store.getDevice(deviceId ?? document.deviceId);
        const inputs = this.collectInputs(document, options.inputs ?? {});
        const now = Date.now();
        const nodes = initialNodes(document);
        const run = {
            id: `run-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            workflowId: document.id,
            workflowName: document.name,
            deviceId: device.id,
            status: 'starting',
            phase: 'prepare',
            createdAt: now,
            updatedAt: now,
            currentStepIndex: 0,
            schema: 2,
            steps: nodes,
            log: [],
            trace: [],
            vars: { ...document.vars },
            inputs: Object.fromEntries(Object.entries(document.inputs).map(([name, spec]) => [name, {
                    provided: inputs.values[name] !== undefined,
                    secret: spec.type === 'secret',
                    ...(spec.type === 'secret' ? {} : { value: inputs.values[name] }),
                }])),
            visits: 0,
            visionCalls: 0,
        };
        if (document.bios !== undefined && options.armBios !== false) {
            run.status = 'armed';
            run.phase = 'bios: waiting for power';
        }
        const visionModel = options.visionModel ?? document.visionModel;
        const runtime = {
            run,
            document,
            device,
            ...(visionModel === undefined ? {} : { visionModel }),
            controller: new AbortController(),
            pauseRequested: false,
            finished: false,
        };
        this.runtimes.set(run.id, runtime);
        this.lastRunId = run.id;
        this.log(runtime, 'info', `Starting workflow "${document.name}" on ${device.name} (${Object.keys(document.nodes).length} nodes)${visionModel === undefined ? '' : ` · vision model ${visionModel.provider}/${visionModel.model}`}`);
        await this.persist(runtime);
        // The interpreter reads `inputs.<name>` directly, so hand it the values map
        // itself, not the `{ values }` wrapper `collectInputs` returns.
        void this.worker(runtime, { armBios: options.armBios, inputs: inputs.values }).catch(error => {
            console.error('[kvmflow] run worker crashed:', error);
        });
        return run;
    }
    /**
     * Fill and check the document's declared inputs.
     * @param document - workflow document.
     * @param provided - caller-supplied values.
     * @returns values by input name.
     */
    collectInputs(document, provided) {
        const values = {};
        const missing = [];
        for (const [name, spec] of Object.entries(document.inputs)) {
            const value = provided[name] ?? spec.default;
            if (value === undefined || value === null || value === '') {
                if (spec.required)
                    missing.push(name);
                continue;
            }
            values[name] = spec.type === 'number' ? Number(value) : spec.type === 'boolean' ? Boolean(value) : String(value);
        }
        if (missing.length > 0) {
            throw new StoreError('MISSING_INPUT', `workflow ${document.id} needs inputs: ${missing.join(', ')}`);
        }
        return { values };
    }
    /**
     * Apply a human control action to a paused or running run.
     * @param runId - run id.
     * @param action - control verb.
     * @param options - port or option for `route` / `choose`.
     * @returns the run record.
     */
    async control(runId, action, options = {}) {
        const runtime = this.runtimes.get(runId);
        if (runtime === undefined || runtime.finished) {
            throw new StoreError('RUN_NOT_ACTIVE', `run ${JSON.stringify(runId)} is not active`);
        }
        this.log(runtime, 'info', `Operator action: ${action}${options.port === undefined ? '' : ` ${options.port}`}${options.option === undefined ? '' : ` ${options.option}`}`);
        if (action === 'abort') {
            runtime.controller.abort();
            runtime.waiter?.({ action: 'abort' });
            runtime.waiter = undefined;
            await this.persist(runtime);
            return runtime.run;
        }
        if (action === 'pause') {
            runtime.pauseRequested = true;
            await this.persist(runtime);
            return runtime.run;
        }
        const waiter = runtime.waiter;
        if (waiter === undefined) {
            throw new StoreError('RUN_NOT_WAITING', `run ${JSON.stringify(runId)} is not waiting for a decision`);
        }
        const decision = this.toDecision(action, options, runtime.run.awaiting);
        runtime.waiter = undefined;
        runtime.pauseRequested = false;
        runtime.run.awaiting = undefined;
        runtime.run.reason = undefined;
        if (runtime.run.status === 'paused') {
            runtime.run.status = 'running';
            runtime.run.phase = 'running';
        }
        waiter(decision);
        await this.persist(runtime);
        return runtime.run;
    }
    toDecision(action, options, awaiting) {
        if (awaiting?.kind === 'bios_confirm')
            return { action: action === 'abort' ? 'abort' : 'resume' };
        switch (action) {
            case 'retry':
                return { action: 'retry' };
            case 'resume':
                return { action: 'resume' };
            case 'skip':
            case 'continue':
                return { action: 'skip' };
            case 'finish':
                return { action: 'finish' };
            case 'route':
                if (options.port === undefined || options.port === '')
                    throw new StoreError('INVALID_ROUTE', 'route needs a port');
                return { action: 'route', port: options.port };
            case 'choose':
                if (options.option === undefined || options.option === '')
                    throw new StoreError('INVALID_CHOICE', 'choose needs an option');
                return { action: 'choose', option: options.option };
            default:
                throw new StoreError('INVALID_CONTROL', `control ${JSON.stringify(action)} cannot answer a paused run`);
        }
    }
    /** Abort any live run when the plugin unloads. */
    dispose() {
        for (const runtime of this.runtimes.values()) {
            runtime.controller.abort();
            runtime.waiter?.({ action: 'abort' });
            runtime.waiter = undefined;
        }
        this.runtimes.clear();
    }
    log(runtime, level, message) {
        runtime.run.log.push({ at: Date.now(), level, message: message.slice(0, 2000) });
        if (runtime.run.log.length > 200)
            runtime.run.log.splice(0, runtime.run.log.length - 200);
        runtime.run.updatedAt = Date.now();
    }
    async persist(runtime) {
        runtime.run.updatedAt = Date.now();
        await this.store.saveRun(runtime.run);
        this.onChange?.(runtime.run);
    }
    /** Copy interpreter state back into the run record. */
    syncState(runtime, state) {
        const run = runtime.run;
        run.vars = state.vars;
        run.visits = Object.values(state.visits).reduce((sum, count) => sum + count, 0);
        run.visionCalls = state.visionCalls;
        run.trace = state.trace;
        run.currentNodeId = state.currentNodeId;
        if (state.phase !== '')
            run.phase = state.phase;
        for (const node of run.steps) {
            const result = state.results[node.id];
            if (result === undefined)
                continue;
            node.attempts = result.visits;
            node.port = result.port;
            node.output = result.output;
            if (result.status === 'running')
                node.status = 'acting';
            else if (result.status === 'passed')
                node.status = 'passed';
            else if (result.status === 'failed')
                node.status = 'failed';
            else if (result.status === 'pending')
                node.status = 'pending';
        }
        const seek = run.trace[run.trace.length - 1];
        if (seek !== undefined) {
            const node = run.steps.find(step => step.id === seek.nodeId);
            if (node !== undefined) {
                if (seek.before !== undefined)
                    node.before = seek.before;
                if (seek.after !== undefined)
                    node.after = seek.after;
                if (seek.reason !== undefined)
                    node.verify = { mode: 'vision', passed: seek.status === 'ok', reason: seek.reason };
            }
        }
        run.currentStepIndex = Math.max(0, run.steps.findIndex(step => step.id === run.currentNodeId));
    }
    async requestDecision(runtime, request) {
        if (runtime.controller.signal.aborted)
            return { action: 'abort' };
        const kind = request.kind === 'human' ? 'human' : request.kind === 'unrouted' ? 'unrouted' : 'failure';
        runtime.run.status = 'paused';
        runtime.run.phase = request.kind === 'human' ? 'awaiting operator' : 'awaiting intervention';
        runtime.run.reason = request.message;
        runtime.run.awaiting = {
            kind,
            message: request.message,
            nodeId: request.nodeId,
            actions: request.actions,
            ...(request.routes === undefined || request.routes.length === 0 ? {} : { routes: request.routes }),
            ...(request.options === undefined || request.options.length === 0 ? {} : { options: request.options }),
        };
        this.log(runtime, 'warn', request.message);
        await this.persist(runtime);
        return new Promise(resolve => {
            if (runtime.controller.signal.aborted) {
                resolve({ action: 'abort' });
                return;
            }
            runtime.waiter = resolve;
            runtime.controller.signal.addEventListener('abort', () => resolve({ action: 'abort' }), { once: true });
        });
    }
    async worker(runtime, options) {
        const { run, document } = runtime;
        const state = {
            vars: { ...document.vars },
            inputs: options.inputs,
            visits: {},
            trace: [],
            visionCalls: 0,
            phase: '',
            results: {},
        };
        const host = this.buildHost(runtime, state);
        try {
            run.startedAt = Date.now();
            if (!(document.bios !== undefined && options.armBios !== false)) {
                run.status = 'running';
                run.phase = 'running';
            }
            await this.persist(runtime);
            if (document.bios !== undefined && options.armBios !== false) {
                const proceed = await this.biosPhase(runtime);
                if (!proceed)
                    return;
            }
            if (document.bios !== undefined && options.armBios === false) {
                this.log(runtime, 'info', 'BIOS prelude skipped by operator');
            }
            const interpreter = new Interpreter(document, host, state, {
                inputs: options.inputs,
                secretInputs: Object.entries(document.inputs).filter(([, spec]) => spec.type === 'secret').map(([name]) => name),
            });
            const outcome = await interpreter.run();
            this.syncState(runtime, state);
            run.status = outcome.result === 'success' ? 'succeeded' : 'failed';
            run.phase = outcome.result === 'success' ? 'done' : 'failed';
            run.reason = outcome.reason;
            run.outputs = outcome.outputs;
            run.endedAt = Date.now();
            this.log(runtime, outcome.result === 'success' ? 'info' : 'warn', `Workflow ${outcome.result}${outcome.reason === undefined ? '' : `: ${outcome.reason}`}`);
            await this.persist(runtime);
        }
        catch (error) {
            this.syncState(runtime, state);
            if (isAbort(error) || runtime.controller.signal.aborted) {
                run.status = 'aborted';
                run.phase = 'aborted';
                run.reason = 'aborted';
                run.endedAt = Date.now();
                this.log(runtime, 'warn', 'Run aborted');
            }
            else {
                run.status = 'failed';
                run.phase = 'failed';
                run.reason = describeError(error);
                run.endedAt = Date.now();
                this.log(runtime, 'error', `Run failed: ${run.reason}`);
            }
            await this.persist(runtime);
        }
        finally {
            // Whatever happened, the target must not be left with a key held down.
            try {
                await host.releaseAll();
            }
            catch {
                // best effort
            }
            runtime.finished = true;
            runtime.waiter = undefined;
            this.lastRunId = run.id;
        }
    }
    buildHost(runtime, state) {
        const device = runtime.device;
        const client = this.clientFor(device);
        const runId = runtime.run.id;
        return {
            signal: runtime.controller.signal,
            device: {
                snapshot: async () => {
                    const snapshot = await client.snapshot();
                    return { data: snapshot.data };
                },
                control: async (events) => {
                    if (events.length > 0)
                        await client.control(events);
                },
                ...(device.viewMapping === undefined ? {} : { viewMapping: device.viewMapping }),
            },
            vision: {
                check: async (request) => verifyWithVision(this.ctx, {
                    data: request.data,
                    condition: request.condition,
                    ...(request.context === undefined ? {} : { context: request.context }),
                    ...(runtime.visionModel === undefined ? {} : { model: runtime.visionModel }),
                    signal: runtime.controller.signal,
                }),
                classify: async (request) => classifyWithVision(this.ctx, {
                    data: request.data,
                    labels: request.labels,
                    ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
                    ...(runtime.visionModel === undefined ? {} : { model: runtime.visionModel }),
                    signal: runtime.controller.signal,
                }),
                extract: async (request) => extractWithVision(this.ctx, {
                    data: request.data,
                    fields: request.fields,
                    prompt: request.prompt,
                    ...(runtime.visionModel === undefined ? {} : { model: runtime.visionModel }),
                    signal: runtime.controller.signal,
                }),
                locate: async (request) => locateWithVision(this.ctx, {
                    data: request.data,
                    target: request.target,
                    ...(request.context === undefined ? {} : { context: request.context }),
                    ...(runtime.visionModel === undefined ? {} : { model: runtime.visionModel }),
                    signal: runtime.controller.signal,
                }),
            },
            saveShot: async (tag, data) => {
                const rel = await this.store.saveRunShot(runId, data, tag);
                return `runs/${runId}/${rel}`;
            },
            readAsset: async (workflowId, relative) => this.store.readWorkflowAsset(workflowId, relative),
            loadSubflow: async (id) => this.store.loadFlow(id),
            log: (level, message) => this.log(runtime, level, message),
            flush: async () => {
                this.syncState(runtime, state);
                await this.persist(runtime);
            },
            decide: async (request) => this.requestDecision(runtime, request),
            sleep: async (ms) => sleep(ms, runtime.controller.signal),
            releaseAll: async () => {
                try {
                    await client.control(releaseEvents());
                }
                catch {
                    // Releasing is best effort; the run is already stopping.
                }
            },
        };
    }
    /**
     * Run one node against the live target without starting a full run, so an
     * author can check a vision prompt or a click before wiring the graph.
     * @param workflowId - workflow the node belongs to.
     * @param nodeId - node to execute.
     * @param deviceId - optional device override.
     * @returns the node's ports, reason and saved frames.
     */
    async nodeTest(workflowId, nodeId, deviceId) {
        if (this.activeRun() !== undefined) {
            throw new StoreError('RUN_ACTIVE', 'finish or abort the active run before testing single nodes');
        }
        const document = await this.store.loadFlow(workflowId);
        const node = document.nodes[nodeId];
        if (node === undefined)
            throw new StoreError('NODE_NOT_FOUND', `node ${JSON.stringify(nodeId)} does not exist in ${workflowId}`);
        const device = this.store.getDevice(deviceId ?? document.deviceId);
        const testId = `test-${Date.now().toString(36)}`;
        // Route every port at a synthetic end node so the interpreter stops after
        // this one node instead of pausing at an unconnected port.
        const stopId = 'test-end';
        const testNode = { ...node, next: Object.fromEntries(Object.keys(node.next).map(port => [port, stopId])) };
        if (Object.keys(testNode.next).length === 0)
            testNode.next = { next: stopId };
        const documentForTest = {
            ...document,
            start: nodeId,
            nodes: {
                ...document.nodes,
                [nodeId]: testNode,
                [stopId]: { id: stopId, type: 'end', name: 'Test end', config: { result: 'success' }, next: {}, retry: { times: 0, delayMs: 0 }, maxVisits: 1 },
            },
        };
        const state = {
            vars: { ...document.vars },
            inputs: {},
            visits: {},
            trace: [],
            visionCalls: 0,
            phase: '',
            results: {},
        };
        const controller = new AbortController();
        const runtime = {
            run: {
                id: testId,
                workflowId: document.id,
                workflowName: document.name,
                deviceId: device.id,
                status: 'running',
                phase: `test ${nodeId}`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                currentStepIndex: 0,
                steps: [],
                log: [],
            },
            document: documentForTest,
            device,
            ...(document.visionModel === undefined ? {} : { visionModel: document.visionModel }),
            controller,
            pauseRequested: false,
            finished: false,
        };
        const host = this.buildHost(runtime, state);
        // A single-node test must never block the caller on a human decision.
        const decider = host.decide;
        host.decide = async (request) => {
            this.log(runtime, 'warn', `node test paused: ${request.message}`);
            return { action: 'finish' };
        };
        const interpreter = new Interpreter(documentForTest, host, state, {
            secretInputs: Object.entries(document.inputs).filter(([, spec]) => spec.type === 'secret').map(([name]) => name),
        });
        const started = Date.now();
        let outcome;
        try {
            outcome = await interpreter.run();
        }
        finally {
            host.decide = decider;
            runtime.finished = true;
            try {
                await host.releaseAll();
            }
            catch {
                // best effort
            }
        }
        const entry = state.trace.find(item => item.nodeId === nodeId);
        return {
            nodeId,
            ...(entry?.port === undefined ? {} : { port: entry.port }),
            ...(entry?.reason === undefined ? {} : { reason: entry.reason }),
            ...(entry?.output === undefined ? {} : { output: entry.output }),
            ...(entry?.before === undefined ? {} : { before: entry.before }),
            ...(entry?.after === undefined ? {} : { after: entry.after }),
            durationMs: Date.now() - started,
            visionCalls: state.visionCalls,
            ...(entry === undefined ? { reason: outcome.reason ?? 'the node produced no trace entry' } : {}),
        };
    }
    async biosPhase(runtime) {
        const { run, document, device } = runtime;
        const bios = document.bios ?? { hotkey: 'F2', intervalMs: 1200, timeoutSec: 180, requireConfirm: false, settleSec: 2 };
        const hotkey = bios.hotkey?.trim() || 'F2';
        const intervalMs = Math.max(300, bios.intervalMs ?? 1200);
        const timeoutSec = Math.max(5, bios.timeoutSec ?? 180);
        const requireConfirm = bios.requireConfirm ?? false;
        const settleSec = Math.max(0, bios.settleSec ?? 2);
        run.status = 'armed';
        run.phase = 'bios: waiting for power';
        run.bios = {
            hotkey,
            intervalMs,
            timeoutSec,
            requireConfirm,
            armedAt: Date.now(),
        };
        this.log(runtime, 'info', `BIOS prelude armed: tapping ${hotkey} every ${intervalMs}ms, waiting up to ${timeoutSec}s for the target power button`);
        await this.persist(runtime);
        while (true) {
            if (runtime.controller.signal.aborted)
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            const started = Date.now();
            let nextTap = 0;
            let lastPoll = 0;
            let detected = false;
            while (Date.now() - started < timeoutSec * 1000) {
                if (runtime.controller.signal.aborted)
                    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
                if (runtime.pauseRequested) {
                    await this.pauseForOperator(runtime);
                    if (runtime.controller.signal.aborted)
                        return false;
                    run.status = 'armed';
                    run.phase = 'bios: waiting for power';
                    run.awaiting = undefined;
                    await this.persist(runtime);
                    nextTap = 0;
                    lastPoll = 0;
                    continue;
                }
                if (Date.now() >= nextTap) {
                    try {
                        await this.clientFor(device).control(keyTap(hotkey));
                        this.log(runtime, 'info', `Injected ${hotkey} while waiting for power`);
                    }
                    catch (error) {
                        this.log(runtime, 'warn', `Hotkey injection failed: ${describeError(error)}`);
                    }
                    nextTap = Date.now() + intervalMs;
                }
                if (Date.now() - lastPoll >= 1000) {
                    lastPoll = Date.now();
                    try {
                        const snapshot = await this.clientFor(device).snapshot();
                        const facts = imageFacts(snapshot.data);
                        const rel = await this.store.saveRunShot(run.id, snapshot.data, 'bios');
                        run.bios.baseline = `runs/${run.id}/${rel}`;
                        run.bios.detectedAt = Date.now();
                        this.log(runtime, 'info', `Video signal detected after power-on (${facts.width}x${facts.height}); BIOS prelude complete`);
                        detected = true;
                        break;
                    }
                    catch (error) {
                        if (!(error instanceof LinkrError) || !error.code.startsWith('SNAPSHOT')) {
                            this.log(runtime, 'warn', `Waiting for video signal: ${describeError(error)}`);
                        }
                    }
                }
                await sleep(200, runtime.controller.signal);
            }
            if (!detected) {
                const decision = await this.requestDecision(runtime, {
                    nodeId: '',
                    kind: 'failure',
                    message: `BIOS prelude timed out after ${timeoutSec}s without a video signal. Power on the target, check HDMI/USB, then retry or abort.`,
                    actions: ['retry', 'abort'],
                });
                if (decision.action === 'abort')
                    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
                run.status = 'armed';
                run.phase = 'bios: waiting for power';
                run.reason = undefined;
                await this.persist(runtime);
                continue;
            }
            if (settleSec > 0)
                await sleep(settleSec * 1000, runtime.controller.signal);
            if (requireConfirm) {
                runtime.run.status = 'paused';
                runtime.run.phase = 'bios: confirm';
                runtime.run.awaiting = {
                    kind: 'bios_confirm',
                    message: 'Video signal detected. Confirm that the target is in BIOS to continue, or abort.',
                    actions: ['confirm_bios', 'abort'],
                };
                this.log(runtime, 'info', 'Waiting for operator confirmation that BIOS is visible');
                await this.persist(runtime);
                const decision = await new Promise(resolve => {
                    runtime.waiter = resolve;
                    runtime.controller.signal.addEventListener('abort', () => resolve({ action: 'abort' }), { once: true });
                });
                runtime.run.awaiting = undefined;
                runtime.waiter = undefined;
                if (decision.action === 'abort')
                    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            }
            run.status = 'running';
            run.phase = 'bios: entered';
            await this.persist(runtime);
            return true;
        }
    }
    async pauseForOperator(runtime) {
        runtime.pauseRequested = false;
        const decision = await this.requestDecision(runtime, {
            nodeId: runtime.run.currentNodeId ?? '',
            kind: 'failure',
            message: 'Paused by operator. Resume to continue, or abort the run.',
            actions: ['resume', 'abort'],
        });
        runtime.run.awaiting = undefined;
        if (decision.action === 'abort') {
            runtime.run.status = 'aborted';
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        runtime.run.status = 'running';
        runtime.run.phase = 'running';
        runtime.run.reason = undefined;
        await this.persist(runtime);
    }
}
