import type { Holding } from "./csv";
import { toEur, type FxRates } from "./fx";

/** PLAN.md 5.2: weights computed by code, never by the model. */

export interface WeightedHolding extends Holding {
  valueEur: number;
  /** 0..1 */
  weight: number;
  /** 1 = largest line */
  rank: number;
  /** Which price produced the value. */
  priceBasis: "last_price" | "cost_price" | "none";
}

export interface PortfolioSummary {
  holdings: WeightedHolding[];
  totalEur: number;
  count: number;
  /** True when at least one line uses cost price (no price column). */
  atCost: boolean;
  fxDate: string;
}

export function computeWeights(holdings: Holding[], fx: FxRates): PortfolioSummary {
  const valued = holdings.map((h) => {
    const price = h.lastPrice ?? h.costPrice;
    const priceBasis: WeightedHolding["priceBasis"] = h.lastPrice != null ? "last_price" : h.costPrice != null ? "cost_price" : "none";
    const valueEur = price == null ? 0 : toEur(h.quantity * price, h.currency, fx);
    return { ...h, valueEur, priceBasis };
  });
  const totalEur = valued.reduce((s, h) => s + h.valueEur, 0);
  const sorted = [...valued].sort((a, b) => b.valueEur - a.valueEur);
  const rankOf = new Map(sorted.map((h, i) => [h.id, i + 1]));
  const out: WeightedHolding[] = valued
    .map((h) => ({ ...h, weight: totalEur > 0 ? h.valueEur / totalEur : 0, rank: rankOf.get(h.id)! }))
    .sort((a, b) => a.rank - b.rank);
  return {
    holdings: out,
    totalEur,
    count: out.length,
    atCost: out.some((h) => h.priceBasis !== "last_price"),
    fxDate: fx.date,
  };
}

/** Display rounding to 0.1 %. */
export function pct(weight: number): number {
  return Math.round(weight * 1000) / 10;
}

/** Round a EUR amount for display and prompts. */
export function eur(value: number): number {
  return Math.round(value);
}

/** The code-computed numbers the model is allowed to write for this holding. */
export function allowedNumbers(h: WeightedHolding, summary: PortfolioSummary): number[] {
  return [pct(h.weight), h.rank, eur(h.valueEur), summary.count, eur(summary.totalEur), h.quantity];
}
