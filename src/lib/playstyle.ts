/**
 * Server-side reader for `card_playstyles`. Returns null when the row
 * is missing (the card hasn't been processed by `ai:playstyle` yet) so
 * the UI can render a graceful "未生成" state instead of erroring.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

export interface CardPlaystyle {
  cardId: string;
  whenToPlayJa: string;
  shinesInJa: string;
  vsOpponentJa: string;
  aiModelVersion: string;
}

export async function getCardPlaystyle(
  cardId: string,
): Promise<CardPlaystyle | null> {
  try {
    const rows = await db
      .select({
        cardId: schema.cardPlaystyles.cardId,
        whenToPlayJa: schema.cardPlaystyles.whenToPlayJa,
        shinesInJa: schema.cardPlaystyles.shinesInJa,
        vsOpponentJa: schema.cardPlaystyles.vsOpponentJa,
        aiModelVersion: schema.cardPlaystyles.aiModelVersion,
      })
      .from(schema.cardPlaystyles)
      .where(eq(schema.cardPlaystyles.cardId, cardId))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    /* table missing — fall through */
    return null;
  }
}
