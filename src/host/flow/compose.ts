/**
 * Composing several workflows into one larger workflow.
 *
 * Two modes serve two different needs:
 * - `subflow`: chains `subflow` nodes in order so the canvas stays compact and
 *   edits to a child workflow propagate automatically.
 * - `inline`: flattens every node into one standalone graph with prefixed ids,
 *   rewired `nodes.<id>` references, and chained `end(success)` transitions so
 *   the author can freely edit or branch across stages.
 */
import { normalizeFlow } from './normalize.js';
import type { FlowDocument, FlowError, FlowInputSpec, FlowNode } from './schema.js';

export type ComposeMode = 'subflow' | 'inline';
export type StageFailurePolicy = 'pause' | 'continue' | 'abort';

export interface ComposeStage {
  document: FlowDocument;
  onFailure?: StageFailurePolicy;
  /** Optional map of old asset path → copied asset path for inline mode. */
  assetMap?: Record<string, string>;
}

export interface ComposeOptions {
  id: string;
  name: string;
  description?: string;
  deviceId?: string;
  mode: ComposeMode;
  stages: ComposeStage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Escape a node id for a regex boundary check. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite `nodes.<oldId>` references and asset paths inside any config/verify
 * value of an inlined stage.
 */
function rewriteValue(
  value: unknown,
  idMap: Map<string, string>,
  assetMap: Record<string, string> | undefined,
): unknown {
  if (typeof value === 'string') {
    if (assetMap !== undefined && Object.hasOwn(assetMap, value)) return assetMap[value];
    let text = value;
    for (const [oldId, newId] of idMap) {
      if (!text.includes(`nodes.${oldId}`)) continue;
      text = text.replace(new RegExp(`\\bnodes\\.${escapeRegex(oldId)}(?![A-Za-z0-9_-])`, 'g'), `nodes.${newId}`);
    }
    return text;
  }
  if (Array.isArray(value)) return value.map(item => rewriteValue(item, idMap, assetMap));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = rewriteValue(child, idMap, assetMap);
    return out;
  }
  return value;
}

function isSuccessEnd(node: FlowNode | undefined): boolean {
  return node?.type === 'end' && node.config?.result !== 'failure';
}

function isFailureEnd(node: FlowNode | undefined): boolean {
  return node?.type === 'end' && node.config?.result === 'failure';
}

/**
 * Compose ordered workflow stages into one schema v2 document.
 * @param options - target metadata, mode, and ordered stages.
 * @returns the normalized composed document and any schema issues.
 */
export function composeFlows(options: ComposeOptions): { document: FlowDocument; issues: FlowError[] } {
  if (options.stages.length === 0) {
    return normalizeFlow({}, { fallbackId: options.id });
  }

  const inputs: Record<string, FlowInputSpec> = {};
  const vars: Record<string, unknown> = {};
  let bios: FlowDocument['bios'] | undefined;
  let visionModel: FlowDocument['visionModel'] | undefined;
  let maxNodeVisits = 1000;
  let timeoutSec = 7200;
  let maxVisionCalls = 400;

  for (const stage of options.stages) {
    const doc = stage.document;
    if (bios === undefined && doc.bios !== undefined) bios = { ...doc.bios };
    if (visionModel === undefined && doc.visionModel !== undefined) visionModel = { ...doc.visionModel };
    for (const [key, spec] of Object.entries(doc.inputs ?? {})) {
      if (!Object.hasOwn(inputs, key)) inputs[key] = { ...spec };
    }
    for (const [key, val] of Object.entries(doc.vars ?? {})) {
      if (!Object.hasOwn(vars, key)) vars[key] = val;
    }
    maxNodeVisits = Math.max(maxNodeVisits, doc.limits.maxNodeVisits);
    timeoutSec = Math.max(timeoutSec, doc.limits.timeoutSec);
    maxVisionCalls = Math.max(maxVisionCalls, doc.limits.maxVisionCalls);
  }

  const description = options.description?.trim()
    || `Composed (${options.mode}) from: ${options.stages.map(stage => stage.document.name).join(' → ')}`;

  if (options.mode === 'subflow') {
    const nodes: Record<string, unknown> = {};
    const stageIds = options.stages.map((_, index) => `stage${index + 1}`);
    const needsFail = options.stages.some(stage => stage.onFailure === 'abort');

    options.stages.forEach((stage, index) => {
      const id = stageIds[index];
      const nextTarget = stageIds[index + 1] ?? 'done';
      const policy = stage.onFailure ?? 'pause';
      const passInputs: Record<string, string> = {};
      for (const key of Object.keys(stage.document.inputs ?? {})) {
        passInputs[key] = `{{inputs.${key}}}`;
      }
      const next: Record<string, string> = { success: nextTarget };
      if (policy === 'continue') next.failure = nextTarget;
      else if (policy === 'abort') next.failure = 'fail';
      nodes[id] = {
        type: 'subflow',
        name: stage.document.name,
        ...(stage.document.description === undefined ? {} : { description: stage.document.description }),
        config: {
          workflow: stage.document.id,
          ...(Object.keys(passInputs).length === 0 ? {} : { inputs: passInputs }),
        },
        next,
      };
    });

    nodes.done = { type: 'end', name: 'Done', config: { result: 'success' } };
    if (needsFail) {
      nodes.fail = { type: 'end', name: 'Failed', config: { result: 'failure', reason: 'a stage failed' } };
    }

    return normalizeFlow({
      version: 2,
      id: options.id,
      name: options.name,
      description,
      ...(options.deviceId === undefined ? {} : { deviceId: options.deviceId }),
      start: stageIds[0],
      inputs,
      vars,
      limits: { maxNodeVisits, timeoutSec, maxVisionCalls },
      ...(bios === undefined ? {} : { bios }),
      ...(visionModel === undefined ? {} : { visionModel }),
      nodes,
    }, { fallbackId: options.id });
  }

  // Inline mode: prefix every stage's nodes and stitch success ends to the next stage's start.
  const stageMaps = options.stages.map((stage, index) => {
    const prefix = `s${index + 1}_`;
    const idMap = new Map<string, string>();
    for (const oldId of Object.keys(stage.document.nodes)) idMap.set(oldId, `${prefix}${oldId}`);
    return { prefix, idMap, stage };
  });

  // Compute the entry node id for each stage; if a stage starts directly at a
  // success end, skip through to the following stage or `done`.
  const entryOf = (index: number): string => {
    for (let cursor = index; cursor < stageMaps.length; cursor += 1) {
      const { idMap, stage } = stageMaps[cursor];
      const startNode = stage.document.nodes[stage.document.start];
      if (startNode !== undefined && !isSuccessEnd(startNode)) {
        return idMap.get(stage.document.start) as string;
      }
    }
    return 'done';
  };

  const nodes: Record<string, unknown> = {};
  const needsFail = options.stages.some(stage => stage.onFailure === 'abort');

  stageMaps.forEach(({ idMap, stage }, index) => {
    const nextEntry = entryOf(index + 1);
    const policy = stage.onFailure ?? 'pause';
    const doc = stage.document;

    for (const [oldId, node] of Object.entries(doc.nodes)) {
      // Success end nodes are replaced by a direct transition to the next stage.
      if (isSuccessEnd(node)) continue;
      // When policy is `continue`, failure ends also bridge forward.
      if (isFailureEnd(node) && policy === 'continue') continue;

      const newId = idMap.get(oldId) as string;
      const next: Record<string, string> = {};
      for (const [port, target] of Object.entries(node.next ?? {})) {
        const targetNode = doc.nodes[target];
        if (isSuccessEnd(targetNode)) next[port] = nextEntry;
        else if (isFailureEnd(targetNode) && policy === 'continue') next[port] = nextEntry;
        else next[port] = idMap.get(target) ?? target;
      }
      if (policy === 'abort' && node.type !== 'end' && !Object.hasOwn(next, 'error')) {
        // Action/sense nodes that support `error` will be wired if valid;
        // normalizeFlow rejects invalid ports, so only add `error` when the node has one.
        if (['key', 'shortcut', 'text', 'click', 'move', 'scroll', 'delay', 'sequence',
          'vision_check', 'vision_classify', 'vision_extract', 'locate', 'image_match', 'screen_change'].includes(node.type)) {
          next.error = 'fail';
        }
      }

      const rewrittenConfig = rewriteValue(node.config, idMap, stage.assetMap);
      const rewrittenPre = node.precondition === undefined ? undefined : rewriteValue(node.precondition, idMap, stage.assetMap);
      const rewrittenVerify = node.verify === undefined ? undefined : rewriteValue(node.verify, idMap, stage.assetMap);

      nodes[newId] = {
        type: node.type,
        name: options.stages.length > 1 ? `[${index + 1}] ${node.name}` : node.name,
        ...(node.description === undefined ? {} : { description: node.description }),
        config: rewrittenConfig,
        next,
        ...(rewrittenPre === undefined ? {} : { precondition: rewrittenPre }),
        ...(rewrittenVerify === undefined ? {} : { verify: rewrittenVerify }),
        ...(node.retry.times === 0 ? {} : { retry: { ...node.retry } }),
        ...(node.maxVisits === 100 ? {} : { maxVisits: node.maxVisits }),
      };
    }
  });

  nodes.done = { type: 'end', name: 'Done', config: { result: 'success' } };
  if (needsFail) {
    nodes.fail = { type: 'end', name: 'Failed', config: { result: 'failure', reason: 'a stage failed' } };
  }

  return normalizeFlow({
    version: 2,
    id: options.id,
    name: options.name,
    description,
    ...(options.deviceId === undefined ? {} : { deviceId: options.deviceId }),
    start: entryOf(0),
    inputs,
    vars,
    limits: { maxNodeVisits, timeoutSec, maxVisionCalls },
    ...(bios === undefined ? {} : { bios }),
    nodes,
  }, { fallbackId: options.id });
}
