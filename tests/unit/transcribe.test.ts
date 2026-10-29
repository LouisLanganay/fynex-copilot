import { describe, expect, it } from "vitest";
import { FakeClient } from "@/lib/llm/client";
import { transcribePdf, MAX_TRANSCRIBE_BYTES } from "@/lib/llm/transcribe";

describe("scanned PDF transcription", () => {
  it("sends the PDF as a native file block and joins the transcribed pages", async () => {
    const client = new FakeClient(() => ({ content: JSON.stringify({ pages: ["Page one of the scanned release, with revenue figures.", "Page two."] }) }));
    const text = await transcribePdf(client, new Uint8Array([37, 80, 68, 70]), "scan.pdf");
    expect(text).toBe("Page one of the scanned release, with revenue figures.\n\nPage two.");
    const content = client.calls[0].messages[1].content as { type: string; file?: { filename: string; file_data: string } }[];
    const file = content.find((c) => c.type === "file")!;
    expect(file.file!.filename).toBe("scan.pdf");
    expect(file.file!.file_data).toBe("data:application/pdf;base64,JVBERg==");
    expect(client.calls[0].response_format?.json_schema.name).toBe("pdf_transcription");
  });
  it("returns null on an unusable answer or an oversized PDF", async () => {
    const bad = new FakeClient(() => ({ content: "not json" }));
    expect(await transcribePdf(bad, new Uint8Array([1]), "x.pdf")).toBeNull();
    expect(await transcribePdf(bad, new Uint8Array(MAX_TRANSCRIBE_BYTES + 1), "x.pdf")).toBeNull();
    expect(bad.calls).toHaveLength(1);
  });
});
