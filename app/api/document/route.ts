import { NextResponse } from "next/server";
import { cacheGet } from "@/lib/cache/cache";
import type { SourceDocument } from "@/lib/sources/types";

export const runtime = "nodejs";

/** GET ?id=<document id> -> cached public document text, for the source panel. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const hit = cacheGet<SourceDocument>("doc", id);
  if (!hit) return NextResponse.json({ error: "Document not cached." }, { status: 404 });
  const d = hit.value;
  return NextResponse.json({ id: d.id, title: d.title, date: d.date, source: d.source, url: d.url, alternateUrl: d.alternateUrl, text: d.text, pageStarts: d.pageStarts, ocr: d.ocr });
}
