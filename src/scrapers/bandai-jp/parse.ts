/**
 * Parse a saved Bandai cardlist HTML fixture into ScrapedCard records.
 *
 * The selectors here are based on the publicly observable structure of
 * https://www.onepiece-cardgame.com/cardlist/ as of 2026-05. Bandai
 * occasionally tweaks their markup, so anything fragile is documented
 * inline with a `// SELECTOR:` comment so it's easy to grep and update
 * after a layout change.
 *
 * The parser is **pure**: it accepts an HTML string and returns parsed
 * cards. No filesystem, no network. Errors throw so the caller can decide
 * whether to log + continue or abort the run.
 */
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { normalizeEffectText } from "@/lib/normalize";

import type { RawSetFixture, ScrapedCard } from "./types";

interface ParseOptions {
  /** Skip cards whose card_id can't be parsed; default false (throw instead). */
  lenient?: boolean;
}

const CARD_TYPE_MAP: Record<string, ScrapedCard["cardType"]> = {
  リーダー: "LEADER",
  キャラクター: "CHARACTER",
  キャラ: "CHARACTER",
  イベント: "EVENT",
  ステージ: "STAGE",
  ドン: "DON",
};

const COLOR_MAP: Record<string, string> = {
  赤: "red",
  緑: "green",
  青: "blue",
  紫: "purple",
  黒: "black",
  黄: "yellow",
};

export function parseSetHtml(
  fixture: RawSetFixture,
  opts: ParseOptions = {},
): ScrapedCard[] {
  const $ = cheerio.load(fixture.html);
  const cards: ScrapedCard[] = [];

  // SELECTOR: each card lives in `.modalCol` (modal column) on the live page.
  // Some sets render an outer `.list .modalCol` and others wrap them in a
  // generic `.cardlist .modalCol`; querying just `.modalCol` covers both.
  const nodes = $(".modalCol");
  if (nodes.length === 0) {
    throw new Error(
      `No .modalCol nodes found in fixture for ${fixture.setCode}. The Bandai layout may have changed — re-inspect data/raw/bandai-jp/${fixture.setCode}.html.`,
    );
  }

  nodes.each((_, el) => {
    try {
      cards.push(parseCardNode($, $(el), fixture));
    } catch (err) {
      if (opts.lenient) {
        console.warn(`⚠ Skipping card: ${(err as Error).message}`);
      } else {
        throw err;
      }
    }
  });

  return cards;
}

function parseCardNode(
  $: cheerio.CheerioAPI,
  node: cheerio.Cheerio<AnyNode>,
  fixture: RawSetFixture,
): ScrapedCard {
  // SELECTOR: the human-readable id ("OP01-001") is the modal heading.
  const idText = textOf(node.find(".cardNumber, .cardId, .infoCol h2").first());
  const idMatch = idText.match(/([A-Z]{2,4}\d{2,3}-\d{3,4})/);
  if (!idMatch) {
    throw new Error(`Could not parse card id from "${idText}"`);
  }
  const id = idMatch[1];
  const setCode = id.split("-")[0];

  const name = textOf(node.find(".cardName, .infoCol h1").first());
  if (!name) throw new Error(`No name found for ${id}`);

  // The rest of the data is presented as a definition list of `.col` rows
  // each with a `<dt>` label and `<dd>` value. Reading them into a Map
  // makes the field extraction order-independent.
  const fields = new Map<string, string>();
  node.find(".col, dl > div").each((_, row) => {
    const label = textOf($(row).find("dt, .label").first());
    const value = textOf($(row).find("dd, .value").first());
    if (label) fields.set(label, value);
  });

  const cardTypeRaw = fields.get("種類") ?? fields.get("カード種類") ?? "";
  const cardType =
    CARD_TYPE_MAP[cardTypeRaw.trim()] ??
    (cardTypeRaw.includes("リーダー")
      ? "LEADER"
      : cardTypeRaw.includes("キャラ")
        ? "CHARACTER"
        : cardTypeRaw.includes("イベント")
          ? "EVENT"
          : cardTypeRaw.includes("ステージ")
            ? "STAGE"
            : cardTypeRaw.includes("ドン")
              ? "DON"
              : null);
  if (!cardType) {
    throw new Error(`Unknown card type "${cardTypeRaw}" for ${id}`);
  }

  const colors = (fields.get("色") ?? "")
    .split(/[\/／\s]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => COLOR_MAP[c] ?? c.toLowerCase());

  const attributes = (fields.get("属性") ?? "")
    .split(/[\/／\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);

  const features = (fields.get("特徴") ?? "")
    .split(/[\/／・,，\s]+/)
    .map((f) => f.trim())
    .filter(Boolean);

  const effectText = normalizeEffectText(fields.get("効果"));
  const triggerText = normalizeEffectText(fields.get("トリガー"));
  const flavorText = normalizeEffectText(fields.get("フレーバー") ?? fields.get("フレーバーテキスト"));

  // SELECTOR: card image — Bandai uses /images/cardlist/card/<id>.png
  const imageSrc =
    node.find(".infoCol img, .cardImg img").attr("src") ??
    node.find("img").first().attr("src") ??
    null;
  const imageUrlJp = imageSrc ? new URL(imageSrc, fixture.url).toString() : null;

  return {
    id,
    setCode,
    cardType,
    colors,
    attributes,
    features,
    cost: parseIntOrNull(fields.get("コスト") ?? fields.get("ライフ")),
    power: parseIntOrNull(fields.get("パワー")),
    counter: parseIntOrNull(fields.get("カウンター")),
    life: cardType === "LEADER" ? parseIntOrNull(fields.get("ライフ")) : null,
    rarity: fields.get("レアリティ")?.trim() || null,
    hasTrigger: Boolean(triggerText),
    imageUrlJp,

    name,
    effectText: effectText || null,
    flavorText: flavorText || null,
    triggerText: triggerText || null,

    sourceUrl: `${fixture.url}#${id}`,
    fetchedAt: fixture.fetchedAt,
  };
}

/* helpers */

function textOf(el: cheerio.Cheerio<AnyNode>): string {
  return normalizeEffectText(el.text());
}

function parseIntOrNull(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/-?\d+/);
  return m ? Number(m[0]) : null;
}
