/**
 * The Linkr web session: password login, session token, and the WHEP signaling
 * exchange that turns on real-time video.
 *
 * Two credentials exist on a Linkr:
 * - the API access token (`Authorization: token …`), which only reaches
 *   `/api/public/*` — snapshots and HID control;
 * - the web session (`Authorization: Bearer …`), obtained by logging in, which
 *   reaches the whole `/api/*` surface including `/api/rtc/whep`.
 *
 * The device answers WHEP with a `sendonly` H.264 answer whose candidate is the
 * device's own LAN address, so a browser on the same network receives the media
 * peer to peer. Only the JSON signaling crosses HTTP, and the device sends no
 * CORS headers, which is why the Host relays it.
 */
import { createHash } from 'node:crypto';
import { LinkrError } from './linkr.js';

/** Hidden salt the Linkr web client prepends before hashing the password. */
const PASSWORD_SALT = 'RADXA_FIXED_SALT_v1';

/** Hash a web password the way the device's own client does. */
export function hashWebPassword(password: string): string {
  return createHash('sha256').update(`${PASSWORD_SALT}${password}`).digest('hex');
}

export interface WebSession {
  token: string;
  obtainedAt: number;
  requireTwoFactor: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One device's web session, with lazy login and one silent re-login per call. */
export class LinkrWebSession {
  readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private session: WebSession | undefined;
  private pending: Promise<WebSession> | undefined;

  constructor(baseUrl: string, username: string, password: string) {
    this.baseUrl = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    this.username = String(username ?? '').trim();
    this.password = String(password ?? '');
  }

  /** Whether enough configuration exists to attempt a login. */
  hasCredentials(): boolean {
    return this.username !== '' && this.password !== '';
  }

  /** Drop the cached token so the next call logs in again. */
  invalidate(): void {
    this.session = undefined;
  }

  /**
   * Log in and cache the bearer token.
   * @returns the active session.
   */
  async login(): Promise<WebSession> {
    if (!this.hasCredentials()) {
      throw new LinkrError('WEB_LOGIN_REQUIRED', 'no Linkr web username/password is configured for this device');
    }
    const response = await fetch(`${this.baseUrl}/api/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, passwd: hashWebPassword(this.password) }),
      signal: AbortSignal.timeout(15000),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LinkrError('WEB_LOGIN_FAILED', `Linkr login returned HTTP ${response.status}`, response.status);
    }
    if (!isRecord(body)) {
      throw new LinkrError('WEB_LOGIN_FAILED', 'Linkr login returned an unexpected body', response.status, body);
    }
    const message = typeof body.message === 'string' ? body.message : '';
    if (body.code !== 0) {
      if (/password incorrect/i.test(message)) {
        throw new LinkrError('WEB_LOGIN_REJECTED', 'Linkr rejected the web username or password', response.status, body);
      }
      throw new LinkrError('WEB_LOGIN_FAILED', `Linkr login failed: ${message || `code ${String(body.code)}`}`, response.status, body);
    }
    const data = isRecord(body.data) ? body.data : {};
    const token = typeof data.token === 'string' ? data.token : '';
    const requireTwoFactor = data.require_two_factor === true;
    if (token === '') {
      throw new LinkrError(
        requireTwoFactor ? 'WEB_TWO_FACTOR_REQUIRED' : 'WEB_LOGIN_FAILED',
        requireTwoFactor
          ? 'this Linkr account requires two-factor login, which KVMFlow cannot complete'
          : 'Linkr login succeeded without a session token',
        response.status,
        body,
      );
    }
    this.session = { token, obtainedAt: Date.now(), requireTwoFactor };
    return this.session;
  }

  /** Reuse the cached token, or log in once for concurrent callers. */
  private async ensure(): Promise<WebSession> {
    if (this.session !== undefined) return this.session;
    if (this.pending === undefined) {
      this.pending = this.login().finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const session = await this.ensure();
    const call = (token: string): Promise<Response> => fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined ?? {}),
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(20000),
    });
    let response = await call(session.token);
    if (response.status === 401 || response.status === 403) {
      // The web token expired: one silent re-login, then report the failure.
      this.invalidate();
      const renewed = await this.ensure();
      response = await call(renewed.token);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LinkrError('WEB_BAD_RESPONSE', `Linkr ${path} returned HTTP ${response.status} without JSON`, response.status);
    }
    if (!isRecord(body) || body.code !== 0) {
      const message = isRecord(body) && typeof body.message === 'string' ? body.message : `HTTP ${response.status}`;
      throw new LinkrError('WEB_REQUEST_FAILED', `Linkr ${path} failed: ${message}`, response.status, body);
    }
    return body.data;
  }

  /**
   * Exchange one SDP offer for the device's answer.
   * @param offer - local description SDP from the browser.
   * @returns the answer SDP and the device-side stream id.
   */
  async whep(offer: string): Promise<{ answer: string; streamId?: string }> {
    const data = await this.request('/api/rtc/whep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer }),
    });
    const answer = isRecord(data) && typeof data.answer === 'string' ? data.answer : '';
    if (answer === '') {
      throw new LinkrError('WEB_WHEP_FAILED', 'Linkr returned no SDP answer', undefined, data);
    }
    return {
      answer,
      ...(isRecord(data) && typeof data.stream_id === 'number' ? { streamId: String(data.stream_id) } : {}),
    };
  }

  /** Read the negotiated codec and bitrate mode for display. */
  async videoInfo(): Promise<{ codecMode?: number; bitrateMode?: number }> {
    const result: { codecMode?: number; bitrateMode?: number } = {};
    const [codec, quality] = await Promise.all([
      this.request('/api/video/codec', { method: 'GET' }).catch(() => undefined),
      this.request('/api/video/quality', { method: 'GET' }).catch(() => undefined),
    ]);
    if (isRecord(codec) && typeof codec.video_codec === 'number') result.codecMode = codec.video_codec;
    if (isRecord(quality) && typeof quality.bitrate_mode === 'number') result.bitrateMode = quality.bitrate_mode;
    return result;
  }
}
