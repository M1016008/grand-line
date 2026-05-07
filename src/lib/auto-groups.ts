/**
 * Heuristic seed groupings for the probability panel.
 *
 * The probability engine itself is content-agnostic — it just needs
 * `{groupId → cardIds[]}`. But asking the user to bucket every card
 * before they see any output is a non-starter. So we infer reasonable
 * defaults from the mechanics array (already populated by the scraper +
 * mock data) and let the user reshuffle from there.
 *
 * Each rule is intentionally narrow to avoid double-counting: a card
 * can belong to multiple groups (e.g. a Rush finisher is in both
 * "フィニッシャー" and "速攻"), but we don't auto-add the same card to
 * groups whose meanings overlap (e.g. "キーカード" is reserved for
 * manual additions).
 */

import type { CardListItem } from "@/lib/cards";

export interface SeededGroup {
  id: string;
  label: string;
  description: string;
  cardIds: string[];
}

export const DEFAULT_GROUP_IDS = [
  "key",
  "finisher",
  "resource",
  "removal",
  "defense",
] as const;

export type DefaultGroupId = (typeof DEFAULT_GROUP_IDS)[number];

interface DeckCardLike {
  card: CardListItem;
  count: number;
}

export function seedGroups(entries: DeckCardLike[]): SeededGroup[] {
  const ids = entries.map((e) => e.card.id);
  const set = new Set(ids);

  function pick(predicate: (c: CardListItem) => boolean): string[] {
    return entries
      .filter((e) => set.has(e.card.id) && predicate(e.card))
      .map((e) => e.card.id);
  }

  return [
    {
      id: "key",
      label: "キーカード",
      description:
        "デッキの中核となる札。デフォルトでは [登場時] 効果のキャラを暫定登録 — 必要に応じて入れ替えてください。",
      cardIds: pick(
        (c) =>
          c.cardType === "CHARACTER" && c.mechanics.includes("OnPlay"),
      ),
    },
    {
      id: "finisher",
      label: "フィニッシャー",
      description: "コスト6以上、または [速攻] を持つキャラ・イベント。",
      cardIds: pick(
        (c) =>
          (c.cost ?? 0) >= 6 || c.mechanics.includes("Rush"),
      ),
    },
    {
      id: "resource",
      label: "リソース",
      description: "サーチ・ドロー・ルック効果でリソースを稼ぐカード。",
      cardIds: pick((c) =>
        c.mechanics.some((m) => m === "Search" || m === "Draw" || m === "Look"),
      ),
    },
    {
      id: "removal",
      label: "除去",
      description: "バニッシュ・KO・トラッシュ送り・手札戻しなどの除去カード。",
      cardIds: pick((c) =>
        c.mechanics.some(
          (m) => m === "Banish" || m === "Trash" || m === "OnKO" || m === "ReturnToHand",
        ),
      ),
    },
    {
      id: "defense",
      label: "防御",
      description: "[ブロッカー] / カウンター≥2000 / ライフ回復のいずれか。",
      cardIds: pick(
        (c) =>
          c.mechanics.includes("Blocker") ||
          c.mechanics.includes("RestoreLife") ||
          (c.counter ?? 0) >= 2000,
      ),
    },
  ];
}

export function groupColor(id: string, fallback = "var(--color-primary)"): string {
  switch (id) {
    case "key":
      return "var(--color-syn-leader)";
    case "finisher":
      return "var(--color-syn-attack)";
    case "resource":
      return "var(--color-syn-resource)";
    case "removal":
      return "var(--color-syn-feature)";
    case "defense":
      return "var(--color-syn-defense)";
    default:
      return fallback;
  }
}
