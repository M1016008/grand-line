import { buildDeckPrintPdf } from "@/lib/deck-print-pdf";
import { deckPrintPreflightFailure } from "@/lib/deck-print-preflight";
import {
  DeckRegulationsUnavailableError,
  getSavedDeck,
  type SavedDeckDetail,
} from "@/lib/saved-decks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ deckId: string }>;
}

export async function GET(req: Request, { params }: RouteContext) {
  const { deckId } = await params;
  let deck: SavedDeckDetail | null;
  try {
    deck = await getSavedDeck(deckId);
  } catch (err) {
    if (err instanceof DeckRegulationsUnavailableError) {
      return Response.json(
        { error: "regulations_unavailable", detail: err.message },
        { status: 503 },
      );
    }
    throw err;
  }

  if (!deck) {
    return Response.json(
      { error: "deck_not_found", detail: `${deckId} was not found.` },
      { status: 404 },
    );
  }

  const preflightFailure = deckPrintPreflightFailure(deck.ruleReport);
  if (preflightFailure) {
    return Response.json(preflightFailure.body, {
      status: preflightFailure.status,
    });
  }

  const url = new URL(req.url);
  const includeLeader = url.searchParams.get("includeLeader") !== "0";
  const pdf = await buildDeckPrintPdf(deck, { includeLeader });
  const body = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(body).set(pdf);
  const filename = `grand-line-${deck.id}.pdf`;

  return new Response(body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
