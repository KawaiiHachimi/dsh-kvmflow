// Renders the bundled client in jsdom against a fake Host: the Workflows tab
// must show the canvas with nodes, edit through the inspector, autosave, and
// the Runs tab must show the run graph, trace and decision buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body><div id="root" style="width:1400px;height:900px"></div></body></html>', { url: 'http://127.0.0.1:60595/', pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const key of ['HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'Event', 'getComputedStyle', 'DOMMatrixReadOnly']) {
  if (dom.window[key] !== undefined) g[key] = dom.window[key];
}
g.IS_REACT_ACT_ENVIRONMENT = true;
g.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 16);
g.cancelAnimationFrame = id => clearTimeout(id);
class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
g.ResizeObserver = ResizeObserver;
dom.window.ResizeObserver = ResizeObserver;
class DOMMatrix { constructor() { this.m22 = 1; this.a = 1; this.d = 1; } }
g.DOMMatrixReadOnly = DOMMatrix;
dom.window.DOMMatrixReadOnly = DOMMatrix;
dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, top: 0, left: 0, width: 1200, height: 700, right: 1200, bottom: 700 }; };
dom.window.confirm = () => true;

const React = require('react');
const ReactDOM = require('react-dom');
const { createRoot } = require('react-dom/client');
const jsx = require('react/jsx-runtime');
const { act } = React;

// A real Store + FlowService behind the fake RPC, so the client talks to the same validation.
const { Store } = await import('../dist/host/store.js');
const { FlowService } = await import('../dist/host/flow/service.js');
const dataDir = mkdtempSync(join(tmpdir(), 'kvmflow-ui-'));
const store = new Store({ dataDir });
store.initSync();
const flows = new FlowService(store);
const created = await flows.create({ name: 'OOBE graph' });
const workflowId = created.document.id;

const calls = [];
let activeRun = null;
let recentRuns = [];
const device = { id: 'dev-1', name: 'Linkr', driver: 'linkr', baseUrl: 'http://x', hasToken: true, hasWebCredentials: false, createdAt: 1, updatedAt: 1 };
async function handle(method, params) {
  calls.push([method, params]);
  switch (method) {
    case 'state': return { dataDir, devices: [device], defaultDeviceId: 'dev-1', recordings: [], workflows: await store.listWorkflows(), recentRuns, ...(activeRun ? { activeRun } : {}) };
    case 'flow.catalog': return { nodes: flows.catalog() };
    case 'flow.get': return flows.view(params.id);
    case 'flow.save': return flows.save({ id: params.id, ...(params.yaml ? { yaml: params.yaml } : {}), ...(params.document ? { document: params.document } : {}), ...(params.layout ? { layout: params.layout } : {}) });
    case 'flow.check': return flows.check(params);
    case 'flow.compose': return flows.compose(params);
    case 'model.list': return {
      models: [
        { provider: 'openai', providerName: 'OpenAI', id: 'gpt-4o', name: 'GPT-4o', supportsImage: true },
        { provider: 'deepseek', providerName: 'DeepSeek', id: 'deepseek-chat', name: 'DeepSeek Chat', supportsImage: false },
      ],
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
    };
    case 'run.get': return { run: activeRun };
    case 'run.control': calls.push(['control', params]); return { run: activeRun };
    case 'run.delete': recentRuns = recentRuns.filter(entry => entry.id !== params.id); return { removed: params.id };
    case 'run.clear': { const n = recentRuns.length; recentRuns = []; return { removed: n }; }
    case 'history.list': return { items: await store.readTextHistory(), path: store.textHistoryPath };
    case 'history.add': return { items: await store.addTextHistory(params.text) };
    case 'history.remove': return { items: await store.removeTextHistory(params.text) };
    case 'history.clear': return { items: await store.clearTextHistory() };
    case 'device.probe': return { probe: { reachable: false, authenticated: false, video: false } };
    case 'screen.snapshot': throw Object.assign(new Error('no signal'), { code: 'x' });
    default: return {};
  }
}
g.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  try {
    const value = await handle(body.method, body.params);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value }) };
  } catch (error) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: { code: 'kvmflow/x', message: error.message, details: error.issues ? { issues: error.issues } : {} } }) };
  }
};

let entry;
g.window.__ModuleLoader__ = { load(value) { entry = value; } };
new Function('window', readFileSync(new URL('../dist/client/index.js', import.meta.url), 'utf8'))(g.window);
const modules = { react: React, 'react-dom': ReactDOM, 'react/jsx-runtime': jsx, 'react-dom/client': require('react-dom/client') };
const plugin = entry.factory(id => { if (!(id in modules)) throw new Error(`unexpected module ${id}`); return modules[id]; });

let Panel;
const ctx = {
  slots: { inject(_k, cb) { cb(); return () => {}; }, register(options, component) { if (options.name === 'main') Panel = component; return () => {}; } },
  locale: (() => { const snapshot = { active: 'zh' }; return { subscribe: () => () => {}, getSnapshot: () => snapshot }; })(),
  effect(fn) { fn(); return () => {}; },
  sidebarRightTabs: { register() { return () => {}; } },
  get() { return undefined; },
};
plugin.apply(ctx);

const root = createRoot(document.getElementById('root'));
const settle = async (ms = 60) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); };
const click = async node => { await act(async () => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); await settle(); };
const byText = (selector, text) => [...document.querySelectorAll(selector)].find(node => node.textContent.trim().includes(text));
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); };

test('workflows tab renders the canvas, edits through the inspector and autosaves', async () => {
  await act(async () => { root.render(React.createElement(Panel, {})); });
  await settle(200);
  await click(byText('[role="tab"]', '工作流'));
  await settle(300);

  assert.ok(document.querySelector('.kf-editor'), 'editor mounted');
  assert.ok(document.querySelector('.react-flow'), 'React Flow mounted');
  const cards = [...document.querySelectorAll('.kf-card')];
  assert.equal(cards.length, 3, 'three starter nodes');
  assert.ok(byText('.kf-card', '起点'), 'start badge shown');
  assert.ok(document.querySelectorAll('.kf-palette-item').length >= 15, 'palette lists node types');
  assert.ok(byText('.kf-save', '已保存'));

  // Workflow settings inspector exposes the DSH vision model selector and persists selection.
  const modelSelect = document.querySelector('select[aria-label="执行视觉模型"]');
  assert.ok(modelSelect, 'vision model selector rendered in workflow settings');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
    setter.call(modelSelect, 'openai\u0000gpt-4o');
    modelSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await settle(900);
  const withModel = await store.loadFlow(workflowId);
  assert.deepEqual(withModel.visionModel, { provider: 'openai', model: 'gpt-4o' }, 'visionModel persisted to YAML');

  // Selecting a node opens the node inspector; renaming it autosaves.
  await click(cards.find(card => card.textContent.includes('begin')));
  await settle(100);
  assert.ok(byText('.kf-inspector-kind', '画面判断'), 'vision_check inspector');
  const nameInput = document.querySelector('.kf-inspector .kf-field input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(nameInput, '桌面就绪？');
    nameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    nameInput.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
    nameInput.dispatchEvent(new dom.window.FocusEvent('blur'));
  });
  await settle(1200);
  const saved = await store.loadFlow(workflowId);
  assert.equal(saved.nodes.begin.name, '桌面就绪？', 'inspector edit was autosaved');

  // Clicking a palette item while a node is selected appends after it.
  const before = Object.keys(saved.nodes).length;
  await click([...document.querySelectorAll('.kf-palette-item')].find(item => item.textContent.includes('vision_classify')));
  await settle(1200);
  const grown = await store.loadFlow(workflowId);
  assert.equal(Object.keys(grown.nodes).length, before + 1, 'a node was added and saved');
  const classify = Object.values(grown.nodes).find(node => node.type === 'vision_classify');
  assert.ok(classify, 'vision_classify node exists');
  assert.ok(Object.values(grown.nodes.begin.next).includes(classify.id) || grown.nodes.begin.next.true === classify.id || grown.nodes.begin.next.false === classify.id, 'connected after the selected node');
  assert.ok(byText('.kf-inspector-kind', '画面分类'), 'new node selected in inspector');

  // YAML view round-trips.
  await click(byText('.kf-seg button', 'YAML'));
  const yaml = document.querySelector('.kf-yaml-text').value;
  assert.match(yaml, /type: vision_classify/);

  // Compose modal: add the current workflow twice, switch to inline mode, and generate.
  await click(byText('.kvmflow-wf-list-head button', '组合'));
  await settle(100);
  const composeDialog = document.querySelector('[role="dialog"]');
  assert.ok(composeDialog, 'compose modal opened');
  await click(byText('.kvmflow-compose-col button', '+ 加入'));
  await click(byText('.kvmflow-compose-modes button', '展平合并'));
  await click(byText('.kvmflow-modal-foot button', '生成大工作流'));
  await settle(300);
  assert.equal(document.querySelector('[role="dialog"]'), null, 'compose modal closed after create');
  const all = await store.listWorkflows();
  assert.equal(all.length, 2, 'composed workflow persisted');
});

test('devices tab uses modals for add/edit and delete confirmation, and unifies control heights', async () => {
  await click(byText('[role="tab"]', '设备'));
  await settle(150);
  assert.equal(document.querySelector('[role="dialog"]'), null, 'no modal initially');
  // Open Add Device modal.
  await click(byText('button', '+ 添加设备'));
  await settle(80);
  const addDialog = document.querySelector('[role="dialog"]');
  assert.ok(addDialog && addDialog.textContent.includes('添加 IP-KVM 设备'), 'add device modal opened');
  assert.ok(addDialog.textContent.includes('Radxa Linkr'), 'driver selector shown');
  await click(byText('.kvmflow-modal-foot button', '取消'));
  await settle(80);
  assert.equal(document.querySelector('[role="dialog"]'), null, 'add modal closed');

  // Delete uses a modal dialog portaled to document.body so canvas / container-type never clips it.
  await click(byText('.kvmflow-device button', '删除'));
  await settle(80);
  const delDialog = document.querySelector('[role="dialog"]');
  assert.ok(delDialog && delDialog.textContent.includes('确定要删除设备'), 'delete confirmation modal opened');
  assert.equal(delDialog.closest('.kvmflow-root'), null, 'modal is portaled outside .kvmflow-root');
  assert.equal(delDialog.parentElement.parentElement, document.body, 'modal backdrop is a direct child of document.body');
  await click(byText('.kvmflow-modal-foot button', '取消'));
  await settle(80);
  assert.equal(document.querySelector('[role="dialog"]'), null, 'delete modal dismissed');

  // Shared 28px control height across buttons and inline selects.
  const cssText = [...document.querySelectorAll('style')].map(el => el.textContent).join('\n');
  assert.match(cssText, /--kvmflow-control-h:\s*28px/);
  assert.match(cssText, /--dsh-frame-top-clearance/);
  assert.match(cssText, /\.kvmflow-inline-select\s*\{[^}]*height:\s*var\(--kvmflow-control-h\)/);
  assert.match(cssText, /\.kf-btn\s*\{[^}]*height:\s*28px/);
});

test('live tab persists ASCII commands to disk history file and shows red dot when disconnected', async () => {
  await click(byText('[role="tab"]', '实时画面'));
  await settle(200);
  // Device probe returned unreachable: top status dot must be red (err), not green (on).
  const headDot = document.querySelector('.kvmflow-device-wrap .kvmflow-dot');
  assert.ok(headDot && headDot.classList.contains('err') && !headDot.classList.contains('on'), 'disconnected device shows red dot');

  const input = document.querySelector('input[placeholder*="ASCII"]');
  assert.ok(input, 'ASCII text input rendered');
  const setVal = async val => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, val);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  await setVal('ipconfig /all');
  await click(byText('button', '输入'));
  await setVal('whoami');
  await click(byText('button', '输入'));
  await settle(100);

  // Panel is collapsed by default; clicking History (2) expands it.
  assert.equal(document.querySelector('.kvmflow-history-panel'), null, 'history panel collapsed by default');
  await click(byText('button', '历史 (2)'));
  await settle(60);
  assert.ok(document.querySelector('.kvmflow-history-panel'), 'history panel expanded');

  const rows = [...document.querySelectorAll('.kvmflow-history-text')].map(el => el.textContent);
  assert.deepEqual(rows, ['whoami', 'ipconfig /all'], 'most recent command first');
  assert.deepEqual(await store.readTextHistory(), ['whoami', 'ipconfig /all'], 'persisted to text-history.txt');

  // Clicking a history row fills the input.
  await click(byText('.kvmflow-history-text', 'ipconfig /all'));
  assert.equal(input.value, 'ipconfig /all');

  // Remove one entry via the right-side Delete button.
  await click(document.querySelector('button[aria-label="删除 whoami"]'));
  await settle(80);
  assert.deepEqual([...document.querySelectorAll('.kvmflow-history-text')].map(el => el.textContent), ['ipconfig /all']);
  assert.deepEqual(await store.readTextHistory(), ['ipconfig /all']);

  // Clear all via confirmation modal.
  await click(byText('.kvmflow-history-panel button', '清空全部'));
  await settle(60);
  assert.ok(document.querySelector('[role="dialog"]'), 'clear history modal opened');
  await click(byText('.kvmflow-modal-foot button', '清空'));
  await settle(80);
  assert.equal(document.querySelector('.kvmflow-history-panel'), null, 'history panel closed after clear');
  assert.deepEqual(await store.readTextHistory(), []);
});

test('runs tab shows the run graph, trace and decision buttons', async () => {
  const doc = await store.loadFlow(workflowId);
  activeRun = {
    id: 'run-1', workflowId, workflowName: doc.name, deviceId: 'dev-1', status: 'paused', phase: 'awaiting operator', schema: 2,
    createdAt: Date.now(), updatedAt: Date.now(), currentStepIndex: 0, currentNodeId: 'begin', visits: 2, visionCalls: 1,
    steps: Object.values(doc.nodes).map((node, index) => ({ index, id: node.id, name: node.name, type: node.type, status: 'pending', attempts: 0 })),
    trace: [{ seq: 1, at: Date.now(), durationMs: 900, workflowId, depth: 0, nodeId: 'begin', nodeType: 'vision_check', status: 'ok', port: 'false', target: 'wait', reason: 'still loading' }],
    log: [{ at: Date.now(), level: 'warn', message: 'needs a human' }],
    awaiting: { kind: 'human', message: '请选择', nodeId: 'begin', actions: ['abort'], options: [{ name: 'continue' }, { name: 'stop', label: '停止' }], routes: ['true'] },
    vars: {},
  };
  recentRuns = [
    { id: 'run-old', workflowId, workflowName: '旧记录', deviceId: 'dev-1', status: 'succeeded', phase: 'done', createdAt: Date.now() - 10_000, updatedAt: Date.now() - 5000, currentStepIndex: 0, totalSteps: 2 },
  ];
  await click(byText('[role="tab"]', '执行'));
  await settle(400);
  assert.ok(document.querySelector('.kf-run-graph .react-flow'), 'run graph rendered');
  assert.ok(document.querySelector('.kf-card.kf-run-paused, .kf-card.kf-awaiting'), 'current node highlighted');
  assert.ok(byText('.kvmflow-trace-row', 'still loading'), 'trace row shown');
  assert.ok(byText('.kvmflow-awaiting-title', '需要你选择下一步'));
  await click(byText('.kvmflow-awaiting button', '停止'));
  const control = calls.find(([method]) => method === 'control');
  assert.deepEqual(control[1], { id: 'run-1', action: 'choose', option: 'stop' });

  // Delete one finished history run via modal confirmation.
  await click(byText('.kvmflow-device button', '清理'));
  await settle(80);
  const confirm = document.querySelector('[role="dialog"]');
  assert.ok(confirm && confirm.textContent.includes('旧记录'), 'delete run modal opened');
  await click(byText('.kvmflow-modal-foot button', '清理'));
  await settle(150);
  assert.equal(recentRuns.length, 0, 'finished run deleted');
});

test('no React errors were logged', () => {
  console.error = originalError;
  const relevant = errors.filter(message => !/act\(|not wrapped in act/.test(message));
  assert.deepEqual(relevant, []);
  root.unmount();
  rmSync(dataDir, { recursive: true, force: true });
});
