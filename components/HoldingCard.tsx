"use client";

import { useEffect, useState } from "react";
import type { Card, CardQuote } from "@/lib/card";
import { isAdviceRequest, REFUSAL } from "@/lib/guardrail/advice";
import { formatWeight } from "@/lib/lead";

const STATUS: Record<string, { label: string; cls: string }> = {
  material_change: { label: "Material change", cls: "font-medium text-neutral-900 dark:text-neutral-100" },
  minor_update: { label: "Minor update", cls: "text-neutral-600 dark:text-neutral-300" },
  no_new_information: { label: "Nothing new", cls: "text-neutral-500 dark:text-neutral-400" },
};

const CATEGORY: Record<string, string> = { results: "Results", guidance: "Guidance", capital: "Capital", strategy: "Strategy", risk: "Risk", other: "Other" };

const STEPS = ["Finding documents", "Choosing documents with tool calls", "Reading the filing", "Verifying quotes"];

export function SkeletonCard({ name, weightPct, startedAt }: { name: string; weightPct: number; startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, now - startedAt) / 1000;
  const step = STEPS[s < 3 ? 0 : s < 10 ? 1 : s < 40 ? 2 : 3];
  return (
    <article data-testid="card-loading" className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800 sm:p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium [overflow-wrap:anywhere]">{name}</h3>
        <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{formatWeight(weightPct)}</span>
      </div>
      <p className="mt-2 text-sm text-neutral-500">{step}...</p>
      <div className="mt-3 space-y-2">
        <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
      </div>
    </article>
  );
}

export function ErrorCard({ name, message, onRetry }: { name: string; message: string; onRetry: () => void }) {
  return (
    <article className="rounded-lg border border-red-200 p-5 dark:border-red-900 sm:p-6">
      <h3 className="text-sm font-medium [overflow-wrap:anywhere]">{name}</h3>
      <p className="mt-1 text-sm text-red-700 dark:text-red-300">{message}</p>
      <button onClick={onRetry} className="mt-2 rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700">
        Retry
      </button>
    </article>
  );
}

export default function HoldingCard({
  card,
  runId,
  passcode,
  highlighted = false,
  activeQuote,
  onQuote,
}: {
  card: Card;
  runId: string;
  passcode: string;
  highlighted?: boolean;
  activeQuote: CardQuote | null;
  onQuote: (q: CardQuote, index: number) => void;
}) {
  const doc = card.documents[0];
  const st = card.status ? STATUS[card.status] : null;
  let n = 0;
  const empty = ["no_source", "no_document", "budget", "error"].includes(card.state);
  return (
    <article
      id={`card-${card.holdingId}`}
      tabIndex={-1}
      data-testid="card"
      data-holding={card.holdingId}
      className={`scroll-mt-4 rounded-lg border p-5 outline-none transition-colors sm:p-6 ${highlighted ? "border-neutral-900 dark:border-neutral-300" : "border-neutral-200 dark:border-neutral-800"}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h3 className="text-sm font-medium [overflow-wrap:anywhere]">
          {card.name} {card.ticker && <span className="ml-0.5 font-mono text-xs font-normal text-neutral-500 dark:text-neutral-400">{card.ticker}</span>}
        </h3>
        <div className="flex items-baseline gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          {st && <span className={st.cls}>{st.label}</span>}
          {st && <span aria-hidden="true">&middot;</span>}
          <span className="tabular-nums">{formatWeight(card.weightPct)}{Number.isFinite(card.weightPct) ? " of portfolio" : ""}</span>
        </div>
      </div>
      <p className={`mt-3 ${empty ? "text-sm text-neutral-500 dark:text-neutral-400" : "text-lg font-medium leading-snug tracking-tight"}`}>{card.headline}</p>
      {doc && (
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400 [overflow-wrap:anywhere]">
          {doc.source}, {doc.title}, {doc.date}
          {card.documents[1] ? ` (compared with ${card.documents[1].date})` : ""}
        </p>
      )}
      {card.note && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{card.note}</p>}

      {card.claims.length > 0 && (
        <ol className="mt-5 space-y-5">
          {card.claims.map((c, i) => (
            <li key={i} className="text-sm leading-relaxed sm:grid sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-x-3" data-testid="claim">
              <span className="block text-xs leading-relaxed text-neutral-500 dark:text-neutral-400 sm:pt-px">{CATEGORY[c.category] ?? ""}</span>
              <div className="min-w-0">
                <p>{c.statement}</p>
                <p className="mt-0.5 text-neutral-500 dark:text-neutral-400">{c.whyItMatters}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.quotes.map((q) => {
                    const idx = ++n;
                    const active = activeQuote && activeQuote.start === q.start && activeQuote.documentId === q.documentId;
                    return (
                      <button
                        key={`${q.documentId}-${q.start}`}
                        data-testid="source-chip"
                        onClick={() => onQuote(q, idx)}
                        title={q.text}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${active ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"}`}
                      >
                        [{idx}]{q.page ? ` p.${q.page}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {card.portfolioNote && <p className="mt-5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{card.portfolioNote}</p>}

      {!empty && card.documents.length > 0 && <AskBox card={card} runId={runId} passcode={passcode} />}

      {!empty && (
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400" data-testid="card-footer">
          {card.model}, {(card.usage.prompt + card.usage.completion).toLocaleString("en-US")} tokens ({card.usage.reasoning.toLocaleString("en-US")} reasoning), ${card.costUsd.toFixed(4)}
          {card.state === "ok" ? `, all ${card.quotesVerified} quotes verified` : ""}
          {card.rejections.length ? `, ${card.rejections.length} rejected and retried` : ""}
          {card.triage?.method === "model" ? `, triage by tool calls (${card.triage.toolCalls.length})` : ""}
          {card.cachedFrom ? `. Cached result from ${card.cachedFrom.slice(0, 10)}` : ""}
        </p>
      )}
    </article>
  );
}

function AskBox({ card, runId, passcode }: { card: Card; runId: string; passcode: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ kind: string; answer: string; quotes: CardQuote[] } | null>(null);
  const [count, setCount] = useState(0);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || busy || count >= 3) return;
    // Same input filter as the server, applied first: a refusal needs no request at all.
    if (isAdviceRequest(q)) {
      setAnswer({ kind: "refused", answer: REFUSAL, quotes: [] });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, holdingName: card.name, documentIds: card.documents.map((d) => d.id), runId, passcode: passcode || undefined }),
      });
      const j = await res.json();
      setAnswer(res.ok ? j : { kind: "error", answer: j.error ?? "Question failed.", quotes: [] });
      if (j.modelCalled) setCount((c) => c + 1);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-5 border-t border-neutral-100 pt-4 dark:border-neutral-800">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={300}
          placeholder="Ask about this document"
          data-testid="ask-input"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700"
        />
        <button disabled={busy || count >= 3} data-testid="ask-submit" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-700">
          {busy ? "..." : "Ask"}
        </button>
      </form>
      {answer && (
        <div className="mt-2 text-sm" data-testid="ask-answer" data-kind={answer.kind}>
          <p className={answer.kind === "refused" ? "text-neutral-600 dark:text-neutral-300" : ""}>{answer.answer}</p>
          {answer.quotes.map((x, i) => (
            <blockquote key={i} className="mt-1 border-l-2 border-neutral-300 pl-2 text-xs text-neutral-500 dark:border-neutral-700">
              {x.text}
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}
