/** Shapes the graph editor shares with the panel; they mirror the Host's JSON. */

export type Translate = (zh: string, en: string) => string;
export type Rpc = (method: string, params?: any, signal?: AbortSignal) => Promise<any>;

export type NodeCategory = 'flow' | 'action' | 'sense' | 'data';

export interface PortSpec {
  name: string;
  kind: 'next' | 'branch' | 'error' | 'end';
  label: string;
  optional: boolean;
}

export interface FieldSpec {
  key: string;
  label: [string, string];
  kind: 'string' | 'text' | 'number' | 'boolean' | 'select' | 'expression' | 'list' | 'map' | 'action' | 'condition';
  required: boolean;
  help?: [string, string];
  placeholder?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface NodeTypeSpec {
  type: string;
  category: NodeCategory;
  label: [string, string];
  description: [string, string];
  action: boolean;
  dynamicPorts: 'cases' | 'options' | 'labels' | null;
  ports: PortSpec[];
  fields: FieldSpec[];
}

export interface VerifySpec {
  mode?: 'change' | 'image' | 'vision' | 'none';
  prompt?: string;
  image?: string;
  settleMs?: number;
  timeoutSec?: number;
  pollMs?: number;
  changed?: boolean;
  maxByteDelta?: number;
}

export interface FlowNodeDoc {
  id?: string;
  type: string;
  name: string;
  description?: string;
  config: Record<string, any>;
  next: Record<string, string>;
  precondition?: VerifySpec;
  verify?: VerifySpec;
  retry: { times: number; delayMs: number };
  maxVisits: number;
}

export interface FlowInputSpec {
  type: 'string' | 'number' | 'boolean' | 'secret';
  description?: string;
  required: boolean;
  default?: unknown;
}

export interface FlowDoc {
  version: 2;
  id: string;
  name: string;
  description?: string;
  deviceId?: string;
  sourceRecording?: string;
  createdAt?: number;
  updatedAt?: number;
  start: string;
  inputs: Record<string, FlowInputSpec>;
  vars: Record<string, unknown>;
  limits: { maxNodeVisits: number; timeoutSec: number; maxVisionCalls: number };
  bios?: { hotkey: string; intervalMs: number; timeoutSec: number; requireConfirm: boolean; settleSec: number };
  nodes: Record<string, FlowNodeDoc>;
}

export interface FlowIssue {
  severity: 'error' | 'warning';
  nodeId?: string;
  path: string;
  message: string;
  code: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface FlowView {
  document: FlowDoc;
  graph: { layout: { version: number; nodes: Record<string, Point> } };
  yaml: string;
  issues: FlowIssue[];
}

export interface RunTraceEntry {
  seq: number;
  at: number;
  durationMs: number;
  workflowId: string;
  depth: number;
  nodeId: string;
  nodeType: string;
  status: 'ok' | 'failed' | 'routed' | 'retried';
  port?: string;
  target?: string;
  reason?: string;
  before?: string;
  after?: string;
  output?: unknown;
}

export interface RunRecordLike {
  id: string;
  workflowId: string;
  status: string;
  phase: string;
  currentNodeId?: string;
  trace?: RunTraceEntry[];
  steps?: Array<{ id: string; status: string; attempts: number; port?: string }>;
  awaiting?: { nodeId?: string; kind: string };
}

/** Props the panel passes to the editor. */
export interface FlowEditorProps {
  rpc: Rpc;
  t: Translate;
  workflowId: string;
  workflows: Array<{ id: string; name: string }>;
  deviceId: string;
  /** The active or selected run of this workflow, for live highlighting. */
  run?: RunRecordLike;
  compact?: boolean;
  runDisabledReason?: string;
  notify: (message: string, tone?: string) => void;
  onRun: (inputs: Record<string, unknown>) => Promise<void> | void;
  onAskAi: (doc: FlowDoc) => void;
  onDelete: () => void;
  onSaved: () => void;
  /** Tells the panel whether unsaved edits exist, so it can warn before leaving. */
  onDirtyChange?: (dirty: boolean) => void;
  renderThumb: (path: string | undefined, label: string) => any;
}

export interface RunGraphProps {
  rpc: Rpc;
  t: Translate;
  workflowId: string;
  run: RunRecordLike;
  height?: number;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string | undefined) => void;
}

export interface FlowUi {
  FlowEditor: (props: FlowEditorProps) => any;
  RunGraph: (props: RunGraphProps) => any;
  CSS: string;
}
