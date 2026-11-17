/** Shared KVMFlow Host vocabulary. */
import type { LinkrEvent } from './linkr.js';
import type { ViewMapping } from './view.js';

export type { LinkrEvent };
export type { ViewMapping };

export interface DeviceRecord {
  id: string;
  name: string;
  driver: 'linkr';
  baseUrl: string;
  token: string;
  /**
   * Linkr web-console account. Needed only for real-time video, which lives on
   * the logged-in `/api/*` surface; snapshots and HID work with the token alone.
   */
  username?: string;
  /** Web-console password, used to mint a Bearer session for `/api/rtc/whep`. */
  password?: string;
  /** Preferred preview: `video` needs web credentials, `snapshot` polls JPEG. */
  preview?: 'video' | 'snapshot';
  notes?: string;
  /**
   * The target's screen inside the captured frame when the frame is letterboxed
   * or pillarboxed, measured from arriving frames. Absent means the frame is the
   * target's screen.
   */
  viewMapping?: ViewMapping;
  createdAt: number;
  updatedAt: number;
}

export type PublicDevice = Omit<DeviceRecord, 'token' | 'password'> & {
  hasToken: boolean;
  /** Whether a web account is configured, i.e. real-time video is possible. */
  hasWebCredentials: boolean;
};

export interface RecordingEventRecord {
  seq: number;
  at: number;
  event: LinkrEvent;
  before?: string;
  after?: string;
}

export interface RecordingStepRecord {
  id: string;
  name: string;
  description?: string;
  startSeq: number;
  endSeq: number;
  before?: string;
  after?: string;
  createdAt: number;
}

export interface RecordingRecord {
  id: string;
  name: string;
  description?: string;
  deviceId?: string;
  status: 'recording' | 'stopped';
  createdAt: number;
  updatedAt: number;
  events: RecordingEventRecord[];
  steps: RecordingStepRecord[];
  startShot?: string;
  error?: string;
}

export type WorkflowAction =
  | { type: 'key'; key: string; holdMs?: number; repeat?: number; intervalMs?: number }
  | { type: 'shortcut'; keys: string[]; holdMs?: number }
  | { type: 'text'; text: string; submit?: boolean; chunkSize?: number }
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle'; count?: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'scroll'; x?: number; y?: number; wheelY: number; wheelX?: number }
  | { type: 'delay'; ms: number }
  | { type: 'sequence'; events: LinkrEvent[] };

export type VerifyMode = 'change' | 'image' | 'vision' | 'none';

export interface VerifySpec {
  mode?: VerifyMode;
  prompt?: string;
  /** Reference image path relative to the workflow asset directory. */
  image?: string;
  settleMs?: number;
  timeoutSec?: number;
  pollMs?: number;
  /** For `change`: require a changed hash (default true). */
  changed?: boolean;
  /** For `image`: allow this many bytes of difference to still count as similar (default 0 = exact hash). */
  maxByteDelta?: number;
}

export interface FailurePolicy {
  strategy: 'pause' | 'retry' | 'continue' | 'abort';
  retries?: number;
  message?: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  precondition?: VerifySpec;
  action: WorkflowAction;
  verify?: VerifySpec;
  onFailure?: FailurePolicy;
}

export interface BiosPrelude {
  hotkey?: string;
  intervalMs?: number;
  timeoutSec?: number;
  requireConfirm?: boolean;
  settleSec?: number;
}

export interface WorkflowRecord {
  version: 1;
  id: string;
  name: string;
  description?: string;
  deviceId?: string;
  sourceRecording?: string;
  createdAt: number;
  updatedAt: number;
  bios?: BiosPrelude;
  variables?: Record<string, unknown>;
  steps: WorkflowStep[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  deviceId?: string;
  stepCount: number;
  hasBios: boolean;
  updatedAt: number;
  path: string;
  error?: string;
}

export type RunStatus =
  | 'starting'
  | 'armed'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'aborted';

export type RunStepStatus =
  | 'pending'
  | 'precheck'
  | 'acting'
  | 'verifying'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'paused';

export interface RunStepState {
  index: number;
  id: string;
  name: string;
  status: RunStepStatus;
  attempts: number;
  startedAt?: number;
  endedAt?: number;
  before?: string;
  after?: string;
  verify?: {
    mode: VerifyMode;
    passed: boolean;
    reason: string;
    output?: string;
  };
  error?: string;
}

export interface RunLogEntry {
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface RunAwaiting {
  kind: 'bios_confirm' | 'failure' | 'no_signal';
  message: string;
  stepIndex?: number;
  actions: string[];
}

export interface RunBiosState {
  hotkey: string;
  intervalMs: number;
  timeoutSec: number;
  requireConfirm: boolean;
  armedAt: number;
  baseline?: string;
  detectedAt?: number;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  deviceId: string;
  status: RunStatus;
  phase: string;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  currentStepIndex: number;
  steps: RunStepState[];
  log: RunLogEntry[];
  awaiting?: RunAwaiting;
  bios?: RunBiosState;
}

export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  deviceId: string;
  status: RunStatus;
  phase: string;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  currentStepIndex: number;
  totalSteps: number;
}

export interface ServerState {
  dataDir: string;
  devices: PublicDevice[];
  defaultDeviceId?: string;
  recordings: Array<{
    id: string;
    name: string;
    status: string;
    eventCount: number;
    stepCount: number;
    updatedAt: number;
  }>;
  activeRecording?: { id: string; name: string; eventCount: number; stepCount: number; startedAt: number };
  workflows: WorkflowSummary[];
  activeRun?: RunRecord;
  recentRuns: RunSummary[];
  biosArmed?: boolean;
}
