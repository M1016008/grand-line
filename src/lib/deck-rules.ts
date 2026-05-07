/**
 * Deck construction rules for One Piece TCG (Standard).
 *
 * Pure validation logic, framework-free, exported in a shape the deck
 * builder UI can render directly. Each rule produces a discriminated
 * object so the UI can sort by `severity` and link back to the offending
 * card list.
 *
 * Reference: https://en.onepiece-cardgame.com/rules/
 *  - 1 leader card per deck.
 *  - Exactly 50 non-leader cards.
 *  - At most 4 copies of any card with the same id (DON!! is separate).
 *  - Every card must share at least one color with the leader's colors.
 *  - Color count: standard decks use the leader's color set only.
 */

export interface DeckRuleCard {
  id: string;
  cardType: string;
  colors: string[];
  count: number;
}

export interface DeckLeader {
  id: string;
  name: string;
  colors: string[];
}

export type RuleSeverity = "error" | "warning" | "info";

export interface RuleViolation {
  code: string;
  severity: RuleSeverity;
  message: string;
  cardIds?: string[];
}

export interface DeckRuleReport {
  legal: boolean;
  totalCount: number;
  violations: RuleViolation[];
}

const TARGET_COUNT = 50;
const MAX_PER_CARD = 4;

export function validateDeck(
  leader: DeckLeader | null,
  cards: DeckRuleCard[],
): DeckRuleReport {
  const violations: RuleViolation[] = [];
  const totalCount = cards.reduce((acc, c) => acc + c.count, 0);

  if (!leader) {
    violations.push({
      code: "no_leader",
      severity: "error",
      message: "リーダーが選択されていません。",
    });
  }

  // Total count
  if (totalCount !== TARGET_COUNT) {
    violations.push({
      code: "deck_count",
      severity: totalCount === 0 ? "info" : "error",
      message: `デッキ枚数は ${TARGET_COUNT} 枚 (現在 ${totalCount} 枚)。`,
    });
  }

  // No leader cards in the 50-card pile.
  const misplacedLeaders = cards.filter((c) => c.cardType === "LEADER");
  if (misplacedLeaders.length > 0) {
    violations.push({
      code: "leader_in_deck",
      severity: "error",
      message: "リーダーカードはメインデッキに入れられません。",
      cardIds: misplacedLeaders.map((c) => c.id),
    });
  }

  // Per-card 4 limit.
  const overLimit = cards.filter((c) => c.count > MAX_PER_CARD);
  if (overLimit.length > 0) {
    violations.push({
      code: "over_four_copies",
      severity: "error",
      message: `1 種類につき最大 ${MAX_PER_CARD} 枚です。`,
      cardIds: overLimit.map((c) => c.id),
    });
  }
  const negative = cards.filter((c) => c.count < 1);
  if (negative.length > 0) {
    violations.push({
      code: "non_positive_count",
      severity: "error",
      message: "枚数が 1 未満のカードが含まれています。",
      cardIds: negative.map((c) => c.id),
    });
  }

  // Color match: at least one shared color with the leader.
  if (leader) {
    const leaderColors = new Set(leader.colors);
    const offColor = cards.filter(
      (c) => !c.colors.some((col) => leaderColors.has(col)),
    );
    if (offColor.length > 0) {
      violations.push({
        code: "off_color",
        severity: "error",
        message: `リーダーの色 (${leader.colors.join(" / ")}) と一致しないカードがあります。`,
        cardIds: offColor.map((c) => c.id),
      });
    }
  }

  const legal =
    violations.filter((v) => v.severity === "error").length === 0 && Boolean(leader);

  return { legal, totalCount, violations };
}

/** Cost-curve histogram for the curve chart. Returns count by integer cost (8 = 8+). */
export function costCurve(cards: DeckRuleCard[]): Record<number, number> {
  const buckets: Record<number, number> = {};
  for (let i = 0; i <= 8; i++) buckets[i] = 0;
  for (const c of cards) {
    // Cost is irrelevant for cards without one (e.g. dummy entries) — skip.
    const cost = (c as DeckRuleCard & { cost?: number | null }).cost ?? null;
    if (cost === null) continue;
    const bucket = cost >= 8 ? 8 : Math.max(0, cost);
    buckets[bucket] += c.count;
  }
  return buckets;
}

/** Color ratio for the leader sanity badge. */
export function colorRatio(cards: DeckRuleCard[]): Record<string, number> {
  const total = cards.reduce((a, c) => a + c.count, 0) || 1;
  const out: Record<string, number> = {};
  for (const c of cards) {
    for (const col of c.colors) {
      out[col] = (out[col] ?? 0) + c.count / total;
    }
  }
  return out;
}
