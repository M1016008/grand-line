/**
 * Per-card compatibility ranking — drives the "相性の良いカード Top N"
 * section on /cards/[id]. Two layers feed it:
 *
 *   1. Rule-based card-to-card edges (`detectCompatibilityFor`). Cheap,
 *      runs on every page load.
 *   2. AI-tagged rows in `card_synergies` that touch this card from
 *      either side. Runs as a single indexed query.
 *
 * The two are merged on the (other_id, relation_type) key — AI wins on
 * collision (same logic as the leader-relative graph in `synergy-data.ts`).
 * Other LEADER cards are excluded from the result so the Top N reflects
 * actual deck-eligible companions.
 */
import "server-only";

import { and, eq, ne, or } from "drizzle-orm";

import { db, schema } from "@/db";
import { listCards, type CardListItem } from "@/lib/cards";
import {
  detectCompatibilityFor,
  type RuleSynergy,
} from "@/lib/synergy-rules";

export interface CompatibleCard {
  card: CardListItem;
  /** 0–10. Higher = stronger compatibility. */
  strength: number;
  relationType: RuleSynergy["relationType"];
  reasoningJa: string;
  /** Provenance for the UI badge — AI rows get a "未確認" hint. */
  source: "rules" | "ai";
}

/**
 * Find the Top N cards that synergise with `cardId`. Returns sorted
 * by descending strength. Excludes the source card and other LEADERS.
 */
export async function getCompatibleCards(
  cardId: string,
  limit = 5,
): Promise<CompatibleCard[]> {
  const all = await listCards({ pageSize: 5000 });
  const target = all.cards.find((c) => c.id === cardId);
  if (!target) return [];

  // Pool: same-colour, non-leader, not the target itself.
  // Same-colour matches the deck-builder's mental model (off-colour cards
  // can't share a deck with the target).
  const targetColors = new Set(target.colors);
  const pool = all.cards.filter(
    (c) =>
      c.id !== target.id &&
      c.cardType !== "LEADER" &&
      c.colors.some((col) => targetColors.has(col)),
  );

  const ruleEdges = detectCompatibilityFor(target, pool);

  // Pull every AI row touching the target.
  let aiEdges: RuleSynergy[] = [];
  try {
    const rows = await db
      .select({
        fromCardId: schema.cardSynergies.fromCardId,
        toCardId: schema.cardSynergies.toCardId,
        relationType: schema.cardSynergies.relationType,
        strength: schema.cardSynergies.strength,
        reasoningJa: schema.cardSynergies.reasoningJa,
        reasoningEn: schema.cardSynergies.reasoningEn,
      })
      .from(schema.cardSynergies)
      .where(
        and(
          eq(schema.cardSynergies.detectedBy, "ai"),
          or(
            eq(schema.cardSynergies.fromCardId, target.id),
            eq(schema.cardSynergies.toCardId, target.id),
          )!,
          ne(schema.cardSynergies.relationType, "leader_direct"),
        ),
      );
    aiEdges = rows.map((r) => ({
      fromCardId: r.fromCardId,
      toCardId: r.toCardId,
      relationType: r.relationType,
      strength: r.strength,
      reasoningJa: r.reasoningJa ?? "",
      reasoningEn: r.reasoningEn ?? "",
    }));
  } catch {
    /* table missing — stay rules-only */
  }

  // Build per-(other_id, relationType) map. AI wins on collision.
  type Bucket = { edge: RuleSynergy; source: "rules" | "ai" };
  const merged = new Map<string, Bucket>();
  const otherOf = (e: RuleSynergy) =>
    e.fromCardId === target.id ? e.toCardId : e.fromCardId;
  for (const e of ruleEdges) {
    const other = otherOf(e);
    merged.set(`${other}::${e.relationType}`, { edge: e, source: "rules" });
  }
  for (const e of aiEdges) {
    const other = otherOf(e);
    merged.set(`${other}::${e.relationType}`, { edge: e, source: "ai" });
  }

  // Collapse to one row per partner card — keep the strongest relation
  // type per partner so we don't show "tempo + defense + feature" rows
  // for the same card three times.
  const byPartner = new Map<string, Bucket>();
  for (const b of merged.values()) {
    const partnerId = otherOf(b.edge);
    const cur = byPartner.get(partnerId);
    if (!cur || b.edge.strength > cur.edge.strength) {
      byPartner.set(partnerId, b);
    }
  }

  const cardById = new Map(all.cards.map((c) => [c.id, c]));
  const results: CompatibleCard[] = [];
  for (const b of byPartner.values()) {
    const partner = cardById.get(otherOf(b.edge));
    if (!partner || partner.cardType === "LEADER") continue;
    results.push({
      card: partner,
      strength: b.edge.strength,
      relationType: b.edge.relationType,
      reasoningJa: b.edge.reasoningJa,
      source: b.source,
    });
  }

  results.sort(
    (a, b) =>
      b.strength - a.strength || a.card.id.localeCompare(b.card.id),
  );
  return results.slice(0, limit);
}
