/** Agent-facing KVMFlow tools over the same Host operations used by the panel. */
import { LinkrError, normalizeKey, parseShortcut, validateEvent, type LinkrEvent } from './linkr.js';
import { imageFacts } from './image.js';
import { parseYaml, dumpYaml, YamlError, type YamlValue } from './yaml.js';
import { normalizeWorkflow, StoreError, type Store } from './store.js';
import { frameToTarget, isFullFrame, mappingExtent } from './view.js';
import type { Recorder } from './recorder.js';
import type { Runner } from './runner.js';
import { verifyWithVision } from './model.js';
import type {
  DeviceRecord,
  RecordingRecord,
  RunRecord,
  VerifySpec,
  WorkflowRecord,
  WorkflowStep,
} from './types.js';

export interface ToolsDeps {
  ctx: any;
  store: Store;
  recorder: Recorder;
  runner: Runner;
  clientFor: (device: DeviceRecord) => any;
}

const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    name: { type: 'string' },
  },
} as const;

const IMAGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    image: IMAGE_VALUE_SCHEMA,
    deviceId: { type: 'string' },
    width: { type: 'number' },
    height: { type: 'number' },
    bytes: { type: 'number' },
    sha256: { type: 'string' },
    capturedAt: { type: 'number' },
    note: { type: 'string' },
    targetArea: {
      type: 'object',
      additionalProperties: false,
      properties: {
        left: { type: 'number' },
        top: { type: 'number' },
        right: { type: 'number' },
        bottom: { type: 'number' },
      },
    },
    targetExtent: {
      type: 'object',
      additionalProperties: false,
      properties: { width: { type: 'number' }, height: { type: 'number' } },
    },
  },
} as const;

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties, ...(required.length > 0 ? { required } : {}) };
}

function anyObjectSchema(): Record<string, unknown> {
  return { type: 'object', additionalProperties: true };
}

function textBlock(text: string): { type: 'text'; text: string } {
  return { type: 'text', text };
}

function imageBlock(value: any): { type: 'image'; attachment: any } {
  return {
    type: 'image',
    attachment: {
      attachmentId: value.attachmentId,
      mediaType: value.mediaType,
      bytes: value.bytes,
      width: value.width,
      height: value.height,
      ...(value.name === undefined ? {} : { name: value.name }),
    },
  };
}

async function saveImageValue(ctx: any, data: Uint8Array, name: string): Promise<any | undefined> {
  const attachments = ctx.get('attachments');
  if (attachments === undefined || typeof attachments.saveImage !== 'function') return undefined;
  const saved = await attachments.saveImage({ data, mediaType: 'image/jpeg', name });
  return {
    attachmentId: saved.attachmentId,
    mediaType: saved.mediaType,
    bytes: saved.bytes,
    width: saved.width,
    height: saved.height,
    ...(saved.name === undefined ? {} : { name: saved.name }),
  };
}

/** Strip `undefined` members so a tool result is lossless JSON. */
function jsonSafe<T>(value: T): T {
  if (value === undefined) return null as T;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asVerifySpec(value: unknown, fallback: VerifySpec = { mode: 'change' }): VerifySpec {
  if (!isRecord(value)) return { ...fallback };
  const mode = typeof value.mode === 'string' ? value.mode : fallback.mode;
  if (!['change', 'image', 'vision', 'none'].includes(mode as string)) {
    throw new Error(`unsupported verify mode ${JSON.stringify(mode)}`);
  }
  return {
    mode: mode as VerifySpec['mode'],
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(typeof value.image === 'string' ? { image: value.image } : {}),
    ...(typeof value.settleMs === 'number' ? { settleMs: value.settleMs } : {}),
    ...(typeof value.timeoutSec === 'number' ? { timeoutSec: value.timeoutSec } : {}),
    ...(typeof value.pollMs === 'number' ? { pollMs: value.pollMs } : {}),
    ...(typeof value.changed === 'boolean' ? { changed: value.changed } : {}),
    ...(typeof value.maxByteDelta === 'number' ? { maxByteDelta: value.maxByteDelta } : {}),
  };
}

function actionFromRecorded(recording: RecordingRecord, stepInput: Record<string, unknown>): { action: any; firstSeq?: number; lastSeq?: number } {
  if (isRecord(stepInput.action)) return { action: stepInput.action };
  const explicit = stepInput.events;
  const range = stepInput.eventRange;
  const seqs: number[] = [];
  if (Array.isArray(explicit)) {
    for (const value of explicit) {
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('events must be integer sequence numbers');
      seqs.push(value);
    }
  } else if (Array.isArray(range) && range.length === 2 && typeof range[0] === 'number' && typeof range[1] === 'number') {
    for (let seq = Math.floor(range[0]); seq <= Math.floor(range[1]); seq += 1) seqs.push(seq);
  }
  if (seqs.length === 0) throw new Error('each generated step needs event sequence numbers or an explicit action');
  const events: LinkrEvent[] = [];
  for (const seq of seqs) {
    const found = recording.events.find(event => event.seq === seq);
    if (found === undefined) throw new Error(`recording has no event ${seq}`);
    events.push(found.event);
  }
  return { action: { type: 'sequence', events }, firstSeq: Math.min(...seqs), lastSeq: Math.max(...seqs) };
}

function findRecordingReference(recording: RecordingRecord, firstSeq?: number): string | undefined {
  if (firstSeq === undefined) return undefined;
  const step = recording.steps.find(entry => firstSeq >= entry.startSeq && firstSeq <= entry.endSeq);
  if (step?.before !== undefined) return step.before;
  if (step?.after !== undefined) return step.after;
  const event = recording.events.find(entry => entry.seq === firstSeq);
  return event?.before ?? event?.after;
}

/**
 * Register every KVMFlow agent tool.
 * @param deps - Host services and KVMFlow state.
 */
export function registerTools(deps: ToolsDeps): void {
  const { ctx, store, recorder, runner, clientFor } = deps;

  const register = (definition: any): void => {
    const execute = definition.execute;
    ctx.tools.register({
      ...definition,
      async execute(args: unknown, exec: any) {
        return jsonSafe(await execute(args, exec));
      },
    });
  };

  register({
    name: 'kvmflow_device_list',
    description: 'List configured IP-KVM devices for KVMFlow. Tokens are never returned. Use a deviceId in other KVMFlow tools when more than one device exists.',
    parameters: objectSchema({}),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(JSON.stringify(value, null, 2))],
    },
    async execute() {
      return {
        dataDir: store.dataDir,
        defaultDeviceId: store.defaultDeviceId() ?? null,
        devices: store.listDevices(),
      };
    },
  });

  register({
    name: 'kvmflow_device_add',
    description: 'Add a Radxa Linkr device to KVMFlow. The access token is stored in the KVMFlow devices file with mode 0600. Use this only when the user asks to configure a device; prefer the KVMFlow panel for editing.',
    parameters: objectSchema({
      name: { type: 'string', description: 'Display name, for example "Lab Linkr".' },
      baseUrl: { type: 'string', description: 'Device origin, for example http://192.168.1.100.' },
      token: { type: 'string', description: 'Linkr API access token (sent as Authorization: token ...).' },
      username: { type: 'string', description: 'Optional web UI username; not used by the public API.' },
      password: { type: 'string', description: 'Optional web UI password; accepted for context and never stored, because the public API uses the token only.' },
      notes: { type: 'string', description: 'Optional note.' },
    }, ['name', 'baseUrl', 'token']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Added device ${value.device?.name ?? ''} (${value.device?.id ?? ''}).`)],
    },
    async execute(args: any) {
      const device = await store.addDevice(args ?? {});
      return { device, defaultDeviceId: store.defaultDeviceId() ?? null };
    },
  });

  register({
    name: 'kvmflow_snapshot',
    description: 'Capture the current screen of the KVM target as a JPEG and show it to you. Always take a snapshot before deciding a mouse or keyboard action, and again after the action to verify it. A no-signal error means the target is off or HDMI is disconnected.',
    parameters: objectSchema({
      deviceId: { type: 'string', description: 'Device id; omit for the configured default.' },
      includeImage: { type: 'boolean', description: 'Attach the JPEG to the tool result (default true).' },
    }),
    output: {
      schema: IMAGE_OUTPUT_SCHEMA,
      render: (_args: unknown, value: any) => {
        const lines = [
          `KVM snapshot ${value.width}x${value.height}, ${value.bytes} bytes, sha256 ${value.sha256}.`,
          ...(value.note === undefined ? [] : [value.note]),
        ];
        return value.image === undefined ? [textBlock(lines.join('\n'))] : [textBlock(lines.join('\n')), imageBlock(value.image)];
      },
    },
    async execute(args: any) {
      const device = store.getDevice(args?.deviceId);
      const snapshot = await clientFor(device).snapshot();
      const facts = imageFacts(snapshot.data);
      const image = args?.includeImage === false ? undefined : await saveImageValue(ctx, snapshot.data, `kvmflow-${device.id}-${Date.now()}.jpg`);
      if (image === undefined && args?.includeImage !== false) {
        return { deviceId: device.id, width: facts.width, height: facts.height, bytes: facts.bytes, sha256: facts.sha256, capturedAt: snapshot.capturedAt, note: 'Image attachment service unavailable; metadata only.' };
      }
      return {
        deviceId: device.id,
        width: facts.width,
        height: facts.height,
        bytes: facts.bytes,
        sha256: facts.sha256,
        capturedAt: snapshot.capturedAt,
        ...(isFullFrame(device.viewMapping) ? {} : {
          targetArea: device.viewMapping,
          targetExtent: mappingExtent(device.viewMapping, facts.width, facts.height),
          note: 'The target screen occupies targetArea of this image; coordinates you measure on the image are converted automatically.',
        }),
        ...(image === undefined ? {} : { image }),
      };
    },
  });

  register({
    name: 'kvmflow_control',
    description: 'Send one ordered batch of USB HID events to the KVM target. Prefer the keyboard, mouse, and text tools; use this for complex sequences and for replaying recorded events. Each event is a Linkr event array: ["keyboard", code, pressed], ["mouse_abs", button, x, y, wheelY, wheelX], ["mouse_rel", button, dx, dy, wheelY, wheelX], ["text", value], or ["delay", milliseconds]. mouse_abs coordinates are raw target-screen absolute values and are NOT converted like kvmflow_mouse.',
    parameters: objectSchema({
      deviceId: { type: 'string', description: 'Device id; omit for the configured default.' },
      events: { type: 'array', description: 'Linkr event arrays in execution order.', items: { type: 'array', items: {} } },
    }, ['events']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Sent ${value.sent} HID events to ${value.deviceId}.`)],
    },
    async execute(args: any) {
      if (!Array.isArray(args?.events) || args.events.length === 0) throw new Error('events must be a non-empty array');
      const events = args.events.map((event: unknown, index: number) => validateEvent(event, index));
      const device = store.getDevice(args?.deviceId);
      await clientFor(device).control(events);
      const active = recorder.current();
      if (active !== undefined && active.deviceId === device.id) {
        for (const event of events) await recorder.append(device, event);
      }
      return { deviceId: device.id, sent: events.length };
    },
  });

  register({
    name: 'kvmflow_keyboard',
    description: 'Press one key or a keyboard shortcut on the KVM target. Key names use KeyboardEvent.code (F2, Enter, Escape, ArrowDown, KeyA, Digit1) and common aliases (Esc, Del, Ctrl, Alt, Shift, Win). Example shortcut keys: ["ControlLeft","AltLeft","Delete"].',
    parameters: objectSchema({
      deviceId: { type: 'string' },
      key: { type: 'string', description: 'Single key to tap. Ignored when keys is provided.' },
      keys: { type: 'array', description: 'Shortcut keys, pressed together in order and released in reverse.', items: { type: 'string' } },
      holdMs: { type: 'number', description: 'Hold duration in milliseconds (default 60 for a tap, 80 for a shortcut).' },
      repeat: { type: 'integer', description: 'Number of taps (single key only, default 1).' },
      intervalMs: { type: 'number', description: 'Delay between repeated taps (default 120).' },
    }),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Keyboard: ${value.description} (${value.deviceId}).`)],
    },
    async execute(args: any) {
      const device = store.getDevice(args?.deviceId);
      const events: LinkrEvent[] = [];
      let description = '';
      if (Array.isArray(args?.keys) && args.keys.length > 0) {
        const codes = args.keys.map((key: string) => normalizeKey(key));
        const holdMs = Math.max(1, Number(args.holdMs) || 80);
        for (const code of codes) events.push(['keyboard', code, true]);
        events.push(['delay', holdMs]);
        for (const code of [...codes].reverse()) events.push(['keyboard', code, false]);
        description = codes.join('+');
      } else if (typeof args?.key === 'string' && args.key.trim() !== '') {
        const key = normalizeKey(args.key);
        const holdMs = Math.max(1, Number(args.holdMs) || 60);
        const repeat = Math.max(1, Math.floor(Number(args.repeat) || 1));
        const intervalMs = Math.max(0, Number(args.intervalMs) || 120);
        for (let index = 0; index < repeat; index += 1) {
          events.push(['keyboard', key, true], ['delay', holdMs], ['keyboard', key, false]);
          if (index < repeat - 1) events.push(['delay', intervalMs]);
        }
        description = repeat > 1 ? `${key} x${repeat}` : key;
      } else {
        throw new Error('provide key or keys');
      }
      await clientFor(device).control(events);
      const active = recorder.current();
      if (active !== undefined && active.deviceId === device.id) {
        for (const event of events) await recorder.append(device, event);
      }
      return { deviceId: device.id, description, sent: events.length };
    },
  });

  register({
    name: 'kvmflow_mouse',
    description: 'Move, click, double-click, right-click, or scroll on the KVM target. Coordinates are normalized on the image kvmflow_snapshot returns (0,0 is top-left; 1,1 is bottom-right). When the target leaves black bars in that image, the point is converted to the target screen automatically. A click sends move, press, and release in one call.',
    parameters: objectSchema({
      deviceId: { type: 'string' },
      action: { type: 'string', enum: ['move', 'click', 'double_click', 'right_click', 'scroll'], description: 'Pointer operation (default click).' },
      x: { type: 'number', description: 'Normalized X in [0,1].' },
      y: { type: 'number', description: 'Normalized Y in [0,1].' },
      wheelY: { type: 'number', description: 'Vertical scroll amount for action=scroll, -20..20.' },
      wheelX: { type: 'number', description: 'Horizontal scroll amount for action=scroll, -20..20.' },
    }, ['x', 'y']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`${value.description} at (${value.x.toFixed(3)}, ${value.y.toFixed(3)}) on ${value.deviceId}.`)],
    },
    async execute(args: any) {
      const x = Number(args?.x);
      const y = Number(args?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        throw new Error('x and y must be normalized numbers between 0 and 1');
      }
      const action = typeof args?.action === 'string' ? args.action : 'click';
      const device = store.getDevice(args?.deviceId);
      // x/y are measured on the image the model sees; the target's own screen is
      // the absolute-coordinate space, so letterboxed frames convert here.
      const target = frameToTarget(device.viewMapping, x, y);
      const tx = target.x;
      const ty = target.y;
      let events: LinkrEvent[];
      let description: string;
      if (action === 'move') {
        events = [['mouse_abs', 0, tx, ty, 0, 0]];
        description = 'move';
      } else if (action === 'scroll') {
        const wheelY = Math.max(-20, Math.min(20, Number(args?.wheelY) || 0));
        const wheelX = Math.max(-20, Math.min(20, Number(args?.wheelX) || 0));
        events = [['mouse_abs', 0, tx, ty, wheelY, wheelX]];
        description = `scroll ${wheelY}`;
      } else {
        const button = action === 'right_click' ? 2 : 1;
        const count = action === 'double_click' ? 2 : 1;
        events = [['mouse_abs', 0, tx, ty, 0, 0]];
        for (let index = 0; index < count; index += 1) {
          events.push(['mouse_abs', button, tx, ty, 0, 0], ['delay', 40], ['mouse_abs', 0, tx, ty, 0, 0]);
          if (index < count - 1) events.push(['delay', 80]);
        }
        description = action;
      }
      await clientFor(device).control(events);
      const active = recorder.current();
      if (active !== undefined && active.deviceId === device.id) {
        for (const event of events) await recorder.append(device, event);
      }
      return {
        deviceId: device.id,
        description,
        x,
        y,
        ...(isFullFrame(device.viewMapping) ? {} : { targetX: tx, targetY: ty }),
        sent: events.length,
      };
    },
  });

  register({
    name: 'kvmflow_text',
    description: 'Type printable ASCII text into the focused field on the KVM target. Linkr text input does not support non-ASCII characters; use keyboard key codes for shortcuts. Set submit to press Enter afterwards.',
    parameters: objectSchema({
      deviceId: { type: 'string' },
      text: { type: 'string', description: 'Printable ASCII, Tab, and Enter only.' },
      submit: { type: 'boolean', description: 'Press Enter after typing (default false).' },
    }, ['text']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Typed ${value.characters} characters on ${value.deviceId}${value.submitted ? ' and pressed Enter' : ''}.`)],
    },
    async execute(args: any) {
      const text = String(args?.text ?? '');
      if (text === '') throw new Error('text is required');
      const device = store.getDevice(args?.deviceId);
      const events: LinkrEvent[] = [];
      for (let index = 0; index < text.length; index += 120) events.push(['text', text.slice(index, index + 120)]);
      if (args?.submit === true) events.push(['keyboard', 'Enter', true], ['delay', 60], ['keyboard', 'Enter', false]);
      validateEvent(['text', text.slice(0, 120)], 0);
      await clientFor(device).control(events);
      const active = recorder.current();
      if (active !== undefined && active.deviceId === device.id) {
        for (const event of events) await recorder.append(device, event);
      }
      return { deviceId: device.id, characters: text.length, submitted: args?.submit === true };
    },
  });

  register({
    name: 'kvmflow_verify',
    description: 'Capture the KVM screen and ask the default DSH vision model whether a success condition is satisfied. Use this to validate a screen state before or after an action. Returns PASS/FAIL and a reason; a vision failure is an error, not a silent pass.',
    parameters: objectSchema({
      deviceId: { type: 'string' },
      condition: { type: 'string', description: 'What must be visible on the screen, in concrete visual terms.' },
      context: { type: 'string', description: 'Optional step context for the verifier.' },
    }, ['condition']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`${value.passed ? 'PASS' : 'FAIL'}: ${value.reason}`)],
    },
    async execute(args: any) {
      const device = store.getDevice(args?.deviceId);
      const snapshot = await clientFor(device).snapshot();
      const verdict = await verifyWithVision(ctx, {
        data: snapshot.data,
        condition: requireString(args?.condition, 'condition'),
        context: optionalString(args?.context),
      });
      const image = await saveImageValue(ctx, snapshot.data, 'kvmflow-verify.jpg');
      return { passed: verdict.passed, reason: verdict.reason, ...(image === undefined ? {} : { image }) };
    },
  });

  register({
    name: 'kvmflow_record_start',
    description: 'Start a manual recording on the KVM target. Subsequent keyboard, mouse, text, and control actions are stored as HID events with before/after screen captures. Mark human steps with kvmflow_record_mark_step.',
    parameters: objectSchema({
      deviceId: { type: 'string' },
      name: { type: 'string', description: 'Recording name.' },
      description: { type: 'string', description: 'What the recording is meant to demonstrate.' },
    }, ['name']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Recording ${value.recording.id} started on ${value.recording.deviceId}.`)],
    },
    async execute(args: any) {
      const device = store.getDevice(args?.deviceId);
      const recording = await recorder.start(device, requireString(args?.name, 'name'), optionalString(args?.description) ?? '');
      return { recording };
    },
  });

  register({
    name: 'kvmflow_record_mark_step',
    description: 'Close the current human step and start the next one at the current event boundary, saving a boundary screenshot. Optionally rename and describe the step.',
    parameters: objectSchema({
      name: { type: 'string', description: 'Step name.' },
      description: { type: 'string', description: 'What this step accomplishes and what the screen should show.' },
      deviceId: { type: 'string', description: 'Device for the boundary screenshot; omit for the configured default.' },
    }, ['name']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Marked step "${value.step.name}" (${value.step.id}) at event ${value.step.startSeq}.`)],
    },
    async execute(args: any) {
      const device = store.getDevice(args?.deviceId);
      const step = await recorder.markStep(device, requireString(args?.name, 'name'), optionalString(args?.description) ?? '');
      return { step };
    },
  });

  register({
    name: 'kvmflow_record_stop',
    description: 'Stop the active KVMFlow recording and return its event and step counts. Use kvmflow_record_get to inspect the result before generating a workflow.',
    parameters: objectSchema({}),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Recording ${value.recording.id} stopped with ${value.recording.events.length} events and ${value.recording.steps.length} steps.`)],
    },
    async execute() {
      const recording = await recorder.stop();
      return { recording };
    },
  });

  register({
    name: 'kvmflow_record_status',
    description: 'Report the active recording, if any, and recent finished recordings.',
    parameters: objectSchema({}),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(JSON.stringify(value, null, 2))],
    },
    async execute() {
      const recordings = await store.listRecordings();
      return {
        active: recorder.current() ?? null,
        recordings: recordings.slice(0, 10).map(recording => ({
          id: recording.id,
          name: recording.name,
          status: recording.status,
          eventCount: recording.events.length,
          stepCount: recording.steps.length,
          updatedAt: recording.updatedAt,
        })),
      };
    },
  });

  register({
    name: 'kvmflow_record_get',
    description: 'Read one recording with its HID events, human step boundaries, and screenshot evidence. Use the sequence numbers to generate workflow steps. Images are attached when includeImages is true (default), limited to 12.',
    parameters: objectSchema({
      recordingId: { type: 'string', description: 'Recording id; omit for the active recording.' },
      includeImages: { type: 'boolean', description: 'Attach step screenshots (default true).' },
    }),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => {
        const blocks: any[] = [textBlock(JSON.stringify(value.summary, null, 2))];
        for (const image of value.images ?? []) blocks.push(imageBlock(image));
        return blocks;
      },
    },
    async execute(args: any) {
      const id = optionalString(args?.recordingId) ?? recorder.current()?.id;
      if (id === undefined) throw new Error('no recording id and no active recording');
      const recording = await store.getRecording(id);
      const images: any[] = [];
      const summary = {
        id: recording.id,
        name: recording.name,
        description: recording.description ?? '',
        status: recording.status,
        eventCount: recording.events.length,
        // Recorded mouse events are already in the target's absolute space, so a
        // replay must not convert them again.
        eventCoordinateSpace: 'target',
        steps: recording.steps.map(step => ({
          id: step.id,
          name: step.name,
          description: step.description ?? '',
          startSeq: step.startSeq,
          endSeq: step.endSeq,
          before: step.before === undefined ? null : `recordings/${recording.id}/${step.before}`,
          after: step.after === undefined ? null : `recordings/${recording.id}/${step.after}`,
        })),
        events: recording.events.map(event => ({
          seq: event.seq,
          at: event.at,
          event: event.event,
          before: event.before === undefined ? null : `recordings/${recording.id}/${event.before}`,
          after: event.after === undefined ? null : `recordings/${recording.id}/${event.after}`,
        })),
      };
      if (args?.includeImages !== false) {
        const shots: string[] = [];
        for (const step of recording.steps) {
          if (step.before !== undefined) shots.push(step.before);
          if (step.after !== undefined) shots.push(step.after);
        }
        for (const event of recording.events) {
          if (event.before !== undefined) shots.push(event.before);
          if (event.after !== undefined) shots.push(event.after);
        }
        for (const shot of [...new Set(shots)].slice(0, 12)) {
          try {
            const data = await store.readRecordingShot(recording.id, shot);
            const image = await saveImageValue(ctx, data, `record-${recording.id}-${shot.split('/').pop()}`);
            if (image !== undefined) images.push(image);
          } catch {
            // A missing screenshot does not invalidate the event list.
          }
        }
      }
      return { summary, images };
    },
  });

  register({
    name: 'kvmflow_workflow_list',
    description: 'List KVMFlow YAML workflows with their step counts and BIOS prelude flag.',
    parameters: objectSchema({}),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(JSON.stringify(value, null, 2))],
    },
    async execute() {
      return { workflows: await store.listWorkflows() };
    },
  });

  register({
    name: 'kvmflow_workflow_get',
    description: 'Read one workflow as its editable YAML source plus a parsed step summary.',
    parameters: objectSchema({ id: { type: 'string', description: 'Workflow id.' } }, ['id']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Workflow ${value.workflow.id}: ${value.workflow.name}\n\n${value.yaml}`)],
    },
    async execute(args: any) {
      const id = requireString(args?.id, 'id');
      const yaml = await store.readWorkflowYaml(id);
      const workflow = await store.loadWorkflow(id);
      return { workflow, yaml };
    },
  });

  register({
    name: 'kvmflow_workflow_save',
    description: 'Validate and save a KVMFlow workflow from YAML text. The document must contain at least one step; each step has a name and action, and may have precondition, verify, and onFailure. Returns the normalized workflow and the saved YAML. This is the main way to let the agent author or edit a workflow after studying a recording.',
    parameters: objectSchema({
      yaml: { type: 'string', description: 'Complete workflow YAML.' },
      id: { type: 'string', description: 'Existing workflow id to overwrite; omit to create a new workflow.' },
    }, ['yaml']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Saved workflow ${value.workflow.id} (${value.workflow.name}) with ${value.workflow.steps.length} steps.`)],
    },
    async execute(args: any) {
      const text = requireString(args?.yaml, 'yaml');
      let parsed: YamlValue;
      try {
        parsed = parseYaml(text);
      } catch (error) {
        throw new Error(error instanceof YamlError ? error.message : `cannot parse YAML: ${String(error)}`);
      }
      const requestedId = optionalString(args?.id);
      const workflow = normalizeWorkflow(parsed, requestedId ?? '');
      if (requestedId !== undefined) workflow.id = requestedId;
      const path = await store.saveWorkflow(workflow);
      const savedYaml = await store.readWorkflowYaml(workflow.id);
      return { workflow, path, yaml: savedYaml };
    },
  });

  register({
    name: 'kvmflow_workflow_generate',
    description: 'Create a YAML workflow from a recording and the agent\'s step plan. Each step names an event range from the recording (eventRange: [firstSeq, lastSeq] or events: [seq...]) or an explicit action, plus optional precondition and verify. The tool copies recording screenshots into the workflow assets and writes the YAML.',
    parameters: objectSchema({
      recordingId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      deviceId: { type: 'string' },
      bios: {
        type: 'object',
        description: 'Optional BIOS prelude: tap hotkey before power-on and wait for the video signal.',
        additionalProperties: false,
        properties: {
          hotkey: { type: 'string' },
          intervalMs: { type: 'number' },
          timeoutSec: { type: 'number' },
          requireConfirm: { type: 'boolean' },
        },
      },
      steps: {
        type: 'array',
        description: 'Ordered steps. Provide eventRange/events from the recording or an explicit action.',
        items: { type: 'object', additionalProperties: true },
      },
    }, ['recordingId', 'name', 'steps']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Generated workflow ${value.workflow.id} with ${value.workflow.steps.length} steps.\n\n${value.yaml}`)],
    },
    async execute(args: any) {
      const recording = await store.getRecording(requireString(args?.recordingId, 'recordingId'));
      if (!Array.isArray(args?.steps) || args.steps.length === 0) throw new Error('steps must be a non-empty array');
      const now = Date.now();
      const workflowId = `wf-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const steps: WorkflowStep[] = [];
      for (let index = 0; index < args.steps.length; index += 1) {
        const input = args.steps[index];
        if (!isRecord(input)) throw new Error(`steps[${index}] must be an object`);
        const resolved = actionFromRecorded(recording, input);
        let verify = asVerifySpec(input.verify, { mode: 'change', settleMs: 800, timeoutSec: 12 });
        let referenceRelative: string | undefined;
        const reference = findRecordingReference(recording, resolved.firstSeq);
        if (reference !== undefined) {
          try {
            const data = await store.readRecordingShot(recording.id, reference);
            referenceRelative = await store.saveWorkflowAsset(workflowId, `step-${index + 1}.jpg`, data);
            if (verify.mode === 'image' && verify.image === undefined) verify = { ...verify, image: referenceRelative };
          } catch {
            // Missing evidence does not block workflow authoring.
          }
        }
        steps.push({
          id: typeof input.id === 'string' && input.id !== '' ? input.id : `step-${index + 1}`,
          name: typeof input.name === 'string' && input.name !== '' ? input.name : `Step ${index + 1}`,
          ...(typeof input.description === 'string' && input.description !== '' ? { description: input.description } : {}),
          ...(input.precondition === undefined ? {} : { precondition: asVerifySpec(input.precondition, { mode: 'none' }) }),
          action: resolved.action,
          verify,
          ...(isRecord(input.onFailure) ? { onFailure: input.onFailure as any } : {}),
          ...(referenceRelative === undefined ? {} : {}),
        });
      }
      const workflow = normalizeWorkflow({
        version: 1,
        id: workflowId,
        name: requireString(args?.name, 'name'),
        description: optionalString(args?.description) ?? '',
        ...(optionalString(args?.deviceId) === undefined ? {} : { deviceId: optionalString(args?.deviceId) }),
        sourceRecording: recording.id,
        ...(isRecord(args?.bios) ? { bios: args.bios } : {}),
        steps,
      }, workflowId);
      await store.saveWorkflow(workflow);
      const yaml = await store.readWorkflowYaml(workflow.id);
      return { workflow, yaml };
    },
  });

  register({
    name: 'kvmflow_run_start',
    description: 'Start a deterministic KVMFlow run of one YAML workflow. With armBios enabled (the default when the workflow declares a BIOS prelude), KVMFlow taps the BIOS hotkey before power-on and waits for the video signal, then executes steps with screen verification. Only one run may be active.',
    parameters: objectSchema({
      workflowId: { type: 'string' },
      deviceId: { type: 'string' },
      armBios: { type: 'boolean', description: 'Run the BIOS prelude when present (default true).' },
    }, ['workflowId']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Run ${value.run.id} started for workflow ${value.run.workflowName}; status ${value.run.status}.`)],
    },
    async execute(args: any) {
      const run = await runner.start(requireString(args?.workflowId, 'workflowId'), optionalString(args?.deviceId), {
        armBios: args?.armBios !== false,
      });
      return { run };
    },
  });

  register({
    name: 'kvmflow_run_status',
    description: 'Read the active or latest run, including each step status, verification reason, and pause reason. Use this to supervise execution and decide the next control action.',
    parameters: objectSchema({ runId: { type: 'string', description: 'Run id; omit for the active/latest run.' } }),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(JSON.stringify(value, null, 2))],
    },
    async execute(args: any) {
      const id = optionalString(args?.runId);
      const run = id === undefined ? await runner.latestRun() : await store.getRun(id);
      if (run === undefined) return { run: null };
      return { run };
    },
  });

  register({
    name: 'kvmflow_run_control',
    description: 'Control a paused KVMFlow run: retry the failed step, continue past it, skip it, confirm BIOS and continue, resume, pause, or abort. A run that is not paused accepts pause and abort.',
    parameters: objectSchema({
      runId: { type: 'string' },
      action: { type: 'string', enum: ['pause', 'resume', 'retry', 'continue', 'skip', 'abort', 'confirm_bios'] },
    }, ['runId', 'action']),
    output: {
      schema: anyObjectSchema(),
      render: (_args: unknown, value: any) => [textBlock(`Run ${value.run.id} is now ${value.run.status} (${value.run.phase}).`)],
    },
    async execute(args: any) {
      const run = await runner.control(requireString(args?.runId, 'runId'), requireString(args?.action, 'action') as any);
      return { run };
    },
  });
}
