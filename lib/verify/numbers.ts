/**
 * Numbers check (PLAN.md 5.6): every number the model writes must appear in the
 * claim's verified quotes or in the list of code-computed numbers.
 */

// Labels that look like numbers but carry no figure: quarters, halves, 9M, fiscal years.
const LABELS = /\b(?:q[1-4]|h[12]|[369]m|fy ?\d{2,4}|cy ?\d{2,4}|t[1-4]|s[12])\b/gi;

// A number: optional thousands groups (comma, dot, space, NBSP, thin space) and a decimal part.
const NUMBER = /(?<![\p{L}\d])(\d{1,3}(?:[,.\u00a0\u202f ]\d{3})+(?:[.,]\d+)?(?!\d)|\d+(?:[.,]\d+)?)(\s?%)?/gu;

export interface NumberToken {
  raw: string;
  /** Candidate numeric values (several when the separator is ambiguous). */
  values: number[];
  percent: boolean;
}

/** Parse a number token into its possible values, handling 1,234.5 / 1 234,5 / 1.234 ambiguity. */
export function parseNumber(raw: string): number[] {
  const s = raw.replace(/[\u00a0\u202f ]/g, " ").trim();
  if (/ /.test(s)) {
    // space groups thousands: "1 234,5" or "1 234.5"
    return [Number(s.replace(/ /g, "").replace(",", "."))];
  }
  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  if (commas && dots) {
    const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    const decSep = s[lastSep];
    const thouSep = decSep === "," ? "." : ",";
    return [Number(s.split(thouSep).join("").replace(decSep, "."))];
  }
  const sep = commas ? "," : dots ? "." : null;
  if (!sep) return [Number(s)];
  const count = commas || dots;
  if (count > 1) return [Number(s.split(sep).join(""))];
  const [intPart, frac] = s.split(sep);
  if (frac.length === 3) {
    // "1,234" or "1.234": thousands in one locale, decimal in the other.
    return [Number(intPart + frac), Number(`${intPart}.${frac}`)];
  }
  return [Number(`${intPart}.${frac}`)];
}

export function extractNumbers(text: string): NumberToken[] {
  const cleaned = text.replace(LABELS, " ");
  const out: NumberToken[] = [];
  for (const m of cleaned.matchAll(NUMBER)) {
    const raw = m[1];
    const percent = !!m[2];
    const values = parseNumber(raw);
    // Years 1990 to 2100 written as plain integers are not figures.
    if (!percent && /^\d{4}$/.test(raw) && values[0] >= 1990 && values[0] <= 2100) continue;
    // Bare single digits (counts like "2 documents") are tolerated, but not "5%".
    if (!percent && /^\d$/.test(raw)) continue;
    out.push({ raw, values, percent });
  }
  return out;
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

export interface NumbersCheck {
  ok: boolean;
  unsupported: string[];
}

/**
 * @param written model-written fields of one claim
 * @param quoteTexts verified quote texts of that claim
 * @param allowed code-computed numbers (weight, rank, value, counts)
 */
export function checkNumbers(written: string[], quoteTexts: string[], allowed: number[]): NumbersCheck {
  const pool: number[] = [...allowed];
  for (const q of quoteTexts) for (const t of extractNumbers(q)) pool.push(...t.values);
  const unsupported: string[] = [];
  for (const field of written) {
    for (const t of extractNumbers(field)) {
      const found = t.values.some((v) => pool.some((p) => sameValue(v, p)));
      if (!found) unsupported.push(t.raw + (t.percent ? "%" : ""));
    }
  }
  return { ok: unsupported.length === 0, unsupported };
}
