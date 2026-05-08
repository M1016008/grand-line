import { Suspense } from "react";

import { CardFilters } from "@/components/grand-line/card-filters";
import { CardThumb } from "@/components/grand-line/card-thumb";
import { MockBanner } from "@/components/grand-line/mock-banner";
import { Pagination } from "@/components/grand-line/pagination";
import { SiteHeader } from "@/components/grand-line/site-header";
import { listCards, listSets } from "@/lib/cards";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    text?: string;
    cardType?: string;
    setCode?: string;
    color?: string;
    feature?: string;
    cost?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 60;

export default async function CardsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const cost = sp.cost && sp.cost !== "8+" ? Number(sp.cost) : undefined;
  const page = sp.page ? Math.max(1, Number(sp.page)) : 1;

  const [result, sets] = await Promise.all([
    listCards({
      text: sp.text,
      cardType: sp.cardType,
      setCode: sp.setCode,
      color: sp.color,
      feature: sp.feature,
      cost,
      page,
      pageSize: PAGE_SIZE,
    }),
    listSets(),
  ]);

  const filterParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v && k !== "page") filterParams.set(k, String(v));
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-display text-foreground text-3xl tracking-wide">
            カードを探す
          </h1>
          <div className="text-muted-foreground text-sm">
            {result.total.toLocaleString()} 件 (全 {result.totalAll.toLocaleString()} 枚 ·{" "}
            {result.usingMock ? "モック" : `${sets.length} セット`})
          </div>
        </div>

        {result.usingMock ? <MockBanner /> : null}

        <Suspense fallback={null}>
          <CardFilters sets={sets} />
        </Suspense>

        {result.cards.length === 0 ? (
          <div className="border-border/40 bg-card/30 text-muted-foreground rounded-lg border p-10 text-center text-sm">
            条件に合うカードが見つかりませんでした。
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {result.cards.map((c) => (
                <li key={c.id}>
                  <CardThumb card={c} />
                </li>
              ))}
            </ul>

            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              basePath="/cards"
              filterParams={filterParams.toString()}
            />
          </>
        )}
      </main>
    </>
  );
}
