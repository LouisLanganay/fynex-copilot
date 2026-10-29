import type { RunBudget } from "./budget";
import type { LlmClient } from "./client";
import { TRANSCRIBE_SYSTEM } from "./prompts";
import { TRANSCRIPTION_SCHEMA } from "./schema";

/**
 * Scanned PDF fallback (PLAN.md 5.4): send the PDF itself to Muse Spark
 * (native PDF input, `file` content block) and ask for a verbatim transcription.
 * Enabled with ENABLE_PDF_TRANSCRIPTION=true. Max 20 pages.
 */

export const MAX_TRANSCRIBE_BYTES = 8 * 1024 * 1024;

export function transcriptionEnabled(): boolean {
  return process.env.ENABLE_PDF_TRANSCRIPTION === "true";
}

export async function transcribePdf(client: LlmClient, bytes: Uint8Array, filename: string, budget?: RunBudget): Promise<string | null> {
  if (bytes.byteLength > MAX_TRANSCRIBE_BYTES) return null;
  const b64 = Buffer.from(bytes).toString("base64");
  const res = await client.chat(
    {
      purpose: `transcribe:${filename}`,
      messages: [
        { role: "system", content: TRANSCRIBE_SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe the first 20 pages of this PDF verbatim." },
            { type: "file", file: { filename, file_data: `data:application/pdf;base64,${b64}` } },
          ],
        },
      ],
      max_tokens: 16000,
      reasoning_effort: "minimal",
      response_format: { type: "json_schema", json_schema: TRANSCRIPTION_SCHEMA as never },
    },
    budget,
  );
  try {
    const parsed = JSON.parse(res.message.content ?? "") as { pages: string[] };
    const text = parsed.pages.slice(0, 20).join("\n\n").trim();
    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
}
