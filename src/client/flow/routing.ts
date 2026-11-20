/**
 * Obstacle-avoiding orthogonal edge routing and AABB overlap resolution for
 * the KVMFlow React Flow canvas.
 *
 * Pure geometry so both the canvas and unit tests can run it without a DOM.
 */
import type { Point } from './types';

export interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RouteInput {
  sourceId: string;
  targetId: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  rects: readonly Rect[];
  /** Parallel-edge lane index (0, 1, 2, …) to separate edges sharing a corridor. */
  lane?: number;
}

export interface RouteResult {
  path: string;
  labelX: number;
  labelY: number;
  points: Point[];
  detoured: boolean;
}

const NODE_WIDTH = 224;
const STUB = 24;
const CLEARANCE = 18;
const LANE_STEP = 14;
const CORNER_RADIUS = 10;

/** Estimate a card's rendered size before React Flow measures it. */
export function estimateNodeSize(portCount: number, hasSummary: boolean): { width: number; height: number } {
  const height = 74 + (hasSummary ? 34 : 0) + Math.max(0, portCount) * 20;
  return { width: NODE_WIDTH, height };
}

function inflate(rect: Rect, pad: number): Rect {
  return {
    id: rect.id,
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

/** True when an axis-aligned segment intersects a rectangle. */
function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX <= rect.x || minX >= rect.x + rect.width) return false;
  if (maxY <= rect.y || minY >= rect.y + rect.height) return false;
  return true;
}

function polylineHitsAny(points: readonly Point[], obstacles: readonly Rect[]): boolean {
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    for (const rect of obstacles) {
      if (segmentHitsRect(a, b, rect)) return true;
    }
  }
  return false;
}

function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return total;
}

/** Remove redundant collinear or duplicate vertices. */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev !== undefined && Math.abs(prev.x - point.x) < 0.5 && Math.abs(prev.y - point.y) < 0.5) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const sameX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - point.x) < 0.5;
      const sameY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - point.y) < 0.5;
      if (sameX || sameY) {
        out[out.length - 1] = point;
        continue;
      }
    }
    out.push(point);
  }
  return out;
}

/** Turn an orthogonal polyline into an SVG path with rounded corners. */
export function roundedPolylinePath(raw: readonly Point[], radius = CORNER_RADIUS): string {
  const points = simplify(raw);
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const parts: string[] = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const len1 = Math.hypot(d1x, d1y);
    const len2 = Math.hypot(d2x, d2y);
    const r = Math.min(radius, len1 / 2, len2 / 2);
    if (r < 0.5) {
      parts.push(`L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`);
      continue;
    }
    const p1x = curr.x - (d1x / len1) * r;
    const p1y = curr.y - (d1y / len1) * r;
    const p2x = curr.x + (d2x / len2) * r;
    const p2y = curr.y + (d2y / len2) * r;
    parts.push(`L ${p1x.toFixed(1)} ${p1y.toFixed(1)}`);
    parts.push(`Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${p2x.toFixed(1)} ${p2y.toFixed(1)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`);
  return parts.join(' ');
}

/** Pick a clean label anchor on the longest horizontal segment (or overall midpoint). */
function labelPoint(points: readonly Point[]): { x: number; y: number } {
  let best = { len: -1, x: (points[0].x + points[points.length - 1].x) / 2, y: (points[0].y + points[points.length - 1].y) / 2 };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a.y - b.y) < 0.5) {
      const len = Math.abs(b.x - a.x);
      // Skip the very short stub segments right at the handles when a longer corridor exists.
      const weight = (i === 0 || i === points.length - 2) ? len * 0.6 : len;
      if (weight > best.len) best = { len: weight, x: (a.x + b.x) / 2, y: a.y };
    }
  }
  return { x: best.x, y: best.y };
}

/**
 * Route an orthogonal edge from `(sourceX, sourceY)` to `(targetX, targetY)`
 * while steering around node bounding boxes.
 */
export function routeEdge(input: RouteInput): RouteResult {
  const { sourceId, targetId, sourceX, sourceY, targetX, targetY, rects } = input;
  const lane = input.lane ?? 0;
  const laneShift = (lane % 2 === 0 ? 1 : -1) * Math.ceil(lane / 2) * LANE_STEP;
  const corridorShift = lane * LANE_STEP;

  const sx = sourceX + STUB;
  const tx = targetX - STUB;
  const isBackEdge = sourceId === targetId || sx > tx;

  const others = rects
    .filter(rect => rect.id !== sourceId && rect.id !== targetId)
    .map(rect => inflate(rect, CLEARANCE));

  if (!isBackEdge) {
    const midX = Math.max(sx, Math.min(tx, (sx + tx) / 2 + laneShift));
    const direct = simplify([
      { x: sourceX, y: sourceY },
      { x: midX, y: sourceY },
      { x: midX, y: targetY },
      { x: targetX, y: targetY },
    ]);
    if (!polylineHitsAny(direct, others)) {
      const label = labelPoint(direct);
      return { path: roundedPolylinePath(direct), labelX: label.x, labelY: label.y, points: direct, detoured: false };
    }

    // Direct path hits an intermediate node: detour above or below all nodes in the horizontal span.
    const spanMinX = Math.min(sx, tx);
    const spanMaxX = Math.max(sx, tx);
    const spanObstacles = others.filter(rect => rect.x + rect.width > spanMinX && rect.x < spanMaxX);
    const topY = Math.min(...spanObstacles.map(rect => rect.y), Math.min(sourceY, targetY) - CLEARANCE) - corridorShift;
    const bottomY = Math.max(...spanObstacles.map(rect => rect.y + rect.height), Math.max(sourceY, targetY) + CLEARANCE) + corridorShift;

    const above = simplify([
      { x: sourceX, y: sourceY },
      { x: sx, y: sourceY },
      { x: sx, y: topY },
      { x: tx, y: topY },
      { x: tx, y: targetY },
      { x: targetX, y: targetY },
    ]);
    const below = simplify([
      { x: sourceX, y: sourceY },
      { x: sx, y: sourceY },
      { x: sx, y: bottomY },
      { x: tx, y: bottomY },
      { x: tx, y: targetY },
      { x: targetX, y: targetY },
    ]);
    const chosen = polylineLength(above) <= polylineLength(below) ? above : below;
    const label = labelPoint(chosen);
    return { path: roundedPolylinePath(chosen), labelX: label.x, labelY: label.y, points: chosen, detoured: true };
  }

  // Back edge or self-loop: include source and target boxes so the return path
  // wraps cleanly around the outside instead of cutting across the cards.
  const allInflated = rects.map(rect => inflate(rect, CLEARANCE + 4));
  const spanMinX = Math.min(tx, sx);
  const spanMaxX = Math.max(tx, sx);
  const spanBoxes = allInflated.filter(rect => rect.x + rect.width > spanMinX && rect.x < spanMaxX);
  const topY = (spanBoxes.length > 0 ? Math.min(...spanBoxes.map(rect => rect.y)) : Math.min(sourceY, targetY) - 60) - corridorShift;
  const bottomY = (spanBoxes.length > 0 ? Math.max(...spanBoxes.map(rect => rect.y + rect.height)) : Math.max(sourceY, targetY) + 60) + corridorShift;
  const outX = Math.max(sx, sourceX + STUB + corridorShift);
  const inX = Math.min(tx, targetX - STUB - corridorShift);

  const above = simplify([
    { x: sourceX, y: sourceY },
    { x: outX, y: sourceY },
    { x: outX, y: topY },
    { x: inX, y: topY },
    { x: inX, y: targetY },
    { x: targetX, y: targetY },
  ]);
  const below = simplify([
    { x: sourceX, y: sourceY },
    { x: outX, y: sourceY },
    { x: outX, y: bottomY },
    { x: inX, y: bottomY },
    { x: inX, y: targetY },
    { x: targetX, y: targetY },
  ]);
  // Slightly prefer routing back edges underneath unless the upper route is notably shorter.
  const chosen = polylineLength(above) + 24 < polylineLength(below) ? above : below;
  const label = labelPoint(chosen);
  return { path: roundedPolylinePath(chosen), labelX: label.x, labelY: label.y, points: chosen, detoured: true };
}

/**
 * Push overlapping node boxes apart while keeping `pinnedIds` (the node the
 * user just dropped) fixed when possible. Returns updated positions for any
 * node that moved, snapped to a 10px grid.
 */
export function resolveOverlaps(
  rects: readonly Rect[],
  pinnedIds: readonly string[] = [],
  gap = 24,
): Record<string, Point> {
  const pinned = new Set(pinnedIds);
  const boxes = rects.map(rect => ({ ...rect }));
  const moved = new Set<string>();

  for (let pass = 0; pass < 16; pass += 1) {
    let any = false;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlapX = Math.min(a.x + a.width + gap, b.x + b.width + gap) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height + gap, b.y + b.height + gap) - Math.max(a.y, b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;

        any = true;
        const aCenterX = a.x + a.width / 2;
        const bCenterX = b.x + b.width / 2;
        const aCenterY = a.y + a.height / 2;
        const bCenterY = b.y + b.height / 2;

        // Prefer pushing vertically if the horizontal overlap is large (same column).
        const pushVert = overlapY <= overlapX * 1.15;
        const dx = pushVert ? 0 : (bCenterX >= aCenterX ? overlapX : -overlapX);
        const dy = pushVert ? (bCenterY >= aCenterY ? overlapY : -overlapY) : 0;

        const aPinned = pinned.has(a.id);
        const bPinned = pinned.has(b.id);
        if (aPinned && !bPinned) {
          b.x += dx;
          b.y += dy;
          moved.add(b.id);
        } else if (bPinned && !aPinned) {
          a.x -= dx;
          a.y -= dy;
          moved.add(a.id);
        } else {
          a.x -= dx / 2;
          a.y -= dy / 2;
          b.x += dx / 2;
          b.y += dy / 2;
          moved.add(a.id);
          moved.add(b.id);
        }
      }
    }
    if (!any) break;
  }

  const out: Record<string, Point> = {};
  for (const box of boxes) {
    if (!moved.has(box.id)) continue;
    out[box.id] = { x: Math.round(box.x / 10) * 10, y: Math.round(box.y / 10) * 10 };
  }
  return out;
}
