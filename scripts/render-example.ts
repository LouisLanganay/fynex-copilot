import fs from "node:fs";
import path from "node:path";
import { fixturesRoot } from "@/lib/cache/cache";
import { runToMarkdown } from "@/lib/report/markdown";

/** Re-render examples/sample-run.md from fixtures/sample-run.json (no model call). */
const run = JSON.parse(fs.readFileSync(path.join(fixturesRoot(), "sample-run.json"), "utf8"));
fs.mkdirSync("examples", { recursive: true });
fs.writeFileSync(path.join("examples", "sample-run.md"), runToMarkdown(run.cards, { model: run.model, generatedAt: run.recordedAt, totalUsd: run.totalUsd }));
console.log("examples/sample-run.md rendered");
