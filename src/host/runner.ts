/** Deterministic workflow execution with pre/post visual verification and human intervention. */
import {
  LinkrClient,
  LinkrError,
  clickEvents,
  keyChord,
  keyTap,
  normalizeKey,
  type LinkrEvent,
} from './linkr.js';
import { imageFacts, sha256 } from './image.js';
import { frameToTarget, type ViewMapping } from './view.js';
import { verifyWithVision } from './model.js';
import { Store, StoreError } from './store.js';
import type {
  DeviceRecord,
  FailurePolicy,
  RunRecord,
  RunStepState,
  VerifySpec,
  WorkflowAction,
  WorkflowRecord,
  WorkflowStep,
} from './types.js';

export interface RunnerDeps {
  ctx: any;
  store: Store;
  clientFor: (device: DeviceRecord) => LinkrClient;
  /** Called after every durable run transition so the UI can poll a fresh snapshot. */
  onChange?: (run: RunRecord) => void;
}

interface CaptureResult {
  data: Uint8Array;
  hash: string;
  bytes: number;
  width: number;
  height: number;
  /** Path relative to the KVMFlow data root. */
  rel: string;
}

interface Runtime {
  run: RunRecord;
  workflow: WorkflowRecord;
  device: DeviceRecord;
  controller: AbortController;
  pauseRequested: boolean;
  waiter?: (action: string) => void;
  previousHash?: string;
  finished: boolean;
}

export type ControlAction =
  | 'pause'
  | 'resume'
  | 'retry'
  | 'continue'
  | 'skip'
  | 'abort'
  | 'confirm_bios';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function describeError(error: unknown): string {
  if (error instanceof LinkrError) return `${error.code}: ${error.message}`;
  if (error instanceof StoreError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function buttonMask(button: 'left' | 'right' | 'middle' | undefined): 1 | 2 | 4 {
  return button === 'right' ? 2 : button === 'middle' ? 4 : 1;
}

function actionEvents(action: WorkflowAction, mapping?: ViewMapping): LinkrEvent[] {
  // `click`, `move`, and `scroll` carry image-normalized coordinates, so they go
  // through the same frame-to-target conversion as a human click. A `sequence`
  // holds raw HID events captured in target space and is never converted.
  const point = (x: number, y: number): { x: number; y: number } => frameToTarget(mapping, x, y);
  switch (action.type) {
    case 'key': {
      const events: LinkrEvent[] = [];
      const repeat = Math.max(1, action.repeat ?? 1);
      for (let index = 0; index < repeat; index += 1) {
        events.push(...keyTap(action.key, action.holdMs));
        if (index < repeat - 1) events.push(['delay', Math.max(0, action.intervalMs ?? 120)]);
      }
      return events;
    }
    case 'shortcut':
      return keyChord(action.keys, action.holdMs);
    case 'text': {
      const chunks: string[] = [];
      const size = Math.max(1, action.chunkSize ?? 120);
      for (let index = 0; index < action.text.length; index += size) chunks.push(action.text.slice(index, index + size));
      const events: LinkrEvent[] = [];
      for (const chunk of chunks) {
        events.push(['text', chunk]);
        events.push(['delay', 60]);
      }
      if (action.submit === true) events.push(...keyTap('Enter'));
      return events;
    }
    case 'click': {
      const target = point(action.x, action.y);
      return clickEvents(target.x, target.y, buttonMask(action.button), Math.max(1, action.count ?? 1));
    }
    case 'move': {
      const target = point(action.x, action.y);
      return [['mouse_abs', 0, target.x, target.y, 0, 0]];
    }
    case 'scroll': {
      const target = point(action.x ?? 0.5, action.y ?? 0.5);
      return [['mouse_abs', 0, target.x, target.y, action.wheelY, action.wheelX ?? 0]];
    }
    case 'delay':
      return [];
    case 'sequence':
      return action.events.map(event => validateSequenceEvent(event));
    default:
      throw new Error(`unsupported action ${JSON.stringify((action as { type?: string }).type)}`);
  }
}

function validateSequenceEvent(event: LinkrEvent): LinkrEvent {
  return event;
}

function describeAction(action: WorkflowAction): string {
  switch (action.type) {
    case 'key':
      return `key ${action.key}${(action.repeat ?? 1) > 1 ? ` x${action.repeat}` : ''}`;
    case 'shortcut':
      return `shortcut ${action.keys.join('+')}`;
    case 'text':
      return `text ${JSON.stringify(action.text.slice(0, 60))}${action.text.length > 60 ? '…' : ''}`;
    case 'click':
      return `click ${action.button ?? 'left'} (${action.x.toFixed(3)}, ${action.y.toFixed(3)})${(action.count ?? 1) > 1 ? ` x${action.count}` : ''}`;
    case 'move':
      return `move (${action.x.toFixed(3)}, ${action.y.toFixed(3)})`;
    case 'scroll':
      return `scroll ${action.wheelY}`;
    case 'delay':
      return `delay ${action.ms}ms`;
    case 'sequence':
      return `sequence ${action.events.length} events`;
    default:
      return 'action';
  }
}

function defaultVerify(action: WorkflowAction): VerifySpec {
  return { mode: action.type === 'delay' ? 'none' : 'change', settleMs: 800, timeoutSec: 12, pollMs: 600 };
}

/** Execute one workflow at a time with a deterministic, inspectable state machine. */
export class Runner {
  private readonly ctx: any;
  private readonly store: Store;
  private readonly clientFor: (device: DeviceRecord) => LinkrClient;
  private readonly onChange?: (run: RunRecord) => void;
  private readonly runtimes = new Map<string, Runtime>();
  private lastRunId?: string;

  constructor(deps: RunnerDeps) {
    this.ctx = deps.ctx;
    this.store = deps.store;
    this.clientFor = deps.clientFor;
    this.onChange = deps.onChange;
  }

  activeRun(): RunRecord | undefined {
    for (const runtime of this.runtimes.values()) {
      if (!runtime.finished) return runtime.run;
    }
    return undefined;
  }

  async latestRun(): Promise<RunRecord | undefined> {
    const active = this.activeRun();
    if (active !== undefined) return active;
    if (this.lastRunId !== undefined) {
      try {
        return await this.store.getRun(this.lastRunId);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Start one workflow.
   * @param workflowId - workflow file id.
   * @param deviceId - optional device override.
   * @param options - BIOS arming and initial step.
   */
  async start(workflowId: string, deviceId?: string, options: { armBios?: boolean } = {}): Promise<RunRecord> {
    const active = this.activeRun();
    if (active !== undefined) {
      throw new StoreError('RUN_ACTIVE', `run ${active.id} is still active; control it before starting another`);
    }
    const workflow = await this.store.loadWorkflow(workflowId);
    const device = this.store.getDevice(deviceId ?? workflow.deviceId);
    const now = Date.now();
    const run: RunRecord = {
      id: `run-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      deviceId: device.id,
      status: 'starting',
      phase: 'prepare',
      createdAt: now,
      updatedAt: now,
      currentStepIndex: 0,
      steps: workflow.steps.map((step, index): RunStepState => ({
        index,
        id: step.id,
        name: step.name,
        status: 'pending',
        attempts: 0,
      })),
      log: [],
    };
    if (workflow.bios !== undefined && options.armBios !== false) {
      // Report the armed state before the worker starts so the caller can
      // ask the human to press the power button at the right moment.
      run.status = 'armed';
      run.phase = 'bios: waiting for power';
    }
    const runtime: Runtime = {
      run,
      workflow,
      device,
      controller: new AbortController(),
      pauseRequested: false,
      finished: false,
    };
    this.runtimes.set(run.id, runtime);
    this.lastRunId = run.id;
    this.log(runtime, 'info', `Starting workflow "${workflow.name}" on ${device.name}`);
    await this.persist(runtime);
    void this.worker(runtime, options).catch(error => {
      // worker already records terminal failures; this protects teardown.
      console.error('[kvmflow] run worker crashed:', error);
    });
    return run;
  }

  /**
   * Apply a human control action to a paused or running run.
   * @param runId - run id.
   * @param action - control verb.
   */
  async control(runId: string, action: ControlAction): Promise<RunRecord> {
    const runtime = this.runtimes.get(runId);
    if (runtime === undefined || runtime.finished) {
      throw new StoreError('RUN_NOT_ACTIVE', `run ${JSON.stringify(runId)} is not active`);
    }
    this.log(runtime, 'info', `Operator action: ${action}`);
    if (action === 'abort') {
      runtime.controller.abort();
      runtime.waiter?.('abort');
      runtime.waiter = undefined;
      await this.persist(runtime);
      return runtime.run;
    }
    if (action === 'pause') {
      runtime.pauseRequested = true;
      await this.persist(runtime);
      return runtime.run;
    }
    const waiter = runtime.waiter;
    if (waiter === undefined) {
      throw new StoreError('RUN_NOT_WAITING', `run ${JSON.stringify(runId)} is not waiting for a decision`);
    }
    runtime.waiter = undefined;
    runtime.pauseRequested = false;
    if (runtime.run.awaiting?.kind === 'bios_confirm') {
      waiter(action === 'confirm_bios' ? 'confirm_bios' : action === 'retry' ? 'retry' : 'confirm_bios');
    } else if (action === 'resume') {
      waiter('retry');
    } else {
      waiter(action);
    }
    await this.persist(runtime);
    return runtime.run;
  }

  /** Abort any live run when the plugin unloads. */
  dispose(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.controller.abort();
      runtime.waiter?.('abort');
      runtime.waiter = undefined;
    }
    this.runtimes.clear();
  }

  private log(runtime: Runtime, level: 'info' | 'warn' | 'error', message: string): void {
    runtime.run.log.push({ at: Date.now(), level, message: message.slice(0, 2000) });
    if (runtime.run.log.length > 200) runtime.run.log.splice(0, runtime.run.log.length - 200);
    runtime.run.updatedAt = Date.now();
  }

  private async persist(runtime: Runtime): Promise<void> {
    runtime.run.updatedAt = Date.now();
    await this.store.saveRun(runtime.run);
    this.onChange?.(runtime.run);
  }

  private async worker(runtime: Runtime, options: { armBios?: boolean }): Promise<void> {
    const { run, workflow } = runtime;
    try {
      run.startedAt = Date.now();
      if (!(workflow.bios !== undefined && options.armBios !== false)) {
        run.status = 'running';
        run.phase = 'running';
      }
      await this.persist(runtime);
      if (workflow.bios !== undefined && options.armBios !== false) {
        const proceed = await this.biosPhase(runtime);
        if (!proceed) return;
      }
      if (workflow.bios !== undefined && options.armBios === false) {
        this.log(runtime, 'info', 'BIOS prelude skipped by operator');
      }
      for (let index = 0; index < workflow.steps.length; index += 1) {
        if (runtime.controller.signal.aborted) throw new Error('aborted');
        if (runtime.pauseRequested) {
          await this.pauseForOperator(runtime);
          if (runtime.run.status === 'aborted') return;
        }
        run.currentStepIndex = index;
        const step = workflow.steps[index];
        const state = run.steps[index];
        if (state.status === 'passed' || state.status === 'skipped') continue;
        run.phase = `step ${index + 1}/${workflow.steps.length}`;
        await this.persist(runtime);
        const outcome = await this.runStep(runtime, step, state);
        if (outcome === 'abort') {
          run.status = 'aborted';
          run.phase = 'aborted';
          run.reason = 'operator aborted the run';
          run.endedAt = Date.now();
          this.log(runtime, 'warn', 'Run aborted by operator');
          await this.persist(runtime);
          return;
        }
      }
      run.status = 'succeeded';
      run.phase = 'done';
      run.reason = undefined;
      run.endedAt = Date.now();
      this.log(runtime, 'info', 'Workflow completed successfully');
      await this.persist(runtime);
    } catch (error) {
      if (runtime.controller.signal.aborted) {
        run.status = 'aborted';
        run.phase = 'aborted';
        run.reason = 'aborted';
        run.endedAt = Date.now();
        this.log(runtime, 'warn', 'Run aborted');
      } else {
        run.status = 'failed';
        run.phase = 'failed';
        run.reason = describeError(error);
        run.endedAt = Date.now();
        this.log(runtime, 'error', `Run failed: ${run.reason}`);
      }
      await this.persist(runtime);
    } finally {
      runtime.finished = true;
      runtime.waiter = undefined;
      this.lastRunId = run.id;
    }
  }

  private async biosPhase(runtime: Runtime): Promise<boolean> {
    const { run, workflow, device } = runtime;
    const bios = workflow.bios ?? {};
    const hotkey = bios.hotkey?.trim() || 'F2';
    const intervalMs = Math.max(300, bios.intervalMs ?? 1200);
    const timeoutSec = Math.max(5, bios.timeoutSec ?? 180);
    const requireConfirm = bios.requireConfirm ?? false;
    const settleSec = Math.max(0, bios.settleSec ?? 2);
    run.status = 'armed';
    run.phase = 'bios: waiting for power';
    run.bios = {
      hotkey,
      intervalMs,
      timeoutSec,
      requireConfirm,
      armedAt: Date.now(),
    };
    this.log(runtime, 'info', `BIOS prelude armed: tapping ${hotkey} every ${intervalMs}ms, waiting up to ${timeoutSec}s for the target power button`);
    await this.persist(runtime);
    while (true) {
      if (runtime.controller.signal.aborted) throw new Error('aborted');
      const started = Date.now();
      let nextTap = 0;
      let lastPoll = 0;
      let detected = false;
      while (Date.now() - started < timeoutSec * 1000) {
        if (runtime.controller.signal.aborted) throw new Error('aborted');
        if (runtime.pauseRequested) {
          await this.pauseForOperator(runtime);
          if (runtime.controller.signal.aborted) return false;
          run.status = 'armed';
          run.phase = 'bios: waiting for power';
          run.awaiting = undefined;
          await this.persist(runtime);
          nextTap = 0;
          lastPoll = 0;
          continue;
        }
        if (Date.now() >= nextTap) {
          try {
            await this.clientFor(device).control(keyTap(hotkey));
            this.log(runtime, 'info', `Injected ${hotkey} while waiting for power`);
          } catch (error) {
            this.log(runtime, 'warn', `Hotkey injection failed: ${describeError(error)}`);
          }
          nextTap = Date.now() + intervalMs;
        }
        if (Date.now() - lastPoll >= 1000) {
          lastPoll = Date.now();
          try {
            const snapshot = await this.clientFor(device).snapshot();
            const facts = imageFacts(snapshot.data);
            const rel = await this.store.saveRunShot(run.id, snapshot.data, 'bios');
            run.bios.baseline = `runs/${run.id}/${rel}`;
            run.bios.detectedAt = Date.now();
            this.log(runtime, 'info', `Video signal detected after power-on (${facts.width}x${facts.height}); BIOS prelude complete`);
            detected = true;
            break;
          } catch (error) {
            if (!(error instanceof LinkrError) || !error.code.startsWith('SNAPSHOT')) {
              this.log(runtime, 'warn', `Waiting for video signal: ${describeError(error)}`);
            }
          }
        }
        await sleep(200, runtime.controller.signal);
      }
      if (!detected) {
        run.status = 'paused';
        run.phase = 'bios: timeout';
        run.reason = `no video signal within ${timeoutSec}s`;
        run.awaiting = {
          kind: 'failure',
          message: `BIOS prelude timed out after ${timeoutSec}s without a video signal. Power on the target, check HDMI/USB, then retry or abort.`,
          actions: ['retry', 'abort'],
        };
        this.log(runtime, 'warn', run.awaiting.message);
        await this.persist(runtime);
        const action = await this.waitForControl(runtime, 'failure', run.awaiting.message, ['retry', 'abort']);
        run.awaiting = undefined;
        if (action === 'abort') throw new Error('aborted');
        run.status = 'armed';
        run.phase = 'bios: waiting for power';
        run.reason = undefined;
        await this.persist(runtime);
        continue;
      }
      if (settleSec > 0) await sleep(settleSec * 1000, runtime.controller.signal);
      if (requireConfirm) {
        run.status = 'paused';
        run.phase = 'bios: confirm';
        run.awaiting = {
          kind: 'bios_confirm',
          message: 'Video signal detected. Confirm that the target is in BIOS to continue, or abort.',
          actions: ['confirm_bios', 'abort'],
        };
        this.log(runtime, 'info', 'Waiting for operator confirmation that BIOS is visible');
        await this.persist(runtime);
        const action = await this.waitForControl(runtime, 'bios_confirm', run.awaiting.message, ['confirm_bios', 'abort']);
        run.awaiting = undefined;
        if (action === 'abort') throw new Error('aborted');
      }
      run.status = 'running';
      run.phase = 'bios: entered';
      await this.persist(runtime);
      return true;
    }
  }

  private async pauseForOperator(runtime: Runtime): Promise<void> {
    runtime.pauseRequested = false;
    runtime.run.status = 'paused';
    runtime.run.phase = 'paused';
    runtime.run.reason = 'paused by operator';
    runtime.run.awaiting = {
      kind: 'failure',
      message: 'Paused before the next step. Resume to continue, or abort the run.',
      actions: ['resume', 'abort'],
    };
    this.log(runtime, 'info', 'Run paused by operator');
    await this.persist(runtime);
    const action = await this.waitForControl(runtime, 'failure', runtime.run.awaiting.message, ['resume', 'abort']);
    runtime.run.awaiting = undefined;
    if (action === 'abort') {
      runtime.run.status = 'aborted';
      return;
    }
    runtime.run.status = 'running';
    runtime.run.phase = 'running';
    runtime.run.reason = undefined;
    await this.persist(runtime);
  }

  private waitForControl(runtime: Runtime, kind: 'failure' | 'bios_confirm', message: string, actions: string[]): Promise<string> {
    return new Promise<string>(resolve => {
      if (runtime.controller.signal.aborted) {
        resolve('abort');
        return;
      }
      runtime.waiter = resolve;
      runtime.controller.signal.addEventListener('abort', () => resolve('abort'), { once: true });
      runtime.run.awaiting = { kind, message, actions };
      if (runtime.run.status !== 'paused') {
        runtime.run.status = 'paused';
        runtime.run.phase = 'awaiting';
      }
      void this.persist(runtime);
    });
  }

  private async capture(runtime: Runtime, tag: string): Promise<CaptureResult | undefined> {
    try {
      const snapshot = await this.clientFor(runtime.device).snapshot();
      const facts = imageFacts(snapshot.data);
      const rel = await this.store.saveRunShot(runtime.run.id, snapshot.data, tag);
      return { data: snapshot.data, hash: facts.sha256, bytes: facts.bytes, width: facts.width, height: facts.height, rel: `runs/${runtime.run.id}/${rel}` };
    } catch (error) {
      this.log(runtime, 'warn', `Screen capture failed (${tag}): ${describeError(error)}`);
      return undefined;
    }
  }

  private async evaluate(
    runtime: Runtime,
    spec: VerifySpec | undefined,
    before: CaptureResult | undefined,
    label: string,
  ): Promise<{ passed: boolean; reason: string; after?: CaptureResult; output?: string }> {
    const mode = spec?.mode ?? 'none';
    if (mode === 'none') return { passed: true, reason: 'no verification requested' };
    const settleMs = Math.max(0, spec?.settleMs ?? 800);
    const timeoutSec = Math.max(1, spec?.timeoutSec ?? 12);
    const pollMs = Math.max(100, spec?.pollMs ?? 600);
    if (settleMs > 0) await sleep(settleMs, runtime.controller.signal);
    const deadline = Date.now() + timeoutSec * 1000;
    let lastReason = 'no frame captured';
    let visionAttempts = 0;
    let after: CaptureResult | undefined;
    while (Date.now() <= deadline) {
      if (runtime.controller.signal.aborted) throw new Error('aborted');
      after = await this.capture(runtime, label);
      if (after === undefined) {
        lastReason = 'screen capture unavailable (target may be off or HDMI disconnected)';
      } else if (mode === 'change') {
        const requireChange = spec?.changed ?? true;
        const reference = before?.hash ?? runtime.previousHash;
        if (reference === undefined) {
          return { passed: requireChange, reason: requireChange ? 'no prior frame to compare; treating as passed' : 'no prior frame and unchanged requested', after };
        }
        const changed = reference !== after.hash;
        if (changed === requireChange) return { passed: true, reason: changed ? 'screen changed' : 'screen unchanged', after };
        lastReason = requireChange ? 'screen did not change' : 'screen changed but was expected to stay the same';
      } else if (mode === 'image') {
        if (spec?.image === undefined || spec.image === '') {
          return { passed: false, reason: 'image verification has no reference image', after };
        }
        try {
          const reference = await this.store.readWorkflowAsset(runtime.workflow.id, spec.image);
          const refHash = sha256(reference);
          if (refHash === after.hash) return { passed: true, reason: 'screen matches the reference image', after };
          const delta = Math.abs(reference.length - after.bytes);
          if (spec.maxByteDelta !== undefined && delta <= spec.maxByteDelta) {
            return { passed: true, reason: `screen is similar to the reference image (${delta} byte delta)`, after };
          }
          lastReason = `screen differs from the reference image (${delta} byte delta)`;
        } catch (error) {
          return { passed: false, reason: `reference image unavailable: ${describeError(error)}`, after };
        }
      } else if (mode === 'vision') {
        if (visionAttempts >= 2) {
          lastReason = `${lastReason} (vision attempts exhausted)`;
          break;
        }
        visionAttempts += 1;
        try {
          const verdict = await verifyWithVision(this.ctx, {
            data: after.data,
            condition: spec?.prompt?.trim() || `The screen satisfies step "${runtime.run.workflowName}" and shows progress away from the pre-action state.`,
            context: runtime.workflow.steps[runtime.run.currentStepIndex]?.description,
            signal: runtime.controller.signal,
          });
          if (verdict.passed) return { passed: true, reason: verdict.reason || 'vision model passed the screen', after, output: verdict.raw };
          lastReason = verdict.reason || 'vision model rejected the screen';
        } catch (error) {
          lastReason = `vision verification failed: ${describeError(error)}`;
        }
      } else {
        return { passed: false, reason: `unsupported verification mode ${JSON.stringify(mode)}`, after };
      }
      if (Date.now() + pollMs > deadline) break;
      await sleep(Math.min(pollMs, Math.max(100, deadline - Date.now())), runtime.controller.signal);
    }
    return { passed: false, reason: lastReason, after };
  }

  private async runStep(runtime: Runtime, step: WorkflowStep, state: RunStepState): Promise<'passed' | 'failed_continue' | 'skipped' | 'abort'> {
    const action = step.action;
    const policy: FailurePolicy = step.onFailure ?? { strategy: 'pause', retries: 0 };
    const verify = step.verify ?? defaultVerify(action);
    let attempts = 0;
    while (true) {
      if (runtime.controller.signal.aborted) return 'abort';
      attempts += 1;
      state.attempts = attempts;
      state.startedAt = Date.now();
      state.status = 'precheck';
      state.error = undefined;
      runtime.run.currentStepIndex = state.index;
      runtime.run.phase = `step ${state.index + 1}/${runtime.run.steps.length}: ${step.name}`;
      this.log(runtime, 'info', `Step ${state.index + 1} attempt ${attempts}: ${step.name}`);
      await this.persist(runtime);

      const needsFrame = verify.mode !== 'none' || step.precondition?.mode !== undefined && step.precondition.mode !== 'none';
      const before = needsFrame ? await this.capture(runtime, `step-${state.index + 1}-before`) : undefined;
      if (before !== undefined) state.before = before.rel;
      if (needsFrame && before === undefined) {
        const actionTaken = await this.handleFailure(runtime, step, state, 'screen capture unavailable before the action', policy);
        if (actionTaken === 'retry') { attempts -= 1; continue; }
        if (actionTaken === 'failed_continue') return 'failed_continue';
        if (actionTaken === 'skipped') return 'skipped';
        return 'abort';
      }

      if (step.precondition !== undefined && step.precondition.mode !== 'none') {
        state.status = 'precheck';
        await this.persist(runtime);
        const pre = await this.evaluate(runtime, step.precondition, before, `step-${state.index + 1}-precondition`);
        if (!pre.passed) {
          const actionTaken = await this.handleFailure(runtime, step, state, `precondition failed: ${pre.reason}`, policy);
          if (actionTaken === 'retry') { attempts -= 1; continue; }
          if (actionTaken === 'failed_continue') return 'failed_continue';
          if (actionTaken === 'skipped') return 'skipped';
          return 'abort';
        }
      }

      state.status = 'acting';
      await this.persist(runtime);
      try {
        if (action.type === 'delay') {
          await sleep(action.ms, runtime.controller.signal);
        } else {
          const events = actionEvents(action, runtime.device.viewMapping);
          if (events.length > 0) await this.clientFor(runtime.device).control(events);
        }
      } catch (error) {
        state.error = describeError(error);
        this.log(runtime, 'error', `Action failed in step ${state.index + 1}: ${state.error}`);
        const actionTaken = await this.handleFailure(runtime, step, state, `action failed: ${state.error}`, policy);
        if (actionTaken === 'retry') { attempts -= 1; continue; }
        if (actionTaken === 'failed_continue') return 'failed_continue';
        if (actionTaken === 'skipped') return 'skipped';
        return 'abort';
      }

      state.status = 'verifying';
      await this.persist(runtime);
      const verdict = await this.evaluate(runtime, verify, before, `step-${state.index + 1}-after`);
      if (verdict.after !== undefined) state.after = verdict.after.rel;
      state.verify = { mode: verify.mode ?? 'none', passed: verdict.passed, reason: verdict.reason, ...(verdict.output !== undefined ? { output: verdict.output } : {}) };
      if (verdict.passed) {
        state.status = 'passed';
        state.endedAt = Date.now();
        runtime.previousHash = verdict.after?.hash;
        this.log(runtime, 'info', `Step ${state.index + 1} passed: ${verdict.reason}`);
        await this.persist(runtime);
        return 'passed';
      }
      this.log(runtime, 'warn', `Step ${state.index + 1} verification failed: ${verdict.reason}`);
      const actionTaken = await this.handleFailure(runtime, step, state, verdict.reason, policy);
      if (actionTaken === 'retry') { attempts -= 1; continue; }
      if (actionTaken === 'failed_continue') return 'failed_continue';
      if (actionTaken === 'skipped') return 'skipped';
      return 'abort';
    }
  }

  private async handleFailure(
    runtime: Runtime,
    step: WorkflowStep,
    state: RunStepState,
    reason: string,
    policy: FailurePolicy,
  ): Promise<'retry' | 'failed_continue' | 'skipped' | 'abort'> {
    state.status = 'failed';
    state.endedAt = Date.now();
    state.error = reason;
    const message = policy.message?.trim() || `Step "${step.name}" failed: ${reason}`;
    this.log(runtime, 'warn', message);
    if (policy.strategy === 'retry' && state.attempts <= (policy.retries ?? 1)) {
      this.log(runtime, 'info', `Retrying step after failure (attempt ${state.attempts + 1})`);
      await this.persist(runtime);
      return 'retry';
    }
    if (policy.strategy === 'continue') {
      state.status = 'failed';
      this.log(runtime, 'warn', 'Continuing after failure by policy');
      await this.persist(runtime);
      return 'failed_continue';
    }
    if (policy.strategy === 'abort') {
      await this.persist(runtime);
      return 'abort';
    }
    runtime.run.status = 'paused';
    runtime.run.phase = 'awaiting intervention';
    runtime.run.reason = message;
    runtime.run.awaiting = {
      kind: 'failure',
      message,
      stepIndex: state.index,
      actions: ['retry', 'continue', 'skip', 'abort'],
    };
    await this.persist(runtime);
    const action = await this.waitForControl(runtime, 'failure', message, ['retry', 'continue', 'skip', 'abort']);
    runtime.run.awaiting = undefined;
    runtime.run.reason = undefined;
    if (action === 'abort') {
      runtime.run.status = 'aborted';
      return 'abort';
    }
    runtime.run.status = 'running';
    runtime.run.phase = `step ${state.index + 1}/${runtime.run.steps.length}: ${step.name}`;
    await this.persist(runtime);
    if (action === 'retry' || action === 'resume') {
      state.status = 'failed';
      return 'retry';
    }
    if (action === 'skip') {
      state.status = 'skipped';
      this.log(runtime, 'info', `Step ${state.index + 1} skipped by operator`);
      await this.persist(runtime);
      return 'skipped';
    }
    return 'failed_continue';
  }
}
