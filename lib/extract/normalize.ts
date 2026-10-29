/**
 * Text normalization shared by documents and quotes (PLAN.md 5.5).
 *
 * The same function runs on both sides, so a quote copied by the model matches
 * the document even when typography differs (curly quotes, ligatures, NBSP,
 * line breaks, hyphenation across lines). `map[i]` gives the raw offset of the
 * i-th normalized character, so the UI can highlight the raw text.
 */

export interface Normalized {
  text: string;
  /** map[i] = offset in the raw string of normalized char i. Length text.length + 1 (end sentinel). */
  map: number[];
}

export interface NormalizeOptions {
  /** Join words hyphenated across a line break ("prof-\nits" -> "profits"). Default true. */
  joinHyphens?: boolean;
  /** Lowercase the output (comparisons are case-insensitive). Default true. */
  lowercase?: boolean;
}

const REMOVED = /[\u00ad\u200b\u200c\u200d\u2060\ufeff]/;
const SINGLE_QUOTES = /[\u2018\u2019\u201a\u201b\u2032\u02bc\u00b4`]/;
const DOUBLE_QUOTES = /[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\ufe58\ufe63\uff0d]/;
const SPACES = /[\s\u00a0\u2000-\u200a\u202f\u205f\u3000]/;

function mapChar(ch: string): string {
  if (REMOVED.test(ch)) return "";
  if (SINGLE_QUOTES.test(ch)) return "'";
  if (DOUBLE_QUOTES.test(ch)) return '"';
  if (DASHES.test(ch)) return "-";
  if (SPACES.test(ch)) return " ";
  return ch.normalize("NFKC");
}

const isLetter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch);

export function normalize(raw: string, opts: NormalizeOptions = {}): Normalized {
  const joinHyphens = opts.joinHyphens ?? true;
  const lowercase = opts.lowercase ?? true;
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // trims leading whitespace

  const chars = Array.from(raw);
  // Offsets in UTF-16 units, so they index the raw JS string directly.
  const offsets: number[] = [];
  let off = 0;
  for (const c of chars) {
    offsets.push(off);
    off += c.length;
  }

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const mapped = mapChar(ch);

    // Hyphenation across a line break: letter "-" [spaces] "\n" [spaces] letter
    if (mapped === "-" && isLetter(chars[i - 1])) {
      let j = i + 1;
      let sawNewline = false;
      while (j < chars.length && /[\s\u00a0]/.test(chars[j])) {
        if (chars[j] === "\n" || chars[j] === "\r") sawNewline = true;
        j++;
      }
      if (sawNewline && isLetter(chars[j])) {
        if (joinHyphens) {
          i = j - 1; // drop the hyphen and the break
        } else {
          out.push("-");
          map.push(offsets[i]);
          lastWasSpace = false;
          i = j - 1; // keep the hyphen, drop the break
        }
        continue;
      }
    }

    if (mapped === "") continue;
    if (mapped === " ") {
      if (!lastWasSpace) {
        out.push(" ");
        map.push(offsets[i]);
        lastWasSpace = true;
      }
      continue;
    }
    const piece = lowercase ? mapped.toLowerCase() : mapped;
    for (const p of Array.from(piece)) {
      // NFKC can produce spaces (e.g. some compatibility chars): collapse them too.
      if (p === " ") {
        if (!lastWasSpace) {
          out.push(" ");
          map.push(offsets[i]);
          lastWasSpace = true;
        }
        continue;
      }
      out.push(p);
      map.push(offsets[i]);
      lastWasSpace = false;
    }
  }
  // trim trailing space
  if (out.length && out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }
  map.push(raw.length);
  // `out` holds code points; build a string and a UTF-16 aligned map.
  let text = "";
  const map16: number[] = [];
  for (let k = 0; k < out.length; k++) {
    text += out[k];
    for (let u = 0; u < out[k].length; u++) map16.push(map[k]);
  }
  map16.push(raw.length);
  return { text, map: map16 };
}

/** Normalized string only. */
export function norm(raw: string, opts?: NormalizeOptions): string {
  return normalize(raw, opts).text;
}

/** Map a [start, end) range in normalized text back to raw offsets. */
export function toRawRange(n: Normalized, start: number, end: number): { start: number; end: number } {
  const rawStart = n.map[start] ?? n.map[n.map.length - 1];
  // end is exclusive: take the raw offset of the last included char, plus its length.
  const lastIdx = Math.max(start, end - 1);
  const rawLast = n.map[lastIdx] ?? rawStart;
  // advance past the full raw character at rawLast (could be a surrogate pair or a ligature)
  return { start: rawStart, end: rawLast + 1 };
}
