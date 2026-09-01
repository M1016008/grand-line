import Link from "next/link";
import { notFound } from "next/navigation";

import { ColorChip } from "@/components/grand-line/color-chip";
import { DeckCoachSection } from "@/components/grand-line/deck-coach-section";
import { SiteHeader } from "@/components/grand-line/site-header";
import { SourceBadge } from "@/components/grand-line/source-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDeckCoachGuideForPage } from "@/lib/deck-coach";
import { getSavedDeck } from "@/lib/saved-decks";
import { proxiedCardImage } from "@/lib/img";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ deckId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { deckId } = await params;
  const deck = await getSavedDeck(deckId);
  return { title: deck ? `${deck.name} - Grand Line` : "Deck - Grand Line" };
}

export default async function SavedDeckPage({ params }: PageProps) {
  const { deckId } = await params;
  const deck = await getSavedDeck(deckId);
  if (!deck) notFound();
  const coachGuide = await getDeckCoachGuideForPage(deck.id);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
              Saved Deck
            </p>
            <h1 className="font-display text-3xl tracking-wide">{deck.name}</h1>
            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono">{deck.totalCards} cards</span>
              <span>{deck.format}</span>
              <Badge variant={deck.ruleReport.legal ? "secondary" : "destructive"}>
                {deck.ruleReport.legal ? "Legal" : "Illegal"}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/decks/new">New deck</Link>
            </Button>
            <Button asChild>
              <a
                href={`/api/decks/${deck.id}/print?includeLeader=1`}
                target="_blank"
                rel="noreferrer"
              >
                Print PDF
              </a>
            </Button>
          </div>
        </div>

        <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card className="border-primary/30 bg-card/60">
            <CardContent className="space-y-3 p-4">
              <div className="border-border/30 bg-card/60 aspect-[3/4] w-full overflow-hidden rounded-md border">
                {deck.leader.imageUrlJp ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={proxiedCardImage(deck.leader.imageUrlJp)!}
                    alt={deck.leader.name}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div>
                <p className="text-muted-foreground font-mono text-xs">
                  {deck.leader.id}
                </p>
                <h2 className="text-lg font-semibold">{deck.leader.name}</h2>
              </div>
              <div className="flex flex-wrap gap-1">
                {deck.leader.colors.map((color) => (
                  <ColorChip key={color} color={color} />
                ))}
              </div>
              <SourceBadge
                source={deck.leader.source}
                verified={deck.leader.verified}
              />
              {deck.notes ? (
                <p className="text-muted-foreground text-sm">{deck.notes}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/40">
            <CardContent className="p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-display text-xl tracking-wide">Main Deck</h2>
                <span className="text-muted-foreground font-mono text-sm">
                  {deck.totalCards}/50
                </span>
              </div>
              <ul className="grid gap-2 md:grid-cols-2">
                {deck.entries.map(({ card, count }) => (
                  <li
                    key={card.id}
                    className="border-border/30 bg-background/40 flex items-center gap-3 rounded-md border p-2"
                  >
                    <div className="border-border/30 bg-card/60 aspect-[3/4] w-12 shrink-0 overflow-hidden rounded-sm border">
                      {card.imageUrlJp ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={proxiedCardImage(card.imageUrlJp)!}
                          alt={card.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground font-mono text-[11px]">
                        {card.id}
                      </p>
                      <p className="truncate text-sm font-medium">{card.name}</p>
                    </div>
                    <span className="font-mono text-lg tabular-nums">x{count}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <DeckCoachSection
          deckId={deck.id}
          deckLegal={deck.ruleReport.legal && deck.totalCards === 50}
          guide={coachGuide}
        />
      </main>
    </>
  );
}
