/**
 * Reading and writing graph documents: YAML value → `FlowDocument`, and back.
 *
 * Normalization is strict about structure and permissive about values: a
 * coordinate or a delay may be a `{{template}}`, because a `locate` node supplies
 * the numbers at run time. Anything that cannot be interpreted is reported with
 * the dotted path that failed, so the YAML view and the agent both get a
 * fixable message instead of a stack trace.
 */
import { validateEvent } from '../linkr.js';
import { inspectTemplates, parseExpression, parseTemplate, isTemplate } from './expr.js';
import { NODE_CATALOG, isNodeType, nodeSpec, portsForNode, } from './schema.js';
export class FlowDocError extends Error {
    code = 'INVALID_FLOW';
    issues;
    constructor(issues) {
        super(issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
        this.name = 'FlowDocError';
        this.issues = issues;
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}
function asNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function asBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function clampInt(value, fallback, min, max) {
    return Math.max(min, Math.min(max, Math.floor(asNumber(value, fallback))));
}
/** `[A-Za-z][A-Za-z0-9_-]*`: safe as a YAML key, a port name and a scope path. */
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
class Collector {
    issues = [];
    fail(path, message) {
        this.issues.push({ path, message });
    }
    /**
     * Run a coercion, recording a failure instead of throwing.
     * @param path - dotted path for the message.
     * @param fallback - value used when the coercion fails.
     * @param coerce - coercion body.
     * @returns the coerced value or the fallback.
     */
    guard(path, fallback, coerce) {
        try {
            return coerce();
        }
        catch (error) {
            this.fail(path, error instanceof Error ? error.message : String(error));
            return fallback;
        }
    }
}
const CONDITION_KINDS = ['vision', 'image', 'change', 'expr', 'all', 'any', 'not'];
/**
 * Coerce a YAML condition. Exactly one kind key is required; `context`,
 * `settleMs` and `maxByteDelta` are modifiers of their kind.
 * @param input - YAML condition mapping.
 * @param path - dotted path for messages.
 * @returns the condition.
 */
export function normalizeCondition(input, path) {
    if (!isRecord(input))
        throw new Error('a condition must be a mapping');
    const keys = Object.keys(input).filter(key => CONDITION_KINDS.includes(key) && input[key] !== undefined && input[key] !== null);
    if (keys.length !== 1) {
        throw new Error(`a condition needs exactly one of ${CONDITION_KINDS.join(', ')} (found ${keys.length === 0 ? 'none' : keys.join(', ')})`);
    }
    const kind = keys[0];
    const value = input[kind];
    switch (kind) {
        case 'vision': {
            const prompt = asString(value, '').trim();
            if (prompt === '')
                throw new Error('vision condition needs a non-empty prompt');
            if (isTemplate(prompt))
                parseTemplate(prompt);
            const context = asString(input.context, '');
            const settleMs = typeof input.settleMs === 'number' ? Math.max(0, Math.min(60_000, input.settleMs)) : undefined;
            return { kind: 'vision', prompt, ...(context === '' ? {} : { context }), ...(settleMs === undefined ? {} : { settleMs }) };
        }
        case 'image': {
            const image = asString(value, '').trim();
            if (image === '')
                throw new Error('image condition needs a reference image path');
            const delta = typeof input.maxByteDelta === 'number' ? Math.max(0, input.maxByteDelta) : undefined;
            return { kind: 'image', image, ...(delta === undefined ? {} : { maxByteDelta: delta }) };
        }
        case 'change': {
            const changed = typeof value === 'boolean' ? value : true;
            return { kind: 'change', changed };
        }
        case 'expr': {
            const source = asString(value, '').trim();
            if (source === '')
                throw new Error('expr condition needs an expression');
            parseExpression(source);
            return { kind: 'expr', expr: source };
        }
        case 'all':
        case 'any': {
            if (!Array.isArray(value) || value.length === 0)
                throw new Error(`${kind} needs a non-empty list of conditions`);
            return { kind, items: value.map((item, index) => normalizeCondition(item, `${path}.${kind}[${index}]`)) };
        }
        case 'not': {
            return { kind: 'not', item: normalizeCondition(value, `${path}.not`) };
        }
        default:
            throw new Error(`unknown condition kind ${JSON.stringify(kind)}`);
    }
}
function normalizeVerify(input, fallbackMode, path) {
    if (input === undefined || input === null)
        return { mode: fallbackMode ?? 'none', settleMs: 800, timeoutSec: 12, pollMs: 600 };
    if (!isRecord(input))
        throw new Error('verify must be a mapping');
    const mode = asString(input.mode, fallbackMode ?? 'change');
    if (!['change', 'image', 'vision', 'none'].includes(mode))
        throw new Error(`unsupported verify mode ${JSON.stringify(mode)}`);
    if (mode === 'vision') {
        const prompt = asString(input.prompt, '').trim();
        if (prompt === '')
            throw new Error(`${path}.prompt is required for vision verification`);
        if (isTemplate(prompt))
            parseTemplate(prompt);
    }
    if (mode === 'image' && asString(input.image, '') === '')
        throw new Error(`${path}.image is required for image verification`);
    return {
        mode: mode,
        ...(typeof input.prompt === 'string' ? { prompt: input.prompt } : {}),
        ...(typeof input.image === 'string' ? { image: input.image } : {}),
        settleMs: Math.max(0, asNumber(input.settleMs, 800)),
        timeoutSec: Math.max(1, asNumber(input.timeoutSec, 12)),
        pollMs: Math.max(100, asNumber(input.pollMs, 600)),
        ...(typeof input.changed === 'boolean' ? { changed: input.changed } : {}),
        ...(typeof input.maxByteDelta === 'number' ? { maxByteDelta: Math.max(0, input.maxByteDelta) } : {}),
    };
}
/** Validate a condition and keep it in its canonical YAML shape inside a config. */
function conditionField(input, path) {
    return conditionToYaml(normalizeCondition(input, path));
}
/** A number, or a template that will supply one at run time. */
function coord(value, path) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value < 0 || value > 1)
            throw new Error(`${path} must be between 0 and 1`);
        return value;
    }
    if (typeof value === 'string' && isTemplate(value)) {
        parseTemplate(value);
        return value;
    }
    throw new Error(`${path} must be a number between 0 and 1, or a template`);
}
function numberOrTemplate(value, path, fallback) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && isTemplate(value)) {
        parseTemplate(value);
        return value;
    }
    if (value === undefined || value === null)
        return fallback;
    throw new Error(`${path} must be a number or a template`);
}
function requireText(value, path) {
    if (typeof value !== 'string' || value.trim() === '')
        throw new Error(`${path} must be a non-empty string`);
    if (isTemplate(value))
        parseTemplate(value);
    return value;
}
function eventsOf(value, path) {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error(`${path} must be a non-empty event list`);
    return value.map((event, index) => validateEvent(event, index));
}
function normalizeLabels(value, path) {
    if (!isRecord(value))
        throw new Error(`${path} must be a mapping of label name to description`);
    const out = {};
    for (const [key, description] of Object.entries(value)) {
        if (!NAME_PATTERN.test(key))
            throw new Error(`${path} label ${JSON.stringify(key)} must match ${NAME_PATTERN}`);
        if (key === 'unknown')
            throw new Error(`${path} label "unknown" is reserved for an unparsable reply`);
        if (typeof description !== 'string' || description.trim() === '')
            throw new Error(`${path}.${key} needs a description`);
        out[key] = description;
    }
    if (Object.keys(out).length === 0)
        throw new Error(`${path} needs at least one label`);
    return out;
}
function normalizeCases(value, path) {
    if (!isRecord(value))
        throw new Error(`${path} must be a mapping of port name to condition`);
    const out = {};
    for (const [key, condition] of Object.entries(value)) {
        if (!NAME_PATTERN.test(key))
            throw new Error(`${path} case ${JSON.stringify(key)} must match ${NAME_PATTERN}`);
        if (key === 'default')
            throw new Error(`${path} case "default" is reserved; it is the fallthrough port`);
        out[key] = conditionField(condition, `${path}.${key}`);
    }
    if (Object.keys(out).length === 0)
        throw new Error(`${path} needs at least one case`);
    return out;
}
function normalizeOptions(value, path) {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error(`${path} needs at least one option`);
    return value.map((item, index) => {
        if (typeof item === 'string') {
            if (!NAME_PATTERN.test(item))
                throw new Error(`${path}[${index}] must match ${NAME_PATTERN}`);
            return { name: item };
        }
        if (isRecord(item)) {
            const name = asString(item.name, '');
            if (!NAME_PATTERN.test(name))
                throw new Error(`${path}[${index}].name must match ${NAME_PATTERN}`);
            const label = asString(item.label, '');
            return { name, ...(label === '' ? {} : { label }) };
        }
        throw new Error(`${path}[${index}] must be a name or { name, label }`);
    });
}
function normalizeStringMap(value, path) {
    if (!isRecord(value))
        throw new Error(`${path} must be a mapping`);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string')
            throw new Error(`${path}.${key} must be a string`);
        if (isTemplate(item))
            parseTemplate(item);
        out[key] = item;
    }
    return out;
}
/**
 * Coerce one node's config for its type.
 * @param type - node type.
 * @param input - raw config.
 * @param path - dotted path for messages.
 * @returns the normalized config.
 */
export function normalizeConfig(type, input, path) {
    const raw = isRecord(input) ? input : {};
    const spec = nodeSpec(type);
    if (spec === undefined)
        throw new Error(`unknown node type ${JSON.stringify(type)}`);
    switch (type) {
        case 'key': {
            const repeat = clampInt(raw.repeat, 1, 1, 100);
            return {
                key: requireText(raw.key, `${path}.key`),
                holdMs: clampInt(raw.holdMs, 60, 1, 5000),
                repeat,
                intervalMs: clampInt(raw.intervalMs, 120, 0, 60_000),
            };
        }
        case 'shortcut': {
            if (!Array.isArray(raw.keys) || raw.keys.length === 0 || raw.keys.some(key => typeof key !== 'string')) {
                throw new Error(`${path}.keys must be a non-empty list of key names`);
            }
            return { keys: raw.keys, holdMs: clampInt(raw.holdMs, 80, 1, 5000) };
        }
        case 'text':
            return {
                text: requireText(raw.text, `${path}.text`),
                submit: asBoolean(raw.submit, false),
                chunkSize: clampInt(raw.chunkSize, 120, 1, 2000),
            };
        case 'click':
            return {
                x: coord(raw.x, `${path}.x`),
                y: coord(raw.y, `${path}.y`),
                button: raw.button === 'right' ? 'right' : raw.button === 'middle' ? 'middle' : 'left',
                count: clampInt(raw.count, 1, 1, 10),
            };
        case 'move':
            return { x: coord(raw.x, `${path}.x`), y: coord(raw.y, `${path}.y`) };
        case 'scroll':
            return {
                x: coord(raw.x ?? 0.5, `${path}.x`),
                y: coord(raw.y ?? 0.5, `${path}.y`),
                wheelY: Math.max(-20, Math.min(20, asNumber(raw.wheelY, 0))),
                wheelX: Math.max(-20, Math.min(20, asNumber(raw.wheelX, 0))),
            };
        case 'delay':
            return { ms: numberOrTemplate(raw.ms, `${path}.ms`, 500) };
        case 'sequence':
            return { events: eventsOf(raw.events, `${path}.events`) };
        case 'if':
            return { condition: conditionField(raw.condition, `${path}.condition`) };
        case 'switch':
            return { cases: normalizeCases(raw.cases, `${path}.cases`) };
        case 'wait_until':
            return {
                condition: conditionField(raw.condition, `${path}.condition`),
                timeoutSec: Math.max(1, Math.min(3600, asNumber(raw.timeoutSec, 60))),
                pollMs: Math.max(200, Math.min(60_000, asNumber(raw.pollMs, 1000))),
            };
        case 'loop': {
            const indexVar = asString(raw.indexVar, '');
            if (indexVar !== '' && !NAME_PATTERN.test(indexVar))
                throw new Error(`${path}.indexVar must match ${NAME_PATTERN}`);
            return {
                maxIterations: clampInt(raw.maxIterations, 10, 1, 1000),
                ...(raw.count === undefined ? {} : { count: clampInt(raw.count, 1, 1, 1000) }),
                ...(raw.while === undefined || raw.while === null ? {} : { while: conditionField(raw.while, `${path}.while`) }),
                ...(indexVar === '' ? {} : { indexVar }),
            };
        }
        case 'human':
            return {
                message: requireText(raw.message, `${path}.message`),
                options: normalizeOptions(raw.options, `${path}.options`),
            };
        case 'subflow': {
            const workflow = requireText(raw.workflow, `${path}.workflow`);
            return {
                workflow,
                ...(raw.inputs === undefined ? {} : { inputs: normalizeStringMap(raw.inputs, `${path}.inputs`) }),
            };
        }
        case 'end': {
            const result = raw.result === 'failure' ? 'failure' : 'success';
            return {
                result,
                ...(typeof raw.reason === 'string' && raw.reason !== '' ? { reason: raw.reason } : {}),
                ...(raw.outputs === undefined ? {} : { outputs: normalizeStringMap(raw.outputs, `${path}.outputs`) }),
            };
        }
        case 'vision_check': {
            return {
                prompt: requireText(raw.prompt, `${path}.prompt`),
                ...(typeof raw.context === 'string' && raw.context !== '' ? { context: raw.context } : {}),
                settleMs: Math.max(0, Math.min(60_000, asNumber(raw.settleMs, 0))),
            };
        }
        case 'vision_classify':
            return {
                prompt: requireText(raw.prompt, `${path}.prompt`),
                labels: normalizeLabels(raw.labels, `${path}.labels`),
                settleMs: Math.max(0, Math.min(60_000, asNumber(raw.settleMs, 0))),
            };
        case 'vision_extract': {
            if (!Array.isArray(raw.fields) || raw.fields.length === 0 || raw.fields.some(field => typeof field !== 'string' || field === '')) {
                throw new Error(`${path}.fields must be a non-empty list of field names`);
            }
            return {
                prompt: requireText(raw.prompt, `${path}.prompt`),
                fields: raw.fields,
                settleMs: Math.max(0, Math.min(60_000, asNumber(raw.settleMs, 0))),
            };
        }
        case 'locate':
            return {
                target: requireText(raw.target, `${path}.target`),
                ...(typeof raw.context === 'string' && raw.context !== '' ? { context: raw.context } : {}),
            };
        case 'image_match':
            return {
                image: requireText(raw.image, `${path}.image`),
                maxByteDelta: Math.max(0, asNumber(raw.maxByteDelta, 0)),
            };
        case 'screen_change':
            return { compareWith: raw.compareWith === 'run-start' ? 'run-start' : 'previous' };
        case 'set':
            return { assign: normalizeStringMap(raw.assign, `${path}.assign`) };
        default:
            throw new Error(`unsupported node type ${JSON.stringify(type)}`);
    }
}
/**
 * Validate one node's config against the catalog's required fields.
 * @param type - node type.
 * @param config - normalized config.
 * @param path - dotted path.
 * @param collector - receives missing-field problems.
 */
function checkRequiredFields(type, config, path, collector) {
    const spec = nodeSpec(type);
    // Action configs are checked field by field in normalizeConfig.
    if (spec === undefined || spec.action)
        return;
    for (const field of spec.fields) {
        if (!field.required)
            continue;
        const value = config[field.key];
        const missing = value === undefined
            || value === null
            || (typeof value === 'string' && value === '')
            || (Array.isArray(value) && value.length === 0);
        if (missing)
            collector.fail(`${path}.${field.key}`, `${field.label[1]} is required`);
    }
}
function normalizeNode(id, input, collector) {
    const path = `nodes.${id}`;
    if (!NAME_PATTERN.test(id)) {
        collector.fail(path, `node id must match ${NAME_PATTERN}`);
        return undefined;
    }
    if (!isRecord(input)) {
        collector.fail(path, 'a node must be a mapping');
        return undefined;
    }
    const type = input.type;
    if (!isNodeType(type)) {
        collector.fail(`${path}.type`, `unknown node type ${JSON.stringify(type)}`);
        return undefined;
    }
    const config = collector.guard(`${path}.config`, {}, () => normalizeConfig(type, input.config ?? input, `${path}.config`));
    checkRequiredFields(type, config, `${path}.config`, collector);
    const next = {};
    if (input.next !== undefined) {
        if (!isRecord(input.next)) {
            collector.fail(`${path}.next`, 'next must be a mapping of port name to node id');
        }
        else {
            const ports = new Set(portsForNode(type, config).map(port => port.name));
            for (const [port, target] of Object.entries(input.next)) {
                if (typeof target !== 'string' || target === '') {
                    collector.fail(`${path}.next.${port}`, 'target must be a node id');
                    continue;
                }
                if (!ports.has(port)) {
                    collector.fail(`${path}.next.${port}`, `node type ${type} has no port ${JSON.stringify(port)}`);
                    continue;
                }
                next[port] = target;
            }
        }
    }
    const retryInput = isRecord(input.retry) ? input.retry : {};
    const node = {
        id,
        type,
        name: asString(input.name, '').trim(),
        ...(typeof input.description === 'string' && input.description !== '' ? { description: input.description } : {}),
        config,
        next,
        retry: {
            times: clampInt(retryInput.times, 0, 0, 20),
            delayMs: clampInt(retryInput.delayMs, 0, 0, 60_000),
        },
        maxVisits: clampInt(input.maxVisits, 100, 1, 100_000),
    };
    if (input.precondition !== undefined && input.precondition !== null) {
        node.precondition = collector.guard(`${path}.precondition`, { mode: 'none' }, () => normalizeVerify(input.precondition, 'vision', `${path}.precondition`));
    }
    if (nodeSpec(type)?.action === true) {
        // An absent verify means "do not verify"; a verify mapping without a mode
        // means the common case, "the screen must change".
        const fallback = input.verify === undefined || input.verify === null ? 'none' : 'change';
        node.verify = collector.guard(`${path}.verify`, { mode: 'none' }, () => normalizeVerify(input.verify, fallback, `${path}.verify`));
    }
    else if (input.verify !== undefined) {
        collector.fail(`${path}.verify`, `node type ${type} evaluates its own condition; verify is only for action nodes`);
    }
    if (node.name === '')
        node.name = nodeSpec(type)?.label[1] ?? type;
    return node;
}
function normalizeInputs(input, collector) {
    if (input === undefined || input === null)
        return {};
    if (!isRecord(input)) {
        collector.fail('inputs', 'inputs must be a mapping');
        return {};
    }
    const out = {};
    for (const [name, spec] of Object.entries(input)) {
        if (!NAME_PATTERN.test(name)) {
            collector.fail(`inputs.${name}`, `input name must match ${NAME_PATTERN}`);
            continue;
        }
        const raw = isRecord(spec) ? spec : {};
        const type = raw.type === 'number' || raw.type === 'boolean' || raw.type === 'secret' ? raw.type : 'string';
        out[name] = {
            type,
            required: asBoolean(raw.required, true),
            ...(typeof raw.description === 'string' && raw.description !== '' ? { description: raw.description } : {}),
            ...(raw.default === undefined ? {} : { default: raw.default }),
        };
    }
    return out;
}
function normalizeLimits(input) {
    const raw = isRecord(input) ? input : {};
    return {
        maxNodeVisits: clampInt(raw.maxNodeVisits, 1000, 1, 100_000),
        timeoutSec: clampInt(raw.timeoutSec, 7200, 10, 86_400),
        maxVisionCalls: clampInt(raw.maxVisionCalls, 400, 1, 5000),
    };
}
function normalizeBios(input) {
    if (!isRecord(input))
        return undefined;
    return {
        hotkey: asString(input.hotkey, 'F2').trim() || 'F2',
        intervalMs: Math.max(300, asNumber(input.intervalMs, 1200)),
        timeoutSec: Math.max(5, asNumber(input.timeoutSec, 180)),
        requireConfirm: asBoolean(input.requireConfirm, false),
        settleSec: Math.max(0, asNumber(input.settleSec, 2)),
    };
}
function normalizeVisionModel(input) {
    if (!isRecord(input))
        return undefined;
    const provider = asString(input.provider, '').trim();
    const model = asString(input.model, '').trim();
    if (provider === '' || model === '')
        return undefined;
    return { provider, model };
}
/**
 * Validate a v1 step-shaped document so the caller can report an upgrade hint.
 * @param input - parsed YAML value.
 * @returns true when the value looks like schema v1.
 */
export function looksLikeV1(input) {
    if (!isRecord(input))
        return false;
    if (input.version === 1)
        return true;
    return Array.isArray(input.steps) && !isRecord(input.nodes);
}
/**
 * Coerce a raw YAML value into a graph document.
 * @param input - parsed YAML value, or an object built by a tool.
 * @param options - fallback id and timestamps.
 * @returns the document and the problems found; a document with problems must not be saved.
 */
export function normalizeFlow(input, options = {}) {
    const collector = new Collector();
    const now = options.now ?? Date.now();
    if (!isRecord(input)) {
        collector.fail('', 'the workflow document must be a mapping');
        return { document: emptyDocument(options.fallbackId ?? 'wf-empty', now), issues: collector.issues };
    }
    if (looksLikeV1(input)) {
        collector.fail('version', 'this is a schema v1 workflow; load it through the store so it can be upgraded to v2');
        return { document: emptyDocument(options.fallbackId ?? 'wf-empty', now), issues: collector.issues };
    }
    if (input.version !== undefined && input.version !== 2) {
        collector.fail('version', `unsupported schema version ${JSON.stringify(input.version)}; this build writes version 2`);
    }
    const nodesInput = isRecord(input.nodes) ? input.nodes : undefined;
    if (nodesInput === undefined)
        collector.fail('nodes', 'nodes must be a mapping of node id to node');
    const nodes = {};
    for (const [id, raw] of Object.entries(nodesInput ?? {})) {
        const node = normalizeNode(id, raw, collector);
        if (node !== undefined)
            nodes[id] = node;
    }
    if (Object.keys(nodes).length === 0 && nodesInput !== undefined) {
        collector.fail('nodes', 'a workflow needs at least one node');
    }
    const start = asString(input.start, '').trim();
    if (start === '')
        collector.fail('start', 'start must name the first node');
    else if (!Object.hasOwn(nodes, start))
        collector.fail('start', `start points at missing node ${JSON.stringify(start)}`);
    const document = {
        version: 2,
        id: asString(input.id, '') || options.fallbackId || `wf-${now.toString(36)}`,
        name: asString(input.name, '').trim() || 'Untitled workflow',
        ...(typeof input.description === 'string' && input.description !== '' ? { description: input.description } : {}),
        ...(typeof input.deviceId === 'string' && input.deviceId !== '' ? { deviceId: input.deviceId } : {}),
        ...(typeof input.sourceRecording === 'string' && input.sourceRecording !== '' ? { sourceRecording: input.sourceRecording } : {}),
        createdAt: options.createdAt ?? asNumber(input.createdAt, now),
        updatedAt: options.updatedAt ?? now,
        start,
        inputs: normalizeInputs(input.inputs, collector),
        vars: isRecord(input.vars) ? { ...input.vars } : {},
        limits: normalizeLimits(input.limits),
        ...(normalizeBios(input.bios) === undefined ? {} : { bios: normalizeBios(input.bios) }),
        ...(normalizeVisionModel(input.visionModel) === undefined ? {} : { visionModel: normalizeVisionModel(input.visionModel) }),
        nodes,
    };
    // Templates and expressions anywhere in a node surface here rather than mid-run.
    for (const node of Object.values(nodes)) {
        for (const problem of inspectTemplates(node.config, `nodes.${node.id}.config`))
            collector.fail('', problem);
    }
    return { document, issues: collector.issues };
}
function emptyDocument(id, now) {
    return {
        version: 2,
        id,
        name: 'Untitled workflow',
        createdAt: now,
        updatedAt: now,
        start: '',
        inputs: {},
        vars: {},
        limits: { maxNodeVisits: 1000, timeoutSec: 7200, maxVisionCalls: 400 },
        nodes: {},
    };
}
/** Convert a condition back to the YAML shape that normalizes into it. */
export function conditionToYaml(condition) {
    switch (condition.kind) {
        case 'vision':
            return {
                vision: condition.prompt,
                ...(condition.context === undefined ? {} : { context: condition.context }),
                ...(condition.settleMs === undefined ? {} : { settleMs: condition.settleMs }),
            };
        case 'image':
            return { image: condition.image, ...(condition.maxByteDelta === undefined ? {} : { maxByteDelta: condition.maxByteDelta }) };
        case 'change':
            return { change: condition.changed };
        case 'expr':
            return { expr: condition.expr };
        case 'all':
        case 'any':
            return { [condition.kind]: condition.items.map(item => conditionToYaml(item)) };
        case 'not':
            return { not: conditionToYaml(condition.item) };
        default:
            return null;
    }
}
/**
 * Serialize a document as a YAML-shaped value in a stable, readable key order.
 * @param document - graph document.
 * @returns the value to hand to `dumpYaml`.
 */
export function flowToYaml(document) {
    const nodes = {};
    for (const node of Object.values(document.nodes)) {
        const spec = nodeSpec(node.type);
        nodes[node.id] = {
            type: node.type,
            ...(node.name !== '' && node.name !== spec?.label[1] ? { name: node.name } : {}),
            ...(node.description === undefined ? {} : { description: node.description }),
            config: node.config,
            ...(node.next !== undefined && Object.keys(node.next).length > 0 ? { next: node.next } : {}),
            ...(node.precondition === undefined ? {} : { precondition: node.precondition }),
            ...(node.verify === undefined || (node.verify.mode ?? 'none') === 'none' ? {} : { verify: node.verify }),
            ...(node.retry.times === 0 ? {} : { retry: { times: node.retry.times, delayMs: node.retry.delayMs } }),
            ...(node.maxVisits === 100 ? {} : { maxVisits: node.maxVisits }),
        };
    }
    return {
        version: 2,
        name: document.name,
        ...(document.description === undefined ? {} : { description: document.description }),
        ...(document.deviceId === undefined ? {} : { deviceId: document.deviceId }),
        ...(document.sourceRecording === undefined ? {} : { sourceRecording: document.sourceRecording }),
        start: document.start,
        ...(Object.keys(document.inputs).length === 0 ? {} : { inputs: document.inputs }),
        ...(Object.keys(document.vars).length === 0 ? {} : { vars: document.vars }),
        limits: document.limits,
        ...(document.bios === undefined ? {} : { bios: document.bios }),
        ...(document.visionModel === undefined ? {} : { visionModel: document.visionModel }),
        nodes,
    };
}
/** Count the palette groups a document uses, for summaries and tests. */
export function nodeCounts(document) {
    const counts = { total: 0, branches: 0, senses: 0 };
    for (const node of Object.values(document.nodes)) {
        counts.total += 1;
        const spec = nodeSpec(node.type);
        if (spec?.category === 'flow' && node.type !== 'end')
            counts.branches += 1;
        if (spec?.category === 'sense')
            counts.senses += 1;
    }
    return counts;
}
/** Everything the palette and the inspector need, as plain JSON for the client. */
export function catalogForClient() {
    return NODE_CATALOG.map(spec => ({
        type: spec.type,
        category: spec.category,
        label: spec.label,
        description: spec.description,
        action: spec.action,
        dynamicPorts: spec.dynamicPorts ?? null,
        ports: spec.ports.map(port => ({ ...port })),
        fields: spec.fields.map(field => ({ ...field })),
    }));
}
