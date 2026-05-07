import Link from "next/link";

import { SiteHeader } from "@/components/grand-line/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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

export default function HomePage() {
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
          <h2 className="font-display text-primary mb-2 text-lg tracking-wide">
            開発ステータス
          </h2>
          <ul className="text-muted-foreground space-y-1">
            <li>
              <span className="text-foreground font-mono">Phase 1</span> ─
              カードDB基盤 (実装中)
            </li>
            <li>
              <span className="text-foreground font-mono">Phase 2</span> ─
              デッキビルダー (リーダー選択 + 50枚デッキ + ルール検証 — 着手)
            </li>
            <li>
              <span className="font-mono">Phase 3 以降</span> ─
              評価指標・シナジー・確率・AI 提案・シナリオ・対戦相手分析・大会情報
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
