/**
 * Discover new Bandai dropdown entries by re-fetching the cardlist root.
 *
 * Bandai adds a new pack about every 3-4 months. Rather than editing
 * `SERIES_PARAM` by hand each time, the discover flow:
 *
 *   1. Fetches https://www.onepiece-cardgame.com/cardlist/ (one request).
 *   2. Parses the `<select id="series">` dropdown to extract every
 *      `(seriesId, label)` pair it contains.
 *   3. Auto-derives a `setCode` from the label's `【XX-NN】` suffix
 *      (e.g. "ブースターパック … 【OP-16】" → "OP16"). Falls back to
 *      `series-NNN` when the label has no bracketed code.
 *   4. Diffs against the static `SERIES_PARAM` table + the
 *      `scrape_targets` DB table.
 *   5. Returns the diff to the caller — *does not* persist or scrape.
 *      Persistence is the caller's choice (UI shows the diff first,
 *      user clicks "取り込む" to commit).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";
import { chromium } from "playwright";

import { SERIES_PARAM } from "./fetch";

export interface DropdownOption {
  seriesId: string;
  label: string;
  /** Best-effort set code parsed from the label. May be null when the
   * label has no `【XX-NN】` bracket (e.g. "プロモーションカード"). */
  setCode: string | null;
}

export interface DiscoveryReport {
  fetchedAt: Date;
  url: string;
  /** Every option the dropdown currently lists. */
  options: DropdownOption[];
  /** Options whose seriesId is *not* in SERIES_PARAM and not already in scrape_targets. */
  newOptions: DropdownOption[];
  /** Options where we couldn't auto-derive a set code (manual input needed). */
  unresolvedOptions: DropdownOption[];
}

const URL = "https://www.onepiece-cardgame.com/cardlist/";
const FIXTURE_PATH = path.resolve("data/raw/bandai-jp/cardlist-root.html");

const SET_CODE_PATTERN = /【([A-Z]+)-([0-9]+)】/;

export function parseDropdown(html: string): DropdownOption[] {
  const $ = cheerio.load(html);
  const out: DropdownOption[] = [];
  $("select#series option").each((_, el) => {
    const value = $(el).attr("value")?.trim() ?? "";
    if (!value) return; // skip the "ALL" placeholder
    // Bandai uses raw HTML inside the option text (e.g. <br class="spInline">).
    // We collapse whitespace and strip the BR placeholder.
    const labelHtml = $(el).html() ?? "";
    const labelText = labelHtml
      .replace(/<br[^>]*>/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const match = labelText.match(SET_CODE_PATTERN);
    const setCode = match ? `${match[1]}${match[2]}` : null;
    out.push({ seriesId: value, label: labelText, setCode });
  });
  return out;
}

export async function fetchAndPersistRoot(): Promise<string> {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      locale: "ja-JP",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });
    const html = await page.content();
    await mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
    await writeFile(FIXTURE_PATH, html, "utf-8");
    return html;
  } finally {
    await browser.close();
  }
}

interface DiscoverOptions {
  fromFixture?: boolean;
  /** seriesId values already in scrape_targets. */
  knownDbSeriesIds?: Set<string>;
}

export async function discover(opts: DiscoverOptions = {}): Promise<DiscoveryReport> {
  const html = opts.fromFixture
    ? await (await import("node:fs/promises")).readFile(FIXTURE_PATH, "utf-8")
    : await fetchAndPersistRoot();
  const options = parseDropdown(html);

  const staticSeries = new Set(Object.values(SERIES_PARAM));
  const dbSeries = opts.knownDbSeriesIds ?? new Set<string>();

  const newOptions: DropdownOption[] = [];
  const unresolvedOptions: DropdownOption[] = [];
  for (const opt of options) {
    const isKnown = staticSeries.has(opt.seriesId) || dbSeries.has(opt.seriesId);
    if (isKnown) continue;
    if (opt.setCode === null) {
      unresolvedOptions.push(opt);
    } else {
      newOptions.push(opt);
    }
  }

  return {
    fetchedAt: new Date(),
    url: URL,
    options,
    newOptions,
    unresolvedOptions,
  };
}
