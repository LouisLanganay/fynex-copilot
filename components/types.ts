export interface PortfolioRow {
  id: string;
  ticker: string | null;
  isin: string | null;
  name: string;
  quantity: number;
  currency: string;
  valueEur: number;
  weightPct: number;
  weight: number;
  rank: number;
  source: string | null;
  secondary: string | null;
}

export interface PortfolioResponse {
  mode: "live" | "mock" | "replay";
  model: string;
  offline: boolean;
  fxDate: string;
  atCost: boolean;
  totalEur: number;
  errors: { row: number; message: string }[];
  estimateUsd: number;
  recordedAt: string | null;
  passcodeRequired: boolean;
  holdings: PortfolioRow[];
}
