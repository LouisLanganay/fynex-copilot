/**
 * No-advice guardrail (PLAN.md section 6), layers 2 and 3.
 * Layer 1 is the system instruction in lib/llm/prompts.ts.
 *
 * Matching is case and accent insensitive. The output filter runs on
 * model-written fields only, never on quotes: a filing may legitimately say
 * "agreement to sell a subsidiary".
 */

export const REFUSAL =
  "I can't give buy or sell advice. I can show you what the company's documents say, with sources.";

/** Lowercase, strip accents, straighten apostrophes. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .toLowerCase();
}

const ACTIONS_EN = "buy|sell|hold|add|trim|exit|keep|dump|short|reduce|increase|load up on|get out of|invest in|take profits?";
const ACTIONS_FR = "acheter|vendre|garder|conserver|renforcer|alleger|solder|liquider|sortir|investir|prendre (mes|des|les) benefices";

/** Questions asking for advice, a rating or a price prediction. */
export const INPUT_PATTERNS: RegExp[] = [
  new RegExp(`\\b(should|shall|must|would|could) (i|we|you|one) (still )?(${ACTIONS_EN})\\b`),
  new RegExp(`\\b(is it|is now|now is) (a good |the right )?(time|moment) to (${ACTIONS_EN})\\b`),
  new RegExp(`\\b(when|whether) (to|should i) (${ACTIONS_EN})\\b`),
  new RegExp(`\\b(${ACTIONS_EN}) or (${ACTIONS_EN})\\b`),
  new RegExp(`\\bdo you recommend\\b|\\bwhat do you recommend\\b|\\byour recommendation\\b`),
  /\b(price target|target price|fair value|intrinsic value)\b/,
  /\b(overvalued|undervalued|over-valued|under-valued|cheap|expensive) (stock|share|now)?\b.*\?|\bis (it|the stock|this stock|[a-z']+) (overvalued|undervalued|cheap|expensive)\b/,
  /\bgood (investment|buy|stock to (own|buy))\b|\bbad investment\b|\bworth (buying|investing)\b/,
  /\b(will|is) (the )?(stock|share|price|shares)( price)? (go|going|likely to go) (up|down)\b|\bwhere (will|is) the (stock|share price) (go|going|heading)\b/,
  /\b(rating|buy rating|sell rating|strong buy)\b/,
  /\bhow much (should|do) i (buy|sell|invest|put)\b/,
  // French
  new RegExp(`\\b(dois|devrais|devrions|doit|faut|faudrait)[- ]?(je|on|il|t[- ]il)?\\b.*\\b(${ACTIONS_FR})\\b`),
  new RegExp(`\\b(c'est|est-ce) (le |un )?(bon )?moment (pour|d') ?(${ACTIONS_FR})\\b`),
  new RegExp(`\\b(${ACTIONS_FR}) ou (${ACTIONS_FR})\\b`),
  /\bobjectif de cours\b|\bcours cible\b|\bjuste valeur\b/,
  /\bconseils? (d'investissement|en investissement|d'achat|de vente)\b|\btu (me )?(conseilles|recommandes)\b|\bvous (me )?(conseillez|recommandez)\b/,
  /\b(bon|mauvais) (investissement|placement)\b|\b(sur|sous)[- ]?evalue(e)?s?\b/,
  /\b(le cours|l'action|le titre) (va|risque de) (monter|baisser|chuter|grimper)\b/,
];

/** Advice phrasing that must never appear in model-written text. */
export const OUTPUT_PATTERNS: RegExp[] = [
  /\bwe recommend\b|\bi recommend\b|\bwe suggest\b|\bi suggest\b|\bour recommendation\b|\bmy recommendation\b/,
  new RegExp(`\\b(you|investors|holders|shareholders) (should|may want to|might want to|could|ought to|need to) (consider )?(${ACTIONS_EN}|rebalance|diversify|wait|stay)\\b`),
  /\b(buy|sell|hold|outperform|underperform|overweight|underweight|neutral) (rating|recommendation|call)\b/,
  /\bstrong (buy|sell)\b|\bprice target\b|\btarget price\b|\bfair value\b|\bupside potential\b|\bdownside risk to the (stock|share price)\b/,
  /\btime to (buy|sell|exit|take profits?)\b|\bgood (time|moment|entry point) to\b|\bbuying opportunity\b|\bentry point\b/,
  /\bconsider (buying|selling|adding|trimming|reducing|exiting|increasing|rebalancing|taking profits)\b/,
  /\b(the )?(stock|shares?|share price) (is|are|looks?) (cheap|expensive|overvalued|undervalued|attractive|a bargain)\b|\b(overvalued|undervalued)\b/,
  /\b(the )?(stock|shares?|share price) (will|should|is likely to|is expected to|could) (rise|fall|go up|go down|rally|drop|climb|decline|rebound)\b/,
  /\bgood investment\b|\bbad investment\b|\bsafe bet\b|\bmust[- ]own\b/,
  // French (outputs are English, but the filter also covers French)
  /\b(acheter|vendre|renforcer|alleger|solder) (vos|les|des|ce|cette|l')\b|\bje (vous )?recommande\b|\bnous recommandons\b|\bobjectif de cours\b|\bil faut (acheter|vendre|renforcer|alleger)\b/,
];

export function isAdviceRequest(question: string): boolean {
  const f = fold(question);
  return INPUT_PATTERNS.some((r) => r.test(f));
}

/** Returns the first advice phrase found in the text, or null. */
export function findAdvice(text: string): string | null {
  const f = fold(text);
  for (const r of OUTPUT_PATTERNS) {
    const m = f.match(r);
    if (m) return m[0];
  }
  return null;
}
