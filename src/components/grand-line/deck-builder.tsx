"use client";

import { useEffect, useMemo, useState } from "react";

import { AiDeckProposer } from "@/components/grand-line/ai-deck-proposer";
import { ColorChip } from "@/components/grand-line/color-chip";
import { DeckRadar } from "@/components/grand-line/deck-radar";
import { ProbabilityPanel } from "@/components/grand-line/probability-panel";
import { RestrictionBadge } from "@/components/grand-line/restriction-badge";
import { SourceBadge } from "@/components/grand-line/source-badge";
import { proxiedCardImage } from "@/lib/img";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { evaluateDeck, type EvalCard } from "@/lib/deck-evaluation";
import {
  costCurve,
  validateDeck,
  type DeckLeader,
  type RuleViolation,
} from "@/lib/deck-rules";
import { cn } from "@/lib/utils";
import { useDeckDraft } from "@/stores/deck";
import type { CardListItem } from "@/lib/cards";

interface DeckBuilderProps {
  leader: CardListItem;
  pool: CardListItem[];
  /** Whether the underlying card data is mock vs DB-backed. */
  usingMock: boolean;
  /** Bandai-issued max-copies overrides (0 = banned, 1-3 = restricted). */
  perCardMax?: Record<string, number>;
  /** Banned pairs. */
  pairBans?: Array<{ cardIdA: string; cardIdB: string }>;
}

const TARGET = 50;

export function DeckBuilder({
  leader,
  pool,
  usingMock,
  perCardMax = {},
  pairBans = [],
}: DeckBuilderProps) {
  const setLeader = useDeckDraft((s) => s.setLeader);
  const entries = useDeckDraft((s) => s.entries);
  const add = useDeckDraft((s) => s.add);
  const remove = useDeckDraft((s) => s.remove);
  const clear = useDeckDraft((s) => s.clear);

  // Initialize the draft to this leader on first mount. Switching leaders
  // wipes the previous draft (handled inside the store).
  useEffect(() => {
    setLeader(leader.id);
  }, [leader.id, setLeader]);

  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const leaderColors = new Set(leader.colors);
    return pool
      .filter((c) => c.cardType !== "LEADER")
      .filter((c) => c.colors.some((col) => leaderColors.has(col)))
      .filter((c) =>
        query
          ? c.name.includes(query) ||
            c.features.some((f) => f.includes(query)) ||
            c.id.includes(query)
          : true,
      );
  }, [pool, leader.colors, query]);

  const draftLeader: DeckLeader = {
    id: leader.id,
    name: leader.name,
    colors: leader.colors,
  };
  const ruleCards = Object.values(entries).map((e) => ({
    id: e.card.id,
    cardType: e.card.cardType,
    colors: e.card.colors,
    count: e.count,
    cost: e.card.cost ?? null,
  }));
  const evalCards: EvalCard[] = Object.values(entries).map((e) => ({
    id: e.card.id,
    cardType: e.card.cardType,
    colors: e.card.colors,
    features: e.card.features,
    cost: e.card.cost,
    power: e.card.power,
    counter: e.card.counter,
    hasTrigger: e.card.hasTrigger,
    mechanics: e.card.mechanics,
    count: e.count,
  }));
  const perCardMaxMap = useMemo(
    () => new Map(Object.entries(perCardMax)),
    [perCardMax],
  );
  const report = validateDeck(draftLeader, ruleCards, {
    perCardMax: perCardMaxMap,
    pairBans,
  });
  const curve = costCurve(ruleCards);
  const total = report.totalCount;
  const evaluation = useMemo(() => evaluateDeck(evalCards), [evalCards]);
  const sortedEntries = Object.values(entries).sort((a, b) => {
    const ca = a.card.cost ?? 99;
    const cb = b.card.cost ?? 99;
    return ca - cb || a.card.id.localeCompare(b.card.id);
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      {/* Card pool */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl tracking-wide">候補カード</h2>
          <span className="text-muted-foreground text-xs">
            {filtered.length} 件 (リーダー色フィルタ適用済み)
          </span>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前 / 特徴 / ID で検索"
        />
        <ScrollArea className="border-border/40 bg-card/30 h-[60vh] rounded-lg border p-2">
          <ul className="grid gap-1.5">
            {filtered.map((c) => {
              const count = entries[c.id]?.count ?? 0;
              const max = perCardMaxMap.get(c.id);
              const banned = max === 0;
              return (
                <li
                  key={c.id}
                  className={cn(
                    "border-border/30 hover:bg-accent/30 flex items-center gap-3 rounded-md border bg-background/40 px-2 py-1.5",
                    banned && "opacity-50",
                  )}
                >
                  <div className="border-border/30 bg-card/60 relative aspect-[3/4] w-9 shrink-0 overflow-hidden rounded-sm border">
                    {c.imageUrlJp ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={proxiedCardImage(c.imageUrlJp)!}
                        alt={c.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {c.id}
                      </span>
                      {c.colors.map((col) => (
                        <ColorChip key={col} color={col} />
                      ))}
                      {typeof max === "number" ? (
                        <RestrictionBadge maxCopies={max} size="sm" />
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {c.cost !== null ? `c${c.cost}` : ""}
                        {c.power !== null ? ` p${c.power}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => remove(c.id)}
                      disabled={count === 0}
                    >
                      −
                    </Button>
                    <span className="w-7 text-center font-mono text-sm tabular-nums">
                      {count}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => add(c)}
                      disabled={count >= 4}
                    >
                      +
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-sm">
              候補が見つかりません。
            </p>
          ) : null}
        </ScrollArea>
      </section>

      {/* Right column: leader summary + draft */}
      <aside className="space-y-4">
        <Card className="border-primary/30 bg-card/60">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
                  Leader · {leader.id}
                </p>
                <p className="text-base font-semibold">{leader.name}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {leader.colors.map((c) => (
                  <ColorChip key={c} color={c} />
                ))}
              </div>
            </div>
            <div className="text-muted-foreground flex flex-wrap gap-2 text-[11px]">
              {leader.life !== null ? <span>life {leader.life}</span> : null}
              {leader.power !== null ? <span>pwr {leader.power}</span> : null}
              {leader.features.slice(0, 4).map((f) => (
                <Badge key={f} variant="secondary" className="text-[10px]">
                  {f}
                </Badge>
              ))}
            </div>
            <SourceBadge source={leader.source} verified={leader.verified} />
          </CardContent>
        </Card>

        {/* Counter + curve */}
        <Card className="border-border/40 bg-card/40">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground text-[11px] tracking-widest uppercase">
                デッキ枚数
              </span>
              <span
                className={cn(
                  "font-mono text-2xl tabular-nums",
                  total === TARGET
                    ? "text-source-verified"
                    : total > TARGET
                      ? "text-destructive"
                      : "text-foreground",
                )}
              >
                {total} / {TARGET}
              </span>
            </div>
            <Separator />
            <div>
              <p className="text-muted-foreground mb-1 text-[11px] tracking-widest uppercase">
                コストカーブ
              </p>
              <CostCurveBars curve={curve} />
            </div>
          </CardContent>
        </Card>

        <AiDeckProposer leader={leader} pool={pool} />

        <RuleReport violations={report.violations} legal={report.legal} />

        {/* 5-metric radar */}
        <Card className="border-border/40 bg-card/40">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-sm tracking-wide">評価指標</h3>
              <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
                Phase 3
              </span>
            </div>
            <DeckRadar evaluation={evaluation} />
          </CardContent>
        </Card>

        {/* Probability turn chart */}
        <ProbabilityPanel entries={sortedEntries} />

        {/* Current draft */}
        <Card className="border-border/40 bg-card/40">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-sm tracking-wide">下書き</h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => clear()}
                disabled={total === 0}
                className="text-muted-foreground hover:text-destructive"
              >
                クリア
              </Button>
            </div>
            <ScrollArea className="h-72">
              <ul className="space-y-1">
                {sortedEntries.map(({ card, count }) => (
                  <li
                    key={card.id}
                    className="hover:bg-accent/30 flex items-center gap-2 rounded-md px-2 py-1 text-xs"
                  >
                    <div className="border-border/30 bg-card/60 relative aspect-[3/4] w-6 shrink-0 overflow-hidden rounded-sm border">
                      {card.imageUrlJp ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={proxiedCardImage(card.imageUrlJp)!}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <span className="text-muted-foreground font-mono">
                      {card.cost !== null ? `c${card.cost}` : "  "}
                    </span>
                    <span className="flex-1 truncate">{card.name}</span>
                    <span className="font-mono">×{count}</span>
                  </li>
                ))}
              </ul>
              {sortedEntries.length === 0 ? (
                <p className="text-muted-foreground p-4 text-center text-xs">
                  まだ何も追加していません。
                </p>
              ) : null}
            </ScrollArea>
          </CardContent>
        </Card>

        {usingMock ? (
          <p className="text-source-unverified text-[11px]">
            ※ モックデータで構築中。実カードでの構築はスクレイプ後に有効化されます。
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function CostCurveBars({ curve }: { curve: Record<number, number> }) {
  const max = Math.max(1, ...Object.values(curve));
  return (
    <div className="grid grid-cols-9 gap-1">
      {Array.from({ length: 9 }).map((_, i) => {
        const v = curve[i] ?? 0;
        const h = Math.max(2, Math.round((v / max) * 56));
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="bg-muted/40 relative flex h-14 w-full items-end rounded-sm">
              <div
                className="bg-primary/80 w-full rounded-sm"
                style={{ height: `${h}px` }}
              />
            </div>
            <span className="text-muted-foreground font-mono text-[10px]">
              {i === 8 ? "8+" : i}
            </span>
            <span className="font-mono text-[10px]">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

function RuleReport({
  violations,
  legal,
}: {
  violations: RuleViolation[];
  legal: boolean;
}) {
  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity !== "error");

  return (
    <Card
      className={cn(
        "border-border/40 bg-card/40",
        legal && "border-source-verified/40",
      )}
    >
      <CardContent className="space-y-2 p-4 text-xs">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm tracking-wide">ルール検証</h3>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase",
              legal
                ? "border-source-verified/40 text-source-verified bg-source-verified/10"
                : "border-destructive/40 text-destructive bg-destructive/10",
            )}
          >
            {legal ? "Legal" : "Illegal"}
          </span>
        </div>
        {errors.length === 0 && warnings.length === 0 ? (
          <p className="text-muted-foreground">問題なし。</p>
        ) : (
          <ul className="space-y-1">
            {[...errors, ...warnings].map((v) => (
              <li key={v.code} className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    v.severity === "error" ? "bg-destructive" : "bg-source-unverified",
                  )}
                />
                <span>
                  {v.message}
                  {v.cardIds && v.cardIds.length > 0 ? (
                    <span className="text-muted-foreground ml-1 font-mono text-[10px]">
                      ({v.cardIds.slice(0, 3).join(", ")}
                      {v.cardIds.length > 3 ? `, +${v.cardIds.length - 3}` : ""})
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
