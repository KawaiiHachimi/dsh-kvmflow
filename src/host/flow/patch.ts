/**
 * Batched graph edits, shared by the agent tool and the canvas.
 *
 * A patch applies to the YAML-shaped value of a document and the result is
 * normalized again, so one validator guards every way of changing a workflow.
 */
import type { YamlValue } from '../yaml.js';
import { flowToYaml, normalizeFlow } from './normalize.js';
import { isNodeType, nodeSpec, portsForNode, type FlowDocument, type FlowError, type NodeType } from './schema.js';

export type PatchOp =
  | {
    op: 'add_node';
    id?: string;
    type: string;
    name?: string;
    description?: string;
    config?: Record<string, unknown>;
    next?: Record<string, string>;
    precondition?: unknown;
    verify?: unknown;
    retry?: unknown;
    maxVisits?: number;
    /** Splice the new node into an existing edge: `from.port` now leads here, and here leads where it used to. */
    after?: { node: string; port?: string };
  }
  | {
    op: 'update_node';
    id: string;
    type?: string;
    name?: string;
    description?: string | null;
    /** Shallow merge; a `null` value removes the key. */
    config?: Record<string, unknown>;
    replaceConfig?: boolean;
    /** Merge into `next`; a `null` target disconnects that port. */
    next?: Record<string, string | null>;
    precondition?: unknown;
    verify?: unknown;
    retry?: unknown;
    maxVisits?: number | null;
  }
  | { op: 'remove_node'; id: string; bridge?: boolean }
  | { op: 'rename_node'; id: string; to: string }
  | { op: 'connect'; from: string; port?: string; to: string }
  | { op: 'disconnect'; from: string; port: string }
  | { op: 'set_start'; id: string }
  | {
    op: 'set_meta';
    name?: string;
    description?: string | null;
    deviceId?: string | null;
    vars?: Record<string, unknown> | null;
    inputs?: Record<string, unknown> | null;
    limits?: Record<string, unknown> | null;
    bios?: Record<string, unknown> | null;
  };

export class PatchError extends Error {
  readonly code = 'INVALID_PATCH';
  readonly opIndex: number;
  constructor(message: string, opIndex: number) {
    super(`ops[${opIndex}]: ${message}`);
    this.name = 'PatchError';
    this.opIndex = opIndex;
  }
}

// The patch edits the loose YAML shape on purpose: normalization re-validates
// every field afterwards, so the intermediate value does not need precise types.
type RawNode = Record<string, any> & { next?: Record<string, string> };
type RawDoc = Record<string, any> & { nodes: Record<string, RawNode> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Ports a new node's forward edge should use, in preference order. */
const FORWARD_PORTS = ['next', 'ok', 'success', 'true', 'body', 'found', 'default'];

function forwardPort(type: NodeType, config: Record<string, unknown>): string | undefined {
  const ports = portsForNode(type, config).map(port => port.name);
  return FORWARD_PORTS.find(name => ports.includes(name)) ?? ports.find(name => name !== 'error');
}

function freshId(type: string, taken: Record<string, unknown>): string {
  const base = type.replace(/_/g, '-');
  let index = 1;
  while (Object.hasOwn(taken, `${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function rawOf(document: FlowDocument): RawDoc {
  // A deep copy through JSON keeps the patch from aliasing the cached document.
  const value = JSON.parse(JSON.stringify(flowToYaml(document))) as RawDoc;
  value.id = document.id;
  value.createdAt = document.createdAt;
  if (!isRecord(value.nodes)) value.nodes = {};
  for (const node of Object.values(value.nodes)) {
    if (!isRecord(node.next)) node.next = {};
    if (!isRecord(node.config)) node.config = {};
  }
  return value;
}

function nodeTypeOf(raw: RawNode, index: number, id: string): NodeType {
  if (!isNodeType(raw.type)) throw new PatchError(`node ${JSON.stringify(id)} has an unknown type ${JSON.stringify(raw.type)}`, index);
  return raw.type;
}

function requireNode(doc: RawDoc, id: unknown, index: number, label = 'node'): RawNode {
  if (typeof id !== 'string' || !Object.hasOwn(doc.nodes, id)) {
    throw new PatchError(`${label} ${JSON.stringify(id)} does not exist`, index);
  }
  return doc.nodes[id];
}

/**
 * Apply a batch of operations.
 * @param document - current normalized document.
 * @param ops - operations in order.
 * @returns the new document, its normalization issues, and the ids added by `add_node`.
 */
export function applyPatch(document: FlowDocument, ops: readonly PatchOp[]): { document: FlowDocument; issues: FlowError[]; added: string[] } {
  if (!Array.isArray(ops) || ops.length === 0) throw new PatchError('ops must be a non-empty list', 0);
  const doc = rawOf(document);
  const added: string[] = [];

  ops.forEach((op, index) => {
    const shape: unknown = op;
    if (!isRecord(shape) || typeof shape.op !== 'string') throw new PatchError('each op needs an "op" field', index);
    switch (op.op) {
      case 'add_node': {
        if (!isNodeType(op.type)) throw new PatchError(`unknown node type ${JSON.stringify(op.type)}`, index);
        const id = op.id ?? freshId(op.type, doc.nodes);
        if (!NAME_PATTERN.test(id)) throw new PatchError(`node id ${JSON.stringify(id)} must match ${NAME_PATTERN}`, index);
        if (Object.hasOwn(doc.nodes, id)) throw new PatchError(`node ${JSON.stringify(id)} already exists`, index);
        const node: RawNode = {
          type: op.type,
          ...(op.name === undefined ? {} : { name: op.name }),
          ...(op.description === undefined ? {} : { description: op.description }),
          config: (op.config ?? {}) as YamlValue,
          next: { ...(op.next ?? {}) },
          ...(op.precondition === undefined ? {} : { precondition: op.precondition as YamlValue }),
          ...(op.verify === undefined ? {} : { verify: op.verify as YamlValue }),
          ...(op.retry === undefined ? {} : { retry: op.retry as YamlValue }),
          ...(op.maxVisits === undefined ? {} : { maxVisits: op.maxVisits }),
        };
        if (op.after !== undefined) {
          const source = requireNode(doc, op.after.node, index, 'after.node');
          const sourceType = nodeTypeOf(source, index, op.after.node);
          const port = op.after.port ?? forwardPort(sourceType, (source.config ?? {}) as Record<string, unknown>);
          if (port === undefined) throw new PatchError(`node ${JSON.stringify(op.after.node)} has no output port to splice after`, index);
          const previous = source.next?.[port];
          const ownForward = forwardPort(op.type, (op.config ?? {}) as Record<string, unknown>);
          if (previous !== undefined && ownForward !== undefined && node.next !== undefined && node.next[ownForward] === undefined) {
            node.next[ownForward] = previous;
          }
          source.next = { ...(source.next ?? {}), [port]: id };
        }
        doc.nodes[id] = node;
        added.push(id);
        if (typeof doc.start !== 'string' || doc.start === '') doc.start = id;
        break;
      }
      case 'update_node': {
        const node = requireNode(doc, op.id, index);
        if (op.type !== undefined) {
          if (!isNodeType(op.type)) throw new PatchError(`unknown node type ${JSON.stringify(op.type)}`, index);
          if (op.type !== node.type) {
            node.type = op.type;
            // A different type has a different config shape; keep only what the caller passes.
            node.config = {};
            node.next = {};
          }
        }
        if (op.name !== undefined) node.name = op.name;
        if (op.description === null) delete node.description;
        else if (op.description !== undefined) node.description = op.description;
        if (op.config !== undefined) {
          const base = op.replaceConfig === true ? {} : { ...((node.config ?? {}) as Record<string, YamlValue>) };
          for (const [key, value] of Object.entries(op.config)) {
            if (value === null) delete base[key];
            else base[key] = value as YamlValue;
          }
          node.config = base;
        }
        if (op.next !== undefined) {
          const next = { ...(node.next ?? {}) };
          for (const [port, target] of Object.entries(op.next)) {
            if (target === null) delete next[port];
            else next[port] = String(target);
          }
          node.next = next;
        }
        for (const key of ['precondition', 'verify', 'retry'] as const) {
          if (op[key] === null) delete node[key];
          else if (op[key] !== undefined) node[key] = op[key] as YamlValue;
        }
        if (op.maxVisits === null) delete node.maxVisits;
        else if (op.maxVisits !== undefined) node.maxVisits = op.maxVisits;
        break;
      }
      case 'remove_node': {
        const node = requireNode(doc, op.id, index);
        const type = nodeTypeOf(node, index, op.id);
        const bridgePort = forwardPort(type, (node.config ?? {}) as Record<string, unknown>);
        const bridgeTarget = op.bridge === false || bridgePort === undefined ? undefined : node.next?.[bridgePort];
        delete doc.nodes[op.id];
        for (const other of Object.values(doc.nodes)) {
          for (const [port, target] of Object.entries(other.next ?? {})) {
            if (target !== op.id) continue;
            if (bridgeTarget !== undefined && bridgeTarget !== op.id) (other.next as Record<string, string>)[port] = bridgeTarget;
            else delete (other.next as Record<string, string>)[port];
          }
        }
        if (doc.start === op.id) doc.start = bridgeTarget ?? Object.keys(doc.nodes)[0] ?? '';
        break;
      }
      case 'rename_node': {
        const node = requireNode(doc, op.id, index);
        if (!NAME_PATTERN.test(op.to)) throw new PatchError(`node id ${JSON.stringify(op.to)} must match ${NAME_PATTERN}`, index);
        if (op.to === op.id) break;
        if (Object.hasOwn(doc.nodes, op.to)) throw new PatchError(`node ${JSON.stringify(op.to)} already exists`, index);
        const renamed: Record<string, RawNode> = {};
        for (const [id, other] of Object.entries(doc.nodes)) renamed[id === op.id ? op.to : id] = id === op.id ? node : other;
        doc.nodes = renamed;
        for (const other of Object.values(doc.nodes)) {
          for (const [port, target] of Object.entries(other.next ?? {})) {
            if (target === op.id) (other.next as Record<string, string>)[port] = op.to;
          }
        }
        if (doc.start === op.id) doc.start = op.to;
        break;
      }
      case 'connect': {
        const node = requireNode(doc, op.from, index, 'from');
        requireNode(doc, op.to, index, 'to');
        const type = nodeTypeOf(node, index, op.from);
        const port = op.port ?? forwardPort(type, (node.config ?? {}) as Record<string, unknown>);
        if (port === undefined) throw new PatchError(`node ${JSON.stringify(op.from)} has no output port`, index);
        node.next = { ...(node.next ?? {}), [port]: op.to };
        break;
      }
      case 'disconnect': {
        const node = requireNode(doc, op.from, index, 'from');
        const next = { ...(node.next ?? {}) };
        delete next[op.port];
        node.next = next;
        break;
      }
      case 'set_start':
        requireNode(doc, op.id, index);
        doc.start = op.id;
        break;
      case 'set_meta': {
        if (op.name !== undefined) doc.name = op.name;
        for (const key of ['description', 'deviceId', 'vars', 'inputs', 'limits', 'bios'] as const) {
          const value = op[key];
          if (value === null) delete doc[key];
          else if (value !== undefined) doc[key] = value as YamlValue;
        }
        break;
      }
      default:
        throw new PatchError(`unknown op ${JSON.stringify((op as { op?: unknown }).op)}`, index);
    }
  });

  const { document: next, issues } = normalizeFlow(doc, {
    fallbackId: document.id,
    createdAt: document.createdAt,
  });
  next.id = document.id;
  return { document: next, issues, added };
}

/** One-line description of each op, for the tool schema and error messages. */
export const PATCH_OPS_HELP = [
  'add_node {id?, type, name?, config?, next?, after?: {node, port?}} — after splices the node into an existing edge',
  'update_node {id, name?, type?, config? (merge; null removes a key), replaceConfig?, next? (merge; null disconnects), precondition?, verify?, retry?, maxVisits?}',
  'remove_node {id, bridge? = true} — bridge reconnects predecessors to the removed node\'s forward target',
  'rename_node {id, to}',
  'connect {from, port?, to} — port defaults to the forward port (next/ok/success/true/body)',
  'disconnect {from, port}',
  'set_start {id}',
  'set_meta {name?, description?, deviceId?, vars?, inputs?, limits?, bios?} — null removes a field',
].join('\n');

/** Exported for tests: which port a splice would use. */
export function forwardPortFor(type: string, config: Record<string, unknown> = {}): string | undefined {
  return isNodeType(type) && nodeSpec(type) !== undefined ? forwardPort(type, config) : undefined;
}
