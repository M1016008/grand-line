import Link from "next/link";
import { notFound } from "next/navigation";

import { CompatibleCardsSection } from "@/components/grand-line/compatible-cards-section";
import { PlaystyleSection } from "@/components/grand-line/playstyle-section";
import { SiteHeader } from "@/components/grand-line/site-header";
import { ColorChip } from "@/components/grand-line/color-chip";
import { PairBanBadge, RestrictionBadge } from "@/components/grand-line/restriction-badge";
import { SourceBadge } from "@/components/grand-line/source-badge";
import { proxiedCardImage } from "@/lib/img";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getCard } from "@/lib/cards";
import { getCompatibleCards } from "@/lib/card-compat";
import { getCardPlaystyle } from "@/lib/playstyle";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const card = await getCard(id);
  return {
    title: card ? `${card.name} (${card.id})` : id,
  };
}

export default async function CardDetailPage({ params }: PageProps) {
  const { id } = await params;
  const card = await getCard(id);
  if (!card) notFound();

  // Fetched in parallel — both depend only on the resolved card.id.
  const [compatible, playstyle] = await Promise.all([
    getCompatibleCards(card.id, 5),
    getCardPlaystyle(card.id),
  ]);

  const stats: Array<[string, string | number | null]> = [
    ["コスト", card.cost],
    ["パワー", card.power],
    ["カウンター", card.counter],
    ["ライフ", card.life],
    ["レアリティ", card.rarity],
  ];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href="/cards">← カード一覧</Link>
        </Button>

        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <div className="space-y-3">
            <div className="border-border/40 bg-card/40 relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border">
              {card.imageUrlJp ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={proxiedCardImage(card.imageUrlJp)!}
                  alt={card.name}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="text-muted-foreground p-6 text-center text-xs">
                  画像未取得
                  <br />
                  (スクレイプ後に表示されます)
                </div>
              )}
            </div>
            <SourceBadge source={card.source} verified={card.verified} />
          </div>

          <div className="space-y-5">
            <header className="space-y-1">
              <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
                {card.id} · {card.cardType}
              </p>
              <h1 className="font-display text-3xl leading-tight tracking-wide">
                {card.name}
              </h1>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {card.restriction ? (
                  <RestrictionBadge
                    maxCopies={card.restriction.maxCopies}
                    effectiveFrom={card.restriction.effectiveFrom}
                  />
                ) : null}
                {card.pairBans.map((pb) => (
                  <PairBanBadge
                    key={pb.partnerId}
                    partnerId={pb.partnerId}
                    partnerName={pb.partnerName}
                  />
                ))}
                {card.colors.map((c) => (
                  <ColorChip key={c} color={c} />
                ))}
                {card.attributes.map((a) => (
                  <Badge key={a} variant="outline">
                    {a}
                  </Badge>
                ))}
                {card.features.map((f) => (
                  <Badge key={f} variant="secondary">
                    {f}
                  </Badge>
                ))}
              </div>
            </header>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {stats.map(([label, value]) =>
                value === null || value === undefined ? null : (
                  <div
                    key={label}
                    className="border-border/40 bg-card/40 rounded-md border p-2 text-center"
                  >
                    <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
                      {label}
                    </div>
                    <div className="font-mono text-sm">{value}</div>
                  </div>
                ),
              )}
            </div>

            <Card className="border-border/40 bg-card/40">
              <CardContent className="space-y-3 p-4">
                <h2 className="text-primary text-xs tracking-widest uppercase">
                  効果
                </h2>
                <p className="text-foreground/90 text-sm leading-relaxed whitespace-pre-line">
                  {card.effectText ?? "(効果テキストなし)"}
                </p>
                {card.triggerText ? (
                  <>
                    <Separator />
                    <h2 className="text-primary text-xs tracking-widest uppercase">
                      [トリガー]
                    </h2>
                    <p className="text-foreground/90 text-sm leading-relaxed whitespace-pre-line">
                      {card.triggerText}
                    </p>
                  </>
                ) : null}
                {card.flavorText ? (
                  <>
                    <Separator />
                    <p className="text-muted-foreground text-xs italic leading-relaxed">
                      {card.flavorText}
                    </p>
                  </>
                ) : null}
              </CardContent>
            </Card>

            {card.mechanics.length > 0 ? (
              <div>
                <h3 className="text-muted-foreground mb-2 text-xs tracking-widest uppercase">
                  検出された仕様キーワード
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {card.mechanics.map((m) => (
                    <Badge key={m} variant="outline" className="font-mono">
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {card.memberships.length > 0 ? (
              <div>
                <h3 className="text-muted-foreground mb-2 text-xs tracking-widest uppercase">
                  収録セット ({card.memberships.length})
                </h3>
                <ul className="space-y-1.5">
                  {card.memberships.map((m) => (
                    <li key={m.code}>
                      <Link
                        href={`/cards?setCode=${m.code}`}
                        className="border-border/40 bg-card/40 hover:border-primary/40 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs transition"
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground font-mono">
                            {m.code}
                          </span>
                          <span>{m.nameJa}</span>
                        </span>
                        {m.canonical ? (
                          <Badge variant="outline" className="text-[10px]">
                            初出
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">
                            再録
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        <PlaystyleSection playstyle={playstyle} />
        <CompatibleCardsSection results={compatible} />
      </main>
    </>
  );
}
