/** Manual recorder: keeps HID events and screenshot evidence for workflow generation. */
import { LinkrClient, LinkrError, type LinkrEvent } from './linkr.js';
import { Store, StoreError } from './store.js';
import type { DeviceRecord, RecordingEventRecord, RecordingRecord, RecordingStepRecord } from './types.js';

const BEFORE_MIN_GAP_MS = 900;
const AFTER_DEBOUNCE_MS = 700;

export interface RecorderDeps {
  store: Store;
  clientFor: (device: DeviceRecord) => LinkrClient;
}

/** Durable write spacing while events stream in; boundaries always flush. */
const FLUSH_INTERVAL_MS = 500;

/** One active manual recording. */
export class Recorder {
  private readonly store: Store;
  private readonly clientFor: (device: DeviceRecord) => LinkrClient;
  private active: RecordingRecord | undefined;
  private lastCaptureAt = 0;
  private afterTimer: NodeJS.Timeout | undefined;
  private afterDevice: DeviceRecord | undefined;
  private flushTimer: NodeJS.Timeout | undefined;
  private dirty = false;
  private disposed = false;

  constructor(deps: RecorderDeps) {
    this.store = deps.store;
    this.clientFor = deps.clientFor;
  }

  /** Mark interrupted recordings as stopped after a Host restart. */
  async recover(): Promise<void> {
    const recordings = await this.store.listRecordings();
    for (const recording of recordings) {
      if (recording.status === 'recording') {
        recording.status = 'stopped';
        recording.error = 'Recording was interrupted when the plugin restarted.';
        await this.store.saveRecording(recording);
      }
    }
  }

  current(): RecordingRecord | undefined {
    return this.active;
  }

  /**
   * Start one recording.
   * @param device - target device.
   * @param name - recording name.
   * @param description - optional purpose.
   * @returns the new recording.
   */
  async start(device: DeviceRecord, name: string, description = ''): Promise<RecordingRecord> {
    if (this.active !== undefined) {
      throw new StoreError('RECORDING_ACTIVE', `recording ${this.active.id} is already active`);
    }
    const now = Date.now();
    const recording: RecordingRecord = {
      id: `rec-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || `Recording ${new Date(now).toLocaleString()}`,
      description,
      deviceId: device.id,
      status: 'recording',
      createdAt: now,
      updatedAt: now,
      events: [],
      steps: [],
    };
    try {
      const snapshot = await this.clientFor(device).snapshot();
      recording.startShot = await this.store.saveRecordingShot(recording.id, snapshot.data, 'start');
      this.lastCaptureAt = Date.now();
    } catch (error) {
      recording.error = `Start screen capture unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
    await this.store.saveRecording(recording);
    this.active = recording;
    return recording;
  }

  /** Capture the pre-action frame when the previous capture is old enough. */
  private async captureBefore(device: DeviceRecord): Promise<string | undefined> {
    if (this.active === undefined) return undefined;
    if (Date.now() - this.lastCaptureAt < BEFORE_MIN_GAP_MS) return undefined;
    try {
      const snapshot = await this.clientFor(device).snapshot();
      this.lastCaptureAt = Date.now();
      return await this.store.saveRecordingShot(this.active.id, snapshot.data, 'before');
    } catch {
      return undefined;
    }
  }

  /**
   * Append one HID event to the active recording.
   * @param device - target device.
   * @param event - normalized Linkr event.
   * @returns the recorded event, or undefined when no recording is active.
   */
  async append(device: DeviceRecord, event: LinkrEvent): Promise<RecordingEventRecord | undefined> {
    if (this.active === undefined || this.active.status !== 'recording') return undefined;
    if (this.active.deviceId !== undefined && this.active.deviceId !== device.id) return undefined;
    const before = await this.captureBefore(device);
    const record: RecordingEventRecord = {
      seq: this.active.events.length + 1,
      at: Date.now(),
      event,
      ...(before !== undefined ? { before } : {}),
    };
    this.active.events.push(record);
    this.afterDevice = device;
    if (this.afterTimer !== undefined) clearTimeout(this.afterTimer);
    this.afterTimer = setTimeout(() => { void this.captureAfter() }, AFTER_DEBOUNCE_MS);
    // A fast key burst would otherwise rewrite the whole recording per event.
    this.dirty = true;
    if (this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        void this.flush();
      }, FLUSH_INTERVAL_MS);
    }
    return record;
  }

  private async flush(): Promise<void> {
    if (!this.dirty || this.active === undefined || this.disposed) return;
    this.dirty = false;
    await this.store.saveRecording(this.active);
  }

  private async captureAfter(): Promise<void> {
    this.afterTimer = undefined;
    if (this.disposed || this.active === undefined || this.active.status !== 'recording') return;
    const device = this.afterDevice;
    if (device === undefined) return;
    try {
      const snapshot = await this.clientFor(device).snapshot();
      const path = await this.store.saveRecordingShot(this.active.id, snapshot.data, 'after');
      const lastEvent = this.active.events[this.active.events.length - 1];
      if (lastEvent !== undefined) lastEvent.after = path;
      const lastStep = this.active.steps[this.active.steps.length - 1];
      if (lastStep !== undefined) lastStep.after = path;
      await this.store.saveRecording(this.active);
    } catch {
      // A missing video signal is normal while the target is off.
    }
  }

  /**
   * Close the current human step and start the next one at the current event boundary.
   * @param name - step name.
   * @param description - optional step description.
   * @param device - target device for a boundary screenshot.
   */
  async markStep(device: DeviceRecord, name: string, description = ''): Promise<RecordingStepRecord> {
    if (this.active === undefined) throw new StoreError('NO_RECORDING', 'no recording is active');
    this.dirty = true;
    await this.flush();
    const boundary = this.active.events.length;
    const previous = this.active.steps[this.active.steps.length - 1];
    let shot: string | undefined;
    try {
      const snapshot = await this.clientFor(device).snapshot();
      shot = await this.store.saveRecordingShot(this.active.id, snapshot.data, `step-${this.active.steps.length + 1}`);
    } catch {
      // The step still exists without a boundary image.
    }
    if (previous !== undefined) {
      previous.endSeq = boundary;
      if (shot !== undefined) previous.after = shot;
    }
    const step: RecordingStepRecord = {
      id: `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || `Step ${this.active.steps.length + 1}`,
      description,
      startSeq: boundary + 1,
      endSeq: boundary,
      ...(shot !== undefined ? { before: shot } : {}),
      createdAt: Date.now(),
    };
    this.active.steps.push(step);
    await this.store.saveRecording(this.active);
    return step;
  }

  /** Update a step's human description. */
  async updateStep(stepId: string, patch: { name?: string; description?: string }): Promise<RecordingStepRecord> {
    if (this.active === undefined) throw new StoreError('NO_RECORDING', 'no recording is active');
    const step = this.active.steps.find(entry => entry.id === stepId);
    if (step === undefined) throw new StoreError('STEP_NOT_FOUND', `step ${JSON.stringify(stepId)} not found`);
    if (typeof patch.name === 'string' && patch.name.trim() !== '') step.name = patch.name.trim();
    if (typeof patch.description === 'string') step.description = patch.description;
    await this.store.saveRecording(this.active);
    return step;
  }

  /** Remove the latest step boundary. */
  async removeLastStep(): Promise<void> {
    if (this.active === undefined) throw new StoreError('NO_RECORDING', 'no recording is active');
    const removed = this.active.steps.pop();
    if (removed === undefined) return;
    const previous = this.active.steps[this.active.steps.length - 1];
    if (previous !== undefined) previous.endSeq = this.active.events.length;
    await this.store.saveRecording(this.active);
  }

  /**
   * Stop the active recording.
   * @returns the finished recording.
   */
  async stop(): Promise<RecordingRecord> {
    if (this.active === undefined) throw new StoreError('NO_RECORDING', 'no recording is active');
    if (this.afterTimer !== undefined) {
      clearTimeout(this.afterTimer);
      this.afterTimer = undefined;
    }
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const device = this.afterDevice;
    if (device !== undefined) {
      try {
        const snapshot = await this.clientFor(device).snapshot();
        const path = await this.store.saveRecordingShot(this.active.id, snapshot.data, 'end');
        const lastEvent = this.active.events[this.active.events.length - 1];
        if (lastEvent !== undefined) lastEvent.after = path;
        const lastStep = this.active.steps[this.active.steps.length - 1];
        if (lastStep !== undefined) lastStep.after = path;
      } catch {
        // Keep the recording without an end frame.
      }
    }
    for (const step of this.active.steps) {
      if (step.endSeq < step.startSeq) step.endSeq = this.active.events.length;
    }
    this.active.status = 'stopped';
    const finished = this.active;
    await this.store.saveRecording(finished);
    this.active = undefined;
    this.afterDevice = undefined;
    return finished;
  }

  /** Release timers when the Host plugin unloads. */
  dispose(): void {
    this.disposed = true;
    if (this.afterTimer !== undefined) {
      clearTimeout(this.afterTimer);
      this.afterTimer = undefined;
    }
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}
