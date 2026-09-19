/** Compact stock label used on cards and detail pages. */
export function stockLabel(stock: number): { text: string; tone: "in" | "low" | "out" } {
  if (stock <= 0) return { text: "Out of Stock", tone: "out" };
  // Only genuinely unbounded lines (SMS numbers, proxy pools) read as
  // "Unlimited" — a 150-account batch should not.
  if (stock >= 500) return { text: "Unlimited", tone: "in" };
  if (stock <= 10) return { text: `Only ${stock} left`, tone: "low" };
  return { text: "In Stock", tone: "in" };
}

/** Percentage saved, or null when there is no discount. */
export function discountPercent(price: number, original?: number): number | null {
  if (!original || original <= price) return null;
  return Math.round(((original - price) / original) * 100);
}

/**
 * Splits a flag/emoji string into whole graphemes.
 *
 * A flag is two regional-indicator code points (e.g. 🇺 + 🇸), so
 * `Array.from("🇺🇸")` yields two broken halves. This groups them correctly,
 * and keeps multi-codepoint emoji such as 🔥 or 🛡️ intact.
 */
export function splitFlags(value: string): string[] {
  if (!value) return [];
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), (s) => s.segment).filter(Boolean);
  } catch {
    // Fallback for older engines: pair up adjacent regional indicators.
    const chars = Array.from(value);
    const out: string[] = [];
    for (let i = 0; i < chars.length; i++) {
      const cp = chars[i].codePointAt(0) ?? 0;
      const isRegionalIndicator = cp >= 0x1f1e6 && cp <= 0x1f1ff;
      if (isRegionalIndicator && i + 1 < chars.length) {
        out.push(chars[i] + chars[i + 1]);
        i++;
      } else {
        out.push(chars[i]);
      }
    }
    return out;
  }
}
