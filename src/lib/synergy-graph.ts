/**
 * Layout helpers for the synergy graph.
 *
 * Two layouts the UI flips between:
 *
 *   1. **Compass** (default). Leader anchored at the centre. Direct edges
 *      from the leader fan out radially in a deterministic order, with
 *      distance proportional to `(10 - strength)` so strong synergies sit
 *      closer. Non-leader edges are hidden in this view — the goal is a
 *      "what does the leader want" snapshot you can read at a glance.
 *
 *   2. **Force**. d3-force simulation across all nodes and edges. Edge
 *      strength weights both the link strength (0..1) and visual stroke
 *      width. The leader is fixed at the centre so the graph doesn't
 *      drift. The simulation is run synchronously for `STATIC_TICKS`
 *      ticks before being handed to React, so the UI never animates a
 *      layout that isn't already settled.
 *
 * Both layouts return the same `LaidOutGraph` shape so the renderer can
 * swap layouts without re-typing.
 */

import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

import type { CardListItem } from "@/lib/cards";
import type { RuleSynergy } from "@/lib/synergy-rules";

/* ──────────────────────────────────────────────────────────────────────── */
/* Public types                                                              */
/* ──────────────────────────────────────────────────────────────────────── */

export type LayoutMode = "compass" | "force";

export interface GraphNode {
  id: string;
  card: CardListItem;
  isLeader: boolean;
  x: number;
  y: number;
}

export interface GraphLink {
  /** Stable id for React keys. */
  id: string;
  source: string;
  target: string;
  relationType: RuleSynergy["relationType"];
  strength: number;
  reasoningJa: string;
  reasoningEn: string;
}

export interface LaidOutGraph {
  width: number;
  height: number;
  nodes: GraphNode[];
  links: GraphLink[];
}

interface BuildOptions {
  width?: number;
  height?: number;
  /** Drop edges below this strength to keep the canvas readable. */
  minStrength?: number;
  /**
   * Cap the number of edges per node (top-N by strength). Helps the
   * force layout converge and the compass view stay readable.
   */
  maxEdgesPerNode?: number;
}

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 820;
const DEFAULT_MIN_STRENGTH = 2.5;
const DEFAULT_MAX_EDGES_PER_NODE = 8;
const STATIC_TICKS = 280;

/* ──────────────────────────────────────────────────────────────────────── */
/* Pre-processing                                                            */
/* ──────────────────────────────────────────────────────────────────────── */

interface NormalizedInput {
  leader: CardListItem;
  cards: CardListItem[];
  edges: RuleSynergy[];
  width: number;
  height: number;
}

function normalize(
  leader: CardListItem,
  pool: CardListItem[],
  edges: RuleSynergy[],
  opts: BuildOptions,
): NormalizedInput {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const minStrength = opts.minStrength ?? DEFAULT_MIN_STRENGTH;
  const cap = opts.maxEdgesPerNode ?? DEFAULT_MAX_EDGES_PER_NODE;

  // Drop weak edges first.
  const filtered = edges.filter((e) => e.strength >= minStrength);

  // Cap edges per node — keep the strongest ones.
  const perNodeCounts = new Map<string, number>();
  const sorted = [...filtered].sort((a, b) => b.strength - a.strength);
  const capped: RuleSynergy[] = [];
  for (const e of sorted) {
    const fromCount = perNodeCounts.get(e.fromCardId) ?? 0;
    const toCount = perNodeCounts.get(e.toCardId) ?? 0;
    if (fromCount >= cap || toCount >= cap) continue;
    capped.push(e);
    perNodeCounts.set(e.fromCardId, fromCount + 1);
    perNodeCounts.set(e.toCardId, toCount + 1);
  }

  // Only include cards actually referenced by surviving edges (plus the leader).
  const referenced = new Set<string>([leader.id]);
  for (const e of capped) {
    referenced.add(e.fromCardId);
    referenced.add(e.toCardId);
  }
  const byId = new Map(pool.map((c) => [c.id, c]));
  if (!byId.has(leader.id)) byId.set(leader.id, leader);
  const cards = [...referenced]
    .map((id) => byId.get(id))
    .filter((c): c is CardListItem => Boolean(c));

  return { leader, cards, edges: capped, width, height };
}

function toLink(e: RuleSynergy): GraphLink {
  return {
    id: `${e.fromCardId}__${e.toCardId}__${e.relationType}`,
    source: e.fromCardId,
    target: e.toCardId,
    relationType: e.relationType,
    strength: e.strength,
    reasoningJa: e.reasoningJa,
    reasoningEn: e.reasoningEn,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Compass layout                                                            */
/* ──────────────────────────────────────────────────────────────────────── */

export function buildCompassLayout(
  leader: CardListItem,
  pool: CardListItem[],
  edges: RuleSynergy[],
  opts: BuildOptions = {},
): LaidOutGraph {
  const norm = normalize(leader, pool, edges, opts);

  // Compass shows leader-anchored edges only.
  const leaderEdges = norm.edges.filter(
    (e) =>
      e.fromCardId === norm.leader.id || e.toCardId === norm.leader.id,
  );
  const partnerIds = new Set<string>();
  for (const e of leaderEdges) {
    partnerIds.add(e.fromCardId === norm.leader.id ? e.toCardId : e.fromCardId);
  }

  // Order partners deterministically by strength (strongest first), then id.
  const strengthByPartner = new Map<string, number>();
  for (const e of leaderEdges) {
    const partner = e.fromCardId === norm.leader.id ? e.toCardId : e.fromCardId;
    const current = strengthByPartner.get(partner) ?? 0;
    if (e.strength > current) strengthByPartner.set(partner, e.strength);
  }
  const partners = [...partnerIds].sort((a, b) => {
    const sa = strengthByPartner.get(a) ?? 0;
    const sb = strengthByPartner.get(b) ?? 0;
    if (sa !== sb) return sb - sa;
    return a.localeCompare(b);
  });

  const cx = norm.width / 2;
  const cy = norm.height / 2;
  const innerRadius = 110;
  const outerRadius = Math.min(norm.width, norm.height) / 2 - 60;
  const byId = new Map(norm.cards.map((c) => [c.id, c]));

  const nodes: GraphNode[] = [
    {
      id: norm.leader.id,
      card: norm.leader,
      isLeader: true,
      x: cx,
      y: cy,
    },
  ];

  for (let i = 0; i < partners.length; i++) {
    const card = byId.get(partners[i]);
    if (!card) continue;
    const angle = (i / Math.max(partners.length, 1)) * 2 * Math.PI - Math.PI / 2;
    const strength = strengthByPartner.get(partners[i]) ?? 0;
    const t = 1 - Math.min(1, Math.max(0, (strength - 2) / 8));
    const radius = innerRadius + t * (outerRadius - innerRadius);
    nodes.push({
      id: partners[i],
      card,
      isLeader: false,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }

  return {
    width: norm.width,
    height: norm.height,
    nodes,
    links: leaderEdges.map(toLink),
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Force layout (d3-force)                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

export function buildForceLayout(
  leader: CardListItem,
  pool: CardListItem[],
  edges: RuleSynergy[],
  opts: BuildOptions = {},
): LaidOutGraph {
  const norm = normalize(leader, pool, edges, opts);
  const cx = norm.width / 2;
  const cy = norm.height / 2;

  // d3-force mutates the node objects in-place; we use a separate copy
  // and copy the resulting (x, y) onto our return value so the caller
  // sees a non-d3 plain object.
  type SimNode = {
    id: string;
    isLeader: boolean;
    x: number;
    y: number;
    fx?: number | null;
    fy?: number | null;
    vx?: number;
    vy?: number;
  };
  type SimLink = { source: string; target: string; weight: number };

  const simNodes: SimNode[] = norm.cards.map((card) => ({
    id: card.id,
    isLeader: card.id === norm.leader.id,
    // Spread initial positions on a circle so the simulation has room to work.
    x:
      card.id === norm.leader.id
        ? cx
        : cx + Math.cos(hash(card.id)) * 180,
    y:
      card.id === norm.leader.id
        ? cy
        : cy + Math.sin(hash(card.id)) * 180,
    // Pin the leader.
    fx: card.id === norm.leader.id ? cx : null,
    fy: card.id === norm.leader.id ? cy : null,
  }));

  const simLinks: SimLink[] = norm.edges.map((e) => ({
    source: e.fromCardId,
    target: e.toCardId,
    weight: e.strength / 10,
  }));

  // d3-force types model `links` as taking nodes-or-ids; we feed strings,
  // which d3 resolves against our nodes by `id`.
  const sim = forceSimulation(simNodes as never)
    .force(
      "link",
      forceLink(simLinks)
        .id((d) => (d as SimNode).id)
        .distance((l) => 80 + (1 - (l as SimLink).weight) * 140)
        .strength((l) => 0.2 + (l as SimLink).weight * 0.7),
    )
    .force("charge", forceManyBody().strength(-280))
    .force("x", forceX(cx).strength(0.04))
    .force("y", forceY(cy).strength(0.04))
    .force("center", forceCenter(cx, cy))
    .stop();

  for (let i = 0; i < STATIC_TICKS; i++) sim.tick();

  const nodeById = new Map(simNodes.map((n) => [n.id, n]));
  const cardById = new Map(norm.cards.map((c) => [c.id, c]));

  const nodes: GraphNode[] = simNodes.map((n) => ({
    id: n.id,
    card: cardById.get(n.id)!,
    isLeader: n.isLeader,
    x: clamp(n.x, 30, norm.width - 30),
    y: clamp(n.y, 30, norm.height - 30),
  }));

  const links: GraphLink[] = norm.edges.map((e) => {
    const linkObj = toLink(e);
    // Replace source/target with resolved ids — they may already be strings,
    // but if d3 mutated them into refs we want plain strings out.
    void nodeById; // (touch to keep helper name in scope)
    return linkObj;
  });

  return {
    width: norm.width,
    height: norm.height,
    nodes,
    links,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* helpers                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (h / 4294967296) * Math.PI * 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
