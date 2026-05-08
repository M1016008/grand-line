import Link from "next/link";
import { notFound } from "next/navigation";

import { ColorChip } from "@/components/grand-line/color-chip";
import { MockBanner } from "@/components/grand-line/mock-banner";
import { SiteHeader } from "@/components/grand-line/site-header";
import { SourceBadge } from "@/components/grand-line/source-badge";
import { SynergyGraph } from "@/components/grand-line/synergy-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listCards } from "@/lib/cards";
import { getSynergyGraph } from "@/lib/synergy-data";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ leaderId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { leaderId } = await params;
  const data = await getSynergyGraph(leaderId);
  return {
    title: data ? `シナジー — ${data.leader.name}` : "シナジー",
  };
}

export default async function SynergyDetailPage({ params }: PageProps) {
  const { leaderId } = await params;
  const data = await getSynergyGraph(leaderId);
  if (!data) notFound();

  // The list-cards usingMock signal reflects DB state — reuse it for the
  // banner. We don't re-derive here to avoid two queries.
  const probe = await listCards({}, 1);

  // Edge histogram for the sidebar.
  const histogram = new Map<string, number>();
  for (const e of data.edges) {
    histogram.set(e.relationType, (histogram.get(e.relationType) ?? 0) + 1);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
              Synergy Compass
            </p>
            <h1 className="font-display text-3xl tracking-wide">
              {data.leader.name}
            </h1>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/synergy">← 別のリーダー</Link>
          </Button>
        </div>

        {probe.usingMock ? <MockBanner /> : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <SynergyGraph
            leader={data.leader}
            pool={data.pool}
            edges={data.edges}
            source={data.source}
          />

          <aside className="space-y-4">
            <Card className="border-primary/30 bg-card/60">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
                      Leader · {data.leader.id}
                    </p>
                    <p className="text-base font-semibold">{data.leader.name}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {data.leader.colors.map((c) => (
                      <ColorChip key={c} color={c} />
                    ))}
                  </div>
                </div>
                <div className="text-muted-foreground flex flex-wrap gap-1 text-[11px]">
                  {data.leader.life !== null ? <span>life {data.leader.life}</span> : null}
                  {data.leader.power !== null ? <span>· pwr {data.leader.power}</span> : null}
                  {data.leader.features.slice(0, 4).map((f) => (
                    <Badge key={f} variant="secondary" className="text-[10px]">
                      {f}
                    </Badge>
                  ))}
                </div>
                <SourceBadge source={data.leader.source} verified={data.leader.verified} />
              </CardContent>
            </Card>

            <Card className="border-border/40 bg-card/40">
              <CardContent className="space-y-2 p-4">
                <h3 className="font-display text-sm tracking-wide">エッジ内訳</h3>
                <ul className="space-y-1 text-xs">
                  {[...histogram.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{relationLabel(k)}</span>
                      <span className="font-mono">{v}</span>
                    </li>
                  ))}
                  {histogram.size === 0 ? (
                    <li className="text-muted-foreground text-center">
                      検出されたシナジーがありません。
                    </li>
                  ) : null}
                </ul>
              </CardContent>
            </Card>

            <Card className="border-border/40 bg-card/40">
              <CardContent className="space-y-2 p-4 text-xs">
                <h3 className="font-display text-sm tracking-wide">読み方</h3>
                <p className="text-muted-foreground">
                  リーダーを中心に、シナジーが強いカードほど内側、弱いほど外側に配置されます。エッジの色は関係タイプ、太さは強度を表します。
                </p>
                <p className="text-muted-foreground">
                  「シンプル」はリーダー直結のみ表示する羅針盤型、「詳細」は全エッジを力学レイアウトで描画します。
                </p>
                <p className="text-muted-foreground">
                  {data.source === "rules+ai" ? (
                    <>
                      ルールベース + AI 推論によるシナジー判定。AI 由来の解釈には{" "}
                      <strong>未確認バッジ</strong> が付きます。
                    </>
                  ) : (
                    <>
                      現時点ではルールベースのみ。AI 解析を追加するには{" "}
                      <code className="font-mono text-[10px]">ANTHROPIC_API_KEY</code>{" "}
                      の設定後に Phase 3.5b を有効化してください。
                    </>
                  )}
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </>
  );
}

function relationLabel(rt: string): string {
  switch (rt) {
    case "leader_direct": return "リーダー直結";
    case "feature_chain": return "特徴チェイン";
    case "tempo_combo": return "テンポ";
    case "defense_combo": return "防御";
    case "resource_engine": return "リソース";
    case "anti_meta": return "メタ対応";
    case "finisher": return "フィニッシャー";
    default: return rt;
  }
}
