/**
 * Text normalization helpers for One Piece TCG card text.
 *
 * Bandai's official site mixes 全角 / 半角 forms freely, and effect text
 * frequently contains zero-width spaces and stray full-width punctuation.
 * Everything that goes into FTS5, regex matching, or AI prompts should
 * pass through `normalizeEffectText` first so downstream code can rely on
 * a single canonical form.
 */

const ZERO_WIDTH = /[​-‍﻿]/g;
const NBSP = / /g;
/** Run of two or more whitespace chars (after NFKC) → single ASCII space. */
const COLLAPSE_WS = /[\s　]+/g;
/**
 * NFKC does *not* fold the corner brackets 【】 (Bandai's keyword
 * markers, e.g. 【ブロッカー】) into ASCII square brackets. Folding them
 * here lets the same regex `\[ブロッカー\]` match either form coming
 * from the scraper, manual entry, or AI translations.
 */
const FOLD_BRACKETS: Array<[RegExp, string]> = [
  [/【/g, "["], // 【
  [/】/g, "]"], // 】
];

/**
 * Normalize raw effect / flavor / trigger text from a Bandai card detail.
 *
 *  1. NFKC — folds 全角 ASCII to ASCII (Ｄｏｎ → Don, ！ → !, ‼ → !!).
 *  2. Strip zero-width and replace NBSP / 全角 space with regular space.
 *  3. Fold 【】 into [].
 *  4. Collapse runs of whitespace.
 *  5. Trim.
 *
 * Returns "" for nullish input so the caller can store `''` in the DB and
 * keep `effect_normalized` non-null without coalesce-everywhere noise.
 */
export function normalizeEffectText(input: string | null | undefined): string {
  if (!input) return "";
  let out = input
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(NBSP, " ");
  for (const [pat, repl] of FOLD_BRACKETS) out = out.replace(pat, repl);
  return out.replace(COLLAPSE_WS, " ").trim();
}
