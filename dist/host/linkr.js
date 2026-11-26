/** Radxa Linkr public HTTP API driver: JPEG snapshots and USB HID event batches. */
export class LinkrError extends Error {
    code;
    status;
    detail;
    constructor(code, message, status, detail) {
        super(message);
        this.name = 'LinkrError';
        this.code = code;
        this.status = status;
        this.detail = detail;
    }
}
const KEY_ALIASES = {
    ctrl: 'ControlLeft',
    control: 'ControlLeft',
    shift: 'ShiftLeft',
    alt: 'AltLeft',
    option: 'AltLeft',
    meta: 'MetaLeft',
    win: 'MetaLeft',
    windows: 'MetaLeft',
    cmd: 'MetaLeft',
    command: 'MetaLeft',
    esc: 'Escape',
    escape: 'Escape',
    del: 'Delete',
    delete: 'Delete',
    return: 'Enter',
    enter: 'Enter',
    space: 'Space',
    spacebar: 'Space',
    tab: 'Tab',
    backspace: 'Backspace',
    capslock: 'CapsLock',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    home: 'Home',
    end: 'End',
    insert: 'Insert',
    printscreen: 'PrintScreen',
    pause: 'Pause',
};
/**
 * Normalize a human key name to a `KeyboardEvent.code` value.
 * @param key - code, single character, or common alias.
 * @returns the Linkr key code.
 */
export function normalizeKey(key) {
    const text = String(key).trim();
    if (text === '')
        throw new LinkrError('INVALID_KEY', 'key must not be empty');
    const lower = text.toLowerCase();
    if (KEY_ALIASES[lower] !== undefined)
        return KEY_ALIASES[lower];
    if (/^[a-zA-Z]$/.test(text))
        return `Key${text.toUpperCase()}`;
    if (/^[0-9]$/.test(text))
        return `Digit${text}`;
    if (/^f(?:[1-9]|1[0-2])$/i.test(text))
        return text.toUpperCase();
    if (/^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1[0-2]))$/.test(text))
        return text;
    if (/^(?:Control|Shift|Alt|Meta)(?:Left|Right)$/.test(text))
        return text;
    return text;
}
/**
 * Parse a keyboard shortcut such as `Ctrl+Alt+Delete`.
 * @param shortcut - shortcut text.
 * @returns one key code per modifier/key.
 */
export function parseShortcut(shortcut) {
    return shortcut.split('+').map(part => normalizeKey(part.trim())).filter(part => part !== '');
}
/** Build a tap (press + release) event pair. */
export function keyTap(key, holdMs = 60) {
    return [
        ['keyboard', normalizeKey(key), true],
        ['delay', Math.max(1, Math.round(holdMs))],
        ['keyboard', normalizeKey(key), false],
    ];
}
/** Build a chord: modifiers down, key down, delay, reverse release. */
export function keyChord(keys, holdMs = 80) {
    const codes = keys.map(normalizeKey);
    if (codes.length === 0)
        throw new LinkrError('INVALID_KEY', 'shortcut must contain at least one key');
    const events = codes.map(code => ['keyboard', code, true]);
    events.push(['delay', Math.max(1, Math.round(holdMs))]);
    for (const code of [...codes].reverse())
        events.push(['keyboard', code, false]);
    return events;
}
export function clickEvents(x, y, button = 1, count = 1) {
    const clampX = Math.min(1, Math.max(0, x));
    const clampY = Math.min(1, Math.max(0, y));
    // Hover briefly before pressing: some UIs (macOS Setup Assistant among them)
    // ignore a press that arrives in the same instant the pointer lands.
    const events = [['mouse_abs', 0, clampX, clampY, 0, 0], ['delay', 60]];
    for (let index = 0; index < count; index += 1) {
        events.push(['mouse_abs', button, clampX, clampY, 0, 0]);
        events.push(['delay', 60]);
        events.push(['mouse_abs', 0, clampX, clampY, 0, 0]);
        if (index < count - 1)
            events.push(['delay', 80]);
    }
    return events;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Validate one Linkr event array; the public API accepts exactly these shapes. */
export function validateEvent(event, index = 0) {
    if (!Array.isArray(event) || event.length === 0) {
        throw new LinkrError('INVALID_EVENT', `events[${index}] must be a non-empty array`);
    }
    const type = event[0];
    if (type === 'keyboard') {
        if (event.length !== 3 || typeof event[1] !== 'string' || event[1] === '' || typeof event[2] !== 'boolean') {
            throw new LinkrError('INVALID_EVENT', `events[${index}] keyboard must be ["keyboard", keyCode, isPressed]`);
        }
        return ['keyboard', normalizeKey(event[1]), event[2]];
    }
    if (type === 'mouse_abs' || type === 'mouse_rel') {
        if (event.length !== 6) {
            throw new LinkrError('INVALID_EVENT', `events[${index}] ${type} must be [${type}, button, x, y, wheelY, wheelX]`);
        }
        const [button, x, y, wheelY, wheelX] = event.slice(1);
        if (!Number.isInteger(button) || button < 0 || button > 7) {
            throw new LinkrError('INVALID_EVENT', `events[${index}] button must be an integer from 0 to 7`);
        }
        for (const value of [x, y, wheelY, wheelX]) {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                throw new LinkrError('INVALID_EVENT', `events[${index}] coordinates must be finite numbers`);
            }
        }
        if (type === 'mouse_abs' && (x < 0 || x > 1 || y < 0 || y > 1)) {
            throw new LinkrError('INVALID_EVENT', `events[${index}] absolute x/y must be between 0 and 1`);
        }
        if (wheelY < -20 || wheelY > 20 || wheelX < -20 || wheelX > 20) {
            throw new LinkrError('INVALID_EVENT', `events[${index}] wheel values must be between -20 and 20`);
        }
        return [type, button, x, y, wheelY, wheelX];
    }
    if (type === 'text') {
        if (event.length !== 2 || typeof event[1] !== 'string') {
            throw new LinkrError('INVALID_EVENT', `events[${index}] text must be ["text", value]`);
        }
        if (event[1].length > 1024)
            throw new LinkrError('INVALID_EVENT', `events[${index}] text exceeds 1024 characters`);
        for (const char of event[1]) {
            const code = char.codePointAt(0) ?? 0;
            if (code !== 9 && code !== 10 && (code < 32 || code > 126)) {
                throw new LinkrError('INVALID_EVENT', `events[${index}] text only supports printable ASCII, Tab, and Enter`);
            }
        }
        return ['text', event[1]];
    }
    if (type === 'delay') {
        if (event.length !== 2 || typeof event[1] !== 'number' || !Number.isFinite(event[1]) || event[1] < 0) {
            throw new LinkrError('INVALID_EVENT', `events[${index}] delay must be ["delay", milliseconds]`);
        }
        return ['delay', event[1]];
    }
    throw new LinkrError('INVALID_EVENT', `events[${index}] has unsupported type ${JSON.stringify(type)}`);
}
/**
 * One Linkr device connection. Requests are serialized and spaced to stay
 * below the device's public API rate limit.
 */
export class LinkrClient {
    baseUrl;
    token;
    minIntervalMs;
    timeoutMs;
    tail = Promise.resolve();
    lastRequestAt = 0;
    constructor(baseUrl, token, options = {}) {
        const trimmed = String(baseUrl ?? '').trim().replace(/\/+$/, '');
        if (trimmed === '')
            throw new LinkrError('INVALID_DEVICE', 'baseUrl must not be empty');
        this.baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
        this.token = String(token ?? '').trim();
        this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 230);
        this.timeoutMs = Math.max(1000, options.timeoutMs ?? 15000);
    }
    async schedule(operation) {
        let release = () => { };
        const previous = this.tail;
        this.tail = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            const wait = Math.max(0, this.lastRequestAt + this.minIntervalMs - Date.now());
            if (wait > 0)
                await new Promise(resolve => setTimeout(resolve, wait));
            this.lastRequestAt = Date.now();
            return await operation();
        }
        finally {
            release();
        }
    }
    headers(extra = {}) {
        return {
            Authorization: `token ${this.token}`,
            ...extra,
        };
    }
    /**
     * Capture one JPEG frame.
     * @returns the JPEG bytes and capture time.
     */
    async snapshot() {
        return this.schedule(async () => {
            let response;
            try {
                response = await fetch(`${this.baseUrl}/api/public/snapshot`, {
                    method: 'GET',
                    headers: this.headers({ Accept: 'image/jpeg' }),
                    signal: AbortSignal.timeout(this.timeoutMs),
                });
            }
            catch (error) {
                throw new LinkrError('SNAPSHOT_NETWORK', `cannot reach Linkr at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
            }
            const buffer = new Uint8Array(await response.arrayBuffer());
            // Trust the JPEG signature: some Linkr builds label the frame as
            // application/octet-stream, and a JSON error body must not be read as an image.
            if (buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
                return { data: buffer, mediaType: 'image/jpeg', capturedAt: Date.now() };
            }
            let detail = undefined;
            let message = '';
            try {
                detail = JSON.parse(new TextDecoder().decode(buffer));
                if (isRecord(detail) && typeof detail.message === 'string')
                    message = detail.message;
            }
            catch {
                message = new TextDecoder().decode(buffer).slice(0, 300);
            }
            if (response.status === 403) {
                throw new LinkrError('SNAPSHOT_FORBIDDEN', `Linkr rejected the access token (HTTP 403)${message ? `: ${message}` : ''}`, response.status, detail);
            }
            if (response.status === 429) {
                throw new LinkrError('SNAPSHOT_RATE_LIMITED', 'Linkr rate limit reached; retry shortly', response.status, detail);
            }
            throw new LinkrError('SNAPSHOT_UNAVAILABLE', `Linkr returned no usable JPEG${message ? `: ${message}` : ` (HTTP ${response.status})`}`, response.status, detail);
        });
    }
    /**
     * Send one ordered Linkr event batch.
     * @param events - validated event arrays.
     */
    async control(events) {
        if (!Array.isArray(events) || events.length === 0) {
            throw new LinkrError('INVALID_EVENT', 'events must be a non-empty array');
        }
        const normalized = events.map((event, index) => validateEvent(event, index));
        await this.schedule(async () => {
            let response;
            try {
                response = await fetch(`${this.baseUrl}/api/public/control`, {
                    method: 'POST',
                    headers: this.headers({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ events: normalized }),
                    signal: AbortSignal.timeout(this.timeoutMs),
                });
            }
            catch (error) {
                throw new LinkrError('CONTROL_NETWORK', `cannot reach Linkr at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
            }
            const text = await response.text();
            let payload = undefined;
            try {
                payload = JSON.parse(text);
            }
            catch {
                // Fall through to a structured transport failure below.
            }
            if (isRecord(payload) && payload.code === 0)
                return;
            const message = isRecord(payload) && typeof payload.message === 'string' ? payload.message : text.slice(0, 300);
            throw new LinkrError('CONTROL_FAILED', `Linkr control failed: ${message || `HTTP ${response.status}`}`, response.status, payload);
        });
    }
    /** Connectivity diagnostics: reachability, token acceptance, and whether a frame is available. */
    async probe() {
        try {
            const snapshot = await this.snapshot();
            return { reachable: true, authenticated: true, video: true, status: 200, bytes: snapshot.data.length };
        }
        catch (error) {
            if (error instanceof LinkrError) {
                if (error.code === 'SNAPSHOT_FORBIDDEN') {
                    return { reachable: true, authenticated: false, video: false, status: error.status ?? 403, body: error.detail };
                }
                if (error.code === 'SNAPSHOT_RATE_LIMITED') {
                    return { reachable: true, authenticated: true, video: false, status: error.status ?? 429, body: error.detail };
                }
                if (error.code === 'SNAPSHOT_UNAVAILABLE') {
                    return { reachable: true, authenticated: true, video: false, status: error.status ?? 200, body: error.detail };
                }
                return { reachable: false, authenticated: false, video: false, error: error.message };
            }
            return { reachable: false, authenticated: false, video: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
}
