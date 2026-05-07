"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { groupColor, seedGroups, type SeededGroup } from "@/lib/auto-groups";
import type { CardListItem } from "@/lib/cards";
import {
  exactTurnProbabilities,
  monteCarloTurnProbabilities,
  type CardGroup,
  type DeckEntry,
  type TurnProbabilityRow,
} from "@/lib/probability";

interface ProbabilityPanelProps {
  /** Deck entries from the Zustand store. */
  entries: Array<{ card: CardListItem; count: number }>;
}

const MAX_TURN = 7;
const MC_TRIALS = 10_000;

export function ProbabilityPanel({ entries }: ProbabilityPanelProps) {
  const [groups, setGroups] = useState<SeededGroup[]>(() => seedGroups(entries));
  const [mcRows, setMcRows] = useState<TurnProbabilityRow[] | null>(null);
  const [isComputing, setIsComputing] = useState(false);

  // Re-seed when the deck membership changes — but don't blow away manual
  // edits the user has already made (preserve assignments for cards still
  // in the deck).
  useEffect(() => {
    setGroups((prev) => {
      const fresh = seedGroups(entries);
      const inDeck = new Set(entries.map((e) => e.card.id));
      return fresh.map((freshGroup) => {
        const prior = prev.find((p) => p.id === freshGroup.id);
        const cardIds = (prior ? prior.cardIds : freshGroup.cardIds).filter((id) =>
          inDeck.has(id),
        );
        return { ...freshGroup, cardIds };
      });
    });
    // Stale Monte Carlo result on deck change.
    setMcRows(null);
  }, [entries]);

  const totalCount = entries.reduce((acc, e) => acc + e.count, 0);
  const deckSize = totalCount > 0 ? totalCount : 50;

  // Live "exact" curves (closed-form, ignores overlap). Recomputed every
  // render — cheap because it's just 7 hypergeometric calls per group.
  const exactRows = useMemo(() => {
    const groupSizes = groups.map((g) => ({
      id: g.id,
      size: g.cardIds.reduce(
        (acc, cardId) =>
          acc + (entries.find((e) => e.card.id === cardId)?.count ?? 0),
        0,
      ),
    }));
    return exactTurnProbabilities(deckSize, groupSizes, MAX_TURN);
  }, [entries, groups, deckSize]);

  const chartData = (mcRows ?? exactRows).map((row) => {
    const point: Record<string, number> = { turn: row.turn };
    for (const g of groups) {
      point[g.id] = row.probabilities[g.id] ?? 0;
    }
    return point;
  });

  async function runMonteCarlo() {
    setIsComputing(true);
    // Defer to next tick so the spinner shows.
    await new Promise((r) => setTimeout(r, 0));
    const deck: DeckEntry[] = entries.map((e) => ({
      cardId: e.card.id,
      count: e.count,
    }));
    const cardGroups: CardGroup[] = groups.map((g) => ({
      id: g.id,
      label: g.label,
      cardIds: g.cardIds,
    }));
    const rows = monteCarloTurnProbabilities(deck, cardGroups, {
      trials: MC_TRIALS,
      maxTurn: MAX_TURN,
    });
    setMcRows(rows);
    setIsComputing(false);
  }

  function toggleCard(groupId: string, cardId: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              cardIds: g.cardIds.includes(cardId)
                ? g.cardIds.filter((id) => id !== cardId)
                : [...g.cardIds, cardId],
            }
          : g,
      ),
    );
  }

  const computedLabel = mcRows ? `Monte Carlo · ${MC_TRIALS.toLocaleString()} 試行` : "厳密解 (mulliganなし)";

  return (
    <Card className="border-border/40 bg-card/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm tracking-wide">引き確率</h3>
          <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
            Phase 3.7
          </span>
        </div>

        {totalCount === 0 ? (
          <p className="text-muted-foreground text-xs">
            カードを追加すると、各グループのターン別の引き確率が表示されます。
          </p>
        ) : (
          <>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 6, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="oklch(0.7 0 0 / 18%)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="turn"
                    tick={{ fill: "oklch(0.85 0.01 80)", fontSize: 10 }}
                    label={{
                      value: "turn",
                      position: "insideBottomRight",
                      offset: -2,
                      fill: "oklch(0.65 0.01 80)",
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tick={{ fill: "oklch(0.85 0.01 80)", fontSize: 10 }}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}`}
                  />
                  <RechartsTooltip
                    formatter={(value, name) => [
                      `${(Number(value) * 100).toFixed(1)}%`,
                      groups.find((g) => g.id === name)?.label ?? String(name),
                    ]}
                    labelFormatter={(label) => `turn ${label}`}
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value) =>
                      groups.find((g) => g.id === value)?.label ?? value
                    }
                  />
                  {groups.map((g) =>
                    g.cardIds.length > 0 ? (
                      <Line
                        key={g.id}
                        type="monotone"
                        dataKey={g.id}
                        stroke={groupColor(g.id)}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    ) : null,
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{computedLabel}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={runMonteCarlo}
                disabled={isComputing}
                className="h-7 text-[10px]"
              >
                {isComputing ? "計算中…" : "Monte Carlo で再計算"}
              </Button>
            </div>

            <div className="space-y-2 pt-1">
              {groups.map((g) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  entries={entries}
                  onToggle={(cardId) => toggleCard(g.id, cardId)}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GroupRow({
  group,
  entries,
  onToggle,
}: {
  group: SeededGroup;
  entries: Array<{ card: CardListItem; count: number }>;
  onToggle: (cardId: string) => void;
}) {
  const totalSize = group.cardIds.reduce(
    (acc, cardId) =>
      acc + (entries.find((e) => e.card.id === cardId)?.count ?? 0),
    0,
  );
  const inGroup = new Set(group.cardIds);

  return (
    <div className="border-border/30 rounded-md border p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-medium"
              style={{ color: groupColor(group.id) }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: groupColor(group.id) }}
              />
              {group.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64 text-xs">
            {group.description}
          </TooltipContent>
        </Tooltip>
        <span className="text-muted-foreground font-mono text-[10px]">
          {totalSize} 枚
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {entries.map(({ card }) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onToggle(card.id)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] tracking-wide transition",
              inGroup.has(card.id)
                ? "border-primary/40 bg-primary/15 text-foreground"
                : "border-border/30 bg-card/40 text-muted-foreground hover:bg-accent/40",
            )}
          >
            {card.name}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <p className="text-muted-foreground p-2 text-center text-[10px]">
          (デッキにカードが入ると候補が表示されます)
        </p>
      ) : null}
    </div>
  );
}

