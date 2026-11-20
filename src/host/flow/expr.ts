/**
 * The workflow expression language: a small parser and evaluator for the
 * conditions and `set` values a graph node uses.
 *
 * There is no `eval` and no access to JS globals: the parser only builds the
 * node kinds declared here, and the evaluator only reads the frozen scope the
 * runner hands over. A path the scope does not have is `undefined`, so a
 * mistyped variable is a `false` condition rather than a crash.
 */

export class ExprError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(offset >= 0 ? `${message} (at offset ${offset})` : message);
    this.name = 'ExprError';
    this.offset = offset;
  }
}

export type ExprNode =
  | { kind: 'literal'; value: unknown }
  | { kind: 'array'; items: ExprNode[] }
  | { kind: 'path'; root: string; steps: Array<string | number> }
  | { kind: 'unary'; op: '!' | '-'; operand: ExprNode }
  | { kind: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { kind: 'logical'; op: '&&' | '||'; left: ExprNode; right: ExprNode }
  | { kind: 'conditional'; test: ExprNode; then: ExprNode; otherwise: ExprNode }
  | { kind: 'call'; name: string; args: ExprNode[] };

export type Scope = Record<string, unknown>;

/** Names an expression may read from the scope. */
export const SCOPE_ROOTS = ['vars', 'inputs', 'nodes', 'last', 'run', 'frame'] as const;

interface Token {
  kind: 'number' | 'string' | 'ident' | 'punct' | 'eof';
  text: string;
  value?: unknown;
  offset: number;
}

const PUNCTUATION = [
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||',
  '+', '-', '*', '/', '%', '!', '<', '>', '(', ')', '[', ']', ',', '.', '?', ':',
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/.exec(source.slice(index));
      if (match === null) throw new ExprError('malformed number', index);
      tokens.push({ kind: 'number', text: match[0], value: Number(match[0]), offset: index });
      index += match[0].length;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let text = '';
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length) {
        const current = source[cursor];
        if (current === '\\') {
          const next = source[cursor + 1];
          text += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : (next ?? '');
          cursor += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          cursor += 1;
          break;
        }
        text += current;
        cursor += 1;
      }
      if (!closed) throw new ExprError('unterminated string', index);
      tokens.push({ kind: 'string', text, value: text, offset: index });
      index = cursor;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index));
      const text = match === null ? char : match[0];
      tokens.push({ kind: 'ident', text, offset: index });
      index += text.length;
      continue;
    }
    const punct = PUNCTUATION.find(candidate => source.startsWith(candidate, index));
    if (punct === undefined) throw new ExprError(`unexpected character ${JSON.stringify(char)}`, index);
    tokens.push({ kind: 'punct', text: punct, offset: index });
    index += punct.length;
  }
  tokens.push({ kind: 'eof', text: '', offset: source.length });
  return tokens;
}

/** Every function an expression may call, with its accepted argument counts. */
const FUNCTION_ARITY: Record<string, [number, number]> = {
  len: [1, 1],
  contains: [2, 2],
  startsWith: [2, 2],
  endsWith: [2, 2],
  lower: [1, 1],
  upper: [1, 1],
  trim: [1, 1],
  number: [1, 1],
  string: [1, 1],
  round: [1, 2],
  floor: [1, 1],
  ceil: [1, 1],
  abs: [1, 1],
  min: [1, 8],
  max: [1, 8],
  coalesce: [1, 8],
};

export const FUNCTION_NAMES = Object.keys(FUNCTION_ARITY);

class Parser {
  private readonly tokens: Token[];
  private cursor = 0;

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  parse(): ExprNode {
    const node = this.parseConditional();
    const rest = this.peek();
    if (rest.kind !== 'eof') throw new ExprError(`unexpected ${JSON.stringify(rest.text)}`, rest.offset);
    return node;
  }

  private peek(): Token {
    return this.tokens[this.cursor];
  }

  private take(): Token {
    const token = this.tokens[this.cursor];
    this.cursor += 1;
    return token;
  }

  private accept(text: string): boolean {
    const token = this.peek();
    if (token.kind === 'punct' && token.text === text) {
      this.cursor += 1;
      return true;
    }
    return false;
  }

  private expect(text: string): void {
    if (!this.accept(text)) {
      const token = this.peek();
      throw new ExprError(`expected ${JSON.stringify(text)}, found ${JSON.stringify(token.text)}`, token.offset);
    }
  }

  private parseConditional(): ExprNode {
    const test = this.parseBinary(0);
    if (!this.accept('?')) return test;
    const then = this.parseConditional();
    this.expect(':');
    const otherwise = this.parseConditional();
    return { kind: 'conditional', test, then, otherwise };
  }

  private static readonly LEVELS: string[][] = [
    ['||'],
    ['&&'],
    ['==', '!=', '===', '!=='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%'],
  ];

  private parseBinary(level: number): ExprNode {
    if (level >= Parser.LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    while (true) {
      const token = this.peek();
      if (token.kind !== 'punct' || !Parser.LEVELS[level].includes(token.text)) return left;
      this.cursor += 1;
      const right = this.parseBinary(level + 1);
      left = token.text === '&&' || token.text === '||'
        ? { kind: 'logical', op: token.text, left, right }
        : { kind: 'binary', op: token.text, left, right };
    }
  }

  private parseUnary(): ExprNode {
    const token = this.peek();
    if (token.kind === 'punct' && (token.text === '!' || token.text === '-')) {
      this.cursor += 1;
      return { kind: 'unary', op: token.text, operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExprNode {
    let node = this.parsePrimary();
    while (true) {
      if (this.accept('.')) {
        const token = this.take();
        if (token.kind !== 'ident') throw new ExprError('expected a property name after "."', token.offset);
        node = this.appendStep(node, token.text, token.offset);
        continue;
      }
      if (this.accept('[')) {
        const index = this.parseConditional();
        this.expect(']');
        node = index.kind === 'literal' && (typeof index.value === 'string' || typeof index.value === 'number')
          ? this.appendStep(node, index.value as string | number, -1)
          : { kind: 'call', name: 'index', args: [node, index] };
        continue;
      }
      return node;
    }
  }

  private appendStep(node: ExprNode, step: string | number, offset: number): ExprNode {
    if (node.kind === 'path') {
      node.steps.push(step);
      return node;
    }
    // `f(x).y` is not valid: calls return values, and members only follow paths.
    throw new ExprError('property access is only supported on variables', offset);
  }

  private parsePrimary(): ExprNode {
    const token = this.take();
    if (token.kind === 'number' || token.kind === 'string') {
      return { kind: 'literal', value: token.value };
    }
    if (token.kind === 'punct' && token.text === '(') {
      const inner = this.parseConditional();
      this.expect(')');
      return inner;
    }
    if (token.kind === 'punct' && token.text === '[') {
      const items: ExprNode[] = [];
      if (!this.accept(']')) {
        while (true) {
          items.push(this.parseConditional());
          if (this.accept(']')) break;
          this.expect(',');
        }
      }
      return { kind: 'array', items };
    }
    if (token.kind === 'ident') {
      if (token.text === 'true') return { kind: 'literal', value: true };
      if (token.text === 'false') return { kind: 'literal', value: false };
      if (token.text === 'null') return { kind: 'literal', value: null };
      if (this.accept('(')) {
        const args: ExprNode[] = [];
        if (!this.accept(')')) {
          while (true) {
            args.push(this.parseConditional());
            if (this.accept(')')) break;
            this.expect(',');
          }
        }
        const arity = FUNCTION_ARITY[token.text];
        if (arity === undefined) {
          throw new ExprError(`unknown function ${JSON.stringify(token.text)}`, token.offset);
        }
        if (args.length < arity[0] || args.length > arity[1]) {
          throw new ExprError(`${token.text}() takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]}-${arity[1]}`} argument(s)`, token.offset);
        }
        return { kind: 'call', name: token.text, args };
      }
      if (!(SCOPE_ROOTS as readonly string[]).includes(token.text)) {
        throw new ExprError(`unknown name ${JSON.stringify(token.text)}; readable roots are ${SCOPE_ROOTS.join(', ')}`, token.offset);
      }
      return { kind: 'path', root: token.text, steps: [] };
    }
    throw new ExprError(`unexpected ${JSON.stringify(token.text)}`, token.offset);
  }
}

/**
 * Parse an expression into an evaluable tree.
 * @param source - expression text.
 * @returns the parsed tree.
 */
export function parseExpression(source: string): ExprNode {
  if (typeof source !== 'string' || source.trim() === '') throw new ExprError('expression is empty', 0);
  return new Parser(source).parse();
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? Number.NaN : Number(trimmed);
  }
  return Number.NaN;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function looseEquals(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  if (typeof left === 'string' && typeof right === 'string') return left === right;
  if (typeof left === 'boolean' || typeof right === 'boolean') return left === right;
  if (left === null || right === null) return left === right;
  // A value from a JSON-shaped node output compared to a literal: compare loosely
  // by text so `"3" == 3` holds without making every comparison a string compare.
  if ((typeof left === 'number' && typeof right === 'string') || (typeof left === 'string' && typeof right === 'number')) {
    const a = toNumber(left);
    const b = toNumber(right);
    if (Number.isFinite(a) && Number.isFinite(b)) return a === b;
  }
  return left === right;
}

function readPath(node: Extract<ExprNode, { kind: 'path' }>, scope: Scope): unknown {
  let value: unknown = scope[node.root];
  for (const step of node.steps) {
    if (value === null || value === undefined) return undefined;
    if (typeof step === 'number') {
      value = Array.isArray(value) ? value[step] : undefined;
      continue;
    }
    if (Array.isArray(value) || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[step];
  }
  return value;
}

function callFunction(name: string, args: unknown[]): unknown {
  switch (name) {
    case 'len': {
      const value = args[0];
      if (Array.isArray(value)) return value.length;
      if (typeof value === 'string') return value.length;
      if (value !== null && typeof value === 'object') return Object.keys(value).length;
      return 0;
    }
    case 'contains':
      return Array.isArray(args[0])
        ? args[0].some(item => looseEquals(item, args[1]))
        : toText(args[0]).includes(toText(args[1]));
    case 'startsWith':
      return toText(args[0]).startsWith(toText(args[1]));
    case 'endsWith':
      return toText(args[0]).endsWith(toText(args[1]));
    case 'lower':
      return toText(args[0]).toLowerCase();
    case 'upper':
      return toText(args[0]).toUpperCase();
    case 'trim':
      return toText(args[0]).trim();
    case 'number':
      return toNumber(args[0]);
    case 'string':
      return toText(args[0]);
    case 'round': {
      const digits = args.length > 1 ? Math.max(0, Math.min(10, Math.floor(toNumber(args[1])))) : 0;
      const factor = 10 ** digits;
      const value = toNumber(args[0]);
      return Number.isFinite(value) ? Math.round(value * factor) / factor : value;
    }
    case 'floor':
      return Math.floor(toNumber(args[0]));
    case 'ceil':
      return Math.ceil(toNumber(args[0]));
    case 'abs':
      return Math.abs(toNumber(args[0]));
    case 'min': {
      const numbers = args.map(toNumber).filter(Number.isFinite);
      return numbers.length === 0 ? undefined : Math.min(...numbers);
    }
    case 'max': {
      const numbers = args.map(toNumber).filter(Number.isFinite);
      return numbers.length === 0 ? undefined : Math.max(...numbers);
    }
    case 'coalesce': {
      for (const value of args) {
        if (value !== undefined && value !== null && value !== '') return value;
      }
      return undefined;
    }
    default:
      throw new ExprError(`unknown function ${JSON.stringify(name)}`, -1);
  }
}

function evaluateNode(node: ExprNode, scope: Scope): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'array':
      return node.items.map(item => evaluateNode(item, scope));
    case 'path':
      return readPath(node, scope);
    case 'unary': {
      const value = evaluateNode(node.operand, scope);
      return node.op === '!' ? !truthy(value) : -toNumber(value);
    }
    case 'logical': {
      const left = evaluateNode(node.left, scope);
      if (node.op === '&&') return truthy(left) ? evaluateNode(node.right, scope) : left;
      return truthy(left) ? left : evaluateNode(node.right, scope);
    }
    case 'conditional':
      return truthy(evaluateNode(node.test, scope))
        ? evaluateNode(node.then, scope)
        : evaluateNode(node.otherwise, scope);
    case 'call': {
      if (node.name === 'index') {
        const target = evaluateNode(node.args[0], scope);
        const key = evaluateNode(node.args[1], scope);
        if (Array.isArray(target)) {
          const position = Math.floor(toNumber(key));
          return Number.isFinite(position) ? target[position] : undefined;
        }
        if (target !== null && typeof target === 'object') {
          return (target as Record<string, unknown>)[toText(key)];
        }
        if (typeof target === 'string') {
          const position = Math.floor(toNumber(key));
          return Number.isFinite(position) ? target[position] : undefined;
        }
        return undefined;
      }
      return callFunction(node.name, node.args.map(arg => evaluateNode(arg, scope)));
    }
    case 'binary': {
      const left = evaluateNode(node.left, scope);
      const right = evaluateNode(node.right, scope);
      switch (node.op) {
        case '==':
        case '===':
          return looseEquals(left, right);
        case '!=':
        case '!==':
          return !looseEquals(left, right);
        case '<':
          return toNumber(left) < toNumber(right);
        case '<=':
          return toNumber(left) <= toNumber(right);
        case '>':
          return toNumber(left) > toNumber(right);
        case '>=':
          return toNumber(left) >= toNumber(right);
        case '+':
          // `+` adds numbers and joins text; it never turns a string into a number
          // by accident, which keeps a template-built label readable.
          if (typeof left === 'string' || typeof right === 'string') return toText(left) + toText(right);
          return toNumber(left) + toNumber(right);
        case '-':
          return toNumber(left) - toNumber(right);
        case '*':
          return toNumber(left) * toNumber(right);
        case '/':
          return toNumber(left) / toNumber(right);
        case '%':
          return toNumber(left) % toNumber(right);
        default:
          throw new ExprError(`unsupported operator ${node.op}`, -1);
      }
    }
    default:
      throw new ExprError('unsupported expression node', -1);
  }
}

/**
 * Evaluate one parsed expression.
 * @param node - parsed tree.
 * @param scope - readable roots.
 * @returns the value; an absent path yields `undefined`.
 */
export function evaluateExpression(node: ExprNode, scope: Scope): unknown {
  return evaluateNode(node, scope);
}

/** True when the expression evaluates to a truthy value. */
export function evaluateTruth(node: ExprNode, scope: Scope): boolean {
  return truthy(evaluateNode(node, scope));
}

/** One piece of a template: literal text or an embedded expression. */
export type TemplatePart = { kind: 'text'; text: string } | { kind: 'expr'; node: ExprNode; source: string };

export interface ParsedTemplate {
  parts: TemplatePart[];
  /** True when the whole string is exactly one `{{ … }}` placeholder. */
  sole: boolean;
}

/**
 * Parse `text with {{expressions}}`.
 * @param text - template source.
 * @returns the parts, or a single text part when there is nothing to substitute.
 */
export function parseTemplate(text: string): ParsedTemplate {
  const parts: TemplatePart[] = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('{{', index);
    if (start < 0) {
      parts.push({ kind: 'text', text: text.slice(index) });
      break;
    }
    // `\{{` is a literal `{{`.
    if (start > 0 && text[start - 1] === '\\') {
      parts.push({ kind: 'text', text: `${text.slice(index, start - 1)}{{` });
      index = start + 2;
      continue;
    }
    if (start > index) parts.push({ kind: 'text', text: text.slice(index, start) });
    const end = text.indexOf('}}', start + 2);
    if (end < 0) throw new ExprError('unterminated {{ in template', start);
    const source = text.slice(start + 2, end).trim();
    parts.push({ kind: 'expr', node: parseExpression(source), source });
    index = end + 2;
  }
  const real = parts.filter(part => part.kind === 'expr' || (part.kind === 'text' && part.text !== ''));
  const sole = real.length === 1 && real[0].kind === 'expr';
  return { parts, sole };
}

/** True when the text contains at least one placeholder. */
export function isTemplate(text: unknown): text is string {
  return typeof text === 'string' && text.includes('{{');
}

/**
 * Resolve a template against the scope.
 * @param text - template source.
 * @param scope - readable roots.
 * @returns the raw value for a sole placeholder, otherwise the joined string.
 */
export function renderTemplate(text: string, scope: Scope): unknown {
  if (!isTemplate(text)) return text;
  const parsed = parseTemplate(text);
  if (parsed.sole) {
    const only = parsed.parts.find(part => part.kind === 'expr') as Extract<TemplatePart, { kind: 'expr' }>;
    return evaluateExpression(only.node, scope);
  }
  let out = '';
  for (const part of parsed.parts) {
    out += part.kind === 'text' ? part.text : toText(evaluateExpression(part.node, scope));
  }
  return out;
}

/**
 * Walk every string in a config value and resolve its templates.
 * @param value - config value.
 * @param scope - readable roots.
 * @returns the same shape with templates resolved.
 */
export function deepRender(value: unknown, scope: Scope): unknown {
  if (typeof value === 'string') return renderTemplate(value, scope);
  if (Array.isArray(value)) return value.map(item => deepRender(item, scope));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepRender(child, scope);
    }
    return out;
  }
  return value;
}

/**
 * Collect the template and expression sources a config value contains, so saving
 * can report a syntax error before a run reaches the node.
 * @param value - config value.
 * @returns human-readable problems.
 */
export function inspectTemplates(value: unknown, where: string): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (!isTemplate(node)) return;
      try {
        parseTemplate(node);
      } catch (error) {
        problems.push(`${where}${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) walk(child, `${path}.${key}`);
    }
  };
  walk(value, '');
  return problems;
}
