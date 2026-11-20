// Geometry tests for obstacle-avoiding edge routing and AABB overlap resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeEdge, resolveOverlaps, roundedPolylinePath } from '../src/client/flow/routing.ts';

test('routeEdge: keeps a clean direct path when no intermediate card is in the way', () => {
  const rects = [
    { id: 'a', x: 0, y: 0, width: 224, height: 120 },
    { id: 'b', x: 320, y: 0, width: 224, height: 120 },
  ];
  const res = routeEdge({ sourceId: 'a', targetId: 'b', sourceX: 224, sourceY: 60, targetX: 320, targetY: 60, rects });
  assert.equal(res.detoured, false);
  assert.match(res.path, /^M /);
});

test('routeEdge: detours around an intermediate card blocking a cross-column edge', () => {
  const rects = [
    { id: 'a', x: 0, y: 0, width: 224, height: 120 },
    { id: 'mid', x: 320, y: 0, width: 224, height: 120 },
    { id: 'b', x: 640, y: 0, width: 224, height: 120 },
  ];
  const res = routeEdge({ sourceId: 'a', targetId: 'b', sourceX: 224, sourceY: 60, targetX: 640, targetY: 60, rects });
  assert.equal(res.detoured, true);
  // Every horizontal corridor segment must clear `mid` (y in [0, 120]).
  const corridor = res.points.find((p, i) => i > 0 && i < res.points.length - 1 && (p.y < 0 || p.y > 120));
  assert.ok(corridor, 'corridor routed outside the blocking card');
});

test('routeEdge: routes back-edges around the outside of cards rather than cutting through them', () => {
  const rects = [
    { id: 'a', x: 0, y: 0, width: 224, height: 120 },
    { id: 'b', x: 320, y: 0, width: 224, height: 120 },
  ];
  const res = routeEdge({ sourceId: 'b', targetId: 'a', sourceX: 544, sourceY: 60, targetX: 0, targetY: 60, rects });
  assert.equal(res.detoured, true);
  assert.ok(res.points.some(p => p.y > 130 || p.y < -10), 'return leg clears both cards');
});

test('resolveOverlaps: pushes overlapping cards apart while keeping the dropped card pinned', () => {
  const rects = [
    { id: 'dropped', x: 100, y: 100, width: 224, height: 140 },
    { id: 'other', x: 120, y: 120, width: 224, height: 140 },
  ];
  const moves = resolveOverlaps(rects, ['dropped'], 24);
  assert.equal(moves.dropped, undefined, 'pinned dropped card stays put');
  assert.ok(moves.other, 'overlapping neighbor was pushed away');
  const a = rects[0];
  const b = { ...rects[1], ...moves.other };
  const sepX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
  const sepY = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
  assert.ok(sepX >= 20 || sepY >= 20, `cards separated cleanly (sepX=${sepX}, sepY=${sepY})`);
});

test('roundedPolylinePath produces valid SVG path commands', () => {
  const d = roundedPolylinePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }]);
  assert.match(d, /^M 0\.0 0\.0 L 90\.0 0\.0 Q 100\.0 0\.0 100\.0 10\.0/);
});
