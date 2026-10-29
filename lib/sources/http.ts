/**
 * Polite HTTP for public data sources.
 * - SEC: declared User-Agent (SEC_USER_AGENT), token bucket at 5 req/s (half the SEC cap of 10).
 * - AMF, filings.xbrl.org, GLEIF, OpenFIGI: at most 2 req/s per host.
 * Retries 429 and 5xx with exponential backoff and jitter, honours Retry-After.
 */

export const DEFAULT_SEC_USER_AGENT = "fynex-copilot (contact@fynexapp.com)";
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export function secUserAgent(): string {
  return process.env.SEC_USER_AGENT?.trim() || DEFAULT_SEC_USER_AGENT;
}

class Throttle {
  private next = 0;
  constructor(private intervalMs: number) {}
  async wait() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

const throttles = new Map<string, Throttle>();
function throttleFor(host: string): Throttle {
  let t = throttles.get(host);
  if (!t) {
    const perSecond = /(^|\.)sec\.gov$/.test(host) ? 5 : 2;
    t = new Throttle(1000 / perSecond);
    throttles.set(host, t);
  }
  return t;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface PoliteFetchOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export async function politeFetch(url: string, o: PoliteFetchOptions = {}): Promise<Response> {
  const u = new URL(url);
  const headers: Record<string, string> = { "User-Agent": secUserAgent(), ...o.headers };
  if (/(^|\.)sec\.gov$/.test(u.hostname)) headers["Accept-Encoding"] = "gzip, deflate";
  const f = o.fetchImpl ?? fetch;
  const retries = o.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    await throttleFor(u.hostname).wait();
    let res: Response | null = null;
    try {
      res = await f(url, { method: o.method ?? "GET", body: o.body, headers, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      if (attempt >= retries) throw e;
    }
    if (res && res.ok) return res;
    if (res && res.status !== 429 && res.status < 500) throw new HttpError(res.status, url);
    if (attempt >= retries) throw new HttpError(res?.status ?? 0, url);
    const retryAfter = Number(res?.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.random() * 300;
    await new Promise((r) => setTimeout(r, Math.min(backoff, 10_000)));
  }
}

export async function fetchJson<T>(url: string, o?: PoliteFetchOptions): Promise<T> {
  const res = await politeFetch(url, o);
  return (await res.json()) as T;
}

export async function fetchText(url: string, o?: PoliteFetchOptions): Promise<string> {
  const buf = await fetchBytes(url, o);
  return new TextDecoder("utf-8").decode(buf);
}

export async function fetchBytes(url: string, o?: PoliteFetchOptions): Promise<Uint8Array> {
  const res = await politeFetch(url, o);
  const len = Number(res.headers.get("content-length"));
  if (len > MAX_DOCUMENT_BYTES) throw new Error(`Document larger than 15 MB: ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_DOCUMENT_BYTES) throw new Error(`Document larger than 15 MB: ${url}`);
  return buf;
}
