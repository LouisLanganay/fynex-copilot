"use client";

import type { Card, CardQuote } from "@/lib/card";
import { formatWeight, LEAD_NONE, LEAD_NOTE, leadChanges, leadSummary, leadTitle } from "@/lib/lead";

/** Opening block of the results: the largest lines with a material change. No model call. */
export default function LeadChanges({ cards, onCard, onSource }: { cards: Card[]; onCard: (holdingId: string) => void; onSource: (card: Card, quote: CardQuote, index: number) => void }) {
  const lead = leadChanges(cards);
  if (!lead.total) return null;
  if (!lead.rows.length) {
    return (
      <p data-testid="lead-none" className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        {LEAD_NONE}
      </p>
    );
  }
  return (
    <section data-testid="lead" aria-labelledby="lead-title" className="mb-8">
      <h3 id="lead-title" className="text-sm font-medium">
        {leadTitle(lead)}
      </h3>
      <p data-testid="lead-summary" className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        {leadSummary(lead)}
      </p>
      <ol className="mt-3 divide-y divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {lead.rows.map((r) => {
          const quote = r.card.claims.flatMap((c) => c.quotes)[0];
          return (
            <li key={r.holdingId} data-testid="lead-row" data-holding={r.holdingId} className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 py-3.5 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-x-4">
              <p data-testid="lead-weight" className={r.weightPct === null ? "text-xs text-neutral-500 dark:text-neutral-400" : "text-lg font-medium leading-snug tabular-nums tracking-tight"}>
                {formatWeight(r.weightPct)}
              </p>
              <a
                href={`#card-${r.holdingId}`}
                onClick={(e) => {
                  e.preventDefault();
                  onCard(r.holdingId);
                }}
                data-testid="lead-link"
                className="group min-w-0 [overflow-wrap:anywhere]"
              >
                <span className="block text-sm text-neutral-500 dark:text-neutral-400">{r.name}</span>
                <span className="mt-0.5 block font-medium leading-snug underline-offset-2 group-hover:underline">{r.headline}</span>
              </a>
              {quote && (
                <button
                  onClick={() => onSource(r.card, quote, 1)}
                  data-testid="lead-source"
                  className="col-start-2 mt-2 justify-self-start whitespace-nowrap rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900 sm:col-start-3 sm:mt-0"
                >
                  Source{quote.page ? ` p.${quote.page}` : ""}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{LEAD_NOTE}</p>
    </section>
  );
}
