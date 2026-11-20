/** Pure helpers for editing a graph document in the browser. */
import type { FlowDoc, FlowNodeDoc, NodeTypeSpec, PortSpec, RunRecordLike, Translate } from './types';

const ERROR_PORT: PortSpec = { name: 'error', kind: 'error', label: 'Error', optional: true };

/**
 * Ports a node exposes; mirrors `portsForNode` on the Host so a label added in
 * the inspector shows its handle before the next save.
 */
export function portsFor(spec: NodeTypeSpec | undefined, config: Record<string, any>): PortSpec[] {
  if (spec === undefined) return [];
  if (spec.dynamicPorts === 'options') {
    return (Array.isArray(config.options) ? config.options : [])
      .map((option: any) => (typeof option === 'string' ? option : option?.name))
      .filter((name: unknown): name is string => typeof name === 'string' && name !== '')
      .map((name: string) => ({ name, kind: 'branch', label: name, optional: true }));
  }
  if (spec.dynamicPorts === 'labels') {
    const labels = config.labels !== null && typeof config.labels === 'object' ? Object.keys(config.labels) : [];
    return [
      ...labels.map(name => ({ name, kind: 'branch' as const, label: name, optional: true })),
      { name: 'unknown', kind: 'branch', label: 'Unknown', optional: true },
      ERROR_PORT,
    ];
  }
  if (spec.dynamicPorts === 'cases') {
    const cases = config.cases !== null && typeof config.cases === 'object' ? Object.keys(config.cases) : [];
    return [
      ...cases.map(name => ({ name, kind: 'branch' as const, label: name, optional: true })),
      { name: 'default', kind: 'branch', label: 'Default', optional: true },
    ];
  }
  return spec.ports;
}

/** Ports in preference order for "continue after this node". */
const FORWARD = ['next', 'ok', 'success', 'true', 'body', 'found', 'default'];

export function forwardPort(ports: PortSpec[]): string | undefined {
  const names = ports.map(port => port.name);
  return FORWARD.find(name => names.includes(name)) ?? names.find(name => name !== 'error');
}

/** A valid starting config for each node type, so a dropped node saves immediately. */
export function defaultConfig(type: string, t: Translate, workflows: Array<{ id: string }>, currentId: string): Record<string, any> {
  switch (type) {
    case 'key': return { key: 'Enter' };
    case 'shortcut': return { keys: ['ControlLeft', 'AltLeft', 'Delete'] };
    case 'text': return { text: t('要输入的文字', 'text to type'), submit: false };
    case 'click': return { x: 0.5, y: 0.5, button: 'left', count: 1 };
    case 'move': return { x: 0.5, y: 0.5 };
    case 'scroll': return { x: 0.5, y: 0.5, wheelY: 3 };
    case 'delay': return { ms: 1000 };
    case 'if': return { condition: { vision: t('画面上出现了……', 'The screen shows …') } };
    case 'switch': return { cases: { first: { vision: t('第一种画面', 'The first screen') }, second: { vision: t('第二种画面', 'The second screen') } } };
    case 'wait_until': return { condition: { change: true }, timeoutSec: 60, pollMs: 1000 };
    case 'loop': return { count: 3, maxIterations: 10, indexVar: 'i' };
    case 'human': return { message: t('请人工确认后选择下一步', 'Check the target, then choose how to continue'), options: ['continue', 'abort'] };
    case 'subflow': return { workflow: workflows.find(entry => entry.id !== currentId)?.id ?? 'wf-id' };
    case 'end': return { result: 'success' };
    case 'set': return { assign: { counter: '{{coalesce(vars.counter, 0) + 1}}' } };
    case 'vision_check': return { prompt: t('画面上出现了……', 'The screen shows …') };
    case 'vision_classify': return {
      prompt: t('当前是哪个画面？', 'Which screen is this?'),
      labels: { first: t('第一种画面', 'The first screen'), second: t('第二种画面', 'The second screen') },
    };
    case 'vision_extract': return { prompt: t('读出画面上的值', 'Read the value shown on screen'), fields: ['value'] };
    case 'locate': return { target: t('要点击的按钮', 'The button to click') };
    case 'image_match': return { image: 'assets/reference.jpg', maxByteDelta: 0 };
    case 'screen_change': return { compareWith: 'previous' };
    default: return {};
  }
}

/** A short line describing what a node does, shown on the canvas card. */
export function summarize(node: FlowNodeDoc, t: Translate): string {
  const c = node.config ?? {};
  const cond = (value: any): string => {
    if (value === null || typeof value !== 'object') return '';
    if (typeof value.vision === 'string') return `👁 ${value.vision}`;
    if (typeof value.expr === 'string') return `ƒ ${value.expr}`;
    if (typeof value.image === 'string') return `🖼 ${value.image}`;
    if ('change' in value) return value.change === false ? t('画面不变', 'screen unchanged') : t('画面变化', 'screen changed');
    if (Array.isArray(value.all)) return t(`全部满足（${value.all.length}）`, `all of ${value.all.length}`);
    if (Array.isArray(value.any)) return t(`任一满足（${value.any.length}）`, `any of ${value.any.length}`);
    if (value.not !== undefined) return `not ${cond(value.not)}`;
    return '';
  };
  switch (node.type) {
    case 'key': return `${c.key}${(c.repeat ?? 1) > 1 ? ` ×${c.repeat}` : ''}`;
    case 'shortcut': return Array.isArray(c.keys) ? c.keys.join(' + ') : '';
    case 'text': return `“${String(c.text ?? '').slice(0, 48)}”${c.submit ? ' ⏎' : ''}`;
    case 'click': return `${c.button ?? 'left'} @ ${fmt(c.x)}, ${fmt(c.y)}${(c.count ?? 1) > 1 ? ` ×${c.count}` : ''}`;
    case 'move': return `@ ${fmt(c.x)}, ${fmt(c.y)}`;
    case 'scroll': return `wheel ${c.wheelY ?? 0}`;
    case 'delay': return `${c.ms} ms`;
    case 'sequence': return t(`${(c.events ?? []).length} 个录制事件`, `${(c.events ?? []).length} recorded events`);
    case 'if': return cond(c.condition);
    case 'switch': return t(`${Object.keys(c.cases ?? {}).length} 个分支`, `${Object.keys(c.cases ?? {}).length} cases`);
    case 'wait_until': return `${cond(c.condition)} · ≤${c.timeoutSec ?? 60}s`;
    case 'loop': return c.count !== undefined ? t(`重复 ${c.count} 次`, `repeat ${c.count}×`) : `${cond(c.while)} · ≤${c.maxIterations ?? 10}`;
    case 'human': return String(c.message ?? '');
    case 'subflow': return `→ ${c.workflow ?? ''}`;
    case 'end': return c.result === 'failure' ? `✗ ${c.reason ?? t('失败', 'failure')}` : `✓ ${c.reason ?? t('成功', 'success')}`;
    case 'set': return Object.keys(c.assign ?? {}).map(key => `${key} =`).join(', ');
    case 'vision_check': return String(c.prompt ?? '');
    case 'vision_classify': return Object.keys(c.labels ?? {}).join(' / ');
    case 'vision_extract': return (c.fields ?? []).join(', ');
    case 'locate': return String(c.target ?? '');
    case 'image_match': return String(c.image ?? '');
    case 'screen_change': return c.compareWith === 'run-start' ? t('与开始时比较', 'vs. run start') : t('与上一帧比较', 'vs. previous frame');
    default: return '';
  }
}

function fmt(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(3) : String(value ?? '');
}

/** A node id that is not taken yet, derived from the type. */
export function freshId(type: string, doc: FlowDoc): string {
  const base = type.replace(/_/g, '-');
  let index = 1;
  while (Object.hasOwn(doc.nodes, `${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/** Remove a node and every edge into it; keep `start` pointing somewhere. */
export function removeNode(doc: FlowDoc, id: string): FlowDoc {
  const nodes: Record<string, FlowNodeDoc> = {};
  for (const [key, node] of Object.entries(doc.nodes)) {
    if (key === id) continue;
    const next: Record<string, string> = {};
    for (const [port, target] of Object.entries(node.next ?? {})) if (target !== id) next[port] = target;
    nodes[key] = { ...node, next };
  }
  const start = doc.start === id ? (Object.keys(nodes)[0] ?? '') : doc.start;
  return { ...doc, nodes, start };
}

/** Rename a node and rewrite every edge and `start` that referenced it. */
export function renameNode(doc: FlowDoc, from: string, to: string): FlowDoc {
  const nodes: Record<string, FlowNodeDoc> = {};
  for (const [key, node] of Object.entries(doc.nodes)) {
    const next: Record<string, string> = {};
    for (const [port, target] of Object.entries(node.next ?? {})) next[port] = target === from ? to : target;
    nodes[key === from ? to : key] = { ...node, id: key === from ? to : key, next };
  }
  return { ...doc, nodes, start: doc.start === from ? to : doc.start };
}

/** Drop edges whose port the node no longer has (after a label or case is removed). */
export function pruneEdges(node: FlowNodeDoc, ports: PortSpec[]): FlowNodeDoc {
  const names = new Set(ports.map(port => port.name));
  const next: Record<string, string> = {};
  for (const [port, target] of Object.entries(node.next ?? {})) if (names.has(port)) next[port] = target;
  return { ...node, next };
}

export interface RunOverlay {
  current?: string;
  visits: Record<string, number>;
  status: Record<string, string>;
  /** `source:port` of every edge the run walked at the top level. */
  taken: Set<string>;
  /** The edge the run took most recently. */
  lastEdge?: string;
  awaitingNode?: string;
}

/** Summarize a run for highlighting the graph it executes. */
export function runOverlay(run: RunRecordLike | undefined, workflowId: string): RunOverlay | undefined {
  if (run === undefined || run.workflowId !== workflowId) return undefined;
  const visits: Record<string, number> = {};
  const status: Record<string, string> = {};
  const taken = new Set<string>();
  let lastEdge: string | undefined;
  for (const entry of run.trace ?? []) {
    if (entry.depth !== 0) continue;
    visits[entry.nodeId] = (visits[entry.nodeId] ?? 0) + 1;
    status[entry.nodeId] = entry.status === 'failed' ? 'failed' : 'passed';
    if (entry.port !== undefined && entry.port !== '' && entry.target !== undefined) {
      lastEdge = `${entry.nodeId}:${entry.port}`;
      taken.add(lastEdge);
    }
  }
  const terminal = ['succeeded', 'failed', 'aborted'].includes(run.status);
  const current = terminal ? undefined : run.currentNodeId;
  if (current !== undefined) status[current] = run.status === 'paused' ? 'paused' : 'running';
  return {
    ...(current === undefined ? {} : { current }),
    visits,
    status,
    taken,
    ...(lastEdge === undefined ? {} : { lastEdge }),
    ...(run.awaiting?.nodeId === undefined || run.awaiting.nodeId === '' ? {} : { awaitingNode: run.awaiting.nodeId }),
  };
}

/** Deep clone through JSON: documents are plain data. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
