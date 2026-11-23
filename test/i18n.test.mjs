// Guards the two-language UI: every user-visible string must come from t()/tr().
//
// The panel is bilingual by construction — each string carries its Chinese and
// English form — but three kinds of slip are silent: an English-only default in
// a component that renders before `t` exists, a raw attribute value added in a
// hurry, and a `t()` pair whose Chinese side was left in English. This test
// fails on all three.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
  'src/client/app.ts',
  'src/client/flow/canvas.tsx',
  'src/client/flow/inspector.tsx',
  'src/client/flow/editor.tsx',
  'src/client/flow/model.ts',
];

/** Non-prose values that are identical or English by nature. */
const ALLOWED_LITERALS = new Set([
  'KVMFlow',
  'YAML',
  'ID',
  'X',
  'Y',
  'not found',
  'Lab Linkr',
  'Win',
  'Esc',
  'Enter',
  'Ctrl+Alt+Del',
  'Mac',
  'Windows',
]);

const CJK = /[\u3000-\u9fff]/;

/** Strip comments so prose inside them is not mistaken for UI text. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, match => '\n'.repeat(match.split('\n').length - 1))
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Character ranges covered by `t(...)` / `tr(...)` calls, found by paren matching. */
function translationSpans(text) {
  const spans = [];
  const call = /\b(?:t|tr)\(/g;
  let match;
  while ((match = call.exec(text)) !== null) {
    let depth = 0;
    let index = match.index + match[0].length - 1;
    let quote;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (quote !== undefined) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    spans.push([match.index, index]);
  }
  return spans;
}

/** True when a match sits inside one of the translation spans. */
function inside(offset, spans) {
  return spans.some(([start, end]) => offset >= start && offset <= end);
}

/** Looks like human prose rather than a code token, path, or identifier. */
function isProse(value) {
  if (value.length < 6) return false;
  if (ALLOWED_LITERALS.has(value)) return false;
  if (!/^[A-Za-z][A-Za-z0-9 ,.'’()/:+%-]*$/.test(value)) return false;
  if (!/[A-Za-z]{3}/.test(value)) return false;
  if (/^(https?:|[a-z-]+\/[a-z-]+$)/.test(value)) return false;
  if (/^[a-z]+(-[a-z]+)+$/.test(value)) return false; // CSS class lists
  if (/^[MAa-z]?\d/.test(value)) return false; // SVG path data
  return value.trim().split(/\s+/).length >= 2;
}

test('every user-visible literal is translated through t()/tr()', () => {
  const offenders = [];
  const attribute = /(?:'aria-label'|aria-label|placeholder|alt|title|confirmLabel|confirmAction|confirmDetail|confirmTitle|cancelLabel|label|description|hint)\s*[:=]\s*'([^'\\\n]+)'/g;
  // A default rendered when a caller passes nothing is just as visible as a literal.
  const fallback = /\?\?\s*'([^'\\\n]+)'/g;
  for (const file of FILES) {
    const text = stripComments(readFileSync(file, 'utf8'));
    const spans = translationSpans(text);
    for (const pattern of [attribute, fallback]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const value = match[1];
        if (!isProse(value)) continue;
        if (inside(match.index, spans)) continue;
        offenders.push(`${file}:${text.slice(0, match.index).split('\n').length} ${match[0].trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `untranslated UI text:\n${offenders.join('\n')}`);
});

test('every t()/tr() pair carries a real Chinese form', () => {
  const offenders = [];
  const pair = /\b(?:t|tr)\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
  const template = /\b(?:t|tr)\(\s*`((?:[^`\\]|\\.)*)`\s*,\s*`((?:[^`\\]|\\.)*)`/gs;
  for (const file of FILES) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of [pair, template]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const zh = match[1].trim();
        const en = match[2].trim();
        const line = text.slice(0, match.index).split('\n').length;
        if (zh === '') {
          offenders.push(`${file}:${line} empty Chinese side for ${JSON.stringify(en)}`);
          continue;
        }
        if (zh === en && !ALLOWED_LITERALS.has(zh)) {
          offenders.push(`${file}:${line} identical pair ${JSON.stringify(zh)}`);
          continue;
        }
        if (!CJK.test(zh) && /[A-Za-z]{3}/.test(zh) && !ALLOWED_LITERALS.has(zh)) {
          offenders.push(`${file}:${line} Chinese side is English: ${JSON.stringify(zh)}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `incomplete translations:\n${offenders.join('\n')}`);
});

test('the strings outside component renders use the locale bridge', () => {
  const app = readFileSync('src/client/app.ts', 'utf8');
  // Modal and ConfirmButton defaults render before a `t` hook exists.
  assert.match(app, /'aria-label': tr\('关闭', 'Close'\)/, 'modal close label is translated');
  assert.match(app, /tr\('取消', 'Cancel'\)/, 'confirm cancel default is translated');
  assert.match(app, /tr\('删除', 'Delete'\)/, 'confirm delete default is translated');
  assert.match(app, /tr\('请确认', 'Confirm'\)/, 'confirm title default is translated');
  // The right sidebar's guide row is invoked by the shell, outside any render.
  assert.match(app, /description: \(\): string => tr\(\s*'[^']*[\u4e00-\u9fff][^']*',\s*'[^']+'\s*\)/, 'guide description carries a Chinese and an English form');
  // The bridge must be wired to the live snapshot so a language switch applies.
  assert.match(app, /readLocale = localeSnapshot;/, 'locale bridge is installed by apply()');
});
