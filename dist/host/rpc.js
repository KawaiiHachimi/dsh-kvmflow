/** Authenticated browser RPC surface for the KVMFlow panel. */
import { LinkrError, validateEvent } from './linkr.js';
import { imageFacts, toBase64 } from './image.js';
import { StoreError, normalizeWorkflow } from './store.js';
import { parseYaml, YamlError } from './yaml.js';
function fail(code, message) {
    return { ok: false, error: { code, message, details: {} } };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function str(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
function describe(error) {
    if (error instanceof LinkrError)
        return fail(`kvmflow/linkr/${error.code}`, error.message);
    if (error instanceof StoreError)
        return fail(`kvmflow/${error.code}`, error.message);
    if (error instanceof YamlError)
        return fail('kvmflow/yaml', error.message);
    return fail('kvmflow/internal', error instanceof Error ? error.message : String(error));
}
/**
 * Handle one KVMFlow RPC endpoint.
 * @param deps - store, recorder, runner, and KVM client factory.
 * @param endpoint - method name.
 * @param payload - JSON payload.
 * @returns a Connection RPC result.
 */
export async function handleRpc(deps, endpoint, payload) {
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
                if (id === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'id is required');
                const device = await deps.store.updateDevice(id, args);
                return { ok: true, value: { device } };
            }
            case 'device.remove': {
                const id = str(args.id);
                if (id === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'id is required');
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
                if (!Array.isArray(args.events) || args.events.length === 0)
                    return fail('kvmflow/INVALID_INPUT', 'events must be a non-empty array');
                const events = args.events.map((event, index) => validateEvent(event, index));
                const device = deps.store.getDevice(str(args.deviceId));
                await deps.clientFor(device).control(events);
                const active = deps.recorder.current();
                if (active !== undefined && active.deviceId === device.id) {
                    for (const event of events)
                        await deps.recorder.append(device, event);
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
                if (stepId === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'stepId is required');
                const patch = {
                    name: str(args.name),
                    description: typeof args.description === 'string' ? args.description : undefined,
                };
                try {
                    const step = await deps.recorder.updateStep(stepId, patch);
                    return { ok: true, value: { step } };
                }
                catch (error) {
                    const recordingId = str(args.recordingId);
                    if (recordingId === undefined)
                        throw error;
                    const recording = await deps.store.getRecording(recordingId);
                    const step = recording.steps.find(entry => entry.id === stepId);
                    if (step === undefined)
                        return fail('kvmflow/STEP_NOT_FOUND', `step ${JSON.stringify(stepId)} not found`);
                    if (patch.name !== undefined)
                        step.name = patch.name;
                    if (patch.description !== undefined)
                        step.description = patch.description;
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
                if (id === undefined)
                    return fail('kvmflow/NO_RECORDING', 'no recording id and no active recording');
                const recording = await deps.store.getRecording(id);
                return { ok: true, value: { recording } };
            }
            case 'record.delete': {
                const id = str(args.id);
                if (id === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'id is required');
                await deps.store.deleteRecording(id);
                return { ok: true, value: { removed: id } };
            }
            case 'workflow.list': {
                return { ok: true, value: { workflows: await deps.store.listWorkflows() } };
            }
            case 'workflow.get': {
                const id = str(args.id);
                if (id === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'id is required');
                const yaml = await deps.store.readWorkflowYaml(id);
                const workflow = await deps.store.loadWorkflow(id);
                return { ok: true, value: { workflow, yaml } };
            }
            case 'workflow.save': {
                const id = str(args.id);
                let workflow;
                if (typeof args.yaml === 'string' && args.yaml.trim() !== '') {
                    let parsed;
                    try {
                        parsed = parseYaml(args.yaml);
                    }
                    catch (error) {
                        return fail('kvmflow/yaml', error instanceof YamlError ? error.message : String(error));
                    }
                    workflow = normalizeWorkflow(parsed, id ?? '');
                    if (id !== undefined)
                        workflow.id = id;
                }
                else if (id !== undefined) {
                    workflow = await deps.store.loadWorkflow(id);
                    if (typeof args.name === 'string' && args.name.trim() !== '')
                        workflow.name = args.name.trim();
                    if (typeof args.description === 'string')
                        workflow.description = args.description;
                }
                else {
                    return fail('kvmflow/INVALID_INPUT', 'yaml is required when creating a workflow');
                }
                const path = await deps.store.saveWorkflow(workflow);
                return { ok: true, value: { workflow, path, yaml: await deps.store.readWorkflowYaml(workflow.id) } };
            }
            case 'workflow.create': {
                const name = str(args.name) ?? '新工作流';
                const now = Date.now();
                const id = `wf-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
                const workflow = normalizeWorkflow({
                    version: 1,
                    id,
                    name,
                    description: str(args.description) ?? '',
                    ...(str(args.deviceId) === undefined ? {} : { deviceId: str(args.deviceId) }),
                    ...(str(args.recordingId) === undefined ? {} : { sourceRecording: str(args.recordingId) }),
                    steps: [{
                            id: 'step-1',
                            name: '第一步',
                            description: '在 KVMFlow 面板中编辑动作与验证条件，或让 AI 根据录制重写此工作流。',
                            action: { type: 'delay', ms: 1000 },
                            verify: { mode: 'none' },
                            onFailure: { strategy: 'pause', retries: 0 },
                        }],
                }, id);
                await deps.store.saveWorkflow(workflow);
                return { ok: true, value: { workflow, yaml: await deps.store.readWorkflowYaml(id) } };
            }
            case 'workflow.delete': {
                const id = str(args.id);
                if (id === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'id is required');
                await deps.store.deleteWorkflow(id);
                return { ok: true, value: { removed: id } };
            }
            case 'run.start': {
                const run = await deps.runner.start(str(args.workflowId) ?? '', str(args.deviceId), { armBios: args.armBios !== false });
                return { ok: true, value: { run } };
            }
            case 'run.get': {
                const id = str(args.id);
                const run = id === undefined ? await deps.runner.latestRun() : await deps.store.getRun(id);
                return { ok: true, value: { run: run ?? null } };
            }
            case 'run.control': {
                const id = str(args.id);
                if (id === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'id is required');
                const action = str(args.action);
                if (action === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'action is required');
                const run = await deps.runner.control(id, action);
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
                }
                catch (error) {
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
                if (offer === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'offer is required');
                if (!device.username || !device.password) {
                    return fail('kvmflow/NO_WEB_CREDENTIALS', 'this device has no Linkr web username/password, so real-time video is unavailable');
                }
                const answer = await deps.sessionFor(device).whep(offer);
                return { ok: true, value: answer };
            }
            case 'image.read': {
                const path = str(args.path);
                if (path === undefined)
                    return fail('kvmflow/INVALID_INPUT', 'path is required');
                const data = await deps.store.readImage(path);
                return { ok: true, value: { path, mediaType: path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg', data: toBase64(data) } };
            }
            default:
                return fail('kvmflow/UNKNOWN_METHOD', `unknown KVMFlow RPC method ${JSON.stringify(endpoint)}`);
        }
    }
    catch (error) {
        if (error instanceof StoreError && error.code === 'INVALID_PATH')
            return fail('kvmflow/INVALID_PATH', error.message);
        if (error?.code === 'ENOENT')
            return fail('kvmflow/NOT_FOUND', `file not found: ${error instanceof Error ? error.message : String(error)}`);
        return describe(error);
    }
}
