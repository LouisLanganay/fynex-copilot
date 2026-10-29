import "./env";
import { ledgerPath, readLedger, totalCap } from "@/lib/llm/budget";

/** Spend from the local ledger, by model and by purpose. */
const file = process.argv[2] ?? ledgerPath();
const rows = readLedger(file);
const total = rows.reduce((s, r) => s + r.usd, 0);
const by = (k: (r: (typeof rows)[number]) => string) => {
  const m = new Map<string, { calls: number; usd: number; tokens: number }>();
  for (const r of rows) {
    const e = m.get(k(r)) ?? { calls: 0, usd: 0, tokens: 0 };
    e.calls++;
    e.usd += r.usd;
    e.tokens += r.prompt_tokens + r.completion_tokens;
    m.set(k(r), e);
  }
  return [...m.entries()].sort((a, b) => b[1].usd - a[1].usd);
};
console.log(`Ledger: ${file}`);
console.log(`Calls: ${rows.length}, total $${total.toFixed(4)} (cap $${totalCap()})`);
console.log("\nBy model:");
for (const [k, v] of by((r) => r.model)) console.log(`  ${k.padEnd(32)} ${String(v.calls).padStart(5)} calls  ${v.tokens.toLocaleString("en-US").padStart(12)} tokens  $${v.usd.toFixed(4)}`);
console.log("\nBy step:");
for (const [k, v] of by((r) => (r.purpose || "").split(":")[0])) console.log(`  ${k.padEnd(32)} ${String(v.calls).padStart(5)} calls  $${v.usd.toFixed(4)}`);
