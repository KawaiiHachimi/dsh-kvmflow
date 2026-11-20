/**
 * Schema v1 → v2 conversion.
 *
 * A v1 workflow is a list of steps, which is exactly a linear chain of action
 * nodes. The failure strategy becomes part of the chain rather than a property:
 * `retry` stays node-level, `continue` routes `error` forward, `abort` routes it
 * to a failing end node, and `pause` leaves `error` unconnected so the run stops
 * for a human as it did before.
 */
import { normalizeFlow } from './normalize.js';
import type { FlowDocument, FlowNode } from './schema.js';

/** Anything shaped like a v1 step; kept structural so no v1-only type is needed. */
interface V1Step {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  action?: unknown;
  precondition?: unknown;
  verify?: unknown;
  onFailure?: { strategy?: unknown; retries?: unknown; message?: unknown } | null;
}

interface V1Document {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  deviceId?: unknown;
  sourceRecording?: unknown;
  createdAt?: unknown;
  bios?: unknown;
  variables?: unknown;
  steps: V1Step[];
}

/** Node ids must match `[A-Za-z][A-Za-z0-9_-]*`; v1 step ids were free text. */
function toNodeId(raw: unknown, index: number, taken: Set<string>): string {
  const base = typeof raw === 'string' ? raw.trim().replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[^A-Za-z]+/, '') : '';
  let candidate = base !== '' ? base : `step${index + 1}`;
  if (!/^[A-Za-z]/.test(candidate)) candidate = `step${candidate}`;
  let unique = candidate;
  let suffix = 2;
  while (taken.has(unique)) {
    unique = `${candidate}-${suffix}`;
    suffix += 1;
  }
  taken.add(unique);
  return unique;
}

/**
 * Convert a v1 document into a v2 graph.
 * @param input - parsed v1 document.
 * @param options - id and clock.
 * @returns the graph document plus the issues normalization found.
 */
export function upgradeV1(
  input: V1Document,
  options: { fallbackId?: string; now?: number } = {},
): { document: FlowDocument; issues: ReturnType<typeof normalizeFlow>['issues']; upgradedFrom: 1 } {
  const taken = new Set<string>();
  const chains: Array<{ node: FlowNode; step: V1Step; strategy: string }> = [];
  input.steps.forEach((step, index) => {
    const id = toNodeId(step.id, index, taken);
    const action = step.action as { type?: unknown } | undefined;
    const type = typeof action?.type === 'string' ? action.type : 'sequence';
    const config: Record<string, unknown> = { ...(action as Record<string, unknown> | undefined) };
    delete config.type;
    const strategy = typeof step.onFailure?.strategy === 'string' ? step.onFailure.strategy : 'pause';
    const node: FlowNode = {
      id,
      type: type as FlowNode['type'],
      name: typeof step.name === 'string' && step.name !== '' ? step.name : `Step ${index + 1}`,
      config,
      next: {},
      retry: {
        times: strategy === 'retry' ? Math.max(1, Math.floor(typeof step.onFailure?.retries === 'number' ? step.onFailure.retries : 1)) : 0,
        delayMs: 0,
      },
      maxVisits: 100,
    };
    if (typeof step.description === 'string' && step.description !== '') node.description = step.description;
    if (step.precondition !== undefined && step.precondition !== null) node.precondition = step.precondition as FlowNode['precondition'];
    if (step.verify !== undefined && step.verify !== null) node.verify = step.verify as FlowNode['verify'];
    chains.push({ node, step, strategy });
  });

  const doneId = taken.has('done') ? 'flow-done' : 'done';
  taken.add(doneId);
  const failId = taken.has('fail') ? 'flow-fail' : 'fail';
  taken.add(failId);

  const nodes: Record<string, FlowNode> = {};
  for (const { node } of chains) nodes[node.id] = node;
  const needsFail = chains.some(entry => entry.strategy === 'abort');
  nodes[doneId] = { id: doneId, type: 'end', name: 'Done', config: { result: 'success' }, next: {}, retry: { times: 0, delayMs: 0 }, maxVisits: 100 };
  if (needsFail) {
    nodes[failId] = {
      id: failId,
      type: 'end',
      name: 'Failed',
      config: { result: 'failure', reason: 'a step failed and its onFailure strategy was abort' },
      next: {},
      retry: { times: 0, delayMs: 0 },
      maxVisits: 100,
    };
  }

  chains.forEach((entry, index) => {
    const nextStep = chains[index + 1];
    const forward = nextStep !== undefined ? nextStep.node.id : doneId;
    entry.node.next.next = forward;
    if (entry.strategy === 'continue') entry.node.next.error = forward;
    if (entry.strategy === 'abort') entry.node.next.error = failId;
  });

  const { document, issues } = normalizeFlow({
    version: 2,
    id: typeof input.id === 'string' ? input.id : '',
    name: input.name,
    description: input.description,
    deviceId: input.deviceId,
    sourceRecording: input.sourceRecording,
    createdAt: input.createdAt,
    start: chains[0]?.node.id ?? doneId,
    vars: input.variables,
    bios: input.bios,
    nodes,
  }, options);
  return { document, issues, upgradedFrom: 1 };
}

/**
 * Build a linear graph from an ordered list of action nodes, for the recording
 * workflow generator. The generated document is a chain ending in `done`.
 * @param options - document identity and the ordered nodes.
 * @returns a normalized document.
 */
export function linearFlow(options: {
  id: string;
  name: string;
  description?: string;
  deviceId?: string;
  sourceRecording?: string;
  bios?: unknown;
  nodes: Array<Omit<FlowNode, 'next' | 'retry' | 'maxVisits'> & Partial<Pick<FlowNode, 'retry' | 'maxVisits'>>>;
}): { document: FlowDocument; issues: ReturnType<typeof normalizeFlow>['issues'] } {
  const taken = new Set<string>(options.nodes.map(node => node.id));
  const doneId = taken.has('done') ? 'flow-done' : 'done';
  const nodes: Record<string, unknown> = {};
  options.nodes.forEach((node, index) => {
    const forward = options.nodes[index + 1]?.id ?? doneId;
    nodes[node.id] = {
      type: node.type,
      name: node.name,
      ...(node.description === undefined ? {} : { description: node.description }),
      config: node.config,
      next: { next: forward },
      ...(node.precondition === undefined ? {} : { precondition: node.precondition }),
      ...(node.verify === undefined ? {} : { verify: node.verify }),
      ...(node.retry === undefined ? {} : { retry: node.retry }),
      ...(node.maxVisits === undefined ? {} : { maxVisits: node.maxVisits }),
    };
  });
  nodes[doneId] = { type: 'end', name: 'Done', config: { result: 'success' }, next: {} };
  return normalizeFlow({
    version: 2,
    id: options.id,
    name: options.name,
    description: options.description,
    deviceId: options.deviceId,
    sourceRecording: options.sourceRecording,
    bios: options.bios,
    start: options.nodes[0]?.id ?? doneId,
    nodes,
  }, { fallbackId: options.id });
}
