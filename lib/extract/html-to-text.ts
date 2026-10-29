import * as cheerio from "cheerio";

/**
 * HTML filing to plain text (PLAN.md 5.4): drop scripts, styles and hidden
 * inline-XBRL headers, table cells separated by " | ", rows by newlines,
 * block elements by newlines, whitespace collapsed within lines.
 */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, head, title").remove();
  $("ix\\:header, [style*='display:none'], [style*='display: none']").remove();

  // Table rows: join cell texts with " | ".
  $("tr").each((_, tr) => {
    const cells = $(tr)
      .find("td, th")
      .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((t) => t && t !== "$" && t !== "%" && t !== ")");
    $(tr).replaceWith(`\n${cells.join(" | ")}\n`);
  });
  $("br").replaceWith("\n");
  $("p, div, li, h1, h2, h3, h4, h5, h6, table, section, article, header, footer").each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  const text = $.root().text();
  return tidy(text);
}

export function tidy(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0\u202f]+/g, " ").trim())
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();
}
