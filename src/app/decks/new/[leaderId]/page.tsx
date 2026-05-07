import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/grand-line/site-header";
import { DeckBuilder } from "@/components/grand-line/deck-builder";
import { MockBanner } from "@/components/grand-line/mock-banner";
import { Button } from "@/components/ui/button";
import { getCard, listCards } from "@/lib/cards";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ leaderId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { leaderId } = await params;
  const leader = await getCard(leaderId);
  return { title: leader ? `デッキを組む — ${leader.name}` : "デッキを組む" };
}

export default async function DeckBuilderPage({ params }: PageProps) {
  const { leaderId } = await params;
  const leader = await getCard(leaderId);
  if (!leader || leader.cardType !== "LEADER") notFound();

  // Pull a wide pool — color filtering happens client-side so the user
  // can change leader without a full reload (Phase 2.5 polish).
  const pool = await listCards({}, 500);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
              Step 2 of 2 — Deck Builder
            </p>
            <h1 className="font-display text-3xl tracking-wide">
              {leader.name}
            </h1>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/decks/new">← 別のリーダーを選ぶ</Link>
          </Button>
        </div>

        {pool.usingMock ? <MockBanner /> : null}

        <DeckBuilder leader={leader} pool={pool.cards} usingMock={pool.usingMock} />
      </main>
    </>
  );
}
