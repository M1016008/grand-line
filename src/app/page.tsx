import Link from "next/link";

import { SiteHeader } from "@/components/grand-line/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listCards, listSets } from "@/lib/cards";

export const dynamic = "force-dynamic";

const PILLARS = [
  {
    title: "確率エンジン",
    body: "超幾何分布の厳密計算 + モンテカルロでターン別の引き確率を可視化。",
    soon: "Phase 3.7",
  },
  {
    title: "シナジーグラフ",
    body: "リーダーを中心に、カード同士の意味的な相互作用をネオン光彩のフォースグラフで描画。",
    soon: "Phase 3.5",
  },
  {
    title: "AI シナリオ",
    body: "理想ムーブ・プラン B / C・対面別調整までを Claude が分析。事実情報は一次ソース。",
    soon: "Phase 4.5",
  },
];

export default async function HomePage() {
  // Cheap probes — both queries are O(small) thanks to listSets returning
  // 51 rows max and listCards({pageSize: 1}) hitting only the count query.
  const [sets, probe] = await Promise.all([
    listSets(),
    listCards({ pageSize: 1 }),
  ]);
  const dbReady = !probe.usingMock && probe.totalAll > 0;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 py-12">
        <section className="flex flex-col items-start gap-6">
          <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
            One Piece TCG · Compass
          </p>
          <h1 className="font-display text-foreground text-4xl leading-tight tracking-wide md:text-6xl">
            航海の前に、
            <span className="text-primary">羅針盤</span>
            を。
          </h1>
          <p className="text-muted-foreground max-w-2xl text-base md:text-lg">
            <strong className="text-foreground">Grand Line</strong>{" "}
            はワンピースカードゲームの情報・デッキ構築・対戦準備を一気通貫で扱う個人向けダッシュボード。
            事実情報は公式から、戦術解釈は Claude AI から ── ハルシネーションを排除した「考える支援」を提供します。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/cards">カードを探す</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/decks/new">デッキを組む</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {PILLARS.map((p) => (
            <Card key={p.title} className="border-border/40 bg-card/40">
              <CardContent className="space-y-2 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-primary text-lg tracking-wide">
                    {p.title}
                  </h2>
                  <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
                    {p.soon}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">{p.body}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="border-border/40 bg-card/30 rounded-xl border p-6 text-sm">
          <h2 className="font-display text-primary mb-3 text-lg tracking-wide">
            現在の状態
          </h2>
          {dbReady ? (
            <div className="text-muted-foreground grid gap-2 sm:grid-cols-3">
              <Stat
                label="取り込み済みカード"
                value={probe.totalAll.toLocaleString()}
              />
              <Stat label="セット数" value={String(sets.length)} />
              <Stat label="リーダー" value="抽出済み" />
            </div>
          ) : (
            <p className="text-muted-foreground">
              モックデータで動作中。Turso またはローカル SQLite を設定し、{" "}
              <code className="font-mono text-xs">
                npm run scrape:bandai-jp:all
              </code>{" "}
              でカードを取り込めます。
            </p>
          )}
          <ul className="text-muted-foreground mt-4 space-y-1">
            <li>
              <span className="text-foreground font-mono">Phase 1-3.7</span> ─
              カードDB / デッキビルダー / 評価指標 / シナジー / 確率エンジン (完了)
            </li>
            <li>
              <span className="font-mono">Phase 4 以降</span> ─ AI デッキ提案・シナリオ・対戦相手分析・大会情報
            </li>
          </ul>
        </section>
      </main>
      <footer className="border-border/40 mt-auto border-t py-6 text-center text-xs">
        <p className="text-muted-foreground">
          Grand Line — One Piece TCG Compass · 個人開発プロジェクト
        </p>
      </footer>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/30 bg-card/40 rounded-lg border p-3">
      <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
        {label}
      </div>
      <div className="text-foreground font-mono text-2xl">{value}</div>
    </div>
  );
}
