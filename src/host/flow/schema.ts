/**
 * The graph document vocabulary: node types, their ports, and the catalog the
 * canvas, the validators and the agent tools all read.
 *
 * The catalog is the single source of truth for "which ports does this node
 * have" and "which config fields does the inspector show". Runtime code asks
 * `portsForNode` rather than hard-coding port names per node type.
 */
import type { LinkrEvent } from '../linkr.js';
import type { ViewMapping } from '../view.js';

export type { LinkrEvent, ViewMapping };

export type FlowError = { path: string; message: string };

/** Document-level guard rails; every field is optional in YAML. */
export interface FlowLimits {
  maxNodeVisits: number;
  timeoutSec: number;
  maxVisionCalls: number;
}

export interface FlowInputSpec {
  type: 'string' | 'number' | 'boolean' | 'secret';
  description?: string;
  required: boolean;
  default?: unknown;
}

export type Condition =
  | { kind: 'vision'; prompt: string; context?: string; settleMs?: number }
  | { kind: 'image'; image: string; maxByteDelta?: number }
  | { kind: 'change'; changed: boolean }
  | { kind: 'expr'; expr: string; source?: string }
  | { kind: 'all'; items: Condition[] }
  | { kind: 'any'; items: Condition[] }
  | { kind: 'not'; item: Condition };

export interface VerifySpec {
  /** `none` skips verification entirely; the other modes poll until they pass. */
  mode?: 'change' | 'image' | 'vision' | 'none';
  prompt?: string;
  image?: string;
  settleMs?: number;
  timeoutSec?: number;
  pollMs?: number;
  changed?: boolean;
  maxByteDelta?: number;
}

export type ActionConfig =
  | { type: 'key'; key: string; holdMs?: number; repeat?: number; intervalMs?: number }
  | { type: 'shortcut'; keys: string[]; holdMs?: number }
  | { type: 'text'; text: string; submit?: boolean; chunkSize?: number }
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle'; count?: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'scroll'; x?: number; y?: number; wheelY: number; wheelX?: number }
  | { type: 'delay'; ms: number }
  | { type: 'sequence'; events: LinkrEvent[] };

export type NodeType =
  | 'key' | 'shortcut' | 'text' | 'click' | 'move' | 'scroll' | 'delay' | 'sequence'
  | 'if' | 'switch' | 'wait_until' | 'loop' | 'subflow' | 'human' | 'set' | 'end'
  | 'vision_check' | 'vision_classify' | 'vision_extract' | 'locate' | 'image_match' | 'screen_change';

export type PortKind = 'next' | 'branch' | 'error' | 'end';

export interface PortSpec {
  name: string;
  kind: PortKind;
  label: string;
  /** A port whose target may be absent; the run pauses there instead of failing. */
  optional: boolean;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  /** Port name → target node id. An absent port means "unconnected". */
  next: Record<string, string>;
  precondition?: VerifySpec;
  verify?: VerifySpec;
  retry: { times: number; delayMs: number };
  maxVisits: number;
}

export interface FlowDocument {
  version: 2;
  id: string;
  name: string;
  description?: string;
  deviceId?: string;
  sourceRecording?: string;
  createdAt: number;
  updatedAt: number;
  start: string;
  inputs: Record<string, FlowInputSpec>;
  vars: Record<string, unknown>;
  limits: FlowLimits;
  bios?: {
    hotkey: string;
    intervalMs: number;
    timeoutSec: number;
    requireConfirm: boolean;
    settleSec: number;
  };
  nodes: Record<string, FlowNode>;
}

export interface FlowLayoutPoint {
  x: number;
  y: number;
}

export interface FlowLayout {
  nodes: Record<string, FlowLayoutPoint>;
  /** Bumping this invalidates stored coordinates after a structural edit. */
  version: number;
}

/** A decorated node for the canvas: config already rendered as plain JSON. */
export interface FlowGraphNode {
  id: string;
  type: NodeType;
  name: string;
  description?: string;
  category: NodeCategory;
  config: Record<string, unknown>;
  ports: PortSpec[];
  next: Record<string, string>;
  retry: { times: number; delayMs: number };
  maxVisits: number;
  hasPrecondition: boolean;
  verify?: VerifySpec;
  position?: FlowLayoutPoint;
}

export interface FlowGraphEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  kind: PortKind;
}

export interface FlowGraph {
  version: 2;
  id: string;
  name: string;
  description?: string;
  deviceId?: string;
  start: string;
  inputs: Record<string, FlowInputSpec>;
  vars: Record<string, unknown>;
  limits: FlowLimits;
  bios?: FlowDocument['bios'];
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  layout: FlowLayout;
}

export type NodeCategory = 'flow' | 'action' | 'sense' | 'data';

export interface ConfigField {
  key: string;
  label: readonly [string, string];
  kind: 'string' | 'text' | 'number' | 'boolean' | 'select' | 'expression' | 'list' | 'map' | 'action' | 'condition';
  required: boolean;
  help?: readonly [string, string];
  placeholder?: string;
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface NodeTypeSpec {
  type: NodeType;
  category: NodeCategory;
  label: readonly [string, string];
  description: readonly [string, string];
  /** Fixed ports; `switch`, `human` and `vision_classify` add ports from config. */
  ports: readonly PortSpec[];
  /** Where the dynamic port names come from, when the node has them. */
  dynamicPorts?: 'cases' | 'options' | 'labels';
  fields: readonly ConfigField[];
  /** Action nodes send HID and therefore honour precondition/verify and frame capture. */
  action: boolean;
}

const NEXT: PortSpec = { name: 'next', kind: 'next', label: 'Next', optional: false };
const ERROR: PortSpec = { name: 'error', kind: 'error', label: 'Error', optional: true };
const TRUE: PortSpec = { name: 'true', kind: 'branch', label: 'True', optional: true };
const FALSE: PortSpec = { name: 'false', kind: 'branch', label: 'False', optional: true };

const actionFields: readonly ConfigField[] = [{ key: 'action', label: ['动作', 'Action'], kind: 'action', required: true }];

/** The node catalog, in palette order. */
export const NODE_CATALOG: readonly NodeTypeSpec[] = [
  {
    type: 'if', category: 'flow', label: ['条件分支', 'If'], action: false,
    description: ['判断一个条件，走 true 或 false 出口。', 'Evaluate one condition and take the true or false port.'],
    ports: [TRUE, FALSE],
    fields: [{ key: 'condition', label: ['条件', 'Condition'], kind: 'condition', required: true }],
  },
  {
    type: 'switch', category: 'flow', label: ['多路分支', 'Switch'], action: false,
    description: ['按顺序判断多个条件，第一个成立的出口生效。', 'Evaluate cases in order and take the first match; `default` when none do.'],
    ports: [],
    dynamicPorts: 'cases',
    fields: [{ key: 'cases', label: ['分支', 'Cases'], kind: 'map', required: true, help: ['顺序即优先级，键名就是出口端口。', 'Order is priority; each key becomes an output port.'] }],
  },
  {
    type: 'wait_until', category: 'flow', label: ['等待条件', 'Wait until'], action: false,
    description: ['轮询条件直到成立，超时走 timeout 出口。', 'Poll a condition until it holds; take `timeout` when the budget runs out.'],
    ports: [{ name: 'ok', kind: 'next', label: 'OK', optional: false }, { name: 'timeout', kind: 'branch', label: 'Timeout', optional: true }],
    fields: [
      { key: 'condition', label: ['条件', 'Condition'], kind: 'condition', required: true },
      { key: 'timeoutSec', label: ['超时（秒）', 'Timeout (s)'], kind: 'number', required: false, min: 1, max: 3600 },
      { key: 'pollMs', label: ['轮询间隔（毫秒）', 'Poll (ms)'], kind: 'number', required: false, min: 200, max: 60_000 },
    ],
  },
  {
    type: 'loop', category: 'flow', label: ['循环', 'Loop'], action: false,
    description: ['重复 body 出口处的流程，达到次数或条件不成立后走 done。', 'Repeat the body until the count or the while-condition ends; then take `done`.'],
    ports: [{ name: 'body', kind: 'next', label: 'Body', optional: false }, { name: 'done', kind: 'next', label: 'Done', optional: false }],
    fields: [
      { key: 'maxIterations', label: ['最多次数', 'Max iterations'], kind: 'number', required: false, min: 1, max: 1000 },
      { key: 'count', label: ['固定次数', 'Fixed count'], kind: 'number', required: false, min: 1, max: 1000 },
      { key: 'while', label: ['续行条件', 'While'], kind: 'condition', required: false },
      { key: 'indexVar', label: ['计数变量', 'Index variable'], kind: 'string', required: false },
    ],
  },
  {
    type: 'human', category: 'flow', label: ['人工确认', 'Human'], action: false,
    description: ['暂停，等操作者选择一个出口。', 'Pause and let the operator choose an output port.'],
    ports: [],
    dynamicPorts: 'options',
    fields: [
      { key: 'message', label: ['提示', 'Message'], kind: 'text', required: true },
      { key: 'options', label: ['选项', 'Options'], kind: 'list', required: true },
    ],
  },
  {
    type: 'subflow', category: 'flow', label: ['子流程', 'Subflow'], action: false,
    description: ['调用另一个工作流，输入输出通过变量传递。', 'Run another workflow and exchange values through its inputs and outputs.'],
    ports: [{ name: 'success', kind: 'next', label: 'Success', optional: false }, { name: 'failure', kind: 'branch', label: 'Failure', optional: true }],
    fields: [
      { key: 'workflow', label: ['工作流 ID', 'Workflow id'], kind: 'string', required: true },
      { key: 'inputs', label: ['输入', 'Inputs'], kind: 'map', required: false },
    ],
  },
  {
    type: 'end', category: 'flow', label: ['结束', 'End'], action: false,
    description: ['结束整个流程并给出结果。', 'Finish the run with a result.'],
    ports: [],
    fields: [
      { key: 'result', label: ['结果', 'Result'], kind: 'select', required: false, options: ['success', 'failure'] },
      { key: 'reason', label: ['原因', 'Reason'], kind: 'string', required: false },
      { key: 'outputs', label: ['输出', 'Outputs'], kind: 'map', required: false },
    ],
  },

  { type: 'key', category: 'action', label: ['按键', 'Key'], action: true, description: ['按一下某个键。', 'Tap one key.'], ports: [NEXT, ERROR], fields: actionFields },
  { type: 'shortcut', category: 'action', label: ['快捷键', 'Shortcut'], action: true, description: ['同时按下多个键。', 'Press several keys together.'], ports: [NEXT, ERROR], fields: actionFields },
  { type: 'text', category: 'action', label: ['输入文本', 'Type text'], action: true, description: ['输入文本，可自动回车。', 'Type text, optionally submitting it.'], ports: [NEXT, ERROR], fields: actionFields },
  { type: 'click', category: 'action', label: ['点击', 'Click'], action: true, description: ['在画面相对坐标点击。', 'Click at frame-normalized coordinates.'], ports: [NEXT, ERROR], fields: actionFields },
  { type: 'move', category: 'action', label: ['移动', 'Move'], action: true, description: ['把指针移到坐标。', 'Move the pointer.'], ports: [NEXT, ERROR], fields: actionFields },
  { type: 'scroll', category: 'action', label: ['滚轮', 'Scroll'], action: true, description: ['在画面上滚动。', 'Scroll on the screen.'], ports: [NEXT, ERROR], fields: actionFields },
  { type: 'delay', category: 'action', label: ['等待', 'Delay'], action: true, description: ['固定等待一段时间。', 'Wait a fixed time.'], ports: [NEXT, ERROR], fields: actionFields },
  { type: 'sequence', category: 'action', label: ['事件序列', 'Sequence'], action: true, description: ['回放录制到的原始 HID 事件。', 'Replay raw recorded HID events.'], ports: [NEXT, ERROR], fields: actionFields },

  {
    type: 'vision_check', category: 'sense', label: ['画面判断', 'Vision check'], action: false,
    description: ['让视觉模型判断画面是否满足条件。', 'Ask the vision model whether the screen satisfies a condition.'],
    ports: [TRUE, FALSE, ERROR],
    fields: [
      { key: 'prompt', label: ['判断条件', 'Condition'], kind: 'text', required: true, help: ['写清楚画面上必须出现什么。', 'Describe what must be visible.'] },
      { key: 'context', label: ['背景说明', 'Context'], kind: 'text', required: false },
      { key: 'settleMs', label: ['等待稳定（毫秒）', 'Settle (ms)'], kind: 'number', required: false, min: 0, max: 60_000 },
    ],
  },
  {
    type: 'vision_classify', category: 'sense', label: ['画面分类', 'Vision classify'], action: false,
    description: ['一次模型调用把画面判成 N 类之一，直接分叉。', 'Classify the screen into one of N labels with a single model call.'],
    ports: [],
    dynamicPorts: 'labels',
    fields: [
      { key: 'prompt', label: ['分类提示', 'Prompt'], kind: 'text', required: true },
      { key: 'labels', label: ['类别', 'Labels'], kind: 'map', required: true, help: ['键名就是出口端口，值描述这一类画面。', 'Each key becomes an output port; its value describes that screen.'] },
    ],
  },
  {
    type: 'vision_extract', category: 'sense', label: ['画面提取', 'Vision extract'], action: false,
    description: ['从画面读出若干字段，写入节点输出。', 'Read fields off the screen into the node output.'],
    ports: [NEXT, ERROR],
    fields: [
      { key: 'prompt', label: ['提取说明', 'Prompt'], kind: 'text', required: true },
      { key: 'fields', label: ['字段名', 'Fields'], kind: 'list', required: true },
    ],
  },
  {
    type: 'locate', category: 'sense', label: ['定位元素', 'Locate'], action: false,
    description: ['找出一个元素的位置，输出画面相对坐标。', 'Find an element and output frame-normalized coordinates.'],
    ports: [{ name: 'found', kind: 'branch', label: 'Found', optional: true }, { name: 'not_found', kind: 'branch', label: 'Not found', optional: true }, ERROR],
    fields: [
      { key: 'target', label: ['目标元素', 'Target'], kind: 'text', required: true },
      { key: 'context', label: ['背景说明', 'Context'], kind: 'text', required: false },
    ],
  },
  {
    type: 'image_match', category: 'sense', label: ['图像比对', 'Image match'], action: false,
    description: ['把画面和参考图比较（JPEG 哈希或字节量差）。', 'Compare the frame to a reference JPEG by hash or byte-size delta.'],
    ports: [TRUE, FALSE, ERROR],
    fields: [
      { key: 'image', label: ['参考图', 'Reference image'], kind: 'string', required: true },
      { key: 'maxByteDelta', label: ['允许字节差', 'Byte delta'], kind: 'number', required: false, min: 0 },
    ],
  },
  {
    type: 'screen_change', category: 'sense', label: ['画面变化', 'Screen change'], action: false,
    description: ['判断画面相对上一次采集是否变化。', 'Whether the screen changed since the last capture.'],
    ports: [TRUE, FALSE, ERROR],
    fields: [{ key: 'compareWith', label: ['比较对象', 'Compare with'], kind: 'select', required: false, options: ['previous', 'run-start'] }],
  },

  {
    type: 'set', category: 'data', label: ['设置变量', 'Set variables'], action: false,
    description: ['用表达式给变量赋值。', 'Assign variables from expressions.'],
    ports: [NEXT],
    fields: [{ key: 'assign', label: ['赋值', 'Assign'], kind: 'map', required: true, help: ['值支持 {{表达式}} 与字面量。', 'Values are expressions or literals.'] }],
  },
];

const BY_TYPE = new Map<string, NodeTypeSpec>(NODE_CATALOG.map(spec => [spec.type, spec]));

/** True when the name is a known node type. */
export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && BY_TYPE.has(value);
}

/** Look up one node type's catalog entry. */
export function nodeSpec(type: string): NodeTypeSpec | undefined {
  return BY_TYPE.get(type);
}

/** True for the eight HID action node types. */
export function isActionType(type: string): boolean {
  return BY_TYPE.get(type)?.action === true;
}

/**
 * Every port a node exposes, including the ones its config names.
 * @param type - node type.
 * @param config - normalized config.
 * @returns ports in canvas order.
 */
export function portsForNode(type: NodeType, config: Record<string, unknown>): PortSpec[] {
  const spec = BY_TYPE.get(type);
  if (spec === undefined) return [];
  const dynamic: PortSpec[] = [];
  if (spec.dynamicPorts === 'options' && Array.isArray(config.options)) {
    for (const option of config.options) {
      const name = typeof option === 'string' ? option : (option as { name?: unknown })?.name;
      if (typeof name === 'string' && name !== '') {
        dynamic.push({ name, kind: 'branch', label: name, optional: true });
      }
    }
    return dynamic;
  }
  if (spec.dynamicPorts === 'labels' && config.labels !== null && typeof config.labels === 'object') {
    for (const name of Object.keys(config.labels as Record<string, unknown>)) {
      dynamic.push({ name, kind: 'branch', label: name, optional: true });
    }
    dynamic.push({ name: 'unknown', kind: 'branch', label: 'Unknown', optional: true });
    dynamic.push(ERROR);
    return dynamic;
  }
  if (spec.dynamicPorts === 'cases' && config.cases !== null && typeof config.cases === 'object') {
    for (const name of Object.keys(config.cases as Record<string, unknown>)) {
      dynamic.push({ name, kind: 'branch', label: name, optional: true });
    }
    dynamic.push({ name: 'default', kind: 'branch', label: 'Default', optional: true });
    return dynamic;
  }
  return [...spec.ports];
}

/** Ports the run cannot proceed past when unconnected. */
export function requiredPorts(ports: PortSpec[]): PortSpec[] {
  return ports.filter(port => !port.optional);
}

/** The action payload of an action node, rebuilt for the device client. */
export function actionOf(node: FlowNode): ActionConfig {
  if (!isActionType(node.type)) throw new Error(`node ${node.id} is not an action`);
  return { type: node.type, ...(node.config as unknown as Record<string, unknown>) } as ActionConfig;
}

/** Human-readable one-liner for a node, used in logs and lists. */
export function describeNode(node: FlowNode): string {
  const spec = BY_TYPE.get(node.type);
  const label = node.name !== '' ? node.name : (spec?.label[1] ?? node.type);
  return `${label} (${node.type})`;
}
