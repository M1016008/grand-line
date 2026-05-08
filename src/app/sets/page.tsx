import Link from "next/link";

import { DiscoverSetsButton } from "@/components/grand-line/discover-sets-button";
import { SiteHeader } from "@/components/grand-line/site-header";
import { MockBanner } from "@/components/grand-line/mock-banner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listCards, listSets, type SetSummary } from "@/lib/cards";

export const dynamic = "force-dynamic";

export const metadata = { title: "セット一覧" };

const TYPE_LABEL: Record<string, string> = {
  booster: "ブースター",
  starter: "スタートデッキ",
  extra: "エクストラ",
  promo: "プロモ",
};

const TYPE_ORDER: Record<string, number> = {
  booster: 0,
  starter: 1,
  extra: 2,
  promo: 3,
};

export default async function SetsPage() {
  const [sets, probe] = await Promise.all([
    listSets(),
    listCards({ pageSize: 1 }),
  ]);

  // Group by setType so the page reads as a catalogue.
  const groups = new Map<string, SetSummary[]>();
  for (const s of sets) {
    const arr = groups.get(s.setType) ?? [];
    arr.push(s);
    groups.set(s.setType, arr);
  }
  const sortedTypes = [...groups.keys()].sort(
    (a, b) => (TYPE_ORDER[a] ?? 99) - (TYPE_ORDER[b] ?? 99),
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10">
        <header className="space-y-1">
          <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
            All Sets
          </p>
          <h1 className="font-display text-foreground text-3xl tracking-wide">
            セット一覧
          </h1>
          <p className="text-muted-foreground text-sm">
            {probe.totalAll.toLocaleString()} 枚 / {sets.length} セット
            (再録は両方のセットからリンクされます)
          </p>
        </header>

        {probe.usingMock ? <MockBanner /> : null}

        <DiscoverSetsButton />

        {sortedTypes.map((type) => (
          <section key={type} className="space-y-3">
            <h2 className="font-display text-primary text-lg tracking-wide">
              {TYPE_LABEL[type] ?? type}
              <span className="text-muted-foreground ml-2 text-xs">
                ({groups.get(type)!.length} セット)
              </span>
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groups.get(type)!.map((s) => (
                <li key={s.code}>
                  <Link
                    href={`/cards?setCode=${s.code}`}
                    className="focus-visible:ring-ring focus-visible:ring-offset-background block focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    <Card className="hover:border-primary/40 group h-full transition">
                      <CardContent className="space-y-1 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
                            {s.code}
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {s.cardCount} 枚
                          </Badge>
                        </div>
                        <p className="text-foreground line-clamp-2 text-sm font-semibold">
                          {s.nameJa}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {sets.length === 0 ? (
          <p className="text-muted-foreground text-center text-sm">
            セットが取り込まれていません。
            <code className="font-mono text-xs">npm run scrape:bandai-jp:all</code>{" "}
            を実行してください。
          </p>
        ) : null}
      </main>
    </>
  );
}
