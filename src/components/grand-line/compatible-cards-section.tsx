"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CompatibleCard } from "@/lib/card-compat";
import { proxiedCardImage } from "@/lib/img";

interface CompatibleCardsSectionProps {
  results: CompatibleCard[];
}

const RELATION_LABEL: Record<CompatibleCard["relationType"], string> = {
  leader_direct: "リーダー直結",
  feature_chain: "特徴チェイン",
  tempo_combo: "テンポ",
  defense_combo: "防御",
  resource_engine: "リソース",
  finisher: "フィニッシャー",
  anti_meta: "メタ対応",
  other: "その他",
};

const RELATION_BADGE: Record<CompatibleCard["relationType"], string> = {
  leader_direct: "border-amber-400/40 text-amber-300",
  feature_chain: "border-violet-400/40 text-violet-300",
  tempo_combo: "border-orange-400/40 text-orange-300",
  defense_combo: "border-sky-400/40 text-sky-300",
  resource_engine: "border-emerald-400/40 text-emerald-300",
  finisher: "border-rose-400/40 text-rose-300",
  anti_meta: "border-rose-400/40 text-rose-300",
  other: "border-border/40 text-muted-foreground",
};

export function CompatibleCardsSection({ results }: CompatibleCardsSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="border-border/40 bg-card/30 rounded-lg border">
      <Button
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        className="w-full justify-between rounded-lg px-4 py-3 text-left hover:bg-card/60"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="font-display text-sm tracking-wide">
            相性の良いカード Top {results.length}
          </span>
          <Badge variant="outline" className="text-[10px]">
            キャラ・イベント・ステージ
          </Badge>
        </span>
        <span
          className="text-muted-foreground text-xs transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          ▾
        </span>
      </Button>

      {open ? (
        <div className="border-border/30 space-y-2 border-t p-3">
          {results.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">
              相性カードのデータがまだありません。AI 解析を走らせるとここに反映されます。
            </p>
          ) : (
            <ol className="space-y-2">
              {results.map((r, i) => (
                <li key={r.card.id}>
                  <Link
                    href={`/cards/${r.card.id}`}
                    className="border-border/30 bg-background/40 hover:border-primary/40 flex gap-3 rounded-md border p-2 transition"
                  >
                    <div className="border-border/40 bg-background/60 relative flex aspect-[3/4] w-16 shrink-0 items-center justify-center overflow-hidden rounded">
                      {r.card.imageUrlJp ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={proxiedCardImage(r.card.imageUrlJp)!}
                          alt={r.card.name}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="text-muted-foreground p-1 text-center text-[10px]">
                          画像なし
                        </div>
                      )}
                      <span className="bg-primary/80 text-primary-foreground absolute top-0 left-0 rounded-br px-1 text-[10px] font-bold">
                        #{i + 1}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground/90 truncate text-sm font-semibold">
                          {r.card.name}
                        </span>
                        <span className="text-muted-foreground font-mono text-[10px]">
                          {r.card.id} · {r.card.cardType}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${RELATION_BADGE[r.relationType]}`}
                        >
                          {RELATION_LABEL[r.relationType]}
                        </span>
                        <span className="text-muted-foreground text-[10px]">
                          強度 {r.strength.toFixed(1)} / 10
                        </span>
                        {r.source === "ai" ? (
                          <Badge variant="outline" className="text-[10px]">
                            AI 解釈
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-foreground/80 text-xs leading-relaxed">
                        {r.reasoningJa || "(理由テキスト未生成)"}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}

          <Card className="border-dashed border-border/30 bg-transparent shadow-none">
            <CardContent className="text-muted-foreground p-3 text-[11px] leading-relaxed">
              相性スコアはルールベース判定 + AI 解釈のミックスです。「AI 解釈」バッジは
              Claude による推論なので、実際のプレイ感と照らし合わせてご活用ください。
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
