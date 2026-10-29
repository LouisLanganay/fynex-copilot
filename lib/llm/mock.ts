import { FakeClient, type ChatRequest } from "./client";

/**
 * `--mock` mode: a deterministic stand-in for Muse Spark used during
 * development and in end-to-end tests. It follows the same protocol (tool
 * calls for triage, schema-shaped JSON for analysis) and quotes real
 * sentences from the documents, so verification runs for real. Costs $0.
 */

const DOC_RE = /<document id="(D\d+)" title="([^"]*)" date="([^"]*)"[^>]*>\n([\s\S]*?)\n<\/document>/g;

function sentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ");
  return (flat.match(/[A-ZÀ-Ý][^.!?|]{40,260}[.!?]/g) ?? []).map((s) => s.trim());
}

function userText(req: ChatRequest): string {
  const m = req.messages.find((x) => x.role === "user");
  return typeof m?.content === "string" ? m.content : "";
}

export function mockHandler(req: ChatRequest) {
  // Triage: list, then select.
  if (req.tools?.length) {
    const toolMsgs = req.messages.filter((m) => m.role === "tool");
    if (!toolMsgs.length) {
      return { tool_calls: [{ id: "call_list", type: "function" as const, function: { name: "list_candidate_documents", arguments: "{}" } }] };
    }
    const list = JSON.parse(String(toolMsgs[0].content)) as { document_id: string; title: string; form_or_subtype: string }[];
    const pick = list.find((d) => /result|revenue|sales|quarter|growth|2\.02/i.test(`${d.title} ${d.form_or_subtype}`)) ?? list[0];
    const other = list.find((d) => d !== pick && /result|revenue|sales|quarter|2\.02/i.test(`${d.title} ${d.form_or_subtype}`));
    return {
      tool_calls: [
        {
          id: "call_select",
          type: "function" as const,
          function: {
            name: "select_documents",
            arguments: JSON.stringify({ primary_document_id: pick.document_id, comparison_document_id: other?.document_id ?? null, reason: "Mock: newest results document." }),
          },
        },
      ],
    };
  }

  const docs = [...userText(req).matchAll(DOC_RE)].map((m) => ({ id: m[1], title: m[2], date: m[3], text: m[4] }));
  const schema = req.response_format?.json_schema.name;

  if (schema === "document_answer") {
    const s = docs.flatMap((d) => sentences(d.text).map((t) => ({ id: d.id, t })))[0];
    if (!s) return { content: JSON.stringify({ answerable: false, answer: "The documents don't say.", quotes: [] }) };
    return { content: JSON.stringify({ answerable: true, answer: `[mock] The document says: ${s.t}`, quotes: [{ document_id: s.id, text: s.t }] }) };
  }

  const d = docs[0];
  if (!d) return { content: JSON.stringify({ status: "no_new_information", headline: "No document.", claims: [], portfolio_note: "" }) };
  const picked = sentences(d.text)
    .filter((s) => /\d/.test(s))
    .slice(0, 3);
  const claims = picked.map((s) => ({
    category: "results",
    statement: `[mock] ${s}`,
    why_it_matters: "[mock] Recorded without the model: this sentence is quoted from the document.",
    quotes: [{ document_id: d.id, text: s }],
  }));
  return {
    content: JSON.stringify({
      status: claims.length ? "minor_update" : "no_new_information",
      headline: `[mock] ${d.title}`.replace(/\d/g, "").slice(0, 140),
      claims,
      portfolio_note: "[mock] Exposure figures are computed by code.",
    }),
  };
}

export function mockClient(): FakeClient {
  return new FakeClient((req) => mockHandler(req), "mock-muse-spark");
}
