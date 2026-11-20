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
const device = { id: 'dev-1', name: 'Linkr', driver: 'linkr', baseUrl: 'http://x', hasToken: true, hasWebCredentials: false, createdAt: 1, updatedAt: 1 };
async function handle(method, params) {
  calls.push([method, params]);
  switch (method) {
    case 'state': return { dataDir, devices: [device], defaultDeviceId: 'dev-1', recordings: [], workflows: await store.listWorkflows(), recentRuns: [], ...(activeRun ? { activeRun } : {}) };
    case 'flow.catalog': return { nodes: flows.catalog() };
    case 'flow.get': return flows.view(params.id);
    case 'flow.save': return flows.save({ id: params.id, ...(params.yaml ? { yaml: params.yaml } : {}), ...(params.document ? { document: params.document } : {}), ...(params.layout ? { layout: params.layout } : {}) });
    case 'flow.check': return flows.check(params);
    case 'run.get': return { run: activeRun };
    case 'run.control': calls.push(['control', params]); return { run: activeRun };
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
  await click(byText('[role="tab"]', '执行'));
  await settle(400);
  assert.ok(document.querySelector('.kf-run-graph .react-flow'), 'run graph rendered');
  assert.ok(document.querySelector('.kf-card.kf-run-paused, .kf-card.kf-awaiting'), 'current node highlighted');
  assert.ok(byText('.kvmflow-trace-row', 'still loading'), 'trace row shown');
  assert.ok(byText('.kvmflow-awaiting-title', '需要你选择下一步'));
  await click(byText('.kvmflow-awaiting button', '停止'));
  const control = calls.find(([method]) => method === 'control');
  assert.deepEqual(control[1], { id: 'run-1', action: 'choose', option: 'stop' });
});

test('no React errors were logged', () => {
  console.error = originalError;
  const relevant = errors.filter(message => !/act\(|not wrapped in act/.test(message));
  assert.deepEqual(relevant, []);
  root.unmount();
  rmSync(dataDir, { recursive: true, force: true });
});
