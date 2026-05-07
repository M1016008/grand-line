/**
 * Server-side synergy graph fetcher.
 *
 * Today this runs the rule-based detector on demand: cheap (pure TS) and
 * good enough to ship the visualisation without a Claude API key.
 *
 * Once `card_synergies` rows are populated by the AI pipeline, this
 * module will switch to a "DB first, rules as fallback / merge" strategy:
 * read AI-tagged edges from the table and union them with fresh rule
 * edges (rule wins on duplicate key, since AI tends to be wordier).
 */
import "server-only";

import { eq } from "drizzle-orm";

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
  // Fetch leader (must exist in DB or mock fallback).
  const all = await listCards({}, 500);
  const leader = all.cards.find((c) => c.id === leaderId);
  if (!leader || leader.cardType !== "LEADER") return null;

  // Restrict the candidate pool to cards that share at least one colour
  // with the leader — synergy edges between off-colour cards are
  // structurally invalid for the deck builder anyway.
  const leaderColors = new Set(leader.colors);
  const pool = all.cards.filter(
    (c) => c.colors.some((col) => leaderColors.has(col)),
  );

  const edges = detectRuleSynergies(leader, pool);

  // Future hook: union with AI-tagged rows. We try to read but tolerate
  // failure (table may be empty or DB may be missing in dev).
  let aiEdgeCount = 0;
  try {
    const rows = await db
      .select()
      .from(schema.cardSynergies)
      .where(eq(schema.cardSynergies.detectedBy, "ai"));
    aiEdgeCount = rows.length;
    // TODO(phase 3.5b): merge `rows` into `edges` once the AI pipeline writes
    // them. Today the table is empty so this is just a probe.
  } catch {
    /* table missing or db unreachable in mock mode — ignore. */
  }

  return {
    leader,
    pool,
    edges,
    source: aiEdgeCount > 0 ? "rules+ai" : "rules",
  };
}
