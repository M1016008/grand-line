/**
 * Parse Bandai's banned/restricted card list at
 * https://www.onepiece-cardgame.com/news/restriction.html.
 *
 * Page structure (verified 2026-05-09):
 *   <h4>禁止カード</h4>      → next .editor_row > ul > li > a → IDs (max_copies = 0)
 *   <h4>制限カード</h4>      → same shape (max_copies = 1)
 *   <h4>禁止ペア</h4>        → multiple .editor_row siblings, each with a
 *                              ul containing exactly two li > a entries
 *                              (the banned pair).
 *
 * The page also lists upcoming changes ("2026年5月1日からの適用内容") and
 * archives ("禁止・制限カードの適用履歴"). For the parser to stay focused
 * we look only at the section labelled "施行済みの禁止・制限カード" — the
 * source-of-truth current state.
 *
 * Pure function. Caller passes raw HTML string + source URL; we return a
 * normalized payload the upsert layer can apply transactionally.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { normalizeEffectText } from "@/lib/normalize";

export interface ParsedRestrictions {
  bans: Array<{ cardId: string; name: string }>;
  restricted: Array<{ cardId: string; name: string; maxCopies: number }>;
  pairs: Array<{ cardIdA: string; cardIdB: string; nameA: string; nameB: string }>;
}

const CARD_ID_PATTERN = /([A-Z]{1,4}\d{0,3}-\d{3,4})/;

export function parseRestrictionsHtml(html: string): ParsedRestrictions {
  const $ = cheerio.load(html);

  // Anchor on the "施行済みの禁止・制限カード" heading. If the page layout
  // changes such that this heading disappears, throw rather than silently
  // returning empty data — that would have catastrophic UX (the validator
  // would let banned cards into decks).
  const enforcedSection = findSectionByHeading($, /施行済み/);
  if (!enforcedSection) {
    throw new Error(
      "Could not locate the '施行済みの禁止・制限カード' section. The Bandai layout may have changed — re-inspect data/raw/bandai-jp/regulations.html.",
    );
  }

  const bans: ParsedRestrictions["bans"] = [];
  const restricted: ParsedRestrictions["restricted"] = [];
  const pairs: ParsedRestrictions["pairs"] = [];

  // Each <h4> within the section starts a sub-block. Walk siblings until
  // the next <h4> to harvest the lists belonging to that label.
  const blocks = collectH4Blocks($, enforcedSection);
  for (const block of blocks) {
    const label = normalizeEffectText(block.heading.text());
    if (label.includes("禁止カード")) {
      for (const entry of harvestSimpleEntries($, block.contentRoots)) {
        bans.push({ cardId: entry.cardId, name: entry.name });
      }
    } else if (label.includes("制限カード")) {
      for (const entry of harvestSimpleEntries($, block.contentRoots)) {
        // Page wording: "デッキに1枚のみ入れることができるカード".
        // We pin maxCopies=1 unless Bandai introduces tiered limits later.
        restricted.push({ cardId: entry.cardId, name: entry.name, maxCopies: 1 });
      }
    } else if (label.includes("禁止ペア")) {
      for (const pair of harvestPairs($, block.contentRoots)) {
        pairs.push(pair);
      }
    }
  }

  return { bans, restricted, pairs };
}

/* ──────────────────────────────────────────────────────────────────────── */

function findSectionByHeading(
  $: cheerio.CheerioAPI,
  pattern: RegExp,
): cheerio.Cheerio<AnyNode> | null {
  for (const el of $("h3").toArray()) {
    const txt = normalizeEffectText($(el).text());
    if (!pattern.test(txt)) continue;
    // Climb to the nearest "section-like" ancestor that contains the
    // h4 sub-blocks. Bandai wraps each top-level section in
    // div.col-sm-12.ui-resizable.
    let candidate: cheerio.Cheerio<AnyNode> = $(el).closest(
      ".col-sm-12.ui-resizable",
    );
    if (candidate.length === 0) candidate = $(el).parent();
    if (candidate.length > 0) return candidate;
  }
  return null;
}

interface H4Block {
  heading: cheerio.Cheerio<AnyNode>;
  /** Sibling roots between this <h4> and the next one. */
  contentRoots: cheerio.Cheerio<AnyNode>;
}

/**
 * Walk the section's direct children in document order, grouping each
 * `<h4>`-bearing block with the subsequent non-h4 blocks (the lists /
 * editor_rows) until the next `<h4>`-bearing block.
 *
 * Bandai's layout for this page reliably puts each h4 inside its own
 * `.component-text` block, immediately followed by one or more
 * `.editor_row` siblings. So the algorithm is just "scan children, start
 * a new bucket on every block that contains an h4".
 */
function collectH4Blocks(
  $: cheerio.CheerioAPI,
  section: cheerio.Cheerio<AnyNode>,
): H4Block[] {
  const out: H4Block[] = [];
  let current: H4Block | null = null;
  for (const child of section.children().toArray()) {
    const $child = $(child);
    const heading = $child.find("h4").first();
    if (heading.length > 0) {
      if (current) out.push(current);
      current = { heading, contentRoots: $() };
    } else if (current) {
      current.contentRoots = current.contentRoots.add($child);
    }
  }
  if (current) out.push(current);
  return out;
}

interface SimpleEntry {
  cardId: string;
  name: string;
}

function harvestSimpleEntries(
  $: cheerio.CheerioAPI,
  roots: cheerio.Cheerio<AnyNode>,
): SimpleEntry[] {
  const out: SimpleEntry[] = [];
  roots.find("ul li a").each((_, anchor) => {
    const text = normalizeEffectText($(anchor).text());
    const m = text.match(CARD_ID_PATTERN);
    if (!m) return;
    const id = m[1];
    const name = text.replace(CARD_ID_PATTERN, "").trim();
    out.push({ cardId: id, name });
  });
  return dedupeById(out);
}

function harvestPairs(
  $: cheerio.CheerioAPI,
  roots: cheerio.Cheerio<AnyNode>,
): ParsedRestrictions["pairs"] {
  const out: ParsedRestrictions["pairs"] = [];
  // Each pair lives in its own .editor_row containing one <ul> with 2 <li>.
  roots.find(".editor_row ul").each((_, ul) => {
    const items = $(ul).find("li a").toArray();
    if (items.length < 2) return;
    const parsed = items
      .map((a) => {
        const text = normalizeEffectText($(a).text());
        const m = text.match(CARD_ID_PATTERN);
        if (!m) return null;
        return { id: m[1], name: text.replace(CARD_ID_PATTERN, "").trim() };
      })
      .filter((x): x is { id: string; name: string } => x !== null);
    if (parsed.length !== 2) return;

    // Normalize so card_id_a < card_id_b lexicographically (matches the
    // CHECK constraint on the table).
    const [a, b] = parsed[0].id < parsed[1].id ? parsed : [parsed[1], parsed[0]];
    out.push({ cardIdA: a.id, cardIdB: b.id, nameA: a.name, nameB: b.name });
  });
  return dedupePairs(out);
}

function dedupeById<T extends { cardId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (seen.has(it.cardId)) return false;
    seen.add(it.cardId);
    return true;
  });
}

function dedupePairs(
  pairs: ParsedRestrictions["pairs"],
): ParsedRestrictions["pairs"] {
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const key = `${p.cardIdA}__${p.cardIdB}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
