/**
 * Turning a node's action config into Linkr HID events.
 *
 * Coordinates are frame-normalized and go through the device's view mapping, so
 * a click lands on the same pixel a human click would. A `sequence` carries raw
 * events captured in target space and is never remapped.
 */
import { clickEvents, keyChord, keyTap, validateEvent } from '../linkr.js';
import { frameToTarget } from '../view.js';
function buttonMask(button) {
    return button === 'right' ? 2 : button === 'middle' ? 4 : 1;
}
/**
 * Time for the target to finish typing `length` characters of a Linkr `text`
 * event. Linkr accepts the event at once and types it afterwards; a 47-character
 * command measured on a Windows target needed about 3 s.
 */
export function typingSettleMs(length) {
    return Math.min(30_000, 400 + Math.max(0, length) * 60);
}
/** Coerce a rendered value to a number, or report why it is not one. */
function num(value, label) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    throw new Error(`${label} must resolve to a number, got ${JSON.stringify(value)}`);
}
/**
 * Build the HID events for one action.
 * @param action - normalized action with any templates already rendered.
 * @param mapping - the device's frame-to-target mapping, when the frame is letterboxed.
 * @returns events to send in one batch.
 */
export function actionEvents(action, mapping) {
    // Recorded coordinates are already in the target's space; only frame points
    // measured on a captured image go through the view mapping.
    const space = action.space === 'target' ? 'target' : 'frame';
    const point = (x, y) => space === 'target'
        ? frameToTarget(undefined, num(x, 'x'), num(y, 'y'))
        : frameToTarget(mapping, num(x, 'x'), num(y, 'y'));
    switch (action.type) {
        case 'key': {
            const events = [];
            const repeat = Math.max(1, action.repeat ?? 1);
            for (let index = 0; index < repeat; index += 1) {
                events.push(...keyTap(action.key, action.holdMs));
                if (index < repeat - 1)
                    events.push(['delay', Math.max(0, action.intervalMs ?? 120)]);
            }
            return events;
        }
        case 'shortcut':
            return keyChord(action.keys, action.holdMs);
        case 'text': {
            const text = String(action.text ?? '');
            const chunks = [];
            const size = Math.max(1, action.chunkSize ?? 120);
            for (let index = 0; index < text.length; index += size)
                chunks.push(text.slice(index, index + size));
            const events = [];
            for (const chunk of chunks) {
                events.push(['text', chunk]);
                events.push(['delay', typingSettleMs(chunk.length)]);
            }
            // Linkr types a `text` event key by key, so Enter must wait for the whole
            // string or a long command submits only its first word.
            if (action.submit === true) {
                events.push(['delay', typingSettleMs(text.length)]);
                events.push(...keyTap('Enter'));
            }
            return events;
        }
        case 'click': {
            const target = point(action.x, action.y);
            return clickEvents(target.x, target.y, buttonMask(action.button), Math.max(1, action.count ?? 1));
        }
        case 'move': {
            const target = point(action.x, action.y);
            return [['mouse_abs', 0, target.x, target.y, 0, 0]];
        }
        case 'scroll': {
            const target = point(action.x ?? 0.5, action.y ?? 0.5);
            return [['mouse_abs', 0, target.x, target.y, action.wheelY, action.wheelX ?? 0]];
        }
        case 'delay':
            return [];
        case 'sequence':
            return action.events.map((event, index) => validateEvent(event, index));
        default:
            throw new Error(`unsupported action ${JSON.stringify(action.type)}`);
    }
}
/** One-line description of an action for the run log. */
export function describeAction(action) {
    switch (action.type) {
        case 'key':
            return `key ${action.key}${(action.repeat ?? 1) > 1 ? ` x${action.repeat}` : ''}`;
        case 'shortcut':
            return `shortcut ${action.keys.join('+')}`;
        case 'text':
            return `text ${JSON.stringify(String(action.text ?? '').slice(0, 60))}`;
        case 'click':
            return `click ${action.button ?? 'left'} (${String(action.x)}, ${String(action.y)})${action.space === 'target' ? ' target' : ''}`;
        case 'move':
            return `move (${String(action.x)}, ${String(action.y)})`;
        case 'scroll':
            return `scroll ${action.wheelY}`;
        case 'delay':
            return `delay ${String(action.ms)}ms`;
        case 'sequence':
            return `sequence ${action.events.length} events`;
        default:
            return 'action';
    }
}
/** Events that release every modifier key and mouse button. */
export function releaseAllEvents() {
    const keys = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];
    const events = keys.map(key => ['keyboard', key, false]);
    // A relative move of zero with no button held releases the mouse buttons
    // without moving the pointer.
    events.push(['mouse_rel', 0, 0, 0, 0, 0]);
    return events;
}
