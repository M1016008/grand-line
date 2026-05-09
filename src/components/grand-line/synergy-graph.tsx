"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  buildCompassLayout,
  buildForceLayout,
  buildStrategyLayout,
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
/** Strategy view promotes "key" cards visually — bigger disc + red ring. */
const NODE_RADIUS_KEY = 30;
const KEY_RING_COLOR = "#ef4444";

type RelationType = RuleSynergy["relationType"];

/** Bucket continuous strength (0..10) into 3 thickness tiers. */
function strokeBucket(strength: number): { width: number; opacity: number } {
  if (strength >= 7) return { width: 5, opacity: 0.9 };
  if (strength >= 4) return { width: 3, opacity: 0.7 };
  return { width: 1.4, opacity: 0.45 };
}

interface ViewTransform {
  /** Pan offset in viewBox units. */
  tx: number;
  ty: number;
  /** Multiplicative zoom (1 = fit, >1 = zoomed in). */
  scale: number;
}

const IDENTITY_VIEW: ViewTransform = { tx: 0, ty: 0, scale: 1 };
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;

export function SynergyGraph({ leader, pool, edges, source }: SynergyGraphProps) {
  const [mode, setMode] = useState<LayoutMode>("compass");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  /** When set, only edges of this relation type render. Null → show all. */
  const [soloRelation, setSoloRelation] = useState<RelationType | null>(null);
  /** Pan/zoom transform applied to the inner <g>. */
  const [view, setView] = useState<ViewTransform>(IDENTITY_VIEW);
  const [isDragging, setIsDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** Latest view in a ref so the wheel handler (bound once) reads fresh values. */
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const dragStateRef = useRef<{
    active: boolean;
    startCx: number;
    startCy: number;
    startTx: number;
    startTy: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);

  // Reset zoom/pan whenever the layout mode changes — the new layout has
  // a different coordinate system and stale offsets would land off-canvas.
  useEffect(() => {
    setView(IDENTITY_VIEW);
  }, [mode]);

  // React's onWheel is registered as passive, so preventDefault inside
  // would log a warning. We attach the listener manually with passive:false
  // to swallow the page-scroll behavior while zooming.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const svgPt = pt.matrixTransform(ctm.inverse());

      const cur = viewRef.current;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur.scale * factor));
      const ratio = newScale / cur.scale;
      if (ratio === 1) return;

      // Keep the point under the cursor anchored.
      // Solve for new (tx, ty) so that tx + scale*p stays the same:
      //   tx_new = tx*ratio + p*(1 - ratio)
      setView({
        scale: newScale,
        tx: cur.tx * ratio + svgPt.x * (1 - ratio),
        ty: cur.ty * ratio + svgPt.y * (1 - ratio),
      });
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Don't hijack clicks on cards — those should navigate.
    const target = e.target as Element;
    if (target.closest("a")) return;
    dragStateRef.current = {
      active: true,
      startCx: e.clientX,
      startCy: e.clientY,
      startTx: view.tx,
      startTy: view.ty,
      moved: false,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const ds = dragStateRef.current;
    if (!ds?.active) return;
    const dx = e.clientX - ds.startCx;
    const dy = e.clientY - ds.startCy;
    if (!ds.moved && Math.hypot(dx, dy) < 4) return;
    if (!ds.moved) setIsDragging(true);
    ds.moved = true;
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return;
    // Convert client-px delta into viewBox-unit delta.
    setView((v) => ({
      ...v,
      tx: ds.startTx + dx / ctm.a,
      ty: ds.startTy + dy / ctm.d,
    }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const ds = dragStateRef.current;
    if (!ds) return;
    if (e.currentTarget.hasPointerCapture(ds.pointerId)) {
      e.currentTarget.releasePointerCapture(ds.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const zoomBy = (factor: number) => {
    setView((v) => {
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      const ratio = newScale / v.scale;
      // Zoom around the canvas centre when triggered by a button.
      const cx = (graph.width / 2) * (1 - ratio);
      const cy = (graph.height / 2) * (1 - ratio);
      return { scale: newScale, tx: v.tx * ratio + cx, ty: v.ty * ratio + cy };
    });
  };
  const resetView = () => setView(IDENTITY_VIEW);
  const isTransformed = view.scale !== 1 || view.tx !== 0 || view.ty !== 0;

  const graph: LaidOutGraph = useMemo(() => {
    if (mode === "compass") return buildCompassLayout(leader, pool, edges);
    if (mode === "strategy") return buildStrategyLayout(leader, pool, edges);
    return buildForceLayout(leader, pool, edges);
  }, [mode, leader, pool, edges]);

  const visibleLinks = useMemo(() => {
    if (!soloRelation) return graph.links;
    return graph.links.filter((l) => l.relationType === soloRelation);
  }, [graph.links, soloRelation]);

  /** Set of node ids touched by at least one currently visible link.
   *  Used to fade out unrelated cards when solo filter is on. */
  const visibleNodeIds = useMemo(() => {
    if (!soloRelation) return null;
    const s = new Set<string>([leader.id]);
    for (const l of visibleLinks) {
      s.add(l.source);
      s.add(l.target);
    }
    return s;
  }, [visibleLinks, soloRelation, leader.id]);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );

  const edgeCount = visibleLinks.length;
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

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => zoomBy(1.2)}
              aria-label="拡大"
              title="拡大"
            >
              ＋
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => zoomBy(1 / 1.2)}
              aria-label="縮小"
              title="縮小"
            >
              −
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={resetView}
              disabled={!isTransformed}
              aria-label="表示をリセット"
              title="リセット"
            >
              {Math.round(view.scale * 100)}%
            </Button>
          </div>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as LayoutMode)}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="compass" title="リーダーから直結する Top8 のみを表示する羅針盤型">
              シンプル
            </ToggleGroupItem>
            <ToggleGroupItem value="strategy" title="特徴 (バロックワークス・麦わら 等) でグルーピング、デッキ核となるキーカードを赤枠で強調">
              戦略
            </ToggleGroupItem>
            <ToggleGroupItem value="force" title="フィルタ無しの全エッジ網状ビュー (上級者向け)">
              詳細
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </header>

      <div className="border-border/30 bg-background/40 relative overflow-hidden rounded-lg border">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          className={cn(
            // Cap the canvas to whatever the viewport can show without
            // scrolling — otherwise the leader at viewBox center lands
            // below the fold and looks "biased" toward the bottom.
            "h-[min(820px,calc(100svh-220px))] min-h-[480px] w-full touch-none select-none",
            isDragging ? "cursor-grabbing" : "cursor-grab",
          )}
          role="img"
          aria-label={`${leader.name} を中心としたシナジーグラフ。ホイールで拡大、ドラッグで移動。`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* Reusable circular clip — used to mask each card thumbnail
              into the node's disc. clipPathUnits=objectBoundingBox lets
              the same clip apply to images of any size. */}
          <defs>
            <clipPath id="synergy-node-circle" clipPathUnits="objectBoundingBox">
              <circle cx="0.5" cy="0.5" r="0.5" />
            </clipPath>
          </defs>

          {/* Pan + zoom transform wraps everything below it. */}
          <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.scale})`}>

          {/* Strategy mode: cluster halos behind everything else.
              Each halo is a soft rounded rect tinted with the cluster
              colour, so the player can see "this whole region of the
              graph belongs to the same archetype" without reading
              labels first. */}
          {mode === "strategy" && graph.clusters
            ? graph.clusters.map((c) => {
                const pad = 28;
                const w = c.bbox.maxX - c.bbox.minX + pad * 2;
                const h = c.bbox.maxY - c.bbox.minY + pad * 2;
                if (w <= 0 || h <= 0) return null;
                return (
                  <g key={`halo-${c.id}`}>
                    <rect
                      x={c.bbox.minX - pad}
                      y={c.bbox.minY - pad}
                      width={w}
                      height={h}
                      rx={36}
                      fill={c.color}
                      fillOpacity={0.06}
                      stroke={c.color}
                      strokeOpacity={0.22}
                      strokeWidth={1.5}
                      strokeDasharray="6 6"
                      style={{ pointerEvents: "none" }}
                    />
                  </g>
                );
              })
            : null}

          {/* Edges first so nodes paint on top. */}
          <g>
            {visibleLinks.map((link) => {
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
              const bucket = strokeBucket(link.strength);
              // Strategy mode: peer-to-peer edges (neither endpoint is
              // the leader) are visually de-emphasised so the leader
              // spokes stay legible. Within-cluster peer edges fade
              // even more — they're "obvious" same-archetype links.
              const touchesLeader = a.isLeader || b.isLeader;
              const sameCluster =
                a.clusterId !== undefined &&
                a.clusterId === b.clusterId;
              const peerScale =
                mode === "strategy" && !touchesLeader
                  ? sameCluster
                    ? 0.35
                    : 0.55
                  : 1;
              return (
                <g key={link.id}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={strokeColor}
                    strokeWidth={bucket.width * peerScale}
                    strokeLinecap="round"
                    strokeOpacity={
                      dim ? 0.08 : bucket.opacity * peerScale
                    }
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
              // Strategy view promotes "key" cards visually with a bigger
              // disc + red ring + glow so the eye lands on them first.
              const showKeyTreatment = mode === "strategy" && node.isKey;
              const r = node.isLeader
                ? NODE_RADIUS_LEADER
                : showKeyTreatment
                  ? NODE_RADIUS_KEY
                  : NODE_RADIUS_CARD;
              const filteredOut =
                visibleNodeIds !== null && !visibleNodeIds.has(node.id);
              const dim =
                filteredOut ||
                (hoveredNode !== null && hoveredNode !== node.id && !node.isLeader);
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode((id) => (id === node.id ? null : id))}
                  className="cursor-pointer transition-opacity"
                  style={{ opacity: dim ? (filteredOut ? 0.12 : 0.35) : 1 }}
                >
                  <Link href={`/cards/${node.id}`}>
                    <title>
                      {node.card.name} ({node.card.id})
                      {showKeyTreatment ? " · 🔑 KEY" : ""}
                    </title>
                    {/* Outer ring — colour cues whether this is the leader,
                        a key card, or a regular partner. */}
                    <circle
                      r={r + (showKeyTreatment ? 5 : 4)}
                      fill="var(--color-background)"
                      stroke={
                        node.isLeader
                          ? "var(--color-primary)"
                          : showKeyTreatment
                            ? KEY_RING_COLOR
                            : nodeStrokeFor(node.card)
                      }
                      strokeWidth={
                        node.isLeader ? 2.5 : showKeyTreatment ? 3 : 1.5
                      }
                      style={{
                        filter: node.isLeader
                          ? "drop-shadow(0 0 12px var(--color-primary))"
                          : showKeyTreatment
                            ? `drop-shadow(0 0 8px ${KEY_RING_COLOR})`
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

          {/* Strategy mode: cluster labels — drawn last so they sit on
              top of edges + halos. Each label tells the player which
              archetype that wedge represents (e.g. "バロックワークス"). */}
          {mode === "strategy" && graph.clusters
            ? graph.clusters.map((c) => (
                <g key={`label-${c.id}`} style={{ pointerEvents: "none" }}>
                  <rect
                    x={c.labelX - (c.label.length * 8 + 28)}
                    y={c.labelY - 18}
                    width={c.label.length * 16 + 56}
                    height={36}
                    rx={18}
                    fill="var(--color-background)"
                    fillOpacity={0.85}
                    stroke={c.color}
                    strokeWidth={1.5}
                    strokeOpacity={0.7}
                  />
                  <text
                    x={c.labelX}
                    y={c.labelY + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={15}
                    fontWeight={700}
                    fill={c.color}
                    fontFamily="var(--font-display), serif"
                  >
                    {c.label}
                  </text>
                  <text
                    x={c.labelX}
                    y={c.labelY + 22}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={10}
                    fill="var(--color-muted-foreground)"
                    fontFamily="var(--font-mono), monospace"
                  >
                    {c.cardCount} 枚
                  </text>
                </g>
              ))
            : null}
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

      <Legend solo={soloRelation} onToggle={setSoloRelation} />
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

function Legend({
  solo,
  onToggle,
}: {
  solo: RelationType | null;
  onToggle: (next: RelationType | null) => void;
}) {
  return (
    <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-2 text-[11px]">
      <span className="tracking-widest uppercase">エッジ色:</span>
      {(Object.keys(RELATION_LABEL) as RelationType[]).map((k) => {
        const active = solo === k;
        const dim = solo !== null && !active;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onToggle(active ? null : k)}
            aria-pressed={active}
            className={cn(
              "border-border/30 inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 transition",
              active && "ring-foreground/40 ring-1",
              dim && "opacity-40 hover:opacity-80",
            )}
            style={{
              borderColor: RELATION_COLOR[k] + (active ? "" : "55"),
              background: active ? RELATION_COLOR[k] + "22" : undefined,
            }}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: RELATION_COLOR[k] }}
            />
            {RELATION_LABEL[k]}
          </button>
        );
      })}
      {solo && (
        <button
          type="button"
          onClick={() => onToggle(null)}
          className="text-muted-foreground hover:text-foreground ml-1 rounded px-1.5 py-0.5 text-[10px] underline-offset-2 hover:underline"
        >
          解除
        </button>
      )}
    </div>
  );
}
