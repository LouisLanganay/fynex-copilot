"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import type { Card, CardQuote } from "@/lib/card";
import { FEED_GROUP_LABEL, feedGroup, feedGroupRank, type FeedGroup } from "@/lib/lead";
import HoldingCard, { SkeletonCard, ErrorCard } from "./HoldingCard";
import LeadChanges from "./LeadChanges";
import SourcePanel from "./SourcePanel";
import type { PortfolioResponse } from "./types";

type Slot = { state: "idle" } | { state: "loading"; startedAt: number } | { state: "done"; card: Card } | { state: "error"; message: string };

const CONCURRENCY = 4;

function newRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function money(v: number) {
  return `EUR ${v.toLocaleString("en-US")}`;
}

export default function Copilot({ sampleCsv }: { sampleCsv: string }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [running, setRunning] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [runId, setRunId] = useState(newRunId);
  const [source, setSource] = useState<{ card: Card; quote: CardQuote; index: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (text: string) => {
    setLoading(true);
    setLoadError(null);
    setPortfolio(null);
    setSlots({});
    setSource(null);
    try {
      if (text.length > 100 * 1024) throw new Error("File is larger than 100 KB.");
      const res = await fetch("/api/portfolio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: text }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not read the file.");
      setCsv(text);
      setPortfolio(j);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const onFile = useCallback(
    async (f: File | undefined | null) => {
      if (!f) return;
      if (!/\.(csv|txt)$/i.test(f.name)) return setLoadError("Please drop a .csv file.");
      await load(await f.text());
    },
    [load],
  );

  const analyzeOne = useCallback(
    async (holdingId: string, rid: string) => {
      setSlots((s) => ({ ...s, [holdingId]: { state: "loading", startedAt: Date.now() } }));
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv, holdingId, runId: rid, passcode: passcode || undefined }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Analysis failed.");
        setSlots((s) => ({ ...s, [holdingId]: { state: "done", card: j.card } }));
      } catch (e) {
        setSlots((s) => ({ ...s, [holdingId]: { state: "error", message: (e as Error).message } }));
      }
    },
    [csv, passcode],
  );

  const analyzeAll = useCallback(async () => {
    if (!portfolio) return;
    const rid = newRunId();
    setRunId(rid);
    setRunning(true);
    setShowSetup(false);
    const ids = portfolio.holdings.map((h) => h.id);
    setSlots(Object.fromEntries(ids.map((id) => [id, { state: "loading", startedAt: Date.now() } as Slot])));
    // The setup above folds away: start from the top so the results open on their first line.
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    let next = 0;
    const worker = async () => {
      while (next < ids.length) await analyzeOne(ids[next++], rid);
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    setRunning(false);
  }, [portfolio, analyzeOne]);

  const cards = useMemo(() => Object.values(slots).flatMap((s) => (s.state === "done" ? [s.card] : [])), [slots]);
  const spent = cards.reduce((s, c) => s + (c.cachedFrom ? 0 : c.costUsd), 0);
  const started = Object.keys(slots).length > 0;
  const hasSources = portfolio?.holdings.some((h) => h.source);
  const sum = portfolio ? Math.round(portfolio.holdings.reduce((s, h) => s + h.weight, 0) * 1000) / 10 : 0;

  // The opening block waits for every card: a heavier line may still be loading.
  const settled = started && !Object.values(slots).some((s) => s.state === "loading" || s.state === "idle");
  const collapsed = started && !showSetup;

  const goToCard = useCallback((holdingId: string) => {
    const el = document.getElementById(`card-${holdingId}`);
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
    setHighlight(holdingId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 2500);
  }, []);

  // Feed order: portfolio order while cards arrive, then grouped by status (weight order inside a group).
  const feed = useMemo(() => {
    if (!portfolio) return [];
    const rows = portfolio.holdings.flatMap((h) => {
      const s = slots[h.id];
      return s && s.state !== "idle" ? [{ h, s, group: feedGroup(s.state === "done" ? s.card : null) }] : [];
    });
    if (!settled) return rows.map((r) => ({ ...r, label: null as string | null }));
    const sorted = [...rows].sort((a, b) => feedGroupRank(a.group) - feedGroupRank(b.group));
    const several = new Set(sorted.map((r) => r.group)).size > 1;
    let last: FeedGroup | null = null;
    return sorted.map((r) => {
      const label: string | null = several && r.group !== last ? FEED_GROUP_LABEL[r.group] : null;
      last = r.group;
      return { ...r, label };
    });
  }, [portfolio, slots, settled]);

  const toggleTheme = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Fynex Copilot</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">What changed in your stocks, with the source.</p>
        </div>
        <div className="flex items-center gap-2">
          {portfolio && <BudgetBadge portfolio={portfolio} spent={spent} running={running} />}
          <button onClick={toggleTheme} aria-label="Toggle dark mode" data-testid="theme-toggle" className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900">
            Theme
          </button>
        </div>
      </header>

      {!collapsed && (
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFile(e.dataTransfer.files?.[0]);
        }}
        className={`rounded-lg border border-dashed p-5 transition-colors ${dragOver ? "border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-900" : "border-neutral-300 dark:border-neutral-700"}`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium">Drop your portfolio CSV</p>
            <p className="text-neutral-500 dark:text-neutral-400">Columns: ticker or ISIN, name, quantity, cost price, currency. Max 50 lines.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => fileInput.current?.click()} className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
              Choose file
            </button>
            <button onClick={() => load(sampleCsv)} disabled={loading} data-testid="try-sample" className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300">
              Try the sample portfolio
            </button>
          </div>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Your CSV is processed in memory and never stored. Only public filings are fetched. Information, not investment advice.</p>
      </section>
      )}

      {loading && <p className="mt-6 text-sm text-neutral-500">Reading the portfolio and matching each line to its regulator...</p>}
      {loadError && <p className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{loadError}</p>}

      {portfolio && (
        <section className={collapsed ? "" : "mt-8"} data-testid="portfolio">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Portfolio, {portfolio.holdings.length} lines</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Total {money(portfolio.totalEur)}, weights sum to <span data-testid="weight-sum">{sum.toFixed(1)}%</span>
              {portfolio.atCost ? ", at cost basis" : ""}. ECB rates of {portfolio.fxDate}.
              {started && (
                <button onClick={() => setShowSetup((v) => !v)} aria-expanded={showSetup} data-testid="toggle-setup" className="ml-2 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100">
                  {showSetup ? "Hide holdings" : "Show holdings"}
                </button>
              )}
            </p>
          </div>
          {portfolio.errors.length > 0 && (
            <ul className="mb-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {portfolio.errors.map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
          {!collapsed && (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">ISIN</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">Weight</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h) => (
                  <tr key={h.id} data-testid="holding-row" className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-2">{h.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{h.ticker ?? ""}</td>
                    <td className="hidden px-3 py-2 font-mono text-xs text-neutral-500 sm:table-cell">{h.isin ?? ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(h.valueEur)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.weightPct.toFixed(1)}%</td>
                    <td className="px-3 py-2">
                      <SourceBadge source={h.source} secondary={h.secondary} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          <div className={`flex flex-col gap-3 sm:flex-row sm:items-center ${collapsed ? "" : "mt-4"}`}>
            {!collapsed && portfolio.passcodeRequired && (
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Passcode for live runs"
                className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              />
            )}
            {!collapsed && (
              <button
                onClick={analyzeAll}
                disabled={running || !hasSources}
                data-testid="analyze"
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                {running ? "Analyzing..." : `Analyze ${portfolio.holdings.length} holdings`}
              </button>
            )}
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {portfolio.mode === "live" && `Live run on ${portfolio.model}, estimated cost about $${portfolio.estimateUsd.toFixed(2)} (hard cap $3).`}
              {portfolio.mode === "mock" && "Mock mode: a deterministic stand-in replaces the model, no cost."}
              {portfolio.mode === "replay" && `Recorded run${portfolio.recordedAt ? ` from ${portfolio.recordedAt.slice(0, 10)}` : ""} on ${portfolio.model}: instant, no model call.`}
            </p>
          </div>
        </section>
      )}

      {portfolio && started && (
        <section className="mt-8" data-testid="feed">
          <h2 className="mb-4 text-xl font-semibold tracking-tight">What changed</h2>
          {settled && <LeadChanges cards={cards} onCard={goToCard} onSource={(card, quote, index) => setSource({ card, quote, index })} />}
          <div className="flex flex-col gap-5">
            {feed.map(({ h, s, label }) => (
              <Fragment key={h.id}>
                {label && <h3 data-testid="feed-group" className="mt-3 text-sm font-medium text-neutral-500 first:mt-0 dark:text-neutral-400">{label}</h3>}
                {s.state === "loading" && <SkeletonCard name={h.name} weightPct={h.weightPct} startedAt={s.startedAt} />}
                {s.state === "error" && <ErrorCard name={h.name} message={s.message} onRetry={() => analyzeOne(h.id, runId)} />}
                {s.state === "done" && (
                  <HoldingCard
                    card={s.card}
                    runId={runId}
                    passcode={passcode}
                    highlighted={highlight === h.id}
                    activeQuote={source?.card.holdingId === h.id ? source.quote : null}
                    onQuote={(quote, index) => setSource({ card: s.card, quote, index })}
                  />
                )}
              </Fragment>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-16 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        Fynex Copilot explains public documents (SEC EDGAR, AMF info-financiere, ESEF). It never recommends buying, selling or holding a security. Built on Muse Spark through the Meta Model API.
      </footer>

      {source && <SourcePanel card={source.card} quote={source.quote} index={source.index} onClose={() => setSource(null)} />}
    </div>
  );
}

function SourceBadge({ source, secondary }: { source: string | null; secondary: string | null }) {
  if (!source) return <span className="text-xs text-neutral-400">No source found</span>;
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid="source-badge">
      <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] font-medium dark:border-neutral-700">{source}</span>
      {secondary && <span className="rounded border border-dashed border-neutral-300 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:border-neutral-700">{secondary}</span>}
    </span>
  );
}

function BudgetBadge({ portfolio, spent, running }: { portfolio: PortfolioResponse; spent: number; running: boolean }) {
  if (portfolio.mode !== "live") return null;
  return (
    <span data-testid="budget" className={`rounded-md border px-2.5 py-1.5 text-xs tabular-nums ${running ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-200 dark:border-neutral-800"}`}>
      ${spent.toFixed(3)} spent / est. ${portfolio.estimateUsd.toFixed(2)}
    </span>
  );
}
