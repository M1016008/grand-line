import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { ColorChip } from "@/components/grand-line/color-chip";
import { RestrictionBadge } from "@/components/grand-line/restriction-badge";
import { SourceBadge } from "@/components/grand-line/source-badge";
import { Badge } from "@/components/ui/badge";
import { proxiedCardImage } from "@/lib/img";
import type { CardListItem } from "@/lib/cards";

interface CardThumbProps {
  card: CardListItem;
  /** Bandai-issued max-copies override (0 = banned, 1-3 = restricted). */
  restrictionMaxCopies?: number | null;
}

export function CardThumb({ card, restrictionMaxCopies }: CardThumbProps) {
  return (
    <Link
      href={`/cards/${card.id}`}
      className="focus-visible:ring-ring focus-visible:ring-offset-background block focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
    >
      <Card className="hover:border-primary/40 group h-full transition">
        <CardContent className="flex h-full gap-3 p-3">
          {/* Card art on the left — fixed aspect 3:4 to match Bandai prints.
              Image bytes flow through /api/img because Bandai's CORP header
              blocks browser hot-linking. */}
          <div className="border-border/30 bg-card/60 relative aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-md border">
            {card.imageUrlJp ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={proxiedCardImage(card.imageUrlJp)!}
                alt={card.name}
                loading="eager"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center text-[9px]">
                no image
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-muted-foreground text-[11px] tracking-widest uppercase">
                  {card.id}
                </div>
                <div className="text-foreground line-clamp-2 text-sm font-semibold">
                  {card.name}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {card.colors.map((c) => (
                  <ColorChip key={c} color={c} />
                ))}
              </div>
            </div>

            {restrictionMaxCopies !== null && restrictionMaxCopies !== undefined ? (
              <RestrictionBadge maxCopies={restrictionMaxCopies} size="sm" />
            ) : null}

            <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge variant="outline" className="font-mono">
                {labelOf(card.cardType)}
              </Badge>
              {card.cost !== null ? <span>cost {card.cost}</span> : null}
              {card.power !== null ? <span>pwr {card.power}</span> : null}
              {card.life !== null ? <span>life {card.life}</span> : null}
              {card.counter !== null ? <span>cnt {card.counter}</span> : null}
              {card.rarity ? <span>· {card.rarity}</span> : null}
            </div>

            {card.features.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {card.features.slice(0, 3).map((f) => (
                  <Badge key={f} variant="secondary" className="text-[10px]">
                    {f}
                  </Badge>
                ))}
                {card.features.length > 3 ? (
                  <span className="text-muted-foreground self-center text-[10px]">
                    +{card.features.length - 3}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="mt-auto pt-1">
              <SourceBadge source={card.source} verified={card.verified} />
            </div>
          </div>
        </CardContent>
      </Card>
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
    case "DON":
      return "ドン";
    default:
      return type;
  }
}
