import type { Card, CardDocument } from "@/lib/card";

/** Render a run as Markdown (the committed example output). */

const STATUS: Record<string, string> = {
  material_change: "Material change",
  minor_update: "Minor update",
  no_new_information: "Nothing new",
};

function docLink(d: CardDocument | undefined, page: number | null): string {
  if (!d) return "";
  const url = d.url + (page && /\.pdf/i.test(d.url) ? `#page=${page}` : "");
  return `[${d.title}, ${d.date}${page ? `, p. ${page}` : ""}](${url})`;
}

export function runToMarkdown(cards: Card[], meta: { model: string; generatedAt: string; totalUsd: number; note?: string }): string {
  const lines: string[] = [];
  lines.push(`# Fynex Copilot: sample portfolio run`);
  lines.push("");
  lines.push(`Generated ${meta.generatedAt} with \`${meta.model}\` on the Meta Model API. Total model cost: $${meta.totalUsd.toFixed(4)}.`);
  if (meta.note) lines.push("", meta.note);
  lines.push("", "Information, not investment advice. Every quote below was checked word for word against the source document by the server.", "");
  for (const c of cards) {
    lines.push(`## ${c.name}${c.ticker ? ` (${c.ticker})` : ""}, ${c.weightPct}% of the portfolio`);
    lines.push("");
    if (c.state === "no_source" || c.state === "no_document" || c.state === "error" || c.state === "budget") {
      lines.push(`_${c.headline}_${c.note ? ` ${c.note}` : ""}`, "");
      continue;
    }
    lines.push(`**${STATUS[c.status ?? ""] ?? c.status}**: ${c.headline}`, "");
    if (c.note) lines.push(`> ${c.note}`, "");
    c.claims.forEach((cl, i) => {
      lines.push(`${i + 1}. **${cl.statement}**`);
      lines.push(`   ${cl.whyItMatters}`);
      for (const q of cl.quotes) {
        const d = c.documents.find((x) => x.id === q.documentId);
        lines.push(`   > "${q.text.replace(/\s+/g, " ").trim()}"`);
        lines.push(`   > ${docLink(d, q.page)}`);
      }
      lines.push("");
    });
    if (c.portfolioNote) lines.push(`_${c.portfolioNote}_`, "");
    const triage = c.triage ? `triage: ${c.triage.method}${c.triage.toolCalls.length ? ` (${c.triage.toolCalls.join(", ")})` : ""}` : "";
    lines.push(
      `<sub>${c.model}, ${c.usage.prompt.toLocaleString("en-US")} input tokens (${c.usage.cached.toLocaleString("en-US")} cached), ${c.usage.completion.toLocaleString("en-US")} output tokens (${c.usage.reasoning.toLocaleString("en-US")} reasoning), $${c.costUsd.toFixed(4)}, attempts ${c.attempts}, ${c.quotesVerified} quotes verified, ${c.rejections.length} rejected; ${triage}</sub>`,
      "",
    );
  }
  return lines.join("\n");
}
