/**
 * Parse a saved Bandai cardlist HTML fixture into ScrapedCard records.
 *
 * The selectors here track the structure of
 * https://www.onepiece-cardgame.com/cardlist/?series=NNNN as captured
 * on 2026-05-08. Each card is a `<dl class="modalCol" id="OP01-001">`
 * with a `<dt>` header (id + name) and a `<dd>` body containing the
 * stats and the effect text.
 *
 * Quirks worth knowing:
 *  - Parallel artworks duplicate the card with id suffixes `_p1`, `_p2`,
 *    `_p3`. We dedupe on the base id and keep the first occurrence —
 *    parallels carry no new game data.
 *  - For LEADER cards, the `<div class="cost">` actually contains
 *    LIFE (the `<h3>` label switches between "コスト" and "ライフ").
 *  - Attribute is rendered as an `<img alt="斬"/>` icon. Events use a
 *    bare "-" instead of an icon.
 *  - Counter / Power show "-" when not applicable. We map these to null.
 *  - Effect text uses 【】 corner brackets; `normalizeEffectText` folds
 *    them into [] so the mechanics extractor matches either form.
 *
 * The parser is **pure** — accepts an HTML string + base URL, returns
 * parsed cards. No filesystem, no network. Errors throw so the caller
 * can decide whether to log + continue or abort the run.
 */
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { normalizeEffectText } from "@/lib/normalize";

import type { RawSetFixture, ScrapedCard } from "./types";

interface ParseOptions {
  /** Skip cards whose data can't be parsed; default false (throw instead). */
  lenient?: boolean;
}

const COLOR_MAP: Record<string, string> = {
  赤: "red",
  緑: "green",
  青: "blue",
  紫: "purple",
  黒: "black",
  黄: "yellow",
};

const RARITY_TO_TYPE_HINT: Record<string, ScrapedCard["cardType"] | undefined> = {
  L: "LEADER",
};

const TYPE_LABELS: Record<string, ScrapedCard["cardType"]> = {
  LEADER: "LEADER",
  CHARACTER: "CHARACTER",
  EVENT: "EVENT",
  STAGE: "STAGE",
  DON: "DON",
};

export function parseSetHtml(
  fixture: RawSetFixture,
  opts: ParseOptions = {},
): ScrapedCard[] {
  const $ = cheerio.load(fixture.html);
  const out: ScrapedCard[] = [];
  const seen = new Set<string>(); // dedupe parallel artworks by base id

  const nodes = $("dl.modalCol");
  if (nodes.length === 0) {
    throw new Error(
      `No .modalCol nodes found in fixture for ${fixture.setCode}. The Bandai layout may have changed — re-inspect data/raw/bandai-jp/${fixture.setCode}.html.`,
    );
  }

  nodes.each((_, el) => {
    try {
      const card = parseCardNode($, $(el), fixture);
      const baseId = card.id; // already stripped of `_pN`
      if (seen.has(baseId)) return;
      seen.add(baseId);
      out.push(card);
    } catch (err) {
      if (opts.lenient) {
        console.warn(`⚠ Skipping card: ${(err as Error).message}`);
      } else {
        throw err;
      }
    }
  });

  return out;
}

function parseCardNode(
  $: cheerio.CheerioAPI,
  node: cheerio.Cheerio<AnyNode>,
  fixture: RawSetFixture,
): ScrapedCard {
  // The infoCol holds three `<span>`s separated by `|`: id, rarity, type.
  // Reading via the spans is more robust than text-splitting because
  // Bandai sometimes wraps with whitespace/icons.
  const infoSpans = node.find(".infoCol > span");
  if (infoSpans.length < 3) {
    throw new Error(`infoCol missing required spans for ${node.attr("id") ?? "?"}`);
  }
  const idRaw = textOf($(infoSpans[0]));
  const rarity = textOf($(infoSpans[1])) || null;
  const typeText = textOf($(infoSpans[2]));

  const idMatch = idRaw.match(/([A-Z]{2,4}\d{2,3}-\d{3,4})/);
  if (!idMatch) throw new Error(`Could not parse card id from "${idRaw}"`);
  const id = idMatch[1]; // OP01-001 (parallels' `_p2` etc never appear in the span text)
  const setCode = id.split("-")[0];

  let cardType: ScrapedCard["cardType"] | null = TYPE_LABELS[typeText.toUpperCase()] ?? null;
  if (!cardType) {
    cardType = RARITY_TO_TYPE_HINT[rarity ?? ""] ?? null;
  }
  if (!cardType) throw new Error(`Unknown card type "${typeText}" for ${id}`);

  const name = textOf(node.find(".cardName").first());
  if (!name) throw new Error(`No cardName for ${id}`);

  // Stats. The `<h3>` label distinguishes コスト vs ライフ inside `.cost`.
  const cost = pickStatLabelled(node, ".cost", "コスト");
  const life = pickStatLabelled(node, ".cost", "ライフ");
  const power = pickStat(node, ".power");
  const counter = pickStat(node, ".counter");

  // Color uses `/` as separator between dual colors.
  const colorRaw = stripLabel(node.find(".color").first());
  const colors = colorRaw
    .split(/[\/／]/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => COLOR_MAP[c] ?? c.toLowerCase());

  const features = stripLabel(node.find(".feature").first())
    .split(/[\/／]/)
    .map((f) => f.trim())
    .filter(Boolean);

  // Attribute is the `alt` attribute of the icon image; events display "-".
  const attrAlt = node.find(".attribute img").attr("alt") ?? "";
  const attributes = attrAlt && attrAlt !== "-" ? [attrAlt.trim()] : [];

  const effectText = normalizeEffectText(extractTextWithBreaks(node.find(".text").first()));
  const triggerText = normalizeEffectText(extractTextWithBreaks(node.find(".trigger").first()));

  // Image lives in <img class="lazy" data-src="..."> with src="dummy.gif".
  // We resolve the relative path against the page URL so storing it as-is
  // remains usable from the browser.
  const dataSrc = node.find(".frontCol img.lazy").attr("data-src") ?? null;
  const imageUrlJp = dataSrc ? new URL(dataSrc, fixture.url).toString() : null;

  return {
    id,
    setCode,
    cardType,
    colors,
    attributes,
    features,
    cost: cardType === "LEADER" ? null : cost,
    power,
    counter,
    life: cardType === "LEADER" ? life : null,
    rarity,
    hasTrigger: Boolean(triggerText),
    imageUrlJp,

    name,
    effectText: effectText || null,
    flavorText: null, // Bandai cardlist doesn't expose flavor in this view
    triggerText: triggerText || null,

    sourceUrl: `${fixture.url}#${id}`,
    fetchedAt: fixture.fetchedAt,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* helpers                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

function textOf(el: cheerio.Cheerio<AnyNode>): string {
  return normalizeEffectText(el.text());
}

/**
 * Read a `<div class="cost"><h3>コスト</h3>4</div>` style stat. Returns
 * null when the `<h3>` doesn't match the expected label (so we can
 * disambiguate `<div class="cost">` between cost and life).
 */
function pickStatLabelled(
  node: cheerio.Cheerio<AnyNode>,
  selector: string,
  expectedLabel: string,
): number | null {
  const el = node.find(selector).first();
  if (el.length === 0) return null;
  const label = el.find("h3").first().text().trim();
  if (!label.includes(expectedLabel)) return null;
  return parseStat(stripLabel(el));
}

function pickStat(node: cheerio.Cheerio<AnyNode>, selector: string): number | null {
  const el = node.find(selector).first();
  if (el.length === 0) return null;
  return parseStat(stripLabel(el));
}

function parseStat(raw: string): number | null {
  const m = raw.match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * Take the text content of an element after removing its `<h3>` label.
 * Bandai consistently uses `<h3>` as the label and the value as the
 * trailing text node (or, for attribute, an `<img>`).
 */
function stripLabel(el: cheerio.Cheerio<AnyNode>): string {
  if (el.length === 0) return "";
  const clone = el.clone();
  clone.find("h3").remove();
  return normalizeEffectText(clone.text());
}

/**
 * Extract text content while preserving `<br>` as newlines so that
 * multi-line effect text (e.g. two timing markers chained on one card)
 * stays readable in the UI and the FTS index. Cheerio's default `.text()`
 * collapses `<br>` into nothing.
 */
function extractTextWithBreaks(el: cheerio.Cheerio<AnyNode>): string {
  if (el.length === 0) return "";
  const clone = el.clone();
  clone.find("h3").remove();
  clone.find("br").replaceWith("\n");
  return clone.text();
}
