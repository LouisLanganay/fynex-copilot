import fs from "node:fs";

/** Load .env.local / .env for CLI scripts (Next.js does it for the app). Never prints values. */
for (const f of [".env.local", ".env"]) {
  if (fs.existsSync(f)) process.loadEnvFile(f);
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function option(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}
