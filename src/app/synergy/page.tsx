import Link from "next/link";

import { ColorChip } from "@/components/grand-line/color-chip";
import { MockBanner } from "@/components/grand-line/mock-banner";
import { SiteHeader } from "@/components/grand-line/site-header";
import { SourceBadge } from "@/components/grand-line/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listCards } from "@/lib/cards";

export const dynamic = "force-dynamic";

export default async function SynergyIndexPage() {
  const result = await listCards({ cardType: "LEADER" }, 200);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10">
        <header>
          <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
            Synergy Compass
          </p>
          <h1 className="font-display text-foreground text-3xl tracking-wide">
            シナジーを見たいリーダーを選ぶ
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            リーダーごとに、効果テキスト・特徴・キーワード仕様から導かれるカード相互作用をグラフで可視化します。
            シンプル (羅針盤型) と詳細 (フォースグラフ) を切り替え可能。
          </p>
        </header>

        {result.usingMock ? <MockBanner /> : null}

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.cards.map((leader) => (
            <li key={leader.id}>
              <Link
                href={`/synergy/${leader.id}`}
                className="focus-visible:ring-ring focus-visible:ring-offset-background block focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
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
                      {leader.features.slice(0, 3).map((f) => (
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
      </main>
    </>
  );
}
