import Link from "next/link";

import { SiteHeader } from "@/components/grand-line/site-header";
import { RestrictionBadge } from "@/components/grand-line/restriction-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRegulationsView, type RegulationRow } from "@/lib/regulations";

export const dynamic = "force-dynamic";

export const metadata = { title: "禁止・制限カード" };

export default async function RegulationsPage() {
  const data = await getRegulationsView();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
        <header>
          <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
            Card Limit Regulation
          </p>
          <h1 className="font-display text-foreground text-3xl tracking-wide">
            禁止・制限カード
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            バンダイ公式{" "}
            <Link
              href="https://www.onepiece-cardgame.com/news/restriction.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              禁止・制限カード一覧
            </Link>{" "}
            から取得した最新の規制状況。デッキビルダーは自動でこのリストを参照して違反を検出します。
            {data.lastFetchedAt ? (
              <span className="text-muted-foreground/80 ml-1 font-mono text-xs">
                · 最終取得 {data.lastFetchedAt}
              </span>
            ) : null}
          </p>
        </header>

        {data.banned.length === 0 &&
        data.restricted.length === 0 &&
        data.pairs.length === 0 ? (
          <Card className="border-border/40 bg-card/30">
            <CardContent className="text-muted-foreground p-10 text-center text-sm">
              現在、禁止・制限カードの情報が DB にありません。
              <br />
              <code className="font-mono text-xs">
                npm run scrape:regulations
              </code>{" "}
              を実行してください。
            </CardContent>
          </Card>
        ) : null}

        {data.banned.length > 0 ? (
          <RegulationGroup
            title="禁止カード"
            description="デッキに 1 枚も入れることができません。"
            rows={data.banned}
          />
        ) : null}

        {data.restricted.length > 0 ? (
          <RegulationGroup
            title="制限カード"
            description="デッキに記載枚数まで。"
            rows={data.restricted}
          />
        ) : null}

        {data.pairs.length > 0 ? (
          <section className="space-y-3">
            <h2 className="font-display text-primary text-lg tracking-wide">
              禁止ペア
              <span className="text-muted-foreground ml-2 text-xs">
                ({data.pairs.length} 組)
              </span>
            </h2>
            <p className="text-muted-foreground text-sm">
              A と B を同じデッキで使用することはできません (リーダーを含む)。
            </p>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.pairs.map((pair, i) => (
                <li key={i}>
                  <Card className="border-destructive/30 bg-card/40">
                    <CardContent className="space-y-2 p-4">
                      <PairCardLine
                        label="A"
                        id={pair.cardA.id}
                        name={pair.cardA.name}
                      />
                      <PairCardLine
                        label="B"
                        id={pair.cardB.id}
                        name={pair.cardB.name}
                      />
                      <p className="text-muted-foreground text-[10px] tracking-widest uppercase">
                        適用 {pair.effectiveFrom}
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}

function RegulationGroup({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: RegulationRow[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-primary text-lg tracking-wide">
        {title}
        <span className="text-muted-foreground ml-2 text-xs">({rows.length})</span>
      </h2>
      <p className="text-muted-foreground text-sm">{description}</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.cardId}>
            <Link
              href={`/cards/${row.cardId}`}
              className="focus-visible:ring-ring focus-visible:ring-offset-background block focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              <Card className="hover:border-primary/40 group transition">
                <CardContent className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
                      {row.cardId} · {row.setCode}
                    </div>
                    <div className="text-foreground truncate text-sm font-semibold">
                      {row.name}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-[10px]">
                      {labelOf(row.cardType)} · 適用 {row.effectiveFrom}
                    </div>
                  </div>
                  <RestrictionBadge maxCopies={row.maxCopies} />
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PairCardLine({
  label,
  id,
  name,
}: {
  label: string;
  id: string;
  name: string;
}) {
  return (
    <Link
      href={`/cards/${id}`}
      className="hover:bg-accent/30 flex items-center gap-2 rounded-md px-1.5 py-1"
    >
      <Badge variant="outline" className="font-mono text-[10px]">
        {label}
      </Badge>
      <span className="text-muted-foreground font-mono text-[11px]">{id}</span>
      <span className="truncate text-sm">{name}</span>
    </Link>
  );
}

function labelOf(type: string): string {
  switch (type) {
    case "LEADER":
      return "リーダー";
    case "CHARACTER":
      return "キャラ";
    case "EVENT":
      return "イベント";
    case "STAGE":
      return "ステージ";
    default:
      return type;
  }
}
