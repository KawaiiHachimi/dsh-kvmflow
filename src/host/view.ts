/**
 * Frame geometry: the visible target area inside a captured KVM frame.
 *
 * A captured frame is not always the target's screen. An IP-KVM keeps the
 * capture at its negotiated timings, so a target that outputs 4:3 (or 5:4, or a
 * resolution below the negotiated mode) arrives letterboxed or pillarboxed:
 * the pixels of the target's desktop occupy a sub-rectangle of the JPEG, and
 * the rest is black.
 *
 * KVMFlow's human UI and its agent tools both describe a position as a
 * normalized point on the image the user or model *sees*. USB HID absolute
 * coordinates, however, span the target's own screen. When the frame contains
 * bars those two spaces differ, and a point measured on the image lands
 * off-target. A `ViewMapping` records the target's rectangle inside the frame so
 * one conversion covers every caller.
 */

export interface ViewMapping {
  /** Left edge of the target area, frame-normalized. */
  left: number;
  /** Top edge of the target area, frame-normalized. */
  top: number;
  /** Right edge of the target area, frame-normalized. */
  right: number;
  /** Bottom edge of the target area, frame-normalized. */
  bottom: number;
}

/** The mapping that means "the frame is the target's screen". */
export const FULL_FRAME: ViewMapping = { left: 0, top: 0, right: 1, bottom: 1 };

/** Smallest accepted content extent on either axis. */
const MIN_EXTENT = 0.2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Validate a frame mapping, ignoring a mapping that covers the whole frame.
 * @param input - candidate from configuration, RPC, or detection.
 * @returns a normalized mapping, or undefined when the frame is the screen.
 */
export function normalizeViewMapping(input: unknown): ViewMapping | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input)) return undefined;
  const left = finite(input.left);
  const top = finite(input.top);
  const right = finite(input.right);
  const bottom = finite(input.bottom);
  if (left === undefined || top === undefined || right === undefined || bottom === undefined) return undefined;
  if (left < 0 || top < 0 || right > 1 || bottom > 1) return undefined;
  if (right - left < MIN_EXTENT || bottom - top < MIN_EXTENT) return undefined;
  if (left === 0 && top === 0 && right === 1 && bottom === 1) return undefined;
  return { left, top, right, bottom };
}

/** Whether a mapping leaves the frame unchanged. */
export function isFullFrame(mapping: ViewMapping | undefined): boolean {
  return mapping === undefined
    || (mapping.left === 0 && mapping.top === 0 && mapping.right === 1 && mapping.bottom === 1);
}

/** Pixel extent of the target area at one frame size. */
export function mappingExtent(mapping: ViewMapping | undefined, width: number, height: number): { width: number; height: number } {
  if (isFullFrame(mapping)) return { width, height };
  const resolved = mapping as ViewMapping;
  return {
    width: Math.max(1, Math.round((resolved.right - resolved.left) * width)),
    height: Math.max(1, Math.round((resolved.bottom - resolved.top) * height)),
  };
}

/**
 * Convert a point measured on the displayed frame into USB HID absolute space.
 * @param mapping - target area inside the frame.
 * @param x - frame-normalized X.
 * @param y - frame-normalized Y.
 * @returns target-normalized coordinates, clamped to [0, 1].
 */
export function frameToTarget(mapping: ViewMapping | undefined, x: number, y: number): { x: number; y: number } {
  if (isFullFrame(mapping)) return { x: clamp01(x), y: clamp01(y) };
  const resolved = mapping as ViewMapping;
  const spanX = Math.max(1e-6, resolved.right - resolved.left);
  const spanY = Math.max(1e-6, resolved.bottom - resolved.top);
  return {
    x: clamp01((x - resolved.left) / spanX),
    y: clamp01((y - resolved.top) / spanY),
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
