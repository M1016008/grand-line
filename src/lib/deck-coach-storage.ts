import { and, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { cards, deckCoachGuides } from "@/db/schema";
import {
  deckCoachGuideSchema,
  type DeckCoachGuide,
  type DeckCoachLevel,
  type StoredDeckCoachGuide,
} from "@/lib/deck-coach-schema";

export interface WriteStoredDeckCoachGuideInput {
  deckId: string;
  level: DeckCoachLevel;
  guide: DeckCoachGuide;
  deckHash: string;
  sourceDataHash: string;
  promptVersion: string;
  aiModelVersion: string;
  generatedAt: Date;
  updatedAt: Date;
}

export function isMissingDeckCoachGuidesTableError(error: unknown): boolean {
  return /\bno such table:\s*deck_coach_guides\b/i.test(
    collectErrorText(error).join("\n"),
  );
}

export async function readStoredDeckCoachGuideFromDb(
  database: Database,
  deckId: string,
  level: DeckCoachLevel,
): Promise<StoredDeckCoachGuide | null> {
  const rows = await database
    .select({
      deckId: deckCoachGuides.deckId,
      level: deckCoachGuides.level,
      guideJson: deckCoachGuides.guideJson,
      deckHash: deckCoachGuides.deckHash,
      sourceDataHash: deckCoachGuides.sourceDataHash,
      promptVersion: deckCoachGuides.promptVersion,
      aiModelVersion: deckCoachGuides.aiModelVersion,
      generatedAt: deckCoachGuides.generatedAt,
      updatedAt: deckCoachGuides.updatedAt,
    })
    .from(deckCoachGuides)
    .where(
      and(
        eq(deckCoachGuides.deckId, deckId),
        eq(deckCoachGuides.level, level),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    deckId: row.deckId,
    level: row.level,
    guide: parseGuideJson(row.guideJson),
    deckHash: row.deckHash,
    sourceDataHash: row.sourceDataHash,
    promptVersion: row.promptVersion,
    aiModelVersion: row.aiModelVersion,
    generatedAt: serializeDate(row.generatedAt),
    updatedAt: serializeDate(row.updatedAt),
  };
}

export async function writeStoredDeckCoachGuideToDb(
  database: Database,
  input: WriteStoredDeckCoachGuideInput,
): Promise<void> {
  await database
    .insert(deckCoachGuides)
    .values({
      deckId: input.deckId,
      level: input.level,
      guideJson: input.guide,
      deckHash: input.deckHash,
      sourceDataHash: input.sourceDataHash,
      promptVersion: input.promptVersion,
      aiModelVersion: input.aiModelVersion,
      generatedAt: input.generatedAt,
      updatedAt: input.updatedAt,
    })
    .onConflictDoUpdate({
      target: [deckCoachGuides.deckId, deckCoachGuides.level],
      set: {
        guideJson: input.guide,
        deckHash: input.deckHash,
        sourceDataHash: input.sourceDataHash,
        promptVersion: input.promptVersion,
        aiModelVersion: input.aiModelVersion,
        generatedAt: input.generatedAt,
        updatedAt: input.updatedAt,
      },
    });
}

export async function readAllCardIdsFromDb(
  database: Database,
): Promise<string[]> {
  const rows = await database.select({ id: cards.id }).from(cards);
  return rows.map((row) => row.id);
}

function parseGuideJson(raw: unknown): DeckCoachGuide {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return deckCoachGuideSchema.parse(value);
}

function serializeDate(value: Date | number | string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  return value;
}

function collectErrorText(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return [];
  }
  if (seen.has(value)) return [];
  seen.add(value);

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  if (value instanceof Error) parts.push(value.name, value.message);
  for (const key of ["code", "rawCode", "cause"]) {
    const child = record[key];
    if (typeof child === "string" || typeof child === "number") {
      parts.push(String(child));
    } else {
      parts.push(...collectErrorText(child, seen));
    }
  }
  return parts.filter(Boolean);
}
