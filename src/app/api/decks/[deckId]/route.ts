import { NextResponse } from "next/server";

import { getSavedDeck } from "@/lib/saved-decks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ deckId: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { deckId } = await params;
  const deck = await getSavedDeck(deckId);
  if (!deck) {
    return NextResponse.json(
      { error: "deck_not_found", detail: `${deckId} was not found.` },
      { status: 404 },
    );
  }

  return NextResponse.json({ deck });
}
