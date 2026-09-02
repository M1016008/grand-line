import Link from "next/link";

import { SiteHeader } from "@/components/grand-line/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listCards, listSets } from "@/lib/cards";

export const dynamic = "force-dynamic";

const CORE_FEATURES = [
  {
    title: "Deck Intelligence",
    body: "Leader を軸に、検証済みデータを基準に3つ候補まで比較検討します。",
  },
  {
    title: "3案比較",
    body: "同じ方針のうちから、推奨 / 安定 / 特化を切り替えて検討できます。",
  },
  {
    title: "Battle Benchmark",
    body: "CPU対戦で構築結果を検証し、デッキの戦い方を定量評価します。",
  },
  {
    title: "Deck Optimizer",
    body: "既存構成から改善候補を探索し、実戦に向けて微修正案を提案します。",
  },
  {
    title: "Deck Coach",
    body: "構築の要点・進行方向・改善軸を、初心者向けに整理します。",
  },
  {
    title: "Card Coach",
    body: "カード単位で使い方、相互作用、採用条件を確認できます。",
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
            One Piece TCG Compass
          </p>
          <h1 className="font-display text-foreground text-4xl leading-tight tracking-wide md:text-6xl">
            デッキを
            <span className="text-primary">作る</span>
            ことから
            <span className="text-primary">検証</span>
            まで。
          </h1>
          <p className="text-muted-foreground max-w-2xl text-base md:text-lg">
            Grand Line は
            <strong className="text-foreground">デッキ作成・検証・対戦・カード調査</strong>
            を一か所で扱うための、ユーザー向けワークフローです。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/decks/new">デッキを作る</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/decks">保存デッキを見る</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/cards">カードを調べる</Link>
            </Button>
          </div>
        </section>

        <section className="border-border/40 bg-card/30 rounded-xl border p-4">
          <h2 className="font-display text-primary mb-2 text-lg tracking-wide">
            Grand Lineの主要導線
          </h2>
          <ul className="text-muted-foreground mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li>デッキを作る → Deck Builder / Deck Intelligence</li>
            <li>デッキを検証する → Battle Benchmark / Practice</li>
            <li>対戦・練習する → CPU対戦 / 検証ラボ</li>
            <li>カードを調べる → カード一覧 / シナジー</li>
          </ul>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {CORE_FEATURES.map((feature) => (
            <Card key={feature.title} className="border-border/40 bg-card/40">
              <CardContent className="space-y-2 p-5">
                <h2 className="font-display text-primary text-lg tracking-wide">
                  {feature.title}
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {feature.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="border-border/40 bg-card/30 rounded-xl border p-6 text-sm">
          <h2 className="font-display text-primary mb-3 text-lg tracking-wide">
            ステータス
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
              モックデータで動作中。Turso またはローカル SQLite を設定し、
              <code className="font-mono text-xs">
                npm run scrape:bandai-jp:all
              </code>
              でカードを取り込めます。
            </p>
          )}
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
