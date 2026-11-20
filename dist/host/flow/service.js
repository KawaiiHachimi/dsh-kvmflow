/**
 * Workflow operations shared by the panel RPC and the agent tools, so a canvas
 * edit and an agent edit go through the same validation and persistence.
 */
import { StoreError } from '../store.js';
import { dumpYaml } from '../yaml.js';
import { analyzeFlow, hasErrors, toGraph } from './graph.js';
import { catalogForClient, flowToYaml, normalizeFlow } from './normalize.js';
import { applyPatch } from './patch.js';
import { composeFlows } from './compose.js';
/** Problems that stop normalization, reported in the same shape as analysis issues. */
function structuralIssues(problems) {
    return problems.map(problem => {
        const match = /^nodes\.([A-Za-z][A-Za-z0-9_-]*)/.exec(problem.path);
        return {
            severity: 'error',
            ...(match === null ? {} : { nodeId: match[1] }),
            path: problem.path,
            code: 'schema',
            message: problem.message,
        };
    });
}
export class FlowInvalidError extends StoreError {
    issues;
    constructor(issues) {
        const errors = issues.filter(issue => issue.severity === 'error');
        super('INVALID_FLOW', `workflow has ${errors.length} error(s): ${errors.slice(0, 5).map(issue => `${issue.path}: ${issue.message}`).join('; ')}`);
        this.issues = issues;
    }
}
function newWorkflowId() {
    const now = Date.now();
    return `wf-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
/** YAML text for a document, in the same form `saveFlow` writes, without timestamps. */
export function flowYaml(document) {
    return dumpYaml(flowToYaml(document));
}
export class FlowService {
    store;
    constructor(store) {
        this.store = store;
    }
    /** The node catalog for palettes, inspectors and the agent. */
    catalog() {
        return catalogForClient();
    }
    async view(id) {
        const document = await this.store.loadFlow(id);
        const layout = await this.store.readLayout(id);
        return {
            document,
            graph: toGraph(document, layout),
            yaml: await this.store.readWorkflowYaml(id),
            issues: analyzeFlow(document),
            path: this.store.workflowPath(id),
        };
    }
    /**
     * Validate YAML text or a YAML-shaped value without saving.
     * @param input - YAML source or a document object.
     * @param id - id to assign.
     * @returns the normalized document when it parsed, and every issue.
     */
    check(input) {
        const id = input.id ?? 'wf-draft';
        if (typeof input.yaml === 'string') {
            const { document, problems, upgraded } = this.store.parseFlowText(input.yaml, id);
            if (problems.length > 0)
                return { issues: structuralIssues(problems), upgraded };
            return { document, issues: analyzeFlow(document), upgraded, graph: toGraph(document), yaml: flowYaml(document) };
        }
        const { document, issues } = normalizeFlow(input.document, { fallbackId: id });
        document.id = id;
        if (issues.length > 0)
            return { issues: structuralIssues(issues), upgraded: false };
        return { document, issues: analyzeFlow(document), upgraded: false, graph: toGraph(document), yaml: flowYaml(document) };
    }
    /**
     * Save a workflow from YAML text or from a YAML-shaped value.
     * @param input - source, target id, optional layout, and whether analysis errors block the save.
     * @returns the saved view.
     */
    async save(input) {
        const id = input.id ?? newWorkflowId();
        const result = this.check({ ...(input.yaml === undefined ? {} : { yaml: input.yaml }), ...(input.document === undefined ? {} : { document: input.document }), id });
        if (result.document === undefined)
            throw new FlowInvalidError(result.issues);
        if (input.strict === true && hasErrors(result.issues))
            throw new FlowInvalidError(result.issues);
        const document = result.document;
        document.id = id;
        try {
            const previous = await this.store.loadFlow(id);
            document.createdAt = previous.createdAt;
            if (document.sourceRecording === undefined && previous.sourceRecording !== undefined)
                document.sourceRecording = previous.sourceRecording;
        }
        catch {
            // A new workflow keeps the creation time normalization assigned.
        }
        const path = await this.store.saveFlow(document);
        if (input.layout !== undefined)
            await this.store.saveLayout(id, this.pruneLayout(document, input.layout));
        return { ...(await this.view(id)), path };
    }
    /**
     * Apply graph patch operations.
     * @param id - workflow id.
     * @param ops - operations.
     * @param strict - reject a result with errors (agent edits) instead of saving it.
     * @returns the saved view and the ids `add_node` created.
     */
    async patch(id, ops, strict = true) {
        const current = await this.store.loadFlow(id);
        const { document, issues: problems, added } = applyPatch(current, ops);
        if (problems.length > 0)
            throw new FlowInvalidError(structuralIssues(problems));
        const issues = analyzeFlow(document);
        if (strict && hasErrors(issues))
            throw new FlowInvalidError(issues);
        await this.store.saveFlow(document);
        // Nodes the patch added have no coordinates yet; drop stale ones and let the
        // canvas place new nodes next to their neighbours.
        const layout = await this.store.readLayout(id);
        if (layout !== undefined)
            await this.store.saveLayout(id, this.pruneLayout(document, layout));
        return { ...(await this.view(id)), added };
    }
    /**
     * Create an empty workflow: a single success end node the author builds in front of.
     * @param options - name, description and origin.
     * @returns the saved view.
     */
    async create(options) {
        const id = newWorkflowId();
        const { document, issues } = normalizeFlow({
            version: 2,
            id,
            name: options.name ?? 'New workflow',
            ...(options.description === undefined ? {} : { description: options.description }),
            ...(options.deviceId === undefined ? {} : { deviceId: options.deviceId }),
            ...(options.recordingId === undefined ? {} : { sourceRecording: options.recordingId }),
            start: 'begin',
            nodes: {
                begin: {
                    type: 'vision_check',
                    name: 'Is the target ready?',
                    config: { prompt: 'The target screen shows a usable desktop, installer or BIOS page (not black, not a loading spinner).' },
                    next: { true: 'done', false: 'wait' },
                },
                wait: {
                    type: 'wait_until',
                    name: 'Wait for the screen',
                    config: { condition: { change: true }, timeoutSec: 60, pollMs: 2000 },
                    next: { ok: 'begin', timeout: 'done' },
                    maxVisits: 5,
                },
                done: { type: 'end', name: 'Done', config: { result: 'success' } },
            },
        }, { fallbackId: id });
        if (issues.length > 0)
            throw new FlowInvalidError(structuralIssues(issues));
        document.id = id;
        await this.store.saveFlow(document);
        return this.view(id);
    }
    /**
     * Compose several workflows in order into a new workflow.
     * @param options - name, mode (`subflow` or `inline`), and ordered items.
     * @returns the saved view of the new composed workflow.
     */
    async compose(options) {
        if (!Array.isArray(options.items) || options.items.length === 0) {
            throw new StoreError('INVALID_INPUT', 'at least one workflow is required to compose');
        }
        const id = newWorkflowId();
        const stages = [];
        for (let index = 0; index < options.items.length; index += 1) {
            const item = options.items[index];
            const document = await this.store.loadFlow(item.workflowId);
            let assetMap;
            if (options.mode === 'inline') {
                const refs = collectAssetRefs(document);
                if (refs.size > 0) {
                    assetMap = {};
                    for (const ref of refs) {
                        try {
                            const bytes = await this.store.readWorkflowAsset(document.id, ref);
                            const base = ref.replace(/^assets\//, '');
                            assetMap[ref] = await this.store.saveWorkflowAsset(id, `s${index + 1}_${base}`, bytes);
                        }
                        catch {
                            // Keep the original path if the asset file is missing.
                        }
                    }
                }
            }
            stages.push({
                document,
                ...(item.onFailure === undefined ? {} : { onFailure: item.onFailure }),
                ...(assetMap === undefined ? {} : { assetMap }),
            });
        }
        const { document, issues } = composeFlows({
            id,
            name: options.name.trim() || 'Composed workflow',
            ...(options.description === undefined ? {} : { description: options.description }),
            ...(options.deviceId === undefined ? {} : { deviceId: options.deviceId }),
            mode: options.mode,
            stages,
        });
        if (issues.length > 0)
            throw new FlowInvalidError(structuralIssues(issues));
        document.id = id;
        await this.store.saveFlow(document);
        return this.view(id);
    }
    /**
     * Store canvas coordinates.
     * @param id - workflow id.
     * @param layout - coordinates.
     */
    async saveLayout(id, layout) {
        const document = await this.store.loadFlow(id);
        await this.store.saveLayout(id, this.pruneLayout(document, layout));
    }
    pruneLayout(document, layout) {
        const nodes = {};
        for (const [id, point] of Object.entries(layout.nodes ?? {})) {
            if (Object.hasOwn(document.nodes, id))
                nodes[id] = point;
        }
        return { version: layout.version ?? 1, nodes };
    }
}
/** Collect any `assets/...` string referenced inside a document. */
function collectAssetRefs(document) {
    const refs = new Set();
    const walk = (value) => {
        if (typeof value === 'string') {
            if (value.startsWith('assets/'))
                refs.add(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value)
                walk(item);
            return;
        }
        if (value !== null && typeof value === 'object') {
            for (const child of Object.values(value))
                walk(child);
        }
    };
    walk(document.nodes);
    return refs;
}
/** Plain JSON of the issues, for RPC and tool results. */
export function issuesJson(issues) {
    return issues.map(issue => ({ ...issue }));
}
