import { Suspense } from "react";

import { SiteHeader } from "@/components/grand-line/site-header";
import { CardFilters } from "@/components/grand-line/card-filters";
import { CardThumb } from "@/components/grand-line/card-thumb";
import { MockBanner } from "@/components/grand-line/mock-banner";
import { listCards } from "@/lib/cards";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    text?: string;
    cardType?: string;
    color?: string;
    feature?: string;
    cost?: string;
  }>;
}

export default async function CardsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const cost = sp.cost && sp.cost !== "8+" ? Number(sp.cost) : undefined;

  const result = await listCards({
    text: sp.text,
    cardType: sp.cardType,
    color: sp.color,
    feature: sp.feature,
    cost,
  });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-display text-foreground text-3xl tracking-wide">
            カードを探す
          </h1>
          <div className="text-muted-foreground text-sm">
            {result.total} 件 / {result.usingMock ? "モック" : "DB"}
          </div>
        </div>

        {result.usingMock ? <MockBanner /> : null}

        <Suspense fallback={null}>
          <CardFilters />
        </Suspense>

        {result.cards.length === 0 ? (
          <div className="border-border/40 bg-card/30 text-muted-foreground rounded-lg border p-10 text-center text-sm">
            条件に合うカードが見つかりませんでした。
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {result.cards.map((c) => (
              <li key={c.id}>
                <CardThumb card={c} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
