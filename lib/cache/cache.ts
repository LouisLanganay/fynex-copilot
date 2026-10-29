import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Tiny disk cache (PLAN.md 5.7). Locally under .cache/, on Vercel under /tmp.
 * Read order: committed fixtures first (fixtures/cache/<ns>/<key>.json), then
 * the runtime cache. Writes go to the runtime cache only.
 */

export function sha(s: string, len = 16): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, len);
}

export function cacheRoot(): string {
  if (process.env.CACHE_DIR) return process.env.CACHE_DIR;
  return process.env.VERCEL ? "/tmp/fynex-copilot/cache" : path.join(process.cwd(), ".cache");
}

export function fixturesRoot(): string {
  return process.env.FIXTURES_DIR ?? path.join(process.cwd(), "fixtures");
}

function file(root: string, ns: string, key: string) {
  return path.join(root, ns, `${key}.json`);
}

interface Envelope<T> {
  storedAt: string;
  value: T;
}

export function cacheGet<T>(ns: string, key: string, maxAgeMs?: number): { value: T; storedAt: string; fromFixture: boolean } | null {
  const candidates: [string, boolean][] = [
    [file(path.join(fixturesRoot(), "cache"), ns, key), true],
    [file(cacheRoot(), ns, key), false],
  ];
  for (const [f, fromFixture] of candidates) {
    if (!fs.existsSync(f)) continue;
    try {
      const env = JSON.parse(fs.readFileSync(f, "utf8")) as Envelope<T>;
      if (!fromFixture && maxAgeMs && Date.now() - Date.parse(env.storedAt) > maxAgeMs) continue;
      return { value: env.value, storedAt: env.storedAt, fromFixture };
    } catch {
      continue;
    }
  }
  return null;
}

export function cacheSet<T>(ns: string, key: string, value: T, root = cacheRoot()) {
  const f = file(root, ns, key);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const env: Envelope<T> = { storedAt: new Date().toISOString(), value };
  fs.writeFileSync(f, JSON.stringify(env));
}

/** Memoize an async producer through the cache. */
export async function cached<T>(ns: string, key: string, produce: () => Promise<T>, maxAgeMs?: number): Promise<T> {
  const hit = cacheGet<T>(ns, key, maxAgeMs);
  if (hit) return hit.value;
  const value = await produce();
  cacheSet(ns, key, value);
  return value;
}
