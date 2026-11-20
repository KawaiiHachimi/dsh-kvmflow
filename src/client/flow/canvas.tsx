/**
 * The React Flow canvas shared by the editor and the run view.
 *
 * Nodes and edges are derived from the document on every change; the canvas
 * only keeps transient drag positions locally and reports structural edits
 * back to its owner, so the document stays the single source of truth.
 */
import { memo, useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  useNodes,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { portsFor, summarize, type RunOverlay } from './model';
import { estimateNodeSize, resolveOverlaps, routeEdge, type Rect } from './routing';
import type { FlowDoc, FlowIssue, FlowNodeDoc, NodeTypeSpec, Point, PortSpec, Translate } from './types';

export const DRAG_MIME = 'application/x-kvmflow-node';

interface CardData extends Record<string, unknown> {
  node: FlowNodeDoc;
  spec?: NodeTypeSpec;
  ports: PortSpec[];
  isStart: boolean;
  issues: FlowIssue[];
  runStatus?: string;
  visits?: number;
  awaiting: boolean;
  connected: Set<string>;
  t: Translate;
}

const CATEGORY_GLYPH: Record<string, string> = { flow: '◆', action: '▶', sense: '◉', data: '≡' };

/** One node card: title, a one-line summary, and one labelled handle per output port. */
const FlowCard = memo(function FlowCard({ data, selected }: NodeProps<Node<CardData>>) {
  const { node, spec, ports, isStart, issues, runStatus, visits, awaiting, connected, t } = data;
  const errors = issues.filter(issue => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const category = spec?.category ?? 'flow';
  const failureEnd = node.type === 'end' && node.config?.result === 'failure';
  const classes = [
    'kf-card',
    `kf-cat-${category}`,
    failureEnd ? 'kf-end-failure' : '',
    selected ? 'kf-selected' : '',
    runStatus === undefined ? '' : `kf-run-${runStatus}`,
    awaiting ? 'kf-awaiting' : '',
    errors > 0 ? 'kf-has-error' : '',
  ].filter(Boolean).join(' ');
  const summary = summarize(node, t);
  return (
    <div className={classes} title={issues.map(issue => issue.message).join('\n') || undefined}>
      <Handle type="target" position={Position.Left} id="in" className="kf-handle kf-handle-in" />
      <div className="kf-card-head">
        <span className="kf-glyph" aria-hidden="true">{CATEGORY_GLYPH[category]}</span>
        <span className="kf-card-title">{node.name || (spec ? t(spec.label[0], spec.label[1]) : node.type)}</span>
        {isStart ? <span className="kf-badge kf-badge-start">{t('起点', 'START')}</span> : null}
        {visits !== undefined && visits > 0 ? <span className="kf-badge kf-badge-visits" title={t('访问次数', 'visits')}>×{visits}</span> : null}
      </div>
      <div className="kf-card-type">
        {spec ? t(spec.label[0], spec.label[1]) : node.type}
        <span className="kf-card-id">{node.id}</span>
      </div>
      {summary !== '' ? <div className="kf-card-summary">{summary}</div> : null}
      {errors + warnings > 0 ? (
        <div className={`kf-card-issues ${errors > 0 ? 'err' : 'warn'}`}>
          {errors > 0 ? t(`${errors} 个错误`, `${errors} error${errors > 1 ? 's' : ''}`) : t(`${warnings} 个提醒`, `${warnings} warning${warnings > 1 ? 's' : ''}`)}
        </div>
      ) : null}
      {ports.length > 0 ? (
        <div className="kf-ports">
          {ports.map(port => (
            <div key={port.name} className={`kf-port kf-port-${port.kind}${connected.has(port.name) ? ' kf-port-on' : ''}${!port.optional && !connected.has(port.name) ? ' kf-port-missing' : ''}`}>
              <span className="kf-port-label">{portLabel(port, t)}</span>
              <Handle type="source" position={Position.Right} id={port.name} className={`kf-handle kf-handle-${port.kind}`} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

const PORT_LABELS: Record<string, [string, string]> = {
  next: ['下一步', 'next'],
  error: ['出错', 'error'],
  true: ['是', 'true'],
  false: ['否', 'false'],
  ok: ['满足', 'ok'],
  timeout: ['超时', 'timeout'],
  body: ['循环体', 'body'],
  done: ['结束循环', 'done'],
  success: ['成功', 'success'],
  failure: ['失败', 'failure'],
  found: ['找到', 'found'],
  not_found: ['未找到', 'not found'],
  unknown: ['无法识别', 'unknown'],
  default: ['其他', 'default'],
};

export function portLabel(port: { name: string }, t: Translate): string {
  const known = PORT_LABELS[port.name];
  return known === undefined ? port.name : t(known[0], known[1]);
}

function rectsFromNodes(nodes: ReadonlyArray<Node<CardData>>): Rect[] {
  return nodes.map(node => {
    const data = node.data as CardData | undefined;
    const est = estimateNodeSize(data?.ports?.length ?? 1, true);
    const width = node.measured?.width ?? est.width;
    const height = node.measured?.height ?? est.height;
    return { id: node.id, x: node.position.x, y: node.position.y, width, height };
  });
}

/** Orthogonal edge that routes around intermediate cards and separates back-edges. */
const SmartEdge = memo(function SmartEdge(props: EdgeProps) {
  const nodes = useNodes<Node<CardData>>();
  const rects = useMemo(() => rectsFromNodes(nodes), [nodes]);
  const lane = typeof (props.data as any)?.lane === 'number' ? (props.data as any).lane : 0;
  const routed = useMemo(() => routeEdge({
    sourceId: props.source,
    targetId: props.target,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    rects,
    lane,
  }), [props.source, props.target, props.sourceX, props.sourceY, props.targetX, props.targetY, rects, lane]);

  return (
    <>
      <BaseEdge id={props.id} path={routed.path} markerEnd={props.markerEnd} style={props.style} interactionWidth={18} />
      {props.label ? (
        <EdgeLabelRenderer>
          <div
            className="kf-edge-pill nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${routed.labelX}px,${routed.labelY}px)` }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

const nodeTypes = { kvm: FlowCard };
const edgeTypes = { smart: SmartEdge };

export interface CanvasProps {
  doc: FlowDoc;
  positions: Record<string, Point>;
  catalog: Map<string, NodeTypeSpec>;
  issues: FlowIssue[];
  overlay?: RunOverlay;
  selectedId?: string;
  readOnly?: boolean;
  t: Translate;
  /** Bumped by the owner to ask the canvas to fit the whole graph. */
  fitToken?: number;
  onSelect?: (id: string | undefined) => void;
  onConnect?: (source: string, port: string, target: string) => void;
  onDisconnect?: (source: string, port: string) => void;
  onDeleteNodes?: (ids: string[]) => void;
  onMove?: (moves: Record<string, Point>) => void;
  onDropType?: (type: string, point: Point) => void;
}

export function FlowCanvas(props: CanvasProps): any {
  const { doc, positions, catalog, issues, overlay, selectedId, readOnly, t } = props;
  const flow = useReactFlow();

  const issuesByNode = useMemo(() => {
    const map = new Map<string, FlowIssue[]>();
    for (const issue of issues) {
      if (issue.nodeId === undefined) continue;
      const list = map.get(issue.nodeId) ?? [];
      list.push(issue);
      map.set(issue.nodeId, list);
    }
    return map;
  }, [issues]);

  const derived = useMemo((): Array<Node<CardData>> => Object.entries(doc.nodes).map(([id, node]) => {
    const spec = catalog.get(node.type);
    const ports = portsFor(spec, node.config ?? {});
    return {
      id,
      type: 'kvm',
      position: positions[id] ?? { x: 0, y: 0 },
      selected: id === selectedId,
      deletable: !readOnly,
      draggable: !readOnly,
      connectable: !readOnly,
      data: {
        node: { ...node, id },
        ...(spec === undefined ? {} : { spec }),
        ports,
        isStart: doc.start === id,
        issues: issuesByNode.get(id) ?? [],
        ...(overlay?.status[id] === undefined ? {} : { runStatus: overlay.status[id] }),
        ...(overlay?.visits[id] === undefined ? {} : { visits: overlay.visits[id] }),
        awaiting: overlay?.awaitingNode === id,
        connected: new Set(Object.keys(node.next ?? {})),
        t,
      },
    };
  }), [doc, positions, catalog, selectedId, readOnly, issuesByNode, overlay, t]);

  // Local copy so a drag moves smoothly; it is rebuilt whenever the document changes.
  const [nodes, setNodes] = useState(derived);
  useEffect(() => { setNodes(derived); }, [derived]);

  const edges = useMemo((): Edge[] => {
    const list: Edge[] = [];
    const targetCounts = new Map<string, number>();
    for (const [id, node] of Object.entries(doc.nodes)) {
      const ports = portsFor(catalog.get(node.type), node.config ?? {});
      for (const port of ports) {
        const target = node.next?.[port.name];
        if (target === undefined || !Object.hasOwn(doc.nodes, target)) continue;
        const key = `${id}:${port.name}`;
        const lane = targetCounts.get(target) ?? 0;
        targetCounts.set(target, lane + 1);
        const taken = overlay?.taken.has(key) === true;
        const latest = overlay?.lastEdge === key;
        const className = [
          'kf-edge',
          `kf-edge-${port.kind}`,
          taken ? 'kf-edge-taken' : '',
          latest ? 'kf-edge-latest' : '',
          overlay !== undefined && !taken ? 'kf-edge-idle' : '',
        ].filter(Boolean).join(' ');
        list.push({
          id: key,
          source: id,
          sourceHandle: port.name,
          target,
          targetHandle: 'in',
          type: 'smart',
          data: { lane },
          className,
          animated: latest && overlay?.current !== undefined,
          deletable: !readOnly,
          ...(port.kind === 'next' ? {} : { label: portLabel(port, t), labelClassName: 'kf-edge-label' }),
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        } as Edge);
      }
    }
    return list;
  }, [doc, catalog, overlay, readOnly, t]);

  const onNodesChange = useCallback((changes: NodeChange<Node<CardData>>[]) => {
    setNodes(current => {
      const updated = applyNodeChanges(changes, current);
      const finishedIds: string[] = [];
      const moved: Record<string, Point> = {};
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position !== undefined) {
          finishedIds.push(change.id);
          moved[change.id] = { x: Math.round(change.position.x), y: Math.round(change.position.y) };
        }
      }
      if (finishedIds.length === 0) return updated;
      // Push any overlapping cards apart around the just-dropped node(s).
      const pushed = resolveOverlaps(rectsFromNodes(updated), finishedIds, 24);
      const allMoves = { ...moved, ...pushed };
      queueMicrotask(() => props.onMove?.(allMoves));
      if (Object.keys(pushed).length === 0) return updated;
      return updated.map(node => (pushed[node.id] === undefined ? node : { ...node, position: pushed[node.id] }));
    });
  }, [props.onMove]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (readOnly) return;
    for (const change of changes) {
      if (change.type !== 'remove') continue;
      const [source, port] = change.id.split(':');
      props.onDisconnect?.(source, port);
    }
  }, [props.onDisconnect, readOnly]);

  const onConnect = useCallback((connection: Connection) => {
    if (readOnly || connection.source === null || connection.target === null) return;
    if (connection.sourceHandle === null || connection.sourceHandle === undefined) return;
    props.onConnect?.(connection.source, connection.sourceHandle, connection.target);
  }, [props.onConnect, readOnly]);

  useEffect(() => {
    if (props.fitToken === undefined || props.fitToken === 0) return undefined;
    const timer = setTimeout(() => { void flow.fitView({ padding: 0.18, duration: 250 }); }, 30);
    return () => clearTimeout(timer);
  }, [props.fitToken]);

  useEffect(() => {
    if (!readOnly || selectedId === undefined || selectedId === '') return undefined;
    const timer = setTimeout(() => {
      void flow.fitView({ nodes: [{ id: selectedId }], maxZoom: 1.15, padding: 0.6, duration: 220 });
    }, 30);
    return () => clearTimeout(timer);
  }, [readOnly, selectedId, flow]);

  const onDragOver = useCallback((event: DragEvent) => {
    if (readOnly) return;
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, [readOnly]);

  const onDrop = useCallback((event: DragEvent) => {
    if (readOnly) return;
    const type = event.dataTransfer.getData(DRAG_MIME);
    if (type === '') return;
    event.preventDefault();
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    props.onDropType?.(type, { x: Math.round(point.x - 110), y: Math.round(point.y - 30) });
  }, [flow, props.onDropType, readOnly]);

  return (
    <div className="kf-canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={deleted => { if (!readOnly) props.onDeleteNodes?.(deleted.map(node => node.id)); }}
        onNodeClick={(_event, node) => props.onSelect?.(node.id)}
        onPaneClick={() => props.onSelect?.(undefined)}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.2}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        snapToGrid
        snapGrid={[10, 10]}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" className="kf-minimap" nodeClassName={node => `kf-mini-${(node.data as CardData)?.spec?.category ?? 'flow'}`} />
      </ReactFlow>
    </div>
  );
}
