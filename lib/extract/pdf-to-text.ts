import { tidy } from "./html-to-text";

/**
 * PDF to text per page (PLAN.md 5.4), with a page offset table so a quote
 * offset maps back to a page number.
 */

export interface PdfText {
  text: string;
  pageStarts: number[];
  pages: number;
  /** Average characters per page: below SCANNED_THRESHOLD the PDF is likely scanned. */
  charsPerPage: number;
}

export const SCANNED_THRESHOLD = 200;

export function joinPages(pages: string[]): PdfText {
  let text = "";
  const pageStarts: number[] = [];
  for (const p of pages) {
    if (text) text += "\n\n";
    pageStarts.push(text.length);
    text += tidy(p);
  }
  const charsPerPage = pages.length ? Math.round(pages.reduce((s, p) => s + p.trim().length, 0) / pages.length) : 0;
  return { text, pageStarts, pages: pages.length, charsPerPage };
}

export async function pdfToText(bytes: Uint8Array): Promise<PdfText> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js may detach the buffer: give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: false });
  return joinPages(text);
}

export function looksScanned(p: PdfText): boolean {
  return p.pages > 0 && p.charsPerPage < SCANNED_THRESHOLD;
}
