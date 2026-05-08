"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  buildCompassLayout,
  buildForceLayout,
  type LaidOutGraph,
  type LayoutMode,
} from "@/lib/synergy-graph";
import type { CardListItem } from "@/lib/cards";
import { proxiedCardImage } from "@/lib/img";
import type { RuleSynergy } from "@/lib/synergy-rules";

interface SynergyGraphProps {
  leader: CardListItem;
  pool: CardListItem[];
  edges: RuleSynergy[];
  /** "rules" or "rules+ai" — affects the badge in the legend. */
  source: "rules" | "rules+ai";
}

const RELATION_LABEL: Record<RuleSynergy["relationType"], string> = {
  leader_direct: "リーダー直結",
  feature_chain: "特徴チェイン",
  tempo_combo: "テンポ",
  defense_combo: "防御",
  resource_engine: "リソース",
  finisher: "フィニッシャー",
  anti_meta: "メタ対応",
  other: "その他",
};

const RELATION_COLOR: Record<RuleSynergy["relationType"], string> = {
  leader_direct: "var(--color-syn-leader)",
  feature_chain: "var(--color-syn-feature)",
  tempo_combo: "var(--color-syn-tempo)",
  defense_combo: "var(--color-syn-defense)",
  resource_engine: "var(--color-syn-resource)",
  finisher: "var(--color-syn-attack)",
  anti_meta: "var(--color-syn-attack)",
  other: "var(--color-muted-foreground)",
};

const NODE_RADIUS_LEADER = 36;
const NODE_RADIUS_CARD = 22;

export function SynergyGraph({ leader, pool, edges, source }: SynergyGraphProps) {
  const [mode, setMode] = useState<LayoutMode>("compass");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  const graph: LaidOutGraph = useMemo(() => {
    if (mode === "compass") return buildCompassLayout(leader, pool, edges);
    return buildForceLayout(leader, pool, edges);
  }, [mode, leader, pool, edges]);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );

  const edgeCount = graph.links.length;
  const nodeCount = graph.nodes.length;

  return (
    <div className="border-border/40 bg-card/40 rounded-xl border p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="font-display text-foreground text-xl tracking-wide">
            シナジーコンパス
          </h2>
          <p className="text-muted-foreground text-xs">
            {nodeCount} ノード · {edgeCount} エッジ ·{" "}
            <Badge variant="outline" className="text-[10px]">
              {source === "rules+ai" ? "rules + AI" : "rules"}
            </Badge>
          </p>
        </div>

        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as LayoutMode)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="compass">シンプル</ToggleGroupItem>
          <ToggleGroupItem value="force">詳細</ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="border-border/30 bg-background/40 relative overflow-hidden rounded-lg border">
        <svg
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          className="h-[560px] w-full select-none"
          role="img"
          aria-label={`${leader.name} を中心としたシナジーグラフ`}
        >
          {/* Reusable circular clip — used to mask each card thumbnail
              into the node's disc. clipPathUnits=objectBoundingBox lets
              the same clip apply to images of any size. */}
          <defs>
            <clipPath id="synergy-node-circle" clipPathUnits="objectBoundingBox">
              <circle cx="0.5" cy="0.5" r="0.5" />
            </clipPath>
          </defs>

          {/* Edges first so nodes paint on top. */}
          <g>
            {graph.links.map((link) => {
              const a = nodeById.get(link.source);
              const b = nodeById.get(link.target);
              if (!a || !b) return null;
              const isHoveredEdge = hoveredEdge === link.id;
              const isHoveredNode =
                hoveredNode === link.source || hoveredNode === link.target;
              const dim =
                (hoveredNode !== null || hoveredEdge !== null) &&
                !isHoveredEdge &&
                !isHoveredNode;
              const strokeColor = RELATION_COLOR[link.relationType];
              return (
                <g key={link.id}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={strokeColor}
                    strokeWidth={1 + (link.strength / 10) * 3}
                    strokeOpacity={dim ? 0.1 : 0.55 + (link.strength / 10) * 0.45}
                    style={{
                      filter:
                        isHoveredEdge || isHoveredNode
                          ? `drop-shadow(0 0 6px ${strokeColor})`
                          : undefined,
                    }}
                  />
                  {/* Invisible thicker hit-target for hover. */}
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="transparent"
                    strokeWidth={14}
                    onMouseEnter={() => setHoveredEdge(link.id)}
                    onMouseLeave={() => setHoveredEdge((id) => (id === link.id ? null : id))}
                  />
                </g>
              );
            })}
          </g>

          {/* Nodes. */}
          <g>
            {graph.nodes.map((node) => {
              const r = node.isLeader ? NODE_RADIUS_LEADER : NODE_RADIUS_CARD;
              const dim =
                hoveredNode !== null && hoveredNode !== node.id && !node.isLeader;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode((id) => (id === node.id ? null : id))}
                  className="cursor-pointer transition-opacity"
                  style={{ opacity: dim ? 0.35 : 1 }}
                >
                  <Link href={`/cards/${node.id}`}>
                    <title>
                      {node.card.name} ({node.card.id})
                    </title>
                    {/* Outer ring — colour cues whether this is the leader
                        or a coloured archetype card. */}
                    <circle
                      r={r + 4}
                      fill="var(--color-background)"
                      stroke={
                        node.isLeader
                          ? "var(--color-primary)"
                          : nodeStrokeFor(node.card)
                      }
                      strokeWidth={node.isLeader ? 2.5 : 1.5}
                      style={{
                        filter: node.isLeader
                          ? "drop-shadow(0 0 12px var(--color-primary))"
                          : undefined,
                      }}
                    />
                    {node.card.imageUrlJp ? (
                      <image
                        href={proxiedCardImage(node.card.imageUrlJp)!}
                        x={-r}
                        y={-r}
                        width={r * 2}
                        height={r * 2}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath="url(#synergy-node-circle)"
                      />
                    ) : (
                      <>
                        <circle
                          r={r}
                          fill={node.isLeader ? "var(--color-primary)" : "var(--color-card)"}
                          fillOpacity={node.isLeader ? 0.18 : 0.85}
                        />
                        <text
                          textAnchor="middle"
                          y={-2}
                          fontSize={node.isLeader ? 11 : 9}
                          fill="var(--color-foreground)"
                          fontFamily="var(--font-display), serif"
                          fontWeight={600}
                          style={{ pointerEvents: "none" }}
                        >
                          {clipText(node.card.name, node.isLeader ? 8 : 6)}
                        </text>
                      </>
                    )}
                    {/* Card id label below the disc. */}
                    <text
                      textAnchor="middle"
                      y={r + 14}
                      fontSize={node.isLeader ? 10 : 9}
                      fill="var(--color-muted-foreground)"
                      fontFamily="var(--font-mono), monospace"
                      style={{ pointerEvents: "none" }}
                    >
                      {node.card.id}
                    </text>
                  </Link>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Hover detail panel */}
        <HoverDetail
          hoveredEdge={hoveredEdge}
          hoveredNode={hoveredNode}
          edges={graph.links}
          nodes={graph.nodes}
        />
      </div>

      <Legend />
    </div>
  );
}

function nodeStrokeFor(card: CardListItem): string {
  if (card.colors.includes("red")) return "var(--color-tcg-red)";
  if (card.colors.includes("green")) return "var(--color-tcg-green)";
  if (card.colors.includes("blue")) return "var(--color-tcg-blue)";
  if (card.colors.includes("purple")) return "var(--color-tcg-purple)";
  if (card.colors.includes("yellow")) return "var(--color-tcg-yellow)";
  if (card.colors.includes("black")) return "var(--color-tcg-black)";
  return "var(--color-border)";
}

function clipText(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + "…";
}

function HoverDetail({
  hoveredEdge,
  hoveredNode,
  edges,
  nodes,
}: {
  hoveredEdge: string | null;
  hoveredNode: string | null;
  edges: import("@/lib/synergy-graph").GraphLink[];
  nodes: import("@/lib/synergy-graph").GraphNode[];
}) {
  const edge = hoveredEdge ? edges.find((e) => e.id === hoveredEdge) : null;
  const node = hoveredNode ? nodes.find((n) => n.id === hoveredNode) : null;

  if (!edge && !node) {
    return (
      <div className="border-border/30 bg-popover/85 text-muted-foreground absolute right-3 bottom-3 max-w-xs rounded-md border px-3 py-2 text-xs backdrop-blur">
        ノードまたはエッジにホバーすると詳細を表示します。クリックでカード詳細へ。
      </div>
    );
  }

  if (edge) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    return (
      <div className="border-primary/40 bg-popover/95 text-popover-foreground absolute right-3 bottom-3 max-w-sm space-y-1.5 rounded-md border px-3 py-2 text-xs backdrop-blur">
        <div className="text-muted-foreground tracking-widest uppercase">
          {RELATION_LABEL[edge.relationType]} · 強度 {edge.strength.toFixed(1)}
        </div>
        <div className="font-mono text-[11px]">
          {sourceNode?.card.name ?? edge.source} → {targetNode?.card.name ?? edge.target}
        </div>
        <p className="text-foreground/90 leading-relaxed">{edge.reasoningJa}</p>
      </div>
    );
  }

  if (node) {
    return (
      <div className="border-primary/40 bg-popover/95 text-popover-foreground absolute right-3 bottom-3 max-w-sm space-y-1 rounded-md border px-3 py-2 text-xs backdrop-blur">
        <div className="text-muted-foreground font-mono tracking-widest uppercase">
          {node.card.id}
        </div>
        <div className="font-display text-sm font-semibold">{node.card.name}</div>
        <div className="text-muted-foreground flex flex-wrap gap-1">
          {node.card.features.slice(0, 4).map((f) => (
            <span key={f} className="rounded bg-secondary/40 px-1.5 py-0.5">
              {f}
            </span>
          ))}
        </div>
        {node.card.cost !== null || node.card.power !== null ? (
          <div className="text-muted-foreground font-mono text-[10px]">
            {node.card.cost !== null ? `cost ${node.card.cost} ` : ""}
            {node.card.power !== null ? `· pwr ${node.card.power}` : ""}
            {node.card.counter !== null ? ` · cnt ${node.card.counter}` : ""}
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}

function Legend() {
  return (
    <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-2 text-[11px]">
      <span className="tracking-widest uppercase">エッジ色:</span>
      {(Object.keys(RELATION_LABEL) as Array<keyof typeof RELATION_LABEL>).map((k) => (
        <span
          key={k}
          className={cn(
            "border-border/30 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
          )}
          style={{ borderColor: RELATION_COLOR[k] + "55" }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: RELATION_COLOR[k] }}
          />
          {RELATION_LABEL[k]}
        </span>
      ))}
    </div>
  );
}
