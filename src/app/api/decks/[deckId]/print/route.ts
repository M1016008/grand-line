import { getSavedDeck } from "@/lib/saved-decks";
import { buildDeckPrintPdf } from "@/lib/deck-print-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ deckId: string }>;
}

export async function GET(req: Request, { params }: RouteContext) {
  const { deckId } = await params;
  const deck = await getSavedDeck(deckId);
  if (!deck) {
    return Response.json(
      { error: "deck_not_found", detail: `${deckId} was not found.` },
      { status: 404 },
    );
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
