"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { DeckEvaluation, MetricKey } from "@/lib/deck-evaluation";

interface DeckRadarProps {
  evaluation: DeckEvaluation;
  className?: string;
}

const AXIS: Array<{ key: MetricKey; label: string }> = [
  { key: "attack", label: "攻撃力" },
  { key: "stability", label: "安定性" },
  { key: "expansion", label: "展開力" },
  { key: "defense", label: "防御力" },
  { key: "meta", label: "対環境" },
];

export function DeckRadar({ evaluation, className }: DeckRadarProps) {
  const [hovered, setHovered] = useState<MetricKey | null>(null);

  const data = AXIS.map((axis) => ({
    metric: axis.label,
    key: axis.key,
    value: evaluation[axis.key].score,
    full: 100,
  }));

  const focused: MetricKey = hovered ?? "stability";
  const focusedMetric = evaluation[focused];

  return (
    <div className={cn("space-y-3", className)}>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="78%">
            <PolarGrid stroke="oklch(0.7 0 0 / 25%)" />
            <PolarAngleAxis
              dataKey="metric"
              tick={{ fill: "oklch(0.85 0.01 80)", fontSize: 11 }}
            />
            <PolarRadiusAxis
              domain={[0, 100]}
              tick={false}
              axisLine={false}
              tickCount={5}
            />
            <Radar
              name="this deck"
              dataKey="value"
              stroke="var(--color-primary)"
              fill="var(--color-primary)"
              fillOpacity={0.35}
              strokeWidth={2}
            />
            <RechartsTooltip
              cursor={false}
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const point = payload[0]?.payload as
                  | { metric: string; key: MetricKey; value: number }
                  | undefined;
                if (!point) return null;
                return (
                  <div className="border-border/40 bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
                    <div className="font-semibold">{point.metric}</div>
                    <div className="font-mono">{point.value.toFixed(1)} / 100</div>
                  </div>
                );
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {AXIS.map((axis) => {
          const score = evaluation[axis.key].score;
          const isFocused = hovered === axis.key;
          return (
            <button
              key={axis.key}
              type="button"
              onMouseEnter={() => setHovered(axis.key)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(axis.key)}
              onBlur={() => setHovered(null)}
              className={cn(
                "border-border/40 rounded-md border px-2 py-1 text-[11px] tracking-wide transition",
                isFocused
                  ? "border-primary/60 bg-primary/10"
                  : "hover:bg-accent/40",
              )}
            >
              <span className="text-muted-foreground mr-1">{axis.label}</span>
              <span className="font-mono">{score.toFixed(0)}</span>
            </button>
          );
        })}
        <div className="text-muted-foreground ml-auto font-mono text-[11px]">
          総合 {evaluation.composite.toFixed(0)}
        </div>
      </div>

      {/* Breakdown of the currently-focused metric */}
      <div className="border-border/40 bg-card/60 space-y-1.5 rounded-md border p-3 text-xs">
        <div className="text-muted-foreground tracking-widest uppercase">
          {AXIS.find((a) => a.key === focused)?.label} ─ 内訳
        </div>
        {focusedMetric.breakdown.map((b) => (
          <div key={b.factor} className="flex items-center gap-2">
            <span className="text-foreground/80 w-40 truncate">{b.factor}</span>
            <div className="bg-muted/40 relative h-1.5 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-primary/80 h-full"
                style={{ width: `${(b.contribution / b.cap) * 100}%` }}
              />
            </div>
            <span className="text-muted-foreground w-12 text-right font-mono">
              {b.contribution.toFixed(1)}/{b.cap}
            </span>
          </div>
        ))}
        {focusedMetric.breakdown[0]?.detail ? (
          <p className="text-muted-foreground pt-1 text-[10px]">
            {focusedMetric.breakdown.map((b) => b.detail).filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
