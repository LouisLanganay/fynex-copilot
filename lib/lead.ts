import type { Card } from "@/lib/card";

/**
 * The opening block of the results: the largest lines with a material change.
 * Computed by code from the cards, with no model call. It ranks by portfolio
 * weight and says nothing about what to do.
 */

export const LEAD_MAX = 3;

export interface LeadRow {
  holdingId: string;
  name: string;
  ticker: string | null;
  /** Null when the weight is not available. */
  weightPct: number | null;
  headline: string;
  card: Card;
}

export interface Lead {
  rows: LeadRow[];
  /** Cards with a verified material change, before the cut to LEAD_MAX. */
  materialCount: number;
  /** Cards looked at. */
  total: number;
}

function usableWeight(w: unknown): number | null {
  return typeof w === "number" && Number.isFinite(w) && w >= 0 ? w : null;
}

/** "9.1%", or a plain label when the weight is missing. */
export function formatWeight(w: unknown): string {
  const v = usableWeight(w);
  return v === null ? "Weight unknown" : `${v.toFixed(1)}%`;
}

/**
 * Up to LEAD_MAX holdings with a material change, heaviest first. Only verified
 * cards count: a fallback card has no AI summary to show. Missing weights go
 * last, and ties keep the portfolio rank, then the name.
 */
export function leadChanges(cards: Card[], max = LEAD_MAX): Lead {
  const material = cards.filter((c) => c.state === "ok" && c.status === "material_change");
  const rows = [...material]
    .sort((a, b) => {
      const wa = usableWeight(a.weightPct);
      const wb = usableWeight(b.weightPct);
      if (wa !== wb) {
        if (wa === null) return 1;
        if (wb === null) return -1;
        return wb - wa;
      }
      return (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name);
    })
    .slice(0, max)
    .map((c) => ({ holdingId: c.holdingId, name: c.name, ticker: c.ticker, weightPct: usableWeight(c.weightPct), headline: c.headline, card: c }));
  return { rows, materialCount: material.length, total: cards.length };
}

/** Sum of the shown weights, rounded to a whole percent. Null if any is missing. */
export function leadCombinedWeight(rows: LeadRow[]): number | null {
  if (!rows.length || rows.some((r) => r.weightPct === null)) return null;
  return Math.round(rows.reduce((s, r) => s + r.weightPct!, 0));
}

export function leadTitle(lead: Lead): string {
  return lead.rows.length === 1 ? "Largest line with a material change" : "Largest lines with a material change";
}

/** One factual sentence on what the block covers. */
export function leadSummary(lead: Lead): string {
  const shown = lead.rows.length;
  const count = `${lead.materialCount} of ${lead.total} ${lead.total === 1 ? "line reports" : "lines report"} a material change`;
  const combined = leadCombinedWeight(lead.rows);
  const share = combined === null ? "" : `, about ${combined}% of the portfolio`;
  if (lead.materialCount <= shown) return `${count}${share}.`;
  return `${count}. The ${shown} largest are shown${share}.`;
}

export const LEAD_NOTE = "Ordered by portfolio weight only. This says what the documents report, not what to do.";
export const LEAD_NONE = "No material change in the latest documents of these lines.";

export type FeedGroup = "material" | "minor" | "nothing" | "other";

export const FEED_GROUP_LABEL: Record<FeedGroup, string> = {
  material: "Material changes",
  minor: "Minor updates",
  nothing: "Nothing new",
  other: "Not analyzed",
};

const GROUP_ORDER: FeedGroup[] = ["material", "minor", "nothing", "other"];

export function feedGroup(card: Card | null): FeedGroup {
  if (!card || !["ok", "fallback"].includes(card.state)) return "other";
  if (card.status === "material_change") return "material";
  if (card.status === "no_new_information") return "nothing";
  return "minor";
}

export function feedGroupRank(g: FeedGroup): number {
  return GROUP_ORDER.indexOf(g);
}
