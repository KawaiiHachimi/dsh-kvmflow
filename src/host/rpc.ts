/** Authenticated browser RPC surface for the KVMFlow panel. */
import { LinkrError, validateEvent } from './linkr.js';
import { imageFacts, toBase64 } from './image.js';
import { StoreError, type Store } from './store.js';
import { YamlError } from './yaml.js';
import { FlowInvalidError, type FlowService } from './flow/service.js';
import type { PatchOp } from './flow/patch.js';
import type { FlowLayout } from './flow/schema.js';
import type { Recorder } from './recorder.js';
import type { Runner } from './runner.js';
import type { LinkrWebSession } from './session.js';

export interface RpcDeps {
  store: Store;
  recorder: Recorder;
  runner: Runner;
  flows: FlowService;
  clientFor: (device: any) => any;
  /** Web session (password login) used only by the real-time video signaling. */
  sessionFor: (device: any) => LinkrWebSession;
}

type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: object } };

function fail(code: string, message: string, details: object = {}): RpcResult {
  return { ok: false, error: { code, message, details } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function describe(error: unknown): RpcResult {
  if (error instanceof FlowInvalidError) return fail('kvmflow/INVALID_FLOW', error.message, { issues: error.issues });
  if (error instanceof LinkrError) return fail(`kvmflow/linkr/${error.code}`, error.message);
  if (error instanceof StoreError) return fail(`kvmflow/${error.code}`, error.message);
  if (error instanceof YamlError) return fail('kvmflow/yaml', error.message);
  return fail('kvmflow/internal', error instanceof Error ? error.message : String(error));
}

/**
 * Handle one KVMFlow RPC endpoint.
 * @param deps - store, recorder, runner, and KVM client factory.
 * @param endpoint - method name.
 * @param payload - JSON payload.
 * @returns a Connection RPC result.
 */
export async function handleRpc(deps: RpcDeps, endpoint: string, payload: unknown): Promise<RpcResult> {
  const args = isRecord(payload) ? payload : {};
  try {
    switch (endpoint) {
      case 'state': {
        // `activeRun` is only a live run; finished runs remain in `recentRuns`
        // so the panel never disables "Run" because of a previous attempt.
        const state = await deps.store.state({ recording: deps.recorder.current(), run: deps.runner.activeRun() });
        return { ok: true, value: state };
      }
      case 'device.add': {
        const device = await deps.store.addDevice({
          name: args.name,
          baseUrl: args.baseUrl,
          token: args.token,
          username: args.username,
          password: args.password,
          notes: args.notes,
        });
        return { ok: true, value: { device, defaultDeviceId: deps.store.defaultDeviceId() ?? null } };
      }
      case 'device.update': {
        const id = str(args.id);
        if (id === undefined) return fail('kvmflow/INVALID_INPUT', 'id is required');
        const device = await deps.store.updateDevice(id, args);
        return { ok: true, value: { device } };
      }
      case 'device.remove': {
        const id = str(args.id);
        if (id === undefined) return fail('kvmflow/INVALID_INPUT', 'id is required');
        await deps.store.removeDevice(id);
        return { ok: true, value: { removed: id } };
      }
      case 'device.probe': {
        const device = deps.store.getDevice(str(args.deviceId));
        const probe = await deps.clientFor(device).probe();
        return { ok: true, value: { deviceId: device.id, probe } };
      }
      case 'screen.snapshot': {
        const device = deps.store.getDevice(str(args.deviceId));
        const snapshot = await deps.clientFor(device).snapshot();
        const facts = imageFacts(snapshot.data);
        return {
          ok: true,
          value: {
            deviceId: device.id,
            width: facts.width,
            height: facts.height,
            bytes: facts.bytes,
            sha256: facts.sha256,
            capturedAt: snapshot.capturedAt,
            mediaType: 'image/jpeg',
            data: toBase64(snapshot.data),
          },
        };
      }
      case 'screen.control': {
        if (!Array.isArray(args.events) || args.events.length === 0) return fail('kvmflow/INVALID_INPUT', 'events must be a non-empty array');
        const events = (args.events as unknown[]).map((event, index) => validateEvent(event, index));
        const device = deps.store.getDevice(str(args.deviceId));
        await deps.clientFor(device).control(events);
        const active = deps.recorder.current();
        if (active !== undefined && active.deviceId === device.id) {
          for (const event of events) await deps.recorder.append(device, event);
        }
        return { ok: true, value: { deviceId: device.id, sent: events.length } };
      }
      case 'record.start': {
        const device = deps.store.getDevice(str(args.deviceId));
        const recording = await deps.recorder.start(device, str(args.name) ?? `录制 ${new Date().toLocaleString()}`, str(args.description) ?? '');
        return { ok: true, value: { recording } };
      }
      case 'record.stop': {
        const recording = await deps.recorder.stop();
        return { ok: true, value: { recording } };
      }
      case 'record.markStep': {
        const device = deps.store.getDevice(str(args.deviceId));
        const step = await deps.recorder.markStep(device, str(args.name) ?? '步骤', str(args.description) ?? '');
        return { ok: true, value: { step } };
      }
      case 'record.updateStep': {
        const stepId = str(args.stepId);
        if (stepId === undefined) return fail('kvmflow/INVALID_INPUT', 'stepId is required');
        const patch = {
          name: str(args.name),
          description: typeof args.description === 'string' ? args.description : undefined,
        };
        try {
          const step = await deps.recorder.updateStep(stepId, patch);
          return { ok: true, value: { step } };
        } catch (error) {
          const recordingId = str(args.recordingId);
          if (recordingId === undefined) throw error;
          const recording = await deps.store.getRecording(recordingId);
          const step = recording.steps.find(entry => entry.id === stepId);
          if (step === undefined) return fail('kvmflow/STEP_NOT_FOUND', `step ${JSON.stringify(stepId)} not found`);
          if (patch.name !== undefined) step.name = patch.name;
          if (patch.description !== undefined) step.description = patch.description;
          await deps.store.saveRecording(recording);
          return { ok: true, value: { step } };
        }
      }
      case 'record.removeLastStep': {
        await deps.recorder.removeLastStep();
        return { ok: true, value: { ok: true } };
      }
      case 'record.get': {
        const id = str(args.id) ?? deps.recorder.current()?.id;
        if (id === undefined) return fail('kvmflow/NO_RECORDING', 'no recording id and no active recording');
        const recording = await deps.store.getRecording(id);
        return { ok: true, value: { recording } };
      }
      case 'record.delete': {
        const id = str(args.id);
        if (id === undefined) return fail('kvmflow/INVALID_INPUT', 'id is required');
        await deps.store.deleteRecording(id);
        return { ok: true, value: { removed: id } };
      }
      case 'workflow.list': {
        return { ok: true, value: { workflows: await deps.store.listWorkflows() } };
      }
      case 'workflow.get':
      case 'flow.get': {
        const id = str(args.id);
        if (id === undefined) return fail('kvmflow/INVALID_INPUT', 'id is required');
        return { ok: true, value: await deps.flows.view(id) };
      }
      case 'flow.catalog':
        return { ok: true, value: { nodes: deps.flows.catalog() } };
      case 'flow.check': {
        const result = deps.flows.check({
          ...(typeof args.yaml === 'string' ? { yaml: args.yaml } : {}),
          ...(args.document === undefined ? {} : { document: args.document }),
          ...(str(args.id) === undefined ? {} : { id: str(args.id) }),
        });
        return { ok: true, value: result };
      }
      case 'workflow.save':
      case 'flow.save': {
        const id = str(args.id);
        const yaml = typeof args.yaml === 'string' && args.yaml.trim() !== '' ? args.yaml : undefined;
        if (yaml === undefined && args.document === undefined) {
          return fail('kvmflow/INVALID_INPUT', 'yaml or document is required');
        }
        const view = await deps.flows.save({
          ...(id === undefined ? {} : { id }),
          ...(yaml === undefined ? {} : { yaml }),
          ...(args.document === undefined ? {} : { document: args.document }),
          ...(isRecord(args.layout) ? { layout: args.layout as unknown as FlowLayout } : {}),
          strict: args.strict === true,
        });
        return { ok: true, value: view };
      }
      case 'flow.patch': {
        const id = str(args.id);
        if (id === undefined) return fail('kvmflow/INVALID_INPUT', 'id is required');
        if (!Array.isArray(args.ops)) return fail('kvmflow/INVALID_INPUT', 'ops must be a list');
        return { ok: true, value: await deps.flows.patch(id, args.ops as PatchOp[], args.strict !== false) };
      }
      case 'flow.layout': {
        const id = str(args.id);
        if (id === undefined || !isRecord(args.layout)) return fail('kvmflow/INVALID_INPUT', 'id and layout are required');
        await deps.flows.saveLayout(id, args.layout as unknown as FlowLayout);
        return { ok: true, value: { saved: id } };
      }
      case 'flow.testNode': {
        const id = str(args.id);
        const nodeId = str(args.nodeId);
        if (id === undefined || nodeId === undefined) return fail('kvmflow/INVALID_INPUT', 'id and nodeId are required');
        return { ok: true, value: await deps.runner.nodeTest(id, nodeId, str(args.deviceId)) };
      }
      case 'workflow.create': {
        const view = await deps.flows.create({
          name: str(args.name) ?? 'New workflow',
          ...(str(args.description) === undefined ? {} : { description: str(args.description) }),
          ...(str(args.deviceId) === undefined ? {} : { deviceId: str(args.deviceId) }),
          ...(str(args.recordingId) === undefined ? {} : { recordingId: str(args.recordingId) }),
        });
        return { ok: true, value: view };
      }
      case 'workflow.delete': {
        const id = str(args.id);
        if (id === undefined) return fail('kvmflow/INVALID_INPUT', 'id is required');
        await deps.store.deleteWorkflow(id);
        return { ok: true, value: { removed: id } };
      }
      case 'run.start': {
        const run = await deps.runner.start(
          str(args.workflowId) ?? '',
          str(args.deviceId),
          {
            armBios: args.armBios !== false,
            ...(isRecord(args.inputs) ? { inputs: args.inputs } : {}),
          },
        );
        return { ok: true, value: { run } };
      }
      case 'run.get': {
        const id = str(args.id);
        const run = id === undefined ? await deps.runner.latestRun() : await deps.store.getRun(id);
        return { ok: true, value: { run: run ?? null } };
      }
      case 'run.control': {
        const id = str(args.id);
        if (id === undefined) return fail('kvmflow/INVALID_INPUT', 'id is required');
        const action = str(args.action);
        if (action === undefined) return fail('kvmflow/INVALID_INPUT', 'action is required');
        const run = await deps.runner.control(id, action as any, {
          ...(str(args.port) === undefined ? {} : { port: str(args.port) }),
          ...(str(args.option) === undefined ? {} : { option: str(args.option) }),
        });
        return { ok: true, value: { run } };
      }
      case 'run.list': {
        return { ok: true, value: { runs: await deps.store.listRuns(30) } };
      }
      case 'video.status': {
        const device = deps.store.getDevice(str(args.deviceId));
        const session = deps.sessionFor(device);
        if (!str(device.username) || !device.password) {
          return { ok: true, value: { available: false, reason: 'no_web_credentials' } };
        }
        try {
          const info = await session.videoInfo();
          return { ok: true, value: { available: true, ...info } };
        } catch (error) {
          return {
            ok: true,
            value: {
              available: false,
              reason: 'web_session_failed',
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }
      case 'rtc.offer': {
        const device = deps.store.getDevice(str(args.deviceId));
        const offer = str(args.offer);
        if (offer === undefined) return fail('kvmflow/INVALID_INPUT', 'offer is required');
        if (!device.username || !device.password) {
          return fail('kvmflow/NO_WEB_CREDENTIALS', 'this device has no Linkr web username/password, so real-time video is unavailable');
        }
        const answer = await deps.sessionFor(device).whep(offer);
        return { ok: true, value: answer };
      }
      case 'image.read': {
        const path = str(args.path);
        if (path === undefined) return fail('kvmflow/INVALID_INPUT', 'path is required');
        const data = await deps.store.readImage(path);
        return { ok: true, value: { path, mediaType: path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg', data: toBase64(data) } };
      }
      default:
        return fail('kvmflow/UNKNOWN_METHOD', `unknown KVMFlow RPC method ${JSON.stringify(endpoint)}`);
    }
  } catch (error) {
    if (error instanceof StoreError && error.code === 'INVALID_PATH') return fail('kvmflow/INVALID_PATH', error.message);
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return fail('kvmflow/NOT_FOUND', `file not found: ${error instanceof Error ? error.message : String(error)}`);
    return describe(error);
  }
}
