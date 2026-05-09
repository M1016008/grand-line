/**
 * Layout helpers for the synergy graph.
 *
 * Three layouts the UI flips between:
 *
 *   1. **Compass** (default). Leader anchored at the centre. Direct edges
 *      from the leader fan out radially in a deterministic order, with
 *      distance proportional to `(10 - strength)` so strong synergies sit
 *      closer. Non-leader edges are hidden in this view — the goal is a
 *      "what does the leader want" snapshot you can read at a glance.
 *
 *   2. **Strategy**. The deck-builder view. Cards are clustered around
 *      the leader by their primary archetype overlap (e.g. for クロコダイル
 *      → "バロックワークス", "王下七武海" each get their own cluster).
 *      Cards inside each cluster sit on concentric arcs by leader-edge
 *      strength — KEY cards (decklist-defining) are drawn larger with a
 *      red ring at the inner arc, ordinary partners on outer arcs.
 *      Force-collide guarantees no overlap regardless of cluster size.
 *
 *   3. **Force**. d3-force simulation across all nodes and edges (legacy).
 *      Kept for users who want the unfiltered network view.
 *
 * All three layouts return the same `LaidOutGraph` shape so the renderer
 * can swap layouts without re-typing.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

import type { CardListItem } from "@/lib/cards";
import type { RuleSynergy } from "@/lib/synergy-rules";

/* ──────────────────────────────────────────────────────────────────────── */
/* Public types                                                              */
/* ──────────────────────────────────────────────────────────────────────── */

export type LayoutMode = "compass" | "strategy" | "force";

export interface GraphNode {
  id: string;
  card: CardListItem;
  isLeader: boolean;
  x: number;
  y: number;
  /** Strategy layout only. Identifies the archetype/feature cluster
   *  this node belongs to (`__other__` for off-archetype). */
  clusterId?: string;
  /** Strategy layout only. True for cards the deck builder treats as
   *  decklist-defining — those get the larger red-ring treatment. */
  isKey?: boolean;
  /** Strategy layout only. Max strength of any edge between this card
   *  and the leader (0 if none). Used for inner/outer arc placement. */
  leaderStrength?: number;
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

export interface ClusterInfo {
  id: string;
  /** Display label, e.g. "バロックワークス" or "その他". */
  label: string;
  /** Hex colour for halo + label tint. */
  color: string;
  cardCount: number;
  /** Bounding box of the cluster's cards in viewBox coords. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Anchor for the cluster label (just outside the bbox toward leader). */
  labelX: number;
  labelY: number;
}

export interface LaidOutGraph {
  width: number;
  height: number;
  nodes: GraphNode[];
  links: GraphLink[];
  /** Strategy layout populates this; compass/force leave it empty. */
  clusters?: ClusterInfo[];
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
/* Strategy layout — feature-clustered, key-card-aware                       */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Visual cluster palette. Indexed by cluster slot — the leader's
 * primary feature gets slot 0, secondary slot 1, etc. Picked to be
 * distinguishable on the dark theme without clashing with the
 * relation-type edge colours.
 */
const CLUSTER_PALETTE = [
  "#22d3ee", // cyan
  "#f97316", // orange
  "#a855f7", // purple
  "#84cc16", // lime
  "#f59e0b", // amber
  "#ec4899", // pink
];
const OTHER_CLUSTER_COLOR = "#64748b"; // slate
const OTHER_CLUSTER_ID = "__other__";
/** A cluster needs at least this many cards to keep its own slice;
 *  smaller clusters fold into "__other__" for visual cleanliness. */
const MIN_CLUSTER_SIZE = 3;
const STRATEGY_NODE_COLLIDE_R = 36;
const STRATEGY_KEY_NODE_COLLIDE_R = 44;

/** Width/height for strategy mode — bigger than compass so clusters
 *  have room to spread without overlap. */
const STRATEGY_WIDTH = 1600;
const STRATEGY_HEIGHT = 1100;

/**
 * Decide which cards count as "key" — the decklist-defining cards
 * the player should notice first. A card is key when ANY of:
 *   - It has a leader-direct edge with strength ≥ 7 (rule or AI), OR
 *   - It's a high-cost (≥6) finisher that shares the leader's primary
 *     feature, OR
 *   - It's a leader-direct edge in the top-5 strongest leader_direct
 *     edges (always promote the absolute top).
 */
function pickKeyCards(
  leader: CardListItem,
  edges: RuleSynergy[],
  cards: CardListItem[],
): Set<string> {
  const leaderId = leader.id;
  const leaderTopFeature = leader.features[0];
  const cardById = new Map(cards.map((c) => [c.id, c]));

  // Per-card best leader-edge strength.
  const bestLeaderStrength = new Map<string, number>();
  const leaderDirectStrengths: Array<{ id: string; s: number }> = [];
  for (const e of edges) {
    let other: string | null = null;
    if (e.fromCardId === leaderId) other = e.toCardId;
    else if (e.toCardId === leaderId) other = e.fromCardId;
    if (!other) continue;
    const cur = bestLeaderStrength.get(other) ?? 0;
    if (e.strength > cur) bestLeaderStrength.set(other, e.strength);
    if (e.relationType === "leader_direct") {
      leaderDirectStrengths.push({ id: other, s: e.strength });
    }
  }

  const keys = new Set<string>();

  // Rule 1: strength ≥ 7
  for (const [id, s] of bestLeaderStrength) {
    if (s >= 7) keys.add(id);
  }

  // Rule 2: top-5 leader_direct (regardless of absolute strength)
  leaderDirectStrengths.sort((a, b) => b.s - a.s);
  for (const r of leaderDirectStrengths.slice(0, 5)) keys.add(r.id);

  // Rule 3: high-cost finisher in primary archetype
  if (leaderTopFeature) {
    for (const c of cards) {
      if (c.id === leaderId) continue;
      if ((c.cost ?? 0) >= 6 && c.features.includes(leaderTopFeature)) {
        // Also require ANY edge to leader (don't promote completely
        // disconnected high-cost cards).
        if ((bestLeaderStrength.get(c.id) ?? 0) > 0) keys.add(c.id);
      }
    }
  }

  // Soft cap: don't let "key" run away — keep top 12 by strength to
  // preserve visual hierarchy. (12 is a comfortable gestalt limit.)
  if (keys.size > 12) {
    const ranked = [...keys]
      .map((id) => ({ id, s: bestLeaderStrength.get(id) ?? 0 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((r) => r.id);
    return new Set(ranked);
  }

  // Make sure every key id is actually in our card set.
  for (const id of [...keys]) if (!cardById.has(id)) keys.delete(id);
  return keys;
}

/**
 * Pick which features to use as cluster axes.
 *
 * Preference order:
 *   1. The leader's own features (e.g. クロコダイル → "バロックワークス")
 *      — this matches the deck-builder's mental model.
 *   2. If leader features are missing/garbage (e.g. literal "?" from a
 *      bad scrape, or empty), fall back to the top-N most common
 *      features among the partner pool. The most popular feature in
 *      the partner pool is, in practice, the one the deck builder
 *      will care about anyway.
 */
function pickClusterAxes(
  leader: CardListItem,
  partners: CardListItem[],
): string[] {
  const cleanLeaderFeatures = leader.features.filter(
    (f) => f && f.trim().length > 0 && f !== "?",
  );
  if (cleanLeaderFeatures.length > 0) return cleanLeaderFeatures;

  // Fallback: count partner features and pick the top 3 by frequency.
  const counts = new Map<string, number>();
  for (const c of partners) {
    for (const f of c.features) {
      if (!f || f === "?" || f.trim().length === 0) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .filter(([, n]) => n >= MIN_CLUSTER_SIZE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([f]) => f);
  return ranked;
}

/**
 * Assign each card to a feature cluster. The axes are picked by
 * `pickClusterAxes` (leader features preferred, partner-pool top
 * features as fallback). Cards that don't share any axis feature
 * land in "__other__". Tiny clusters (< MIN_CLUSTER_SIZE) also
 * collapse into "__other__" so the canvas isn't littered with
 * one-card slices.
 */
function clusterByFeature(
  leader: CardListItem,
  cards: CardListItem[],
): { clusters: Map<string, CardListItem[]>; axes: string[] } {
  const partners = cards.filter((c) => c.id !== leader.id);
  const axes = pickClusterAxes(leader, partners);
  const initial = new Map<string, CardListItem[]>();
  for (const f of axes) initial.set(f, []);
  initial.set(OTHER_CLUSTER_ID, []);

  for (const card of partners) {
    const matched = axes.find((f) => card.features.includes(f));
    if (matched) initial.get(matched)!.push(card);
    else initial.get(OTHER_CLUSTER_ID)!.push(card);
  }

  // Collapse tiny clusters into __other__.
  const final = new Map<string, CardListItem[]>();
  const otherBucket = initial.get(OTHER_CLUSTER_ID) ?? [];
  for (const [id, members] of initial) {
    if (id === OTHER_CLUSTER_ID) continue;
    if (members.length < MIN_CLUSTER_SIZE) {
      otherBucket.push(...members);
    } else {
      final.set(id, members);
    }
  }
  if (otherBucket.length > 0) final.set(OTHER_CLUSTER_ID, otherBucket);
  return { clusters: final, axes };
}

export function buildStrategyLayout(
  leader: CardListItem,
  pool: CardListItem[],
  edges: RuleSynergy[],
  opts: BuildOptions = {},
): LaidOutGraph {
  // Strategy mode wants a roomy canvas — many clusters need spreading out.
  // Lift the per-partner cap to 20 so leader-direct edges aren't dropped
  // by partners that happen to be peer-edge-heavy (feature_chain rows
  // can outscore the leader_direct edge during normalize's sort).
  const strategyOpts: BuildOptions = {
    width: opts.width ?? STRATEGY_WIDTH,
    height: opts.height ?? STRATEGY_HEIGHT,
    minStrength: opts.minStrength ?? DEFAULT_MIN_STRENGTH,
    maxEdgesPerNode: opts.maxEdgesPerNode ?? 20,
  };
  const norm = normalize(leader, pool, edges, strategyOpts);

  // Drop any card that has no edge to the leader. The strategy view is
  // explicitly leader-centric — cards that only synergise with other
  // partners aren't deck-building signal in this view.
  const leaderTouched = new Set<string>([norm.leader.id]);
  const leaderEdgesOnly: RuleSynergy[] = [];
  const peerEdges: RuleSynergy[] = [];
  for (const e of norm.edges) {
    const touchesLeader =
      e.fromCardId === norm.leader.id || e.toCardId === norm.leader.id;
    if (touchesLeader) {
      leaderEdgesOnly.push(e);
      leaderTouched.add(e.fromCardId);
      leaderTouched.add(e.toCardId);
    } else {
      peerEdges.push(e);
    }
  }
  const cards = norm.cards.filter((c) => leaderTouched.has(c.id));

  // Compute per-card leader strength for arc placement + key picking.
  const leaderStrength = new Map<string, number>();
  for (const e of leaderEdgesOnly) {
    const other =
      e.fromCardId === norm.leader.id ? e.toCardId : e.fromCardId;
    const cur = leaderStrength.get(other) ?? 0;
    if (e.strength > cur) leaderStrength.set(other, e.strength);
  }

  const keyIds = pickKeyCards(norm.leader, leaderEdgesOnly, cards);
  const { clusters, axes } = clusterByFeature(norm.leader, cards);

  // Order clusters: axes first (leader-feature order, or top-frequency
  // fallback), __other__ last.
  const orderedClusterIds = [
    ...axes.filter((f) => clusters.has(f)),
    ...(clusters.has(OTHER_CLUSTER_ID) ? [OTHER_CLUSTER_ID] : []),
  ];
  // Drop anything not in our orderedClusterIds (shouldn't happen but
  // defensive — covers the case where a leader feature has no members).
  const orderedClusters = orderedClusterIds
    .map((id) => ({ id, members: clusters.get(id)! }))
    .filter((c) => c.members && c.members.length > 0);

  const cx = norm.width / 2;
  const cy = norm.height / 2;
  const innerArc = 200; // key cards
  const outerArc = Math.min(norm.width, norm.height) / 2 - 80;
  const N = orderedClusters.length;

  // Pre-place each card on its cluster wedge. Force-collide post-process
  // smooths out any overlap. Wedge half-angle is sized so cluster
  // members can spread laterally without crossing into neighbours.
  type SimNode = {
    id: string;
    isLeader: boolean;
    isKey: boolean;
    x: number;
    y: number;
    fx?: number | null;
    fy?: number | null;
    radius: number;
    desiredR: number;
    desiredAngle: number;
  };

  const simNodes: SimNode[] = [
    {
      id: norm.leader.id,
      isLeader: true,
      isKey: false,
      x: cx,
      y: cy,
      fx: cx,
      fy: cy,
      radius: STRATEGY_KEY_NODE_COLLIDE_R + 8,
      desiredR: 0,
      desiredAngle: 0,
    },
  ];

  // Track each card's cluster + computed seed position.
  const clusterIdByCardId = new Map<string, string>();

  orderedClusters.forEach((cluster, i) => {
    clusterIdByCardId.set(`__cluster_${cluster.id}`, cluster.id);
    const wedgeCentre = (i / N) * 2 * Math.PI - Math.PI / 2;
    // Wedge spans most of its slice but leaves a small gutter between
    // neighbouring clusters (15% padding each side).
    const wedgeHalf = (Math.PI / N) * 0.85;

    // Sort cluster members: keys first (innermost), then by strength desc,
    // then by id for stability. Inner ring → outer ring as we walk.
    const members = [...cluster.members].sort((a, b) => {
      const ak = keyIds.has(a.id) ? 1 : 0;
      const bk = keyIds.has(b.id) ? 1 : 0;
      if (ak !== bk) return bk - ak;
      const sa = leaderStrength.get(a.id) ?? 0;
      const sb = leaderStrength.get(b.id) ?? 0;
      if (sa !== sb) return sb - sa;
      return a.id.localeCompare(b.id);
    });

    // Distribute members into rings. Each ring is one wedge-arc.
    // Ring capacity grows with radius (more circumference = more room).
    let placed = 0;
    let ringIndex = 0;
    while (placed < members.length) {
      const r = innerArc + ringIndex * 90;
      // Capacity ≈ wedge arc length / 2*COLLIDE_R, capped to 8 per ring.
      const capacity = Math.max(
        2,
        Math.min(8, Math.floor((2 * wedgeHalf * r) / (2 * STRATEGY_NODE_COLLIDE_R))),
      );
      const inThisRing = Math.min(capacity, members.length - placed);
      // Spread the ring's members evenly across the wedge.
      for (let k = 0; k < inThisRing; k++) {
        const card = members[placed + k];
        const t =
          inThisRing === 1 ? 0 : (k / (inThisRing - 1)) * 2 - 1; // -1..+1
        const angle = wedgeCentre + t * wedgeHalf * 0.95;
        const isKey = keyIds.has(card.id);
        const radius = Math.min(r, outerArc);
        simNodes.push({
          id: card.id,
          isLeader: false,
          isKey,
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          radius: isKey ? STRATEGY_KEY_NODE_COLLIDE_R : STRATEGY_NODE_COLLIDE_R,
          desiredR: radius,
          desiredAngle: angle,
        });
        clusterIdByCardId.set(card.id, cluster.id);
      }
      placed += inThisRing;
      ringIndex += 1;
    }
  });

  // Force-collide pass — keeps every card legible even if a cluster is
  // bigger than the wedge math anticipated. Radial + angular forces hold
  // each card near its seed angle/radius.
  type SimLink = { source: string; target: string; weight: number };
  const simLinks: SimLink[] = leaderEdgesOnly.map((e) => ({
    source: e.fromCardId,
    target: e.toCardId,
    weight: e.strength / 10,
  }));

  const sim = forceSimulation(simNodes as never)
    .force(
      "link",
      forceLink(simLinks)
        .id((d) => (d as SimNode).id)
        .distance(120)
        .strength(0.04),
    )
    .force("charge", forceManyBody().strength(-50))
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((d) => d.radius)
        .strength(1.0)
        .iterations(3),
    )
    // Hold each card close to its desired radius and angle. Strong
    // angular pull keeps cluster boundaries crisp; weaker radial pull
    // lets force-collide breathe outward when a ring is too packed.
    .force(
      "radial",
      forceRadial<SimNode>((d) => d.desiredR, cx, cy).strength((d) =>
        d.isLeader ? 0 : 0.45,
      ),
    )
    .force(
      "x",
      forceX<SimNode>((d) =>
        d.isLeader ? cx : cx + Math.cos(d.desiredAngle) * d.desiredR,
      ).strength(0.3),
    )
    .force(
      "y",
      forceY<SimNode>((d) =>
        d.isLeader ? cy : cy + Math.sin(d.desiredAngle) * d.desiredR,
      ).strength(0.3),
    )
    .stop();

  for (let i = 0; i < 320; i++) sim.tick();

  // Build result graph nodes.
  const cardById = new Map(cards.map((c) => [c.id, c]));
  cardById.set(norm.leader.id, norm.leader);
  const nodes: GraphNode[] = simNodes.map((n) => ({
    id: n.id,
    card: cardById.get(n.id)!,
    isLeader: n.isLeader,
    x: clamp(n.x, 30, norm.width - 30),
    y: clamp(n.y, 30, norm.height - 30),
    clusterId: n.isLeader ? undefined : clusterIdByCardId.get(n.id),
    isKey: n.isKey,
    leaderStrength: n.isLeader ? undefined : leaderStrength.get(n.id) ?? 0,
  }));

  // Compute cluster bounding boxes + label anchors.
  const clusterColours = new Map<string, string>();
  orderedClusters.forEach((c, i) => {
    clusterColours.set(
      c.id,
      c.id === OTHER_CLUSTER_ID
        ? OTHER_CLUSTER_COLOR
        : CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
    );
  });
  const clusterInfos: ClusterInfo[] = orderedClusters.map((c, i) => {
    const members = nodes.filter((n) => n.clusterId === c.id);
    const xs = members.map((n) => n.x);
    const ys = members.map((n) => n.y);
    const minX = Math.min(...xs, cx);
    const maxX = Math.max(...xs, cx);
    const minY = Math.min(...ys, cy);
    const maxY = Math.max(...ys, cy);
    // Label anchor: just outside the bbox in the direction away from
    // the leader so it doesn't sit on top of cards.
    const wedgeCentre = (i / N) * 2 * Math.PI - Math.PI / 2;
    const labelR = outerArc + 40;
    return {
      id: c.id,
      label: c.id === OTHER_CLUSTER_ID ? "その他のシナジー" : c.id,
      color: clusterColours.get(c.id)!,
      cardCount: members.length,
      bbox: { minX, minY, maxX, maxY },
      labelX: cx + Math.cos(wedgeCentre) * labelR,
      labelY: cy + Math.sin(wedgeCentre) * labelR,
    };
  });

  // Edges: include both leader-edges AND peer edges between cards we
  // kept. Peer edges enrich the strategy view (showing in-cluster
  // chains) without overwhelming since the renderer will style them
  // subtly.
  const keepIds = new Set(nodes.map((n) => n.id));
  const allEdges = [...leaderEdgesOnly, ...peerEdges].filter(
    (e) => keepIds.has(e.fromCardId) && keepIds.has(e.toCardId),
  );

  return {
    width: norm.width,
    height: norm.height,
    nodes,
    links: allEdges.map(toLink),
    clusters: clusterInfos,
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
