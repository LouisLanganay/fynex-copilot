"use client";

import { useEffect, useRef, useState } from "react";
import type { Card, CardQuote } from "@/lib/card";

interface Doc {
  id: string;
  title: string;
  date: string;
  source: string;
  url: string;
  alternateUrl?: string;
  text: string;
  pageStarts: number[];
  ocr: boolean;
}

const CONTEXT = 1800;

function originalLink(doc: Doc, quote: CardQuote): string {
  if (/\.pdf($|\?)/i.test(doc.url)) return quote.page ? `${doc.url}#page=${quote.page}` : doc.url;
  // Text fragment: first words of the quote, so the browser scrolls to it on sec.gov.
  const words = quote.text.replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ");
  return `${doc.url}#:~:text=${encodeURIComponent(words)}`;
}

export default function SourcePanel({ card, quote, index, onClose }: { card: Card; quote: CardQuote; index: number; onClose: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mark = useRef<HTMLElement>(null);
  const meta = card.documents.find((d) => d.id === quote.documentId);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/document?id=${quote.documentId}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Document unavailable.");
        if (!cancelled) {
          setDoc(j);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [quote.documentId]);

  useEffect(() => {
    mark.current?.scrollIntoView({ block: "center" });
  }, [doc, quote.start]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const from = Math.max(0, quote.start - CONTEXT);
  const to = doc ? Math.min(doc.text.length, quote.end + CONTEXT) : 0;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/20 dark:bg-black/50" onClick={onClose} />
      <aside
        data-testid="source-panel"
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-[80vh] flex-col rounded-t-xl border-t border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950 sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[34rem] sm:rounded-none sm:border-l sm:border-t-0"
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
          <div className="min-w-0">
            <p className="text-xs text-neutral-500">
              Source [{index}] for {card.name}
              {quote.page ? `, page ${quote.page}` : ""}
            </p>
            <p className="truncate text-sm font-medium">{meta?.title ?? doc?.title}</p>
            <p className="text-xs text-neutral-500">
              {meta?.source}, {meta?.date}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!doc && !error && <p className="text-sm text-neutral-500">Loading the document...</p>}
          {doc && (
            <>
              {doc.ocr && <p className="mb-2 text-xs text-amber-700">Source text transcribed by the model from a scanned PDF.</p>}
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                {from > 0 && "[...] "}
                {doc.text.slice(from, quote.start)}
                <mark ref={mark} className="quote" data-testid="quote-mark">
                  {doc.text.slice(quote.start, quote.end)}
                </mark>
                {doc.text.slice(quote.end, to)}
                {to < doc.text.length && " [...]"}
              </p>
            </>
          )}
        </div>
        {doc && (
          <div className="flex flex-wrap gap-3 border-t border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <a href={originalLink(doc, quote)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Open original{quote.page ? ` (page ${quote.page})` : ""}
            </a>
            {doc.alternateUrl && (
              <a href={doc.alternateUrl} target="_blank" rel="noreferrer" className="text-neutral-500 underline underline-offset-2">
                {doc.source === "AMF" ? "Other language version" : "Filing index"}
              </a>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
