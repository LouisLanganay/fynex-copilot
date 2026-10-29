import type { Holding } from "@/lib/portfolio/csv";
import { namesMatch, type SecTicker } from "@/lib/sources/edgar";
import type { ResolvedHolding } from "@/lib/sources/types";

/**
 * Resolution order (PLAN.md 5.3):
 * 1. FR ISIN: AMF primary; EDGAR secondary if a SEC registrant has the same name.
 * 2. Ticker in the SEC map (US ISIN, or a name that matches the SEC title).
 * 3. ISIN only: OpenFIGI (US listing) to a ticker, then SEC map, then name match.
 * 4. Other ISIN: GLEIF LEI, then ESEF.
 * 5. Nothing.
 *
 * Network lookups are injected so the order is unit-testable.
 */

export interface ResolveDeps {
  secTickers: () => Promise<SecTicker[]>;
  openFigiTicker: (isin: string) => Promise<{ ticker: string; name: string } | null>;
  gleifLei: (isin: string) => Promise<string | null>;
  esefHasFilings: (lei: string) => Promise<boolean>;
}

function bySecName(tickers: SecTicker[], name: string): SecTicker | undefined {
  return tickers.find((t) => namesMatch(t.title, name));
}

export async function resolveHolding(h: Holding, deps: ResolveDeps): Promise<ResolvedHolding> {
  const tickers = await deps.secTickers();
  const country = h.isin?.slice(0, 2) ?? null;

  if (country === "FR") {
    const sec = bySecName(tickers, h.name);
    return { source: "AMF", secondary: sec ? "SEC EDGAR" : null, cik: sec?.cik, secTitle: sec?.title };
  }

  // A bare ticker can collide across markets (SU is Suncor in the US, Schneider in Paris):
  // trust the SEC map directly only for US ISINs, or when the names agree.
  if (h.ticker) {
    const t = tickers.find((x) => x.ticker === h.ticker);
    if (t && (country === "US" || country === null || namesMatch(t.title, h.name))) {
      return { source: "SEC EDGAR", cik: t.cik, secTitle: t.title };
    }
  }

  if (h.isin) {
    const figi = await deps.openFigiTicker(h.isin).catch(() => null);
    if (figi) {
      const t = tickers.find((x) => x.ticker === figi.ticker.toUpperCase());
      if (t && (country === "US" || namesMatch(t.title, h.name) || namesMatch(t.title, figi.name))) {
        return { source: "SEC EDGAR", cik: t.cik, secTitle: t.title };
      }
    }
    const byName = bySecName(tickers, h.name) ?? (figi ? bySecName(tickers, figi.name) : undefined);
    if (byName) return { source: "SEC EDGAR", cik: byName.cik, secTitle: byName.title, note: "Matched by company name" };

    const lei = await deps.gleifLei(h.isin).catch(() => null);
    if (lei && (await deps.esefHasFilings(lei).catch(() => false))) return { source: "ESEF", lei };
  }
  return { source: null, note: "No public source found for this identifier" };
}
