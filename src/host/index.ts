/** KVMFlow Host plugin: IP-KVM control, recording, workflows, verified runs, and agent tools. */
import { LinkrClient } from './linkr.js';
import { Store, type StoreConfig } from './store.js';
import { Recorder } from './recorder.js';
import { Runner } from './runner.js';
import { registerTools } from './tools.js';
import { handleRpc } from './rpc.js';
import { LinkrWebSession } from './session.js';
import { FlowService } from './flow/service.js';
import type { DeviceRecord } from './types.js';

export const name = 'kvmflow';

/** Host services required before KVMFlow can activate. */
export const inject = ['tools', 'connection', 'webServer'];

export interface Config extends StoreConfig {}

const PROMPT_TEXT = [
  'KVMFlow controls a real computer through an IP-KVM. Its tools are kvmflow_* (device list/add, snapshot, keyboard, mouse, text, control, verify, record, workflow, flow, node test, run).',
  'Operating loop: take kvmflow_snapshot before deciding an action; act in small steps; take another snapshot or call kvmflow_verify after each action. Never assume a click or keypress changed the screen.',
  'UI coordinates are normalized: (0,0) top-left, (1,1) bottom-right. Keyboard keys use KeyboardEvent.code (F2, Escape, Enter, KeyA); shortcuts pass an ordered keys array.',
  'Recording: start a recording, let the human drive the target or drive it yourself, mark each human-meaningful step with a name and description, stop, then read the recording with kvmflow_record_get. kvmflow_workflow_generate turns it into a linear graph.',
  'Workflows are graphs (schema v2): nodes with typed output ports wired by `next`. Read kvmflow_flow_catalog before authoring. Branch on screens with vision_classify (one call, N ports) or if/switch; wait with wait_until; repeat with loop or a back edge plus maxVisits; read values with vision_extract; find click targets with locate and template the coordinates. Every path should reach an end node.',
  'Edit an existing workflow with kvmflow_flow_patch (small, validated operations) instead of rewriting the YAML. Check a single node against the live screen with kvmflow_node_test before relying on it.',
  'BIOS: a workflow with a bios prelude taps the hotkey before power-on, waits for the first video signal, and then starts the graph. Ask the human to press the target power button only after the run reports armed/waiting for power.',
  'Runs pause for a human when a node fails without an error port, reaches an unconnected port, or is a human node. Read kvmflow_run_status (awaiting.actions, routes, options) and answer with kvmflow_run_control. Do not start a second run while one is active.',
  'Self-healing: runs repeat an action that did not take, accept a late screen, and jump forward when the target is already ahead (limits.autoRecover). It only works when every action has a vision verify naming the page that must appear. Recorded mouse_abs values are target space: use the `frame` point kvmflow_record_get lists for click nodes, or space: target.',
  'The KVM token is a credential: do not print it in messages, logs, or workflow files. Pass passwords as secret inputs, never as literal text in a workflow.',
].join('\n');

function clientKey(device: DeviceRecord, minIntervalMs: number): string {
  return `${device.id}|${device.baseUrl}|${device.token}|${minIntervalMs}`;
}

/**
 * Activate KVMFlow in the Host composition.
 * @param ctx - plugin context.
 * @param config - data directory and default device options.
 */
export function apply(ctx: any, config: Config = {}): void {
  const store = new Store(config);
  store.initSync();
  const clientCache = new Map<string, LinkrClient>();
  const clientFor = (device: DeviceRecord): LinkrClient => {
    const key = clientKey(device, config.linkrMinIntervalMs ?? 230);
    const cached = clientCache.get(key);
    if (cached !== undefined) return cached;
    const client = new LinkrClient(device.baseUrl, device.token, {
      minIntervalMs: Math.max(120, config.linkrMinIntervalMs ?? 230),
    });
    clientCache.set(key, client);
    // A small cache: configuration changes produce a new key and the old
    // client stays until the plugin reloads.
    if (clientCache.size > 16) {
      const first = clientCache.keys().next().value;
      if (first !== undefined) clientCache.delete(first);
    }
    return client;
  };

  // Web sessions outlive one RPC call so a burst of signaling reuses the token.
  const sessionCache = new Map<string, LinkrWebSession>();
  const sessionFor = (device: DeviceRecord): LinkrWebSession => {
    const key = `${device.id}|${device.baseUrl}|${device.username ?? ''}|${device.password ?? ''}`;
    const cached = sessionCache.get(key);
    if (cached !== undefined) return cached;
    const session = new LinkrWebSession(device.baseUrl, device.username ?? '', device.password ?? '');
    sessionCache.set(key, session);
    if (sessionCache.size > 16) {
      const first = sessionCache.keys().next().value;
      if (first !== undefined) sessionCache.delete(first);
    }
    return session;
  };

  const recorder = new Recorder({ store, clientFor });
  void recorder.recover().catch(error => {
    console.error('[kvmflow] recorder recovery failed:', error);
  });
  const runner = new Runner({ ctx, store, clientFor });
  const flows = new FlowService(store);
  registerTools({ ctx, store, recorder, runner, flows, clientFor });

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/kvmflow',
    // DSH 0.2.3+ admits every matched route centrally from this declaration and
    // passes the authenticated Peer to the handler. Older releases ignore the
    // field, so the handler keeps the legacy credential check below as a guard.
    auth: 'required',
    handler: async (req: any, res: any, peer?: unknown) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method !== 'POST' || url.pathname !== '/kvmflow/rpc') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      // `requestRejection` was removed in DSH 0.2.3; calling it unchecked made
      // every RPC throw, which left the panel loading forever.
      const legacy = ctx.connection?.requestRejection;
      if (typeof legacy === 'function') {
        const rejection = legacy.call(ctx.connection, { headers: req.headers });
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
      } else if (peer === undefined) {
        // Neither the central admission nor the legacy guard admitted this request.
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('unauthorized');
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4_000_000) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: { code: 'kvmflow/TOO_LARGE', message: 'request body too large', details: {} } }));
          return;
        }
      }
      let envelope: any;
      try {
        envelope = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: { code: 'kvmflow/BAD_REQUEST', message: 'body is not JSON', details: {} } }));
        return;
      }
      if (typeof envelope?.method !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: { code: 'kvmflow/BAD_REQUEST', message: 'method is required', details: {} } }));
        return;
      }
      const result = await handleRpc({ ctx, store, recorder, runner, flows, clientFor, sessionFor }, envelope.method, envelope.params);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    },
  }), 'kvmflow: http rpc');

  const systemPrompt = ctx.get('systemPrompt');
  if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
    ctx.effect(() => systemPrompt.section({
      name: 'kvmflow',
      order: 60,
      text: PROMPT_TEXT,
    }), 'kvmflow: prompt guidance');
  }

  ctx.effect(() => () => {
    recorder.dispose();
    runner.dispose();
  }, 'kvmflow: teardown');
}
