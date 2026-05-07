import Link from "next/link";

import { SiteHeader } from "@/components/grand-line/site-header";
import { ColorChip } from "@/components/grand-line/color-chip";
import { SourceBadge } from "@/components/grand-line/source-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listCards } from "@/lib/cards";

export const dynamic = "force-dynamic";

export default async function LeaderPickerPage() {
  const result = await listCards({ cardType: "LEADER" }, 200);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10">
        <header>
          <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
            Step 1 of 2
          </p>
          <h1 className="font-display text-foreground text-3xl tracking-wide">
            リーダーを選ぶ
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            ワンピTCGはリーダーがデッキ全体の挙動を規定する。Grand Line
            では選んだリーダーを軸に色制約・特徴制約が自動で適用されます。
          </p>
        </header>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.cards.map((leader) => (
            <li key={leader.id}>
              <Link
                href={`/decks/new/${leader.id}`}
                className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Card className="hover:border-primary/40 group h-full transition">
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
                          {leader.id} · {leader.setCode}
                        </p>
                        <p className="text-foreground text-sm font-semibold">
                          {leader.name}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {leader.colors.map((c) => (
                          <ColorChip key={c} color={c} />
                        ))}
                      </div>
                    </div>
                    <div className="text-muted-foreground flex flex-wrap gap-1 text-[11px]">
                      {leader.life !== null ? (
                        <Badge variant="outline" className="font-mono">
                          life {leader.life}
                        </Badge>
                      ) : null}
                      {leader.power !== null ? (
                        <Badge variant="outline" className="font-mono">
                          pwr {leader.power}
                        </Badge>
                      ) : null}
                      {leader.features.slice(0, 2).map((f) => (
                        <Badge key={f} variant="secondary" className="text-[10px]">
                          {f}
                        </Badge>
                      ))}
                    </div>
                    <SourceBadge
                      source={leader.source}
                      verified={leader.verified}
                      className="mt-1 self-start"
                    />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>

        {result.cards.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            リーダーカードが見つかりませんでした。スクレイパーを実行してデータを取り込んでください。
          </p>
        ) : null}
      </main>
    </>
  );
}
