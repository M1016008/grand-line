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
  generatedAt: string | null;
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
        generatedAt: schema.cardPlaystyles.generatedAt,
      })
      .from(schema.cardPlaystyles)
      .where(eq(schema.cardPlaystyles.cardId, cardId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      generatedAt: serializeDate(row.generatedAt),
    };
  } catch {
    /* table missing — fall through */
    return null;
  }
}

function serializeDate(value: Date | number | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  return value;
}
