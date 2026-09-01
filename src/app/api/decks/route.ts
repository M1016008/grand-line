import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createSavedDeck,
  listSavedDecks,
  SavedDeckError,
} from "@/lib/saved-decks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const entrySchema = z.object({
  cardId: z.string().min(1),
  count: z.number().int().min(1).max(4),
});

const postSchema = z.object({
  leaderCardId: z.string().min(1),
  name: z.string().min(1).max(80),
  notes: z.string().max(1000).nullable().optional(),
  format: z.string().min(1).max(40).optional(),
  entries: z.array(entrySchema).min(1).max(50),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitParam) ? limitParam : 50;

  try {
    const decks = await listSavedDecks(limit);
    return NextResponse.json({ decks });
  } catch (err) {
    if (isMissingDeckTableError(err)) {
      return NextResponse.json({ decks: [], needsMigration: true });
    }
    console.error("[/api/decks] list failed:", err);
    return NextResponse.json(
      { error: "deck_list_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", detail: (err as Error).message },
      { status: 400 },
    );
  }

  try {
    const deck = await createSavedDeck(body);
    return NextResponse.json({ deck }, { status: 201 });
  } catch (err) {
    if (err instanceof SavedDeckError) {
      return NextResponse.json(
        {
          error: err.code,
          detail: err.message,
          violations: err.violations,
        },
        { status: err.status },
      );
    }
    console.error("[/api/decks] save failed:", err);
    return NextResponse.json(
      { error: "deck_save_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

function isMissingDeckTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such table: decks|no such table: deck_cards/i.test(message);
}
