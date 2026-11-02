import { NextResponse } from "next/server";
import { readDocument } from "@/lib/pipeline/server";

export const runtime = "nodejs";

/** GET ?id=<document id> -> cached public document text, for the source panel. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const d = readDocument(id);
  if (!d) return NextResponse.json({ error: "Document not cached." }, { status: 404 });
  return NextResponse.json({ id: d.id, title: d.title, date: d.date, source: d.source, url: d.url, alternateUrl: d.alternateUrl, text: d.text, pageStarts: d.pageStarts, ocr: d.ocr, contentType: d.contentType, excerpt: d.excerpt });
}
