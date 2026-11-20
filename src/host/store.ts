/** Durable KVMFlow state: devices, recordings, YAML workflows, and runs. */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { mkdir, readFile, readdir, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseYaml, dumpYaml, YamlError, type YamlValue } from './yaml.js';
import { flowToYaml, looksLikeV1, normalizeFlow, nodeCounts } from './flow/normalize.js';
import { upgradeV1 } from './flow/convert.js';
import { analyzeFlow } from './flow/graph.js';
import type { FlowDocument, FlowLayout } from './flow/schema.js';
import { validateEvent, type LinkrEvent } from './linkr.js';
import { normalizeViewMapping } from './view.js';
import type {
  DeviceRecord,
  FailurePolicy,
  PublicDevice,
  RecordingRecord,
  RecordingStepRecord,
  RunRecord,
  RunSummary,
  ServerState,
  VerifySpec,
  WorkflowAction,
  WorkflowRecord,
  WorkflowStep,
  WorkflowSummary,
} from './types.js';

export interface StoreConfig {
  dataDir?: string;
  defaultDeviceId?: string;
  linkrMinIntervalMs?: number;
  device?: {
    name?: string;
    baseUrl?: string;
    token?: string;
    username?: string;
    password?: string;
    notes?: string;
  };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function publicDevice(device: DeviceRecord): PublicDevice {
  const { token: _token, password: _password, ...rest } = device;
  return {
    ...rest,
    hasToken: device.token.length > 0,
    hasWebCredentials: (device.username ?? '').trim() !== '' && (device.password ?? '') !== '',
  };
}

export class StoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

/**
 * Resolve the on-disk data root.
 * @param config - plugin configuration.
 * @returns absolute data directory.
 */
export function resolveDataDir(config: StoreConfig): string {
  if (typeof config.dataDir === 'string' && config.dataDir.trim() !== '') {
    const configured = config.dataDir.trim();
    return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  }
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return join(home, 'kvmflow');
}

function normalizeVerify(input: unknown, fallbackMode: VerifySpec['mode']): VerifySpec {
  if (input === undefined || input === null) return { mode: fallbackMode };
  if (!isRecord(input)) throw new StoreError('INVALID_WORKFLOW', 'verify/precondition must be a mapping');
  const mode = asString(input.mode, fallbackMode ?? 'change') as VerifySpec['mode'];
  if (!['change', 'image', 'vision', 'none'].includes(mode)) {
    throw new StoreError('INVALID_WORKFLOW', `unsupported verify mode ${JSON.stringify(mode)}`);
  }
  return {
    mode,
    ...(typeof input.prompt === 'string' ? { prompt: input.prompt } : {}),
    ...(typeof input.image === 'string' ? { image: input.image } : {}),
    settleMs: Math.max(0, asNumber(input.settleMs, 800)),
    timeoutSec: Math.max(1, asNumber(input.timeoutSec, 12)),
    pollMs: Math.max(100, asNumber(input.pollMs, 600)),
    ...(typeof input.changed === 'boolean' ? { changed: input.changed } : {}),
    ...(typeof input.maxByteDelta === 'number' ? { maxByteDelta: Math.max(0, input.maxByteDelta) } : {}),
  };
}

function normalizeAction(input: unknown): WorkflowAction {
  if (!isRecord(input) || typeof input.type !== 'string') {
    throw new StoreError('INVALID_WORKFLOW', 'each step needs an action mapping with a type');
  }
  switch (input.type) {
    case 'key':
      if (typeof input.key !== 'string' || input.key.trim() === '') {
        throw new StoreError('INVALID_WORKFLOW', 'key action requires a non-empty key');
      }
      return {
        type: 'key',
        key: input.key,
        holdMs: Math.max(1, asNumber(input.holdMs, 60)),
        repeat: Math.max(1, Math.floor(asNumber(input.repeat, 1))),
        intervalMs: Math.max(0, asNumber(input.intervalMs, 120)),
      };
    case 'shortcut': {
      if (!Array.isArray(input.keys) || input.keys.length === 0 || input.keys.some(key => typeof key !== 'string')) {
        throw new StoreError('INVALID_WORKFLOW', 'shortcut action requires string keys');
      }
      return { type: 'shortcut', keys: input.keys as string[], holdMs: Math.max(1, asNumber(input.holdMs, 80)) };
    }
    case 'text':
      if (typeof input.text !== 'string') throw new StoreError('INVALID_WORKFLOW', 'text action requires text');
      return {
        type: 'text',
        text: input.text,
        submit: asBoolean(input.submit, false),
        chunkSize: Math.max(1, Math.floor(asNumber(input.chunkSize, 120))),
      };
    case 'click': {
      const x = asNumber(input.x, Number.NaN);
      const y = asNumber(input.y, Number.NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        throw new StoreError('INVALID_WORKFLOW', 'click action requires normalized x/y between 0 and 1');
      }
      const button = input.button === 'right' ? 'right' : input.button === 'middle' ? 'middle' : 'left';
      return { type: 'click', x, y, button, count: Math.max(1, Math.floor(asNumber(input.count, 1))) };
    }
    case 'move': {
      const x = asNumber(input.x, Number.NaN);
      const y = asNumber(input.y, Number.NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        throw new StoreError('INVALID_WORKFLOW', 'move action requires normalized x/y between 0 and 1');
      }
      return { type: 'move', x, y };
    }
    case 'scroll':
      return {
        type: 'scroll',
        x: Math.min(1, Math.max(0, asNumber(input.x, 0.5))),
        y: Math.min(1, Math.max(0, asNumber(input.y, 0.5))),
        wheelY: Math.max(-20, Math.min(20, asNumber(input.wheelY, 0))),
        wheelX: Math.max(-20, Math.min(20, asNumber(input.wheelX, 0))),
      };
    case 'delay':
      return { type: 'delay', ms: Math.max(0, asNumber(input.ms, 500)) };
    case 'sequence': {
      if (!Array.isArray(input.events) || input.events.length === 0) {
        throw new StoreError('INVALID_WORKFLOW', 'sequence action requires a non-empty events array');
      }
      return { type: 'sequence', events: (input.events as unknown[]).map((event, index) => validateEvent(event, index)) };
    }
    default:
      throw new StoreError('INVALID_WORKFLOW', `unsupported action type ${JSON.stringify(input.type)}`);
  }
}

function normalizeFailure(input: unknown): FailurePolicy {
  if (input === undefined || input === null) return { strategy: 'pause', retries: 0 };
  if (!isRecord(input)) throw new StoreError('INVALID_WORKFLOW', 'onFailure must be a mapping');
  const strategy = asString(input.strategy, 'pause');
  if (!['pause', 'retry', 'continue', 'abort'].includes(strategy)) {
    throw new StoreError('INVALID_WORKFLOW', `unsupported onFailure strategy ${JSON.stringify(strategy)}`);
  }
  return {
    strategy: strategy as FailurePolicy['strategy'],
    retries: Math.max(0, Math.floor(asNumber(input.retries, 1))),
    ...(typeof input.message === 'string' ? { message: input.message } : {}),
  };
}

function normalizeStep(input: unknown, index: number): WorkflowStep {
  if (!isRecord(input)) throw new StoreError('INVALID_WORKFLOW', `steps[${index}] must be a mapping`);
  const action = normalizeAction(input.action);
  const defaultVerify = action.type === 'delay' ? 'none' : 'change';
  return {
    id: asString(input.id, '') || newId('step'),
    name: asString(input.name, '') || `Step ${index + 1}`,
    ...(typeof input.description === 'string' && input.description !== '' ? { description: input.description } : {}),
    ...(input.precondition !== undefined ? { precondition: normalizeVerify(input.precondition, 'none') } : {}),
    action,
    verify: normalizeVerify(input.verify, defaultVerify),
    onFailure: normalizeFailure(input.onFailure),
  };
}

/**
 * Validate a schema v1 workflow and fill its defaults. Only the upgrade path
 * and the recording generator use this; everything else works on v2 graphs.
 * @param input - parsed YAML value.
 * @param fallbackId - id to use when the document omits one.
 * @returns a complete workflow record.
 */
export function normalizeWorkflow(input: unknown, fallbackId = ''): WorkflowRecord {
  if (!isRecord(input)) throw new StoreError('INVALID_WORKFLOW', 'workflow document must be a mapping');
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new StoreError('INVALID_WORKFLOW', 'workflow must contain at least one step');
  }
  const now = Date.now();
  const biosInput = isRecord(input.bios) ? input.bios : undefined;
  const steps = input.steps.map((step, index) => normalizeStep(step, index));
  return {
    version: 1,
    id: asString(input.id, '') || fallbackId || newId('wf'),
    name: asString(input.name, '') || 'Untitled workflow',
    ...(typeof input.description === 'string' && input.description !== '' ? { description: input.description } : {}),
    ...(typeof input.deviceId === 'string' && input.deviceId !== '' ? { deviceId: input.deviceId } : {}),
    ...(typeof input.sourceRecording === 'string' && input.sourceRecording !== '' ? { sourceRecording: input.sourceRecording } : {}),
    createdAt: asNumber(input.createdAt, now),
    updatedAt: now,
    ...(biosInput !== undefined ? {
      bios: {
        hotkey: asString(biosInput.hotkey, 'F2') || 'F2',
        intervalMs: Math.max(300, asNumber(biosInput.intervalMs, 1200)),
        timeoutSec: Math.max(5, asNumber(biosInput.timeoutSec, 180)),
        requireConfirm: asBoolean(biosInput.requireConfirm, false),
        settleSec: Math.max(0, asNumber(biosInput.settleSec, 2)),
      },
    } : {}),
    ...(isRecord(input.variables) ? { variables: input.variables } : {}),
    steps,
  };
}

function flowSummary(document: FlowDocument, path: string, upgraded: boolean): WorkflowSummary {
  const counts = nodeCounts(document);
  const issues = analyzeFlow(document);
  return {
    id: document.id,
    name: document.name,
    ...(document.description !== undefined ? { description: document.description } : {}),
    ...(document.deviceId !== undefined ? { deviceId: document.deviceId } : {}),
    stepCount: counts.total,
    version: 2,
    branchCount: counts.branches,
    issueCount: issues.length,
    hasBios: document.bios !== undefined,
    updatedAt: document.updatedAt,
    path,
    ...(upgraded ? { upgradedFrom: 1 as const } : {}),
  };
}

const FLOW_HEADER = [
  'KVMFlow workflow (schema v2): a graph of nodes.',
  'Each node has a type, a config, and `next` mapping output ports to node ids.',
  'Edit it on the KVMFlow canvas, here, or let the agent patch it with kvmflow_flow_patch.',
].join('\n');

/** One KVMFlow data root with lazy directory creation. */
export class Store {
  readonly config: StoreConfig;
  readonly dataDir: string;
  readonly recordingsDir: string;
  readonly workflowsDir: string;
  readonly runsDir: string;
  readonly tmpDir: string;
  private devices: DeviceRecord[] = [];
  private readonly recordingCache = new Map<string, { mtimeMs: number; record: RecordingRecord }>();
  private readonly workflowCache = new Map<string, { mtimeMs: number; summary: WorkflowSummary }>();

  constructor(config: StoreConfig) {
    this.config = config;
    this.dataDir = resolveDataDir(config);
    this.recordingsDir = join(this.dataDir, 'recordings');
    this.workflowsDir = join(this.dataDir, 'workflows');
    this.runsDir = join(this.dataDir, 'runs');
    this.tmpDir = join(this.dataDir, 'tmp');
  }

  /** Create the data root and load devices synchronously so tools exist after apply returns. */
  initSync(): void {
    for (const dir of [this.dataDir, this.recordingsDir, this.workflowsDir, this.runsDir, this.tmpDir]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    if (existsSync(this.devicesPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(this.devicesPath, 'utf8'));
        if (Array.isArray(parsed)) {
          this.devices = parsed.filter(isRecord).map(entry => ({
            id: asString(entry.id, '') || newId('dev'),
            name: asString(entry.name, 'IP-KVM'),
            driver: 'linkr',
            baseUrl: asString(entry.baseUrl, ''),
            token: asString(entry.token, ''),
            ...(typeof entry.username === 'string' ? { username: entry.username } : {}),
        ...(typeof entry.password === 'string' ? { password: entry.password } : {}),
        ...(entry.preview === 'video' || entry.preview === 'snapshot' ? { preview: entry.preview } : {}),
            ...(typeof entry.password === 'string' ? { password: entry.password } : {}),
            ...(entry.preview === 'video' || entry.preview === 'snapshot' ? { preview: entry.preview } : {}),
            ...(typeof entry.notes === 'string' ? { notes: entry.notes } : {}),
            ...(normalizeViewMapping(entry.viewMapping) === undefined ? {} : { viewMapping: normalizeViewMapping(entry.viewMapping) }),
            createdAt: asNumber(entry.createdAt, Date.now()),
            updatedAt: asNumber(entry.updatedAt, Date.now()),
          }));
        }
      } catch (error) {
        throw new StoreError('DEVICES_READ_FAILED', `cannot read ${this.devicesPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const seed = this.config.device;
    if (this.devices.length === 0 && seed !== undefined && typeof seed.baseUrl === 'string' && typeof seed.token === 'string') {
      const now = Date.now();
      const device: DeviceRecord = {
        id: newId('dev'),
        name: seed.name ?? 'IP-KVM',
        driver: 'linkr',
        baseUrl: seed.baseUrl,
        token: seed.token,
        ...(seed.username === undefined ? {} : { username: seed.username }),
        ...(seed.password === undefined ? {} : { password: seed.password }),
        ...(seed.notes === undefined ? {} : { notes: seed.notes }),
        createdAt: now,
        updatedAt: now,
      };
      this.devices.push(device);
      writeFileSync(this.devicesPath, `${JSON.stringify(this.devices, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
  }

  /** Create the data root and load devices. */
  async init(): Promise<void> {
    for (const dir of [this.dataDir, this.recordingsDir, this.workflowsDir, this.runsDir, this.tmpDir]) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
    await this.loadDevices();
    const seed = this.config.device;
    if (this.devices.length === 0 && seed !== undefined && typeof seed.baseUrl === 'string' && typeof seed.token === 'string') {
      await this.addDevice({
        name: seed.name ?? 'IP-KVM',
        baseUrl: seed.baseUrl,
        token: seed.token,
        username: seed.username,
        password: seed.password,
        notes: seed.notes,
      });
    }
  }

  private get devicesPath(): string {
    return join(this.dataDir, 'devices.json');
  }

  private async loadDevices(): Promise<void> {
    try {
      const text = await readFile(this.devicesPath, 'utf8');
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('devices.json must contain an array');
      this.devices = parsed.filter(isRecord).map(entry => ({
        id: asString(entry.id, '') || newId('dev'),
        name: asString(entry.name, 'IP-KVM'),
        driver: 'linkr',
        baseUrl: asString(entry.baseUrl, ''),
        token: asString(entry.token, ''),
        ...(typeof entry.username === 'string' ? { username: entry.username } : {}),
        ...(typeof entry.password === 'string' ? { password: entry.password } : {}),
        ...(entry.preview === 'video' || entry.preview === 'snapshot' ? { preview: entry.preview } : {}),
        ...(typeof entry.password === 'string' ? { password: entry.password } : {}),
        ...(typeof entry.notes === 'string' ? { notes: entry.notes } : {}),
        ...(normalizeViewMapping(entry.viewMapping) === undefined ? {} : { viewMapping: normalizeViewMapping(entry.viewMapping) }),
        createdAt: asNumber(entry.createdAt, Date.now()),
        updatedAt: asNumber(entry.updatedAt, Date.now()),
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.devices = [];
        return;
      }
      throw new StoreError('DEVICES_READ_FAILED', `cannot read ${this.devicesPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async saveDevices(): Promise<void> {
    await writeFile(this.devicesPath, `${JSON.stringify(this.devices, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(this.devicesPath, 0o600).catch(() => {});
  }

  listDevices(): PublicDevice[] {
    return this.devices.map(publicDevice);
  }

  rawDevices(): DeviceRecord[] {
    return this.devices.map(device => ({ ...device }));
  }

  getDevice(id?: string): DeviceRecord {
    const resolved = id?.trim() || this.config.defaultDeviceId?.trim() || this.devices[0]?.id;
    const device = this.devices.find(entry => entry.id === resolved);
    if (device === undefined) {
      throw new StoreError('DEVICE_NOT_FOUND', id === undefined || id === '' ? 'no KVM device configured' : `device ${JSON.stringify(id)} not found`);
    }
    return { ...device };
  }

  defaultDeviceId(): string | undefined {
    return this.config.defaultDeviceId?.trim() || this.devices[0]?.id;
  }

  async addDevice(input: Record<string, unknown>): Promise<PublicDevice> {
    const baseUrl = asString(input.baseUrl, '').trim();
    const token = asString(input.token, '').trim();
    if (baseUrl === '') throw new StoreError('INVALID_DEVICE', 'baseUrl is required');
    if (token === '') throw new StoreError('INVALID_DEVICE', 'access token is required');
    const now = Date.now();
    const device: DeviceRecord = {
      id: newId('dev'),
      name: asString(input.name, '').trim() || baseUrl,
      driver: 'linkr',
      baseUrl,
      token,
      ...(asString(input.username, '') !== '' ? { username: asString(input.username, '') } : {}),
      ...(asString(input.password, '') !== '' ? { password: asString(input.password, '') } : {}),
      ...(input.preview === 'video' || input.preview === 'snapshot' ? { preview: input.preview } : {}),
      ...(asString(input.notes, '') !== '' ? { notes: asString(input.notes, '') } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.devices.push(device);
    await this.saveDevices();
    return publicDevice(device);
  }

  async updateDevice(id: string, patch: Record<string, unknown>): Promise<PublicDevice> {
    const device = this.devices.find(entry => entry.id === id);
    if (device === undefined) throw new StoreError('DEVICE_NOT_FOUND', `device ${JSON.stringify(id)} not found`);
    if (typeof patch.name === 'string' && patch.name.trim() !== '') device.name = patch.name.trim();
    if (typeof patch.baseUrl === 'string' && patch.baseUrl.trim() !== '') device.baseUrl = patch.baseUrl.trim();
    if (typeof patch.token === 'string' && patch.token.trim() !== '') device.token = patch.token.trim();
    if (typeof patch.username === 'string') device.username = patch.username;
    if (typeof patch.password === 'string') device.password = patch.password;
    if (patch.preview === 'video' || patch.preview === 'snapshot') device.preview = patch.preview;
    if (typeof patch.notes === 'string') device.notes = patch.notes;
    if ('viewMapping' in patch) {
      const mapping = normalizeViewMapping(patch.viewMapping);
      if (mapping === undefined) delete device.viewMapping;
      else device.viewMapping = mapping;
    }
    device.updatedAt = Date.now();
    await this.saveDevices();
    return publicDevice(device);
  }

  async removeDevice(id: string): Promise<void> {
    const before = this.devices.length;
    this.devices = this.devices.filter(entry => entry.id !== id);
    if (this.devices.length === before) throw new StoreError('DEVICE_NOT_FOUND', `device ${JSON.stringify(id)} not found`);
    await this.saveDevices();
  }

  recordingDir(id: string): string {
    return join(this.recordingsDir, id);
  }

  async listRecordingFiles(): Promise<string[]> {
    try {
      return (await readdir(this.recordingsDir)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<RecordingRecord> {
    const path = join(this.recordingsDir, `${id}.json`);
    try {
      const info = await stat(path);
      const cached = this.recordingCache.get(id);
      if (cached !== undefined && cached.mtimeMs === info.mtimeMs) return cached.record;
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!isRecord(parsed)) throw new Error('recording must be an object');
      const record = parsed as unknown as RecordingRecord;
      this.recordingCache.set(id, { mtimeMs: info.mtimeMs, record });
      return record;
    } catch (error) {
      throw new StoreError('RECORDING_NOT_FOUND', `recording ${JSON.stringify(id)} not found: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listRecordings(): Promise<RecordingRecord[]> {
    const files = await this.listRecordingFiles();
    const records: RecordingRecord[] = [];
    for (const id of files) {
      try {
        records.push(await this.getRecording(id));
      } catch {
        // A partially written or manually removed recording is skipped; the UI
        // lists only complete records.
      }
    }
    for (const id of [...this.recordingCache.keys()]) {
      if (!files.includes(id)) this.recordingCache.delete(id);
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    return records;
  }

  async saveRecording(recording: RecordingRecord): Promise<void> {
    recording.updatedAt = Date.now();
    const dir = this.recordingDir(recording.id);
    await mkdir(join(dir, 'shots'), { recursive: true, mode: 0o700 });
    const path = join(this.recordingsDir, `${recording.id}.json`);
    await writeFile(path, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
    const info = await stat(path);
    this.recordingCache.set(recording.id, { mtimeMs: info.mtimeMs, record: recording });
  }

  async deleteRecording(id: string): Promise<void> {
    this.recordingCache.delete(id);
    await rm(join(this.recordingsDir, `${id}.json`), { force: true });
    await rm(this.recordingDir(id), { recursive: true, force: true });
  }

  recordingShotPath(id: string, relative: string): string {
    const root = this.recordingDir(id);
    const target = resolve(root, relative);
    if (!target.startsWith(`${resolve(root)}${sep}`)) throw new StoreError('INVALID_PATH', 'image path escapes the recording directory');
    return target;
  }

  async saveRecordingShot(id: string, data: Uint8Array, tag: string): Promise<string> {
    const name = `shots/${Date.now().toString(36)}-${tag.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)}.jpg`;
    const target = this.recordingShotPath(id, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data);
    return name;
  }

  async readRecordingShot(id: string, relative: string): Promise<Uint8Array> {
    return readFile(this.recordingShotPath(id, relative));
  }

  workflowPath(id: string): string {
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.workflowsDir, `${safe}.yaml`);
  }

  workflowAssetDir(id: string): string {
    return join(this.workflowsDir, `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.assets`);
  }

  async workflowAssetPath(id: string, relative: string): Promise<string> {
    const root = this.workflowAssetDir(id);
    const target = resolve(root, relative);
    if (!target.startsWith(`${resolve(root)}${sep}`)) throw new StoreError('INVALID_PATH', 'workflow asset path escapes the asset directory');
    return target;
  }

  async saveWorkflowAsset(id: string, name: string, data: Uint8Array): Promise<string> {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const relative = `assets/${safe}`;
    const target = await this.workflowAssetPath(id, relative);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data);
    return relative;
  }

  async readWorkflowAsset(id: string, relative: string): Promise<Uint8Array> {
    return readFile(await this.workflowAssetPath(id, relative));
  }

  async readWorkflowYaml(id: string): Promise<string> {
    try {
      return await readFile(this.workflowPath(id), 'utf8');
    } catch (error) {
      throw new StoreError('WORKFLOW_NOT_FOUND', `workflow ${JSON.stringify(id)} not found: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Path of the canvas coordinates beside a workflow. */
  layoutPath(id: string): string {
    return join(this.workflowsDir, `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.layout.json`);
  }

  /** Where the original of an upgraded v1 workflow is kept. */
  backupPath(id: string): string {
    return join(this.workflowsDir, '.backup', `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.v1.yaml`);
  }

  /**
   * Parse YAML text into a graph document without saving it.
   * @param text - YAML source.
   * @param id - id to assign.
   * @returns the document, its normalization problems, and whether it was v1.
   */
  parseFlowText(text: string, id: string): { document: FlowDocument; problems: Array<{ path: string; message: string }>; upgraded: boolean } {
    let parsed: YamlValue;
    try {
      parsed = parseYaml(text);
    } catch (error) {
      throw new StoreError('INVALID_WORKFLOW', error instanceof YamlError ? error.message : `cannot parse workflow: ${String(error)}`);
    }
    if (looksLikeV1(parsed)) {
      // Normalize as v1 first so v1 defaults (a `change` verify on every action,
      // `pause` on failure) survive the upgrade explicitly.
      const legacy = normalizeWorkflow(parsed, id);
      // normalizeWorkflow invents random ids for steps that had none; keep the
      // author's ids and let the upgrade number the rest (step1, step2, …).
      const rawSteps = (parsed as { steps?: unknown[] }).steps ?? [];
      legacy.steps = legacy.steps.map((step, index) => {
        const raw = rawSteps[index] as { id?: unknown } | undefined;
        return { ...step, id: typeof raw?.id === 'string' ? raw.id : '' };
      });
      const { document, issues } = upgradeV1(legacy as any, { fallbackId: id });
      document.id = id;
      return { document, problems: issues, upgraded: true };
    }
    const { document, issues } = normalizeFlow(parsed, { fallbackId: id });
    document.id = id;
    return { document, problems: issues, upgraded: false };
  }

  /**
   * Load a workflow as a graph. A v1 file is upgraded once: the original goes to
   * `.backup/<id>.v1.yaml` and the v2 document replaces it.
   * @param id - workflow id.
   * @returns the normalized document.
   */
  async loadFlow(id: string): Promise<FlowDocument> {
    const text = await this.readWorkflowYaml(id);
    const { document, problems, upgraded } = this.parseFlowText(text, id);
    if (problems.length > 0) {
      throw new StoreError('INVALID_WORKFLOW', problems.map(problem => `${problem.path}: ${problem.message}`).join('; '));
    }
    if (upgraded) {
      const backup = this.backupPath(id);
      await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
      if (!existsSync(backup)) await writeFile(backup, text, 'utf8');
      await this.saveFlow(document, { keepTimestamp: true, upgraded: true });
    }
    return document;
  }

  /**
   * Write a graph document as YAML.
   * @param document - normalized document.
   * @param options - keep the updatedAt stamp (upgrades), and mark an upgrade in the summary.
   * @returns the file path.
   */
  async saveFlow(document: FlowDocument, options: { keepTimestamp?: boolean; upgraded?: boolean } = {}): Promise<string> {
    if (options.keepTimestamp !== true) document.updatedAt = Date.now();
    const target = this.workflowPath(document.id);
    const value = flowToYaml(document) as Record<string, YamlValue>;
    const yaml = dumpYaml({ ...value, createdAt: document.createdAt, updatedAt: document.updatedAt } as YamlValue, FLOW_HEADER);
    await writeFile(target, yaml, 'utf8');
    const info = await stat(target);
    this.workflowCache.set(document.id, { mtimeMs: info.mtimeMs, summary: flowSummary(document, target, options.upgraded === true) });
    return target;
  }

  async readLayout(id: string): Promise<FlowLayout | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.layoutPath(id), 'utf8'));
      if (!isRecord(parsed) || !isRecord(parsed.nodes)) return undefined;
      const nodes: FlowLayout['nodes'] = {};
      for (const [key, point] of Object.entries(parsed.nodes)) {
        if (isRecord(point) && typeof point.x === 'number' && typeof point.y === 'number' && Number.isFinite(point.x) && Number.isFinite(point.y)) {
          nodes[key] = { x: Math.round(point.x), y: Math.round(point.y) };
        }
      }
      return { version: typeof parsed.version === 'number' ? parsed.version : 1, nodes };
    } catch {
      return undefined;
    }
  }

  async saveLayout(id: string, layout: FlowLayout): Promise<void> {
    const nodes: FlowLayout['nodes'] = {};
    for (const [key, point] of Object.entries(layout.nodes ?? {})) {
      if (typeof point?.x === 'number' && typeof point?.y === 'number' && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        nodes[key] = { x: Math.round(point.x), y: Math.round(point.y) };
      }
    }
    await writeFile(this.layoutPath(id), `${JSON.stringify({ version: layout.version ?? 1, nodes }, null, 2)}\n`, 'utf8');
  }

  async listWorkflows(): Promise<WorkflowSummary[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.workflowsDir)).filter(name => name.endsWith('.yaml'));
    } catch {
      return [];
    }
    const summaries: WorkflowSummary[] = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      const path = this.workflowPath(id);
      try {
        const info = await stat(path);
        const cached = this.workflowCache.get(id);
        if (cached !== undefined && cached.mtimeMs === info.mtimeMs) {
          summaries.push(cached.summary);
          continue;
        }
        const document = await this.loadFlow(id);
        const fresh = await stat(path);
        const summary = this.workflowCache.get(id)?.summary ?? flowSummary(document, path, false);
        this.workflowCache.set(id, { mtimeMs: fresh.mtimeMs, summary });
        summaries.push(summary);
      } catch (error) {
        summaries.push({
          id,
          name: id,
          stepCount: 0,
          hasBios: false,
          updatedAt: 0,
          path: this.workflowPath(id),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries;
  }

  async deleteWorkflow(id: string): Promise<void> {
    this.workflowCache.delete(id);
    await rm(this.workflowPath(id), { force: true });
    await rm(this.layoutPath(id), { force: true });
    await rm(this.workflowAssetDir(id), { recursive: true, force: true });
  }

  async saveRun(run: RunRecord): Promise<void> {
    run.updatedAt = Date.now();
    const dir = join(this.runsDir, run.id);
    await mkdir(join(dir, 'shots'), { recursive: true, mode: 0o700 });
    const path = join(this.runsDir, `${run.id}.json`);
    await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
    await mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
  }

  runDir(id: string): string {
    return join(this.runsDir, id);
  }

  async saveRunShot(id: string, data: Uint8Array, tag: string): Promise<string> {
    const relative = `shots/${Date.now().toString(36)}-${tag.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)}.jpg`;
    const root = this.runDir(id);
    const target = resolve(root, relative);
    if (!target.startsWith(`${resolve(root)}${sep}`)) throw new StoreError('INVALID_PATH', 'run image path escaped its directory');
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data);
    return relative;
  }

  async getRun(id: string): Promise<RunRecord> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.runsDir, `${id}.json`), 'utf8'));
      return parsed as RunRecord;
    } catch {
      throw new StoreError('RUN_NOT_FOUND', `run ${JSON.stringify(id)} not found`);
    }
  }

  /** Remove one stored run record and its screenshot directory. */
  async deleteRun(id: string): Promise<void> {
    const safe = id.trim();
    if (safe === '' || safe.includes('/') || safe.includes('\\') || safe.includes('..')) {
      throw new StoreError('INVALID_PATH', 'invalid run id');
    }
    const root = `${resolve(this.runsDir)}${sep}`;
    const jsonPath = resolve(this.runsDir, `${safe}.json`);
    const dirPath = resolve(this.runsDir, safe);
    if (!jsonPath.startsWith(root) || !dirPath.startsWith(root)) {
      throw new StoreError('INVALID_PATH', 'run path escaped the runs directory');
    }
    await rm(jsonPath, { force: true });
    await rm(dirPath, { recursive: true, force: true });
  }

  /** Remove every stored run except an optional active run id. */
  async clearRuns(excludeId?: string): Promise<number> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.runsDir);
    } catch {
      return 0;
    }
    const ids = new Set<string>();
    for (const name of entries) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : name;
      if (id !== '' && id !== excludeId) ids.add(id);
    }
    for (const id of ids) await this.deleteRun(id);
    return ids.size;
  }

  async listRuns(limit = 30): Promise<RunSummary[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.runsDir)).filter(name => name.endsWith('.json'));
    } catch {
      return [];
    }
    const runs: RunSummary[] = [];
    for (const name of names.slice(-limit * 2)) {
      try {
        const run = await this.getRun(name.slice(0, -5));
        runs.push({
          id: run.id,
          workflowId: run.workflowId,
          workflowName: run.workflowName,
          deviceId: run.deviceId,
          status: run.status,
          phase: run.phase,
          ...(run.reason !== undefined ? { reason: run.reason } : {}),
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          currentStepIndex: run.currentStepIndex,
          totalSteps: run.steps.length,
        });
      } catch {
        // Skip an unreadable run file.
      }
    }
    runs.sort((a, b) => b.updatedAt - a.updatedAt);
    return runs.slice(0, limit);
  }

  /** Path of the persisted ASCII text history file (one command per line, like .bash_history). */
  get textHistoryPath(): string {
    return join(this.dataDir, 'text-history.txt');
  }

  async readTextHistory(): Promise<string[]> {
    try {
      const raw = await readFile(this.textHistoryPath, 'utf8');
      return raw.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line !== '');
    } catch {
      return [];
    }
  }

  private async writeTextHistory(items: string[]): Promise<string[]> {
    const clean = items
      .map(item => item.replace(/[\r\n]+/g, ' '))
      .filter(item => item !== '')
      .slice(0, 100);
    await writeFile(this.textHistoryPath, clean.length === 0 ? '' : `${clean.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      await chmod(this.textHistoryPath, 0o600);
    } catch {
      // Ignore chmod on filesystems that do not support POSIX modes.
    }
    return clean;
  }

  async addTextHistory(text: string): Promise<string[]> {
    const entry = text.replace(/[\r\n]+/g, ' ');
    if (entry === '') return this.readTextHistory();
    const current = await this.readTextHistory();
    return this.writeTextHistory([entry, ...current.filter(item => item !== entry)]);
  }

  async removeTextHistory(text: string): Promise<string[]> {
    const current = await this.readTextHistory();
    return this.writeTextHistory(current.filter(item => item !== text));
  }

  async clearTextHistory(): Promise<string[]> {
    return this.writeTextHistory([]);
  }

  /** Read a JPEG/PNG below the data root as bytes. */
  async readImage(relativePath: string): Promise<Uint8Array> {
    const target = resolve(this.dataDir, relativePath);
    if (!target.startsWith(`${resolve(this.dataDir)}${sep}`)) {
      throw new StoreError('INVALID_PATH', 'image path escapes the KVMFlow data directory');
    }
    if (!/\.(?:jpe?g|png)$/i.test(target)) throw new StoreError('INVALID_PATH', 'only JPEG and PNG images can be read');
    const info = await stat(target);
    if (!info.isFile()) throw new StoreError('INVALID_PATH', 'image path is not a file');
    return readFile(target);
  }

  /** Build the snapshot shown by the UI. */
  async state(active: {
    recording?: RecordingRecord;
    run?: RunRecord;
  } = {}): Promise<ServerState> {
    const recordings = await this.listRecordings();
    const workflows = await this.listWorkflows();
    const runs = await this.listRuns();
    return {
      dataDir: this.dataDir,
      devices: this.listDevices(),
      ...(this.defaultDeviceId() !== undefined ? { defaultDeviceId: this.defaultDeviceId() } : {}),
      recordings: recordings.map(recording => ({
        id: recording.id,
        name: recording.name,
        status: recording.status,
        eventCount: recording.events.length,
        stepCount: recording.steps.length,
        updatedAt: recording.updatedAt,
      })),
      ...(active.recording !== undefined ? {
        activeRecording: {
          id: active.recording.id,
          name: active.recording.name,
          eventCount: active.recording.events.length,
          stepCount: active.recording.steps.length,
          startedAt: active.recording.createdAt,
        },
      } : {}),
      workflows,
      ...(active.run !== undefined ? { activeRun: active.run } : {}),
      recentRuns: runs,
    };
  }
}
