// Engine tests for schema v2: expressions, normalization, analysis, v1 upgrade,
// patching, and the interpreter against a fake device and a scripted vision model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseExpression, evaluateExpression, renderTemplate, ExprError } from '../dist/host/flow/expr.js';
import { normalizeFlow, flowToYaml } from '../dist/host/flow/normalize.js';
import { analyzeFlow, hasErrors, toGraph, autoLayout } from '../dist/host/flow/graph.js';
import { upgradeV1 } from '../dist/host/flow/convert.js';
import { applyPatch, PatchError } from '../dist/host/flow/patch.js';
import { Interpreter } from '../dist/host/flow/interp.js';
import { Store } from '../dist/host/store.js';
import { FlowService } from '../dist/host/flow/service.js';
import { composeFlows } from '../dist/host/flow/compose.js';
import { askVision, listAvailableModels } from '../dist/host/model.js';
import { dumpYaml, parseYaml } from '../dist/host/yaml.js';

const evalExpr = (source, scope = {}) => evaluateExpression(parseExpression(source), scope);

// ---------- expressions ----------

test('expressions: arithmetic, comparison, logic, functions, paths', () => {
  const scope = { vars: { n: 2, name: 'Win', list: [1, 2, 3] }, nodes: { a: { output: { label: 'network', x: 0.5 } } }, inputs: {} };
  assert.equal(evalExpr('1 + 2 * 3', scope), 7);
  assert.equal(evalExpr('vars.n < 3 && vars.name == "Win"', scope), true);
  assert.equal(evalExpr("nodes.a.output.label == 'network'", scope), true);
  assert.equal(evalExpr('len(vars.list)', scope), 3);
  assert.equal(evalExpr('vars.list[1]', scope), 2);
  assert.equal(evalExpr('contains(vars.list, 3)', scope), true);
  assert.equal(evalExpr('vars.missing.deep == null', scope), false, 'absent path is undefined, not null');
  assert.equal(evalExpr('coalesce(vars.missing, "fallback")', scope), 'fallback');
  assert.equal(evalExpr('vars.n > 1 ? "big" : "small"', scope), 'big');
  assert.equal(evalExpr('"3" == 3', scope), true);
  assert.equal(evalExpr('round(2.456, 2)', scope), 2.46);
  assert.equal(evalExpr('!vars.missing', scope), true);
});

test('expressions reject globals, unknown functions and syntax errors', () => {
  assert.throws(() => parseExpression('process.exit(1)'), ExprError);
  assert.throws(() => parseExpression('constructor'), ExprError);
  assert.throws(() => parseExpression('eval("1")'), ExprError);
  assert.throws(() => parseExpression('vars.a +'), ExprError);
  assert.throws(() => parseExpression('len(1, 2)'), ExprError);
});

test('templates keep types for a sole placeholder and join otherwise', () => {
  const scope = { vars: { x: 0.25, user: 'alice' }, inputs: {}, nodes: {} };
  assert.equal(renderTemplate('{{vars.x}}', scope), 0.25);
  assert.equal(renderTemplate('hello {{vars.user}}!', scope), 'hello alice!');
  assert.equal(renderTemplate('plain text', scope), 'plain text');
  assert.equal(renderTemplate('literal \\{{ braces', scope), 'literal {{ braces');
});

// ---------- documents ----------

const oobe = () => ({
  version: 2,
  name: 'OOBE',
  inputs: { username: { type: 'string' }, password: { type: 'secret' } },
  start: 'detect',
  nodes: {
    detect: {
      type: 'vision_classify',
      config: { prompt: 'Which page?', labels: { region: 'Region page', network: 'Network page', desktop: 'Desktop' } },
      maxVisits: 10,
      next: { region: 'pick', network: 'skip', desktop: 'done', unknown: 'ask' },
    },
    pick: { type: 'click', config: { x: 0.8, y: 0.9 }, next: { next: 'detect' } },
    skip: { type: 'locate', config: { target: 'I don\'t have internet' }, next: { found: 'clickSkip', not_found: 'ask' } },
    clickSkip: { type: 'click', config: { x: '{{nodes.skip.output.x}}', y: '{{nodes.skip.output.y}}' }, next: { next: 'detect' } },
    ask: { type: 'human', config: { message: 'Help', options: ['continue', 'abort'] }, next: { continue: 'detect', abort: 'fail' } },
    done: { type: 'end', config: { result: 'success', outputs: { user: '{{inputs.username}}' } } },
    fail: { type: 'end', config: { result: 'failure', reason: 'operator gave up' } },
  },
});

test('a valid graph normalizes, has no errors, and round-trips through YAML', () => {
  const { document, issues } = normalizeFlow(oobe(), { fallbackId: 'wf-oobe' });
  assert.deepEqual(issues, []);
  assert.equal(hasErrors(analyzeFlow(document)), false);
  const yaml = dumpYaml(flowToYaml(document));
  const again = normalizeFlow(parseYaml(yaml), { fallbackId: 'wf-oobe' });
  assert.deepEqual(again.issues, []);
  assert.deepEqual(Object.keys(again.document.nodes).sort(), Object.keys(document.nodes).sort());
  assert.deepEqual(again.document.nodes.detect.next, document.nodes.detect.next);
  assert.equal(again.document.nodes.clickSkip.config.x, '{{nodes.skip.output.x}}');
  assert.equal(again.document.inputs.password.type, 'secret');
});

test('normalization reports bad ports, bad ids, bad conditions and bad templates by path', () => {
  const doc = oobe();
  doc.nodes.pick.next = { nowhere: 'detect' };
  doc.nodes['9bad'] = { type: 'delay', config: { ms: 1 } };
  doc.nodes.cond = { type: 'if', config: { condition: { expr: 'vars.a +' } } };
  doc.nodes.tpl = { type: 'text', config: { text: 'hi {{vars.' } };
  const { issues } = normalizeFlow(doc);
  const paths = issues.map(issue => issue.path).join('\n');
  assert.match(paths, /nodes\.pick\.next\.nowhere/);
  assert.match(paths, /nodes\.9bad/);
  assert.match(paths, /nodes\.cond\.config/);
  assert.match(paths, /nodes\.tpl\.config/);
});

test('analysis finds missing targets, unreachable nodes, unconnected ports and unbounded cycles', () => {
  const { document } = normalizeFlow({
    version: 2,
    name: 'bad',
    start: 'a',
    nodes: {
      a: { type: 'key', config: { key: 'Enter' }, next: { next: 'b' } },
      b: { type: 'key', config: { key: 'Tab' }, next: { next: 'a' } },
      c: { type: 'if', config: { condition: { expr: 'true' } }, next: { true: 'ghost' } },
    },
  });
  const issues = analyzeFlow(document);
  const codes = issues.map(issue => `${issue.code}:${issue.nodeId ?? ''}`);
  assert.ok(codes.includes('target:c'), 'edge to a missing node is an error');
  assert.ok(codes.includes('unreachable:c'));
  assert.ok(codes.some(code => code.startsWith('cycle:')), 'a→b→a without bounds warns');
  assert.ok(codes.includes('no-end:'));
  assert.equal(hasErrors(issues), true);
});

test('auto layout places nodes left to right by distance from start', () => {
  const { document } = normalizeFlow(oobe());
  const positions = autoLayout(document);
  assert.ok(positions.pick.x > positions.detect.x);
  assert.ok(positions.clickSkip.x > positions.skip.x);
  const graph = toGraph(document);
  assert.equal(graph.edges.find(edge => edge.id === 'detect:region').target, 'pick');
  assert.deepEqual(graph.nodes.find(node => node.id === 'detect').ports.map(port => port.name), ['region', 'network', 'desktop', 'unknown', 'error']);
});

// ---------- v1 upgrade ----------

test('v1 steps become a chain; onFailure maps to retry, error routes and a fail end', () => {
  const { document, issues } = upgradeV1({
    id: 'wf-old',
    name: 'Old',
    bios: { hotkey: 'Delete' },
    steps: [
      { id: 'step-1', name: 'Enter BIOS', action: { type: 'key', key: 'F2' }, verify: { mode: 'vision', prompt: 'BIOS main page' }, onFailure: { strategy: 'retry', retries: 2 } },
      { id: 'step 2!', name: 'Move', action: { type: 'key', key: 'ArrowRight' }, onFailure: { strategy: 'continue' } },
      { name: 'Save', action: { type: 'key', key: 'F10' }, onFailure: { strategy: 'abort' } },
      { name: 'Wait', action: { type: 'delay', ms: 100 } },
    ],
  });
  assert.deepEqual(issues, []);
  const ids = Object.keys(document.nodes);
  assert.equal(document.start, 'step-1');
  assert.ok(ids.includes('step-2-'), `sanitized id, got ${ids.join(',')}`);
  assert.equal(document.nodes['step-1'].retry.times, 2);
  assert.equal(document.nodes['step-1'].next.next, 'step-2-');
  assert.equal(document.nodes['step-2-'].next.error, document.nodes['step-2-'].next.next, 'continue routes error forward');
  assert.equal(document.nodes.step3.next.error, 'fail');
  assert.equal(document.nodes.fail.config.result, 'failure');
  assert.equal(document.nodes.step4.next.next, 'done');
  assert.equal(document.bios.hotkey, 'Delete');
  assert.equal(hasErrors(analyzeFlow(document)), false);
});

test('the store upgrades a v1 file once and keeps the original as a backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kvmflow-store-'));
  try {
    const store = new Store({ dataDir: dir });
    store.initSync();
    const v1 = 'version: 1\nname: Legacy\nsteps:\n  - name: Tap\n    action:\n      type: key\n      key: Enter\n';
    writeFileSync(store.workflowPath('wf-legacy'), v1);
    const document = await store.loadFlow('wf-legacy');
    assert.equal(document.version, 2);
    assert.equal(readFileSync(store.backupPath('wf-legacy'), 'utf8'), v1);
    const saved = readFileSync(store.workflowPath('wf-legacy'), 'utf8');
    assert.match(saved, /^version: 2$/m);
    assert.match(saved, /^start: step1$/m);
    // v1 defaults survive: an action verifies a screen change unless told otherwise.
    assert.equal(document.nodes.step1.verify.mode, 'change');
    const list = await store.listWorkflows();
    assert.equal(list[0].version, 2);
    assert.equal(list[0].stepCount, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- patching ----------

test('patch: add after splices into an edge, connect, rename, remove with bridge', () => {
  const { document } = normalizeFlow({
    version: 2, name: 'p', start: 'a',
    nodes: {
      a: { type: 'key', config: { key: 'Enter' }, next: { next: 'z' } },
      z: { type: 'end', config: { result: 'success' } },
    },
  });
  let result = applyPatch(document, [
    { op: 'add_node', id: 'check', type: 'vision_check', config: { prompt: 'Desktop visible' }, after: { node: 'a' } },
    { op: 'add_node', id: 'retryKey', type: 'key', config: { key: 'Enter' }, next: { next: 'check' } },
    { op: 'connect', from: 'check', port: 'false', to: 'retryKey' },
  ]);
  assert.deepEqual(result.issues, []);
  let doc = result.document;
  assert.equal(doc.nodes.a.next.next, 'check');
  assert.equal(doc.nodes.check.next.true, 'z', 'spliced node inherits the old target on its forward port');
  assert.equal(doc.nodes.check.next.false, 'retryKey');

  result = applyPatch(doc, [{ op: 'rename_node', id: 'check', to: 'desktop' }, { op: 'remove_node', id: 'a' }]);
  doc = result.document;
  assert.equal(doc.start, 'desktop', 'removing the start node bridges to its target');
  assert.equal(doc.nodes.retryKey.next.next, 'desktop');
  assert.throws(() => applyPatch(doc, [{ op: 'connect', from: 'nope', to: 'z' }]), PatchError);
  assert.throws(() => applyPatch(doc, [{ op: 'add_node', id: 'z', type: 'delay' }]), PatchError);
});

test('patch: update merges config and null removes keys or edges', () => {
  const { document } = normalizeFlow({
    version: 2, name: 'p', start: 'a',
    nodes: {
      a: { type: 'click', config: { x: 0.1, y: 0.2, count: 2 }, next: { next: 'z', error: 'z' } },
      z: { type: 'end', config: {} },
    },
  });
  const { document: doc } = applyPatch(document, [{ op: 'update_node', id: 'a', config: { x: 0.5, count: null }, next: { error: null } }]);
  assert.equal(doc.nodes.a.config.x, 0.5);
  assert.equal(doc.nodes.a.config.y, 0.2);
  assert.equal(doc.nodes.a.config.count, 1, 'removed key falls back to its default');
  assert.equal(doc.nodes.a.next.error, undefined);
});

// ---------- interpreter ----------

const jpeg = text => new Uint8Array(Buffer.from(`\xff\xd8${text}`, 'latin1'));

function fakeHost(options = {}) {
  const screens = options.screens ?? ['screen-0'];
  let screen = 0;
  const sent = [];
  const decisions = [...(options.decisions ?? [])];
  const asked = [];
  const visionCalls = [];
  const controller = new AbortController();
  const host = {
    signal: controller.signal,
    device: {
      async snapshot() {
        const data = jpeg(screens[Math.min(screen, screens.length - 1)]);
        if (options.advanceOnSnapshot === true) screen += 1;
        return { data };
      },
      async control(events) {
        sent.push(events);
        if (options.advanceOnInput !== false) screen += 1;
      },
      viewMapping: options.viewMapping,
    },
    vision: {
      async check(request) {
        visionCalls.push(['check', request.condition]);
        return options.check ? options.check(request, screens[Math.min(screen, screens.length - 1)]) : { passed: true, reason: 'ok', raw: 'PASS' };
      },
      async classify(request) {
        const current = screens[Math.min(screen, screens.length - 1)];
        visionCalls.push(['classify', current]);
        return options.classify ? options.classify(current, request) : { label: 'unknown', reason: 'n/a' };
      },
      async extract(request) {
        visionCalls.push(['extract']);
        return { values: Object.fromEntries(request.fields.map(field => [field, options.extracted?.[field] ?? null])) };
      },
      async locate() {
        visionCalls.push(['locate']);
        return options.locate ?? { found: true, x: 0.4, y: 0.6, reason: 'found the link' };
      },
    },
    async saveShot(tag) { return `runs/test/${tag}.jpg`; },
    async readAsset(_id, relative) {
      if (options.assets?.[relative] === undefined) throw new Error(`missing asset ${relative}`);
      return options.assets[relative];
    },
    async loadSubflow(id) {
      const raw = options.subflows?.[id];
      if (raw === undefined) throw new Error(`no subflow ${id}`);
      return normalizeFlow(raw, { fallbackId: id }).document;
    },
    log() {},
    async flush() {},
    async decide(request) {
      asked.push(request);
      const next = decisions.shift();
      if (next === undefined) throw new Error(`unexpected decision request: ${request.message}`);
      return typeof next === 'function' ? next(request) : next;
    },
    async sleep() {},
    async releaseAll() {},
  };
  return { host, sent, asked, visionCalls, controller, setScreen: index => { screen = index; } };
}

const freshState = () => ({ vars: {}, inputs: {}, visits: {}, trace: [], visionCalls: 0, phase: '', results: {} });

function run(raw, fake, options = {}) {
  const { document, issues } = normalizeFlow(raw, { fallbackId: 'wf-test' });
  assert.deepEqual(issues, [], 'test document must be valid');
  const state = freshState();
  state.vars = { ...document.vars };
  return { state, promise: new Interpreter(document, fake.host, state, options).run() };
}

test('interpreter: vision_classify drives an N-way branch with a back edge, locate feeds click', async () => {
  const fake = fakeHost({
    screens: ['region', 'network', 'desktop'],
    classify: current => ({ label: current, reason: `looks like ${current}` }),
  });
  const { state, promise } = run(oobe(), fake, { inputs: { username: 'alice', password: 'pw' }, secretInputs: ['password'] });
  const outcome = await promise;
  assert.equal(outcome.result, 'success');
  assert.deepEqual(outcome.outputs, { user: 'alice' });
  const path = state.trace.map(entry => `${entry.nodeId}:${entry.port}`);
  assert.deepEqual(path, ['detect:region', 'pick:next', 'detect:network', 'skip:found', 'clickSkip:next', 'detect:desktop', 'done:']);
  // The templated click used the located coordinates.
  const click = fake.sent[1].find(event => event[0] === 'mouse_abs' && event[1] === 1);
  assert.deepEqual([click[2], click[3]], [0.4, 0.6]);
  assert.equal(state.visits.detect, 3);
});

test('interpreter: unknown label routes to a human node and the operator choice picks the port', async () => {
  const fake = fakeHost({
    screens: ['mystery'],
    classify: () => ({ label: 'not-a-label', reason: '?' }),
    decisions: [{ action: 'choose', option: 'abort' }],
  });
  const { promise, state } = run(oobe(), fake, { inputs: { username: 'a', password: 'b' } });
  const outcome = await promise;
  assert.equal(outcome.result, 'failure');
  assert.equal(outcome.reason, 'operator gave up');
  assert.equal(fake.asked[0].kind, 'human');
  assert.deepEqual(fake.asked[0].options.map(option => option.name), ['continue', 'abort']);
  assert.deepEqual(state.trace.map(entry => entry.port), ['unknown', 'abort', '']);
});

test('interpreter: if/set/loop with an expression, and maxVisits stops a runaway back edge', async () => {
  const counter = {
    version: 2, name: 'count', vars: { n: 0 }, start: 'loop',
    nodes: {
      loop: { type: 'loop', config: { count: 3, indexVar: 'i' }, next: { body: 'inc', done: 'check' } },
      inc: { type: 'set', config: { assign: { n: '{{vars.n + vars.i}}' } }, next: { next: 'loop' } },
      check: { type: 'if', config: { condition: { expr: 'vars.n == 6' } }, next: { true: 'ok', false: 'bad' } },
      ok: { type: 'end', config: { result: 'success' } },
      bad: { type: 'end', config: { result: 'failure' } },
    },
  };
  const fake = fakeHost();
  const { promise, state } = run(counter, fake);
  assert.equal((await promise).result, 'success');
  assert.equal(state.vars.n, 6, '1 + 2 + 3');
  assert.equal(state.visits.inc, 3);

  const runaway = {
    version: 2, name: 'spin', start: 'a',
    nodes: {
      a: { type: 'delay', config: { ms: 1 }, maxVisits: 4, next: { next: 'a', error: 'stop' } },
      stop: { type: 'end', config: { result: 'failure', reason: 'spun out' } },
    },
  };
  const second = run(runaway, fakeHost());
  const outcome = await second.promise;
  assert.equal(outcome.reason, 'spun out');
  assert.equal(second.state.visits.a, 4);
});

test('interpreter: wait_until polls until the condition holds and times out otherwise', async () => {
  // Each poll sees a new frame; an unchanged frame would reuse the cached verdict.
  let polls = 0;
  const fake = fakeHost({ screens: ['s0', 's1', 's2', 's3'], advanceOnSnapshot: true, check: () => ({ passed: ++polls >= 3, reason: `poll ${polls}`, raw: '' }) });
  const doc = {
    version: 2, name: 'w', start: 'w',
    nodes: {
      w: { type: 'wait_until', config: { condition: { vision: 'spinner gone' }, timeoutSec: 30, pollMs: 200 }, next: { ok: 'ok', timeout: 'late' } },
      ok: { type: 'end', config: { result: 'success' } },
      late: { type: 'end', config: { result: 'failure', reason: 'late' } },
    },
  };
  assert.equal((await run(doc, fake).promise).result, 'success');
  assert.equal(polls, 3);

  const never = fakeHost({ screens: ['a', 'b', 'c', 'd', 'e', 'f'], advanceOnSnapshot: true, check: () => ({ passed: false, reason: 'still spinning', raw: '' }) });
  doc.nodes.w.config.timeoutSec = 1;
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => (clock += 400);
  try {
    assert.equal((await run(doc, never).promise).reason, 'late');
  } finally {
    Date.now = realNow;
  }
});

test('interpreter: vision verdicts are cached per frame so an unchanged loop does not pay twice', async () => {
  const fake = fakeHost({ screens: ['same'], advanceOnInput: false, check: () => ({ passed: false, reason: 'no', raw: '' }) });
  const doc = {
    version: 2, name: 'cache', start: 'c',
    nodes: {
      c: { type: 'vision_check', config: { prompt: 'Desktop' }, maxVisits: 3, next: { true: 'ok', false: 'c', error: 'gaveUp' } },
      ok: { type: 'end', config: {} },
      gaveUp: { type: 'end', config: { result: 'failure' } },
    },
  };
  const { promise } = run(doc, fake);
  assert.equal((await promise).result, 'failure');
  assert.equal(fake.visionCalls.length, 1, 'one model call for three visits on the same frame');
});

test('interpreter: failures retry, then take the error port, or pause and accept route/skip/abort', async () => {
  let attempts = 0;
  const flaky = fakeHost();
  flaky.host.device.control = async () => { attempts += 1; throw new Error('HID offline'); };
  const doc = {
    version: 2, name: 'f', start: 'k',
    nodes: {
      k: { type: 'key', config: { key: 'Enter' }, retry: { times: 2 }, next: { next: 'ok', error: 'handled' } },
      ok: { type: 'end', config: {} },
      handled: { type: 'end', config: { result: 'failure', reason: 'handled' } },
    },
  };
  assert.equal((await run(doc, flaky).promise).reason, 'handled');
  assert.equal(attempts, 3);

  // Without an error port the run pauses; "skip" continues on the main path.
  delete doc.nodes.k.next.error;
  doc.nodes.k.retry = { times: 0 };
  const paused = fakeHost({ decisions: [{ action: 'skip' }] });
  paused.host.device.control = async () => { throw new Error('HID offline'); };
  const outcome = await run(doc, paused).promise;
  assert.equal(outcome.result, 'success');
  assert.equal(paused.asked[0].kind, 'failure');
  assert.ok(paused.asked[0].actions.includes('skip'));

  const aborting = fakeHost({ decisions: [{ action: 'abort' }] });
  aborting.host.device.control = async () => { throw new Error('HID offline'); };
  await assert.rejects(run(doc, aborting).promise, /aborted/);
});

test('interpreter: an unconnected port pauses with the connected routes', async () => {
  const fake = fakeHost({ check: () => ({ passed: false, reason: 'no', raw: '' }), decisions: [{ action: 'route', port: 'true' }] });
  const doc = {
    version: 2, name: 'u', start: 'c',
    nodes: {
      c: { type: 'vision_check', config: { prompt: 'x' }, next: { true: 'ok' } },
      ok: { type: 'end', config: { result: 'success' } },
    },
  };
  const outcome = await run(doc, fake).promise;
  assert.equal(outcome.result, 'success');
  assert.equal(fake.asked[0].kind, 'unrouted');
  assert.deepEqual(fake.asked[0].routes, ['true']);
});

test('interpreter: action verify uses the frame before the action; image_match and screen_change', async () => {
  const ref = jpeg('target');
  const fake = fakeHost({ screens: ['start', 'target'], assets: { 'assets/ref.jpg': ref } });
  const doc = {
    version: 2, name: 'v', start: 'press',
    nodes: {
      press: { type: 'key', config: { key: 'Enter' }, verify: { mode: 'change', settleMs: 0, timeoutSec: 2 }, next: { next: 'match' } },
      match: { type: 'image_match', config: { image: 'assets/ref.jpg' }, next: { true: 'changed', false: 'bad' } },
      changed: { type: 'screen_change', config: { compareWith: 'run-start' }, next: { true: 'ok', false: 'bad' } },
      ok: { type: 'end', config: {} },
      bad: { type: 'end', config: { result: 'failure' } },
    },
  };
  const { promise, state } = run(doc, fake);
  assert.equal((await promise).result, 'success');
  assert.equal(state.trace[1].output.passed, true);
  assert.equal(createHash('sha256').update(ref).digest('hex').length, 64);
});

test('interpreter: vision_extract writes outputs that later nodes template into text', async () => {
  const fake = fakeHost({ extracted: { ip: '10.0.0.7' } });
  const doc = {
    version: 2, name: 'x', start: 'read',
    nodes: {
      read: { type: 'vision_extract', config: { prompt: 'Read the IP', fields: ['ip'] }, next: { next: 'type' } },
      type: { type: 'text', config: { text: 'ping {{nodes.read.output.ip}}', submit: false }, next: { next: 'ok' } },
      ok: { type: 'end', config: { outputs: { ip: '{{nodes.read.output.ip}}' } } },
    },
  };
  const outcome = await run(doc, fake).promise;
  assert.deepEqual(outcome.outputs, { ip: '10.0.0.7' });
  assert.deepEqual(fake.sent[0][0], ['text', 'ping 10.0.0.7']);
});

test('interpreter: set never re-evaluates text that came from the screen', async () => {
  const fake = fakeHost({ extracted: { title: '{{vars.secret}}' } });
  const doc = {
    version: 2, name: 's', vars: { secret: 'hunter2' }, start: 'read',
    nodes: {
      read: { type: 'vision_extract', config: { prompt: 'title', fields: ['title'] }, next: { next: 'copy' } },
      copy: { type: 'set', config: { assign: { title: '{{nodes.read.output.title}}' } }, next: { next: 'ok' } },
      ok: { type: 'end', config: { outputs: { title: '{{vars.title}}' } } },
    },
  };
  const outcome = await run(doc, fake).promise;
  assert.equal(outcome.outputs.title, '{{vars.secret}}');
});

test('interpreter: subflows receive inputs, return outputs, and share the trace', async () => {
  const fake = fakeHost({
    subflows: {
      'wf-login': {
        version: 2, name: 'login', inputs: { user: { type: 'string' } }, start: 'type',
        nodes: {
          type: { type: 'text', config: { text: '{{inputs.user}}' }, next: { next: 'end' } },
          end: { type: 'end', config: { outputs: { typed: '{{inputs.user}}' } } },
        },
      },
    },
  });
  const doc = {
    version: 2, name: 'parent', start: 'call',
    nodes: {
      call: { type: 'subflow', config: { workflow: 'wf-login', inputs: { user: 'bob' } }, next: { success: 'check', failure: 'bad' } },
      check: { type: 'if', config: { condition: { expr: "nodes.call.output.typed == 'bob'" } }, next: { true: 'ok', false: 'bad' } },
      ok: { type: 'end', config: {} },
      bad: { type: 'end', config: { result: 'failure' } },
    },
  };
  const { promise, state } = run(doc, fake);
  assert.equal((await promise).result, 'success');
  assert.deepEqual(state.trace.map(entry => `${entry.depth}:${entry.nodeId}`), ['1:type', '1:end', '0:call', '0:check', '0:ok']);
});

test('interpreter: the document visit limit and the vision budget stop a run', async () => {
  const doc = {
    version: 2, name: 'l', limits: { maxNodeVisits: 5, maxVisionCalls: 2 }, start: 'a',
    nodes: {
      a: { type: 'delay', config: { ms: 1 }, maxVisits: 1000, next: { next: 'a' } },
    },
  };
  await assert.rejects(run(doc, fakeHost()).promise, /node visits/);
  const vision = {
    version: 2, name: 'v', limits: { maxVisionCalls: 2 }, start: 'c',
    nodes: {
      c: { type: 'vision_check', config: { prompt: 'x' }, maxVisits: 50, next: { true: 'c', false: 'c' } },
    },
  };
  const fake = fakeHost({ screens: ['a', 'b', 'c', 'd'], advanceOnSnapshot: true, decisions: [{ action: 'abort' }] });
  await assert.rejects(run(vision, fake).promise, /aborted/);
  assert.match(fake.asked[0].message, /vision budget/);
  assert.equal(fake.visionCalls.length, 2);
});

test('interpreter: limits.timeoutSec stops a run but excludes time spent waiting for a human', async () => {
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    const slow = fakeHost();
    slow.host.sleep = async ms => { clock += ms; };
    const doc = {
      version: 2, name: 't', limits: { timeoutSec: 10 }, start: 'a',
      nodes: { a: { type: 'delay', config: { ms: 4000 }, maxVisits: 50, next: { next: 'a' } } },
    };
    await assert.rejects(run(doc, slow).promise, /10s of execution/);

    const waiting = fakeHost({ decisions: [() => { clock += 60_000; return { action: 'choose', option: 'go' }; }] });
    const human = {
      version: 2, name: 'h', limits: { timeoutSec: 10 }, start: 'ask',
      nodes: {
        ask: { type: 'human', config: { message: 'ready?', options: ['go'] }, next: { go: 'end' } },
        end: { type: 'end', config: {} },
      },
    };
    assert.equal((await run(human, waiting).promise).result, 'success', 'a minute at a human prompt is not execution time');
  } finally {
    Date.now = realNow;
  }
});

test('interpreter: abort during a pause rejects with AbortError', async () => {
  const fake = fakeHost({
    decisions: [() => { fake.controller.abort(); return { action: 'abort' }; }],
  });
  const doc = {
    version: 2, name: 'h', start: 'h',
    nodes: { h: { type: 'human', config: { message: 'ok?', options: ['yes'] }, next: { yes: 'end' } }, end: { type: 'end', config: {} } },
  };
  await assert.rejects(run(doc, fake).promise, error => error.name === 'AbortError');
});

// ---------- service ----------

test('service: create, patch strictly, save layout, and refuse an invalid agent save', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kvmflow-svc-'));
  try {
    const store = new Store({ dataDir: dir });
    store.initSync();
    const flows = new FlowService(store);
    const created = await flows.create({ name: 'Fresh' });
    assert.equal(hasErrors(created.issues), false);
    const id = created.document.id;

    const patched = await flows.patch(id, [{ op: 'add_node', id: 'press', type: 'key', config: { key: 'Enter' }, after: { node: 'begin', port: 'true' } }]);
    assert.deepEqual(patched.added, ['press']);
    assert.equal(patched.document.nodes.begin.next.true, 'press');
    assert.equal(patched.document.nodes.press.next.next, 'done');

    await assert.rejects(flows.patch(id, [{ op: 'connect', from: 'press', to: 'ghost' }]), /does not exist/);

    await flows.saveLayout(id, { version: 1, nodes: { press: { x: 10.4, y: 20.6 }, ghost: { x: 1, y: 1 } } });
    const view = await flows.view(id);
    assert.deepEqual(view.graph.layout.nodes.press, { x: 10, y: 21 });
    assert.ok(!('ghost' in JSON.parse(readFileSync(store.layoutPath(id), 'utf8')).nodes));

    await assert.rejects(flows.save({ id, yaml: 'version: 2\nname: x\nstart: a\nnodes:\n  a:\n    type: if\n    config:\n      condition:\n        expr: "true"\n    next:\n      true: missing\n', strict: true }), /error/);
    const check = flows.check({ yaml: 'version: 2\nname: x\nstart: a\nnodes:\n  a:\n    type: bogus\n' });
    assert.equal(check.document, undefined);
    assert.equal(check.issues[0].nodeId, 'a');
    assert.ok(existsSync(store.workflowPath(id)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- compose ----------

test('compose: subflow mode chains subflow nodes, forwards inputs, and applies failure policies', () => {
  const first = normalizeFlow({
    version: 2, id: 'wf-a', name: 'Stage A', bios: { hotkey: 'F2' },
    inputs: { user: { type: 'string' } }, start: 'step',
    nodes: { step: { type: 'delay', config: { ms: 10 }, next: { next: 'done' } }, done: { type: 'end', config: { result: 'success' } } },
  }, { fallbackId: 'wf-a' }).document;
  const second = normalizeFlow({
    version: 2, id: 'wf-b', name: 'Stage B',
    inputs: { host: { type: 'string' } }, start: 'step',
    nodes: { step: { type: 'delay', config: { ms: 10 }, next: { next: 'done' } }, done: { type: 'end', config: { result: 'success' } } },
  }, { fallbackId: 'wf-b' }).document;

  const { document, issues } = composeFlows({
    id: 'wf-combo', name: 'A then B', mode: 'subflow',
    stages: [{ document: first, onFailure: 'continue' }, { document: second, onFailure: 'abort' }],
  });
  assert.deepEqual(issues, []);
  assert.equal(hasErrors(analyzeFlow(document)), false);
  assert.equal(document.start, 'stage1');
  assert.equal(document.bios?.hotkey, 'F2');
  assert.deepEqual(Object.keys(document.inputs).sort(), ['host', 'user']);
  assert.equal(document.nodes.stage1.next.success, 'stage2');
  assert.equal(document.nodes.stage1.next.failure, 'stage2');
  assert.equal(document.nodes.stage2.next.success, 'done');
  assert.equal(document.nodes.stage2.next.failure, 'fail');
  assert.equal(document.nodes.stage1.config.inputs.user, '{{inputs.user}}');
});

test('compose: inline mode prefixes ids, rewrites nodes.<id> references, stitches ends, and executes', async () => {
  const first = normalizeFlow({
    version: 2, id: 'wf-read', name: 'Read', start: 'read',
    nodes: {
      read: { type: 'vision_extract', config: { prompt: 'Read IP', fields: ['ip'] }, next: { next: 'save' } },
      save: { type: 'set', config: { assign: { ip: '{{nodes.read.output.ip}}' } }, next: { next: 'done' } },
      done: { type: 'end', config: { result: 'success' } },
    },
  }, { fallbackId: 'wf-read' }).document;
  const second = normalizeFlow({
    version: 2, id: 'wf-type', name: 'Type', start: 'read',
    nodes: {
      read: { type: 'text', config: { text: 'ssh {{vars.ip}}' }, next: { next: 'done' } },
      done: { type: 'end', config: { result: 'success' } },
    },
  }, { fallbackId: 'wf-type' }).document;

  const { document, issues } = composeFlows({
    id: 'wf-flat', name: 'Read and Type', mode: 'inline',
    stages: [{ document: first }, { document: second }],
  });
  assert.deepEqual(issues, []);
  assert.equal(hasErrors(analyzeFlow(document)), false);
  assert.equal(document.start, 's1_read');
  assert.equal(document.nodes.s1_save.config.assign.ip, '{{nodes.s1_read.output.ip}}');
  assert.equal(document.nodes.s1_save.next.next, 's2_read');
  assert.equal(document.nodes.s2_read.next.next, 'done');

  const fake = fakeHost({ extracted: { ip: '10.1.2.3' } });
  const state = freshState();
  state.vars = { ...document.vars };
  const outcome = await new Interpreter(document, fake.host, state).run();
  assert.equal(outcome.result, 'success');
  assert.deepEqual(fake.sent[0][0], ['text', 'ssh 10.1.2.3']);
});

test('service: compose inline copies referenced workflow assets under prefixed names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kvmflow-compose-'));
  try {
    const store = new Store({ dataDir: dir });
    store.initSync();
    const flows = new FlowService(store);
    const refBytes = jpeg('ref-pic');
    await store.saveWorkflowAsset('wf-img', 'ref.jpg', refBytes);
    await flows.save({
      id: 'wf-img',
      document: {
        version: 2, name: 'Match', start: 'm',
        nodes: {
          m: { type: 'image_match', config: { image: 'assets/ref.jpg' }, next: { true: 'done', false: 'done' } },
          done: { type: 'end', config: { result: 'success' } },
        },
      },
      strict: true,
    });
    const composed = await flows.compose({
      name: 'Double Match', mode: 'inline',
      items: [{ workflowId: 'wf-img' }, { workflowId: 'wf-img' }],
    });
    assert.equal(composed.document.nodes.s1_m.config.image, 'assets/s1_ref.jpg');
    assert.equal(composed.document.nodes.s2_m.config.image, 'assets/s2_ref.jpg');
    const copied = await store.readWorkflowAsset(composed.document.id, 'assets/s1_ref.jpg');
    assert.deepEqual(new Uint8Array(copied), refBytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('visionModel: normalizes, round-trips through YAML, inherits on compose, and overrides DSH default in askVision', async () => {
  const { document, issues } = normalizeFlow({
    version: 2, name: 'Vision Override', start: 'done',
    visionModel: { provider: 'openai', model: 'gpt-4o' },
    nodes: { done: { type: 'end', config: { result: 'success' } } },
  }, { fallbackId: 'wf-vm' });
  assert.deepEqual(issues, []);
  assert.deepEqual(document.visionModel, { provider: 'openai', model: 'gpt-4o' });
  const round = normalizeFlow(parseYaml(dumpYaml(flowToYaml(document))), { fallbackId: 'wf-vm' });
  assert.deepEqual(round.document.visionModel, { provider: 'openai', model: 'gpt-4o' });

  const composed = composeFlows({ id: 'wf-c', name: 'C', mode: 'subflow', stages: [{ document }] });
  assert.deepEqual(composed.document.visionModel, { provider: 'openai', model: 'gpt-4o' });

  let calledWith;
  const fakeCtx = {
    get(key) {
      if (key === 'llm') {
        return {
          listProviders: () => [{ id: 'openai', name: 'OpenAI' }],
          listModels: async () => [{ provider: 'openai', id: 'gpt-4o', name: 'GPT-4o', inputModalities: ['text', 'image'] }],
          async *stream(opts) {
            calledWith = { provider: opts.provider, model: opts.model };
            yield { type: 'text-delta', text: 'PASS\nok' };
          },
        };
      }
      if (key === 'attachments') return { saveImage: async () => ({ attachmentId: 'att-1' }) };
      if (key === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) };
      return undefined;
    },
  };
  const listed = await listAvailableModels(fakeCtx);
  assert.equal(listed.models.length, 1);
  assert.equal(listed.models[0].supportsImage, true);
  assert.deepEqual(listed.defaultModel, { provider: 'deepseek', model: 'deepseek-chat' });

  await askVision(fakeCtx, { data: jpeg('x'), prompt: 'check', model: { provider: 'openai', model: 'gpt-4o' } });
  assert.deepEqual(calledWith, { provider: 'openai', model: 'gpt-4o' });
});

test('store: deleteRun and clearRuns remove run json and shot folders while sparing an active run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kvmflow-runs-'));
  try {
    const store = new Store({ dataDir: dir });
    store.initSync();
    const mkRun = id => ({
      id, workflowId: 'wf-1', workflowName: 'Demo', deviceId: 'dev-1', status: 'succeeded', phase: 'done',
      createdAt: Date.now(), updatedAt: Date.now(), currentStepIndex: 0, steps: [], log: [],
    });
    await store.saveRun(mkRun('run-a'));
    await store.saveRunShot('run-a', jpeg('a'), 'shot');
    await store.saveRun(mkRun('run-b'));
    await store.saveRun(mkRun('run-active'));

    await store.deleteRun('run-a');
    assert.equal(existsSync(join(store.runsDir, 'run-a.json')), false);
    assert.equal(existsSync(store.runDir('run-a')), false);

    const removed = await store.clearRuns('run-active');
    assert.equal(removed, 1);
    const left = await store.listRuns();
    assert.deepEqual(left.map(entry => entry.id), ['run-active']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store: text history persists line-by-line to text-history.txt like bash history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kvmflow-hist-'));
  try {
    const store = new Store({ dataDir: dir });
    store.initSync();
    await store.addTextHistory('ipconfig');
    await store.addTextHistory('whoami');
    await store.addTextHistory('ipconfig');
    assert.deepEqual(await store.readTextHistory(), ['ipconfig', 'whoami']);
    assert.equal(readFileSync(store.textHistoryPath, 'utf8'), 'ipconfig\nwhoami\n');
    await store.removeTextHistory('whoami');
    assert.deepEqual(await store.readTextHistory(), ['ipconfig']);
    await store.clearTextHistory();
    assert.deepEqual(await store.readTextHistory(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
