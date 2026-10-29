/** ECB euro reference rates (EUR base). PLAN.md 3.5. */

export const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export interface FxRates {
  /** Date of the ECB fixing (YYYY-MM-DD). */
  date: string;
  /** Units of currency per 1 EUR. EUR itself is 1. */
  rates: Record<string, number>;
}

export function parseEcbXml(xml: string): FxRates {
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  if (!date) throw new Error("ECB XML: no date");
  const rates: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    rates[m[1]] = Number(m[2]);
  }
  if (Object.keys(rates).length < 2) throw new Error("ECB XML: no rates");
  return { date, rates };
}

let memo: { at: number; fx: FxRates } | null = null;
const TTL_MS = 12 * 3600 * 1000;

export async function fetchEcbRates(fetchImpl: typeof fetch = fetch): Promise<FxRates> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.fx;
  const res = await fetchImpl(ECB_URL);
  if (!res.ok) throw new Error(`ECB rates: HTTP ${res.status}`);
  const fx = parseEcbXml(await res.text());
  memo = { at: Date.now(), fx };
  return fx;
}

/** Convert an amount in `currency` to EUR. GBX/GBp (pence) handled. */
export function toEur(amount: number, currency: string, fx: FxRates): number {
  let ccy = currency.toUpperCase();
  let factor = 1;
  if (ccy === "GBX" || currency === "GBp") {
    ccy = "GBP";
    factor = 0.01;
  }
  const rate = fx.rates[ccy];
  if (!rate) throw new Error(`No ECB rate for ${currency}`);
  return (amount * factor) / rate;
}
