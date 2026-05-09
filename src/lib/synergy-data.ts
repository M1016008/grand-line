/**
 * Server-side synergy graph fetcher.
 *
 * Two layers feed the graph:
 *   1. The rule-based detector — cheap, runs on every request, gives
 *      decent coverage even without an API key.
 *   2. AI-tagged rows persisted in `card_synergies` by the
 *      `ai:synergy` CLI (Phase 3.5b). Merged in on top of the rules so
 *      the graph picks up any nuanced relationships the regex layer
 *      can't see.
 *
 * Merge policy: an AI row for a (from, to, relation_type) triple
 * REPLACES the rule-layer's row. The AI strength is on a 0–10 scale
 * (rules cap at 7) so the AI naturally wins when both layers fire.
 * The UI badge reads "rules+ai" whenever at least one AI row exists
 * for the leader's pool.
 */
import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";

import { db, schema } from "@/db";
import { listCards, type CardListItem } from "@/lib/cards";
import { detectRuleSynergies, type RuleSynergy } from "@/lib/synergy-rules";

export interface SynergyGraphData {
  leader: CardListItem;
  pool: CardListItem[];
  edges: RuleSynergy[];
  /** UI badge: are we drawing rule-only edges, or AI-augmented? */
  source: "rules" | "rules+ai";
}

export async function getSynergyGraph(leaderId: string): Promise<SynergyGraphData | null> {
  // First fetch the leader directly so we know its colours.
  const all = await listCards({ pageSize: 5000 });
  const leader = all.cards.find((c) => c.id === leaderId);
  if (!leader || leader.cardType !== "LEADER") return null;

  // Restrict the candidate pool to cards that:
  //   - share at least one colour with the leader (synergy edges between
  //     off-colour cards are structurally invalid for the deck builder), and
  //   - are not themselves LEADER cards. Leaders can't go in another
  //     leader's deck, so a leader→leader edge (e.g. イム → ペローナ) is
  //     misleading even when the rule detector finds shared features.
  const leaderColors = new Set(leader.colors);
  const pool = all.cards.filter(
    (c) =>
      c.cardType !== "LEADER" &&
      c.colors.some((col) => leaderColors.has(col)),
  );

  const ruleEdges = detectRuleSynergies(leader, pool);

  // Pull AI-tagged rows that touch the leader (either side of the edge).
  // We deliberately don't pull every AI row — most are for other leaders
  // and would just bloat the merge.
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
            eq(schema.cardSynergies.fromCardId, leader.id),
            eq(schema.cardSynergies.toCardId, leader.id),
          )!,
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
    /* table missing or db unreachable — ignore, stay rules-only. */
  }

  // Merge: AI rows override rule rows on the same (from, to, type) key.
  const key = (e: RuleSynergy) =>
    `${e.fromCardId}__${e.toCardId}__${e.relationType}`;
  const merged = new Map<string, RuleSynergy>();
  for (const e of ruleEdges) merged.set(key(e), e);
  for (const e of aiEdges) merged.set(key(e), e);

  const edges = [...merged.values()].sort(
    (a, b) =>
      b.strength - a.strength ||
      a.fromCardId.localeCompare(b.fromCardId) ||
      a.toCardId.localeCompare(b.toCardId),
  );

  // Suppress unused-import warning.
  void isNull;

  return {
    leader,
    pool,
    edges,
    source: aiEdges.length > 0 ? "rules+ai" : "rules",
  };
}
