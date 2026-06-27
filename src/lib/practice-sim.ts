import { evaluateDeck, type EvalCard } from "@/lib/deck-evaluation";
import {
  OFFICIAL_RULES_REFERENCE,
  type AnalysisMetrics,
  type AblationResult,
  type CardTimingStat,
  type CpuSkill,
  type DrawProbabilityStat,
  type GameEvent,
  type GameReplayLog,
  type LifeCurvePoint,
  type PracticeSide,
  type ReplayStateSnapshot,
  type WinReason,
  cpuSkillRank,
} from "@/lib/practice-log";
import { exactTurnProbabilities } from "@/lib/probability";
import type { CardListItem } from "@/lib/cards";

export type { CpuSkill } from "@/lib/practice-log";

export interface PracticeDeckEntry {
  card: CardListItem;
  count: number;
}

export interface PracticeDeck {
  id: string;
  name: string;
  leader: CardListItem;
  entries: PracticeDeckEntry[];
  source: "draft" | "generated";
  totalCards: number;
}

export interface PracticeAction {
  id: string;
  label: string;
  score: number;
  donUsed: number;
  cardIds: string[];
  rationale: string;
  risk: "low" | "medium" | "high";
}

export interface DrillState {
  seed: number;
  don: number;
  handSize: number;
  playerLife: number;
  opponentLife: number;
  boardPressure: number;
  hand: CardListItem[];
  actions: PracticeAction[];
  recommended: PracticeAction;
}

export interface MatchResult {
  winner: PracticeSide;
  turns: number;
  reason: WinReason;
  playerLife: number;
  opponentLife: number;
  playerScore: number;
  opponentScore: number;
  log: string[];
  contributions: Contribution[];
  replay: GameReplayLog;
}

export interface Contribution {
  cardId: string;
  name: string;
  side: PracticeSide;
  impact: number;
  appearances: number;
}

export interface BatchResult {
  games: number;
  playerWins: number;
  opponentWins: number;
  playerWinRate: number;
  avgTurns: number;
  topContributors: Contribution[];
  metrics: AnalysisMetrics;
  replays?: GameReplayLog[];
}

interface DraftLikeEntry {
  card: CardListItem;
  count: number;
}

interface DrillOptions {
  don: number;
  handSize: number;
  seed: number;
}

interface MatchOptions {
  seed: number;
  maxTurns?: number;
  cpuSkill?: CpuSkill;
  firstPlayer?: PracticeSide;
}

const TARGET_DECK_SIZE = 50;
const MAX_COPIES = 4;

export function buildPracticeDeck(
  leader: CardListItem,
  pool: CardListItem[],
  draftEntries: DraftLikeEntry[] = [],
): PracticeDeck {
  const leaderColors = new Set(leader.colors);
  const eligibleByColor = pool
    .filter((card) => card.cardType !== "LEADER")
    .filter((card) => card.colors.some((color) => leaderColors.has(color)))
    .sort((a, b) => cardPriority(b, leader) - cardPriority(a, leader));
  const fallbackPool = pool
    .filter((card) => card.cardType !== "LEADER")
    .sort((a, b) => cardPriority(b, leader) - cardPriority(a, leader));
  const eligible = eligibleByColor.length > 0 ? eligibleByColor : fallbackPool;

  const byId = new Map(eligible.map((card) => [card.id, card]));
  const counts = new Map<string, PracticeDeckEntry>();
  let source: PracticeDeck["source"] = "generated";

  for (const entry of draftEntries) {
    const card = byId.get(entry.card.id);
    if (!card || entry.count <= 0) continue;
    source = "draft";
    counts.set(card.id, {
      card,
      count: clampInt(entry.count, 1, MAX_COPIES),
    });
  }

  let cursor = 0;
  while (totalCount([...counts.values()]) < TARGET_DECK_SIZE && eligible.length > 0) {
    const card = eligible[cursor % eligible.length];
    const existing = counts.get(card.id)?.count ?? 0;
    if (existing < MAX_COPIES) {
      counts.set(card.id, { card, count: existing + 1 });
    }
    cursor++;
    if (cursor > eligible.length * MAX_COPIES + TARGET_DECK_SIZE) break;
  }

  cursor = 0;
  while (totalCount([...counts.values()]) < TARGET_DECK_SIZE && eligible.length > 0) {
    const card = eligible[cursor % eligible.length];
    const existing = counts.get(card.id)?.count ?? 0;
    counts.set(card.id, { card, count: existing + 1 });
    cursor++;
    if (cursor > TARGET_DECK_SIZE * 2) break;
  }

  const entries = [...counts.values()].sort((a, b) => {
    const ca = a.card.cost ?? 99;
    const cb = b.card.cost ?? 99;
    return ca - cb || a.card.id.localeCompare(b.card.id);
  });

  return {
    id: `${leader.id}:${source}`,
    name: `${leader.name}${source === "draft" ? " draft" : " generated"}`,
    leader,
    entries,
    source,
    totalCards: totalCount(entries),
  };
}

export function generateDrill(deck: PracticeDeck, opts: DrillOptions): DrillState {
  const rng = mulberry32(opts.seed);
  const hand = sampleHand(deck, opts.handSize, rng);
  const boardPressure = 1 + Math.floor(rng() * 4);
  const playerLife = Math.max(1, (deck.leader.life ?? 5) - Math.floor(rng() * 2));
  const opponentLife = Math.max(1, 5 - Math.floor(rng() * 3));
  const actions = rankDrillActions(hand, {
    don: opts.don,
    boardPressure,
    playerLife,
    opponentLife,
  });

  return {
    seed: opts.seed,
    don: opts.don,
    handSize: opts.handSize,
    playerLife,
    opponentLife,
    boardPressure,
    hand,
    actions,
    recommended: actions[0],
  };
}

export function simulateMatch(
  playerDeck: PracticeDeck,
  opponentDeck: PracticeDeck,
  opts: MatchOptions,
): MatchResult {
  const maxTurns = opts.maxTurns ?? 10;
  const cpuSkill = opts.cpuSkill ?? "level1";
  const rng = mulberry32(opts.seed);
  const firstPlayer = opts.firstPlayer ?? (opts.seed % 2 === 0 ? "player" : "opponent");
  const player = createMatchState("player", playerDeck, rng, firstPlayer, "level4");
  const opponent = createMatchState("opponent", opponentDeck, rng, firstPlayer, cpuSkill);
  const recorder = createRecorder(opts.seed, cpuSkill, firstPlayer, playerDeck, opponentDeck);
  const log: string[] = [];
  const contributions = new Map<string, Contribution>();

  recorder.push("game_start", 0, undefined, {
    rules: OFFICIAL_RULES_REFERENCE.version,
    firstPlayer,
  }, snapshot(player, opponent));
  logMulligan(recorder, player, opponent);

  for (let turn = 1; turn <= maxTurns; turn++) {
    const order: PracticeSide[] =
      firstPlayer === "player" ? ["player", "opponent"] : ["opponent", "player"];
    for (const side of order) {
      const active = side === "player" ? player : opponent;
      const defending = side === "player" ? opponent : player;
      takeTurn(side, turn, active, defending, rng, log, contributions, recorder, cpuSkill);
      if (defending.life <= 0) {
        return finishMatch(
          side,
          "leader_damage",
          turn,
          player,
          opponent,
          log,
          contributions,
          recorder,
        );
      }
      if (active.cursor >= active.pile.length && active.hand.length === 0) {
        return finishMatch(
          defending.side,
          "deck_out",
          turn,
          player,
          opponent,
          log,
          contributions,
          recorder,
        );
      }
    }
  }

  const playerScore = player.life * 20 + player.tempo + player.evaluation.composite;
  const opponentScore = opponent.life * 20 + opponent.tempo + opponent.evaluation.composite;
  return finishMatch(
    playerScore >= opponentScore ? "player" : "opponent",
    "score_at_limit",
    maxTurns,
    player,
    opponent,
    log,
    contributions,
    recorder,
  );
}

export function simulateBatch(
  playerDeck: PracticeDeck,
  opponentDeck: PracticeDeck,
  games: number,
  seed: number,
  cpuSkill: CpuSkill = "level1",
): BatchResult {
  let playerWins = 0;
  let opponentWins = 0;
  let turns = 0;
  const aggregate = new Map<string, Contribution>();
  const results: MatchResult[] = [];

  for (let i = 0; i < games; i++) {
    const result = simulateMatch(playerDeck, opponentDeck, {
      seed: seed + i * 97,
      cpuSkill,
      firstPlayer: i % 2 === 0 ? "player" : "opponent",
    });
    results.push(result);
    turns += result.turns;
    if (result.winner === "player") playerWins++;
    else opponentWins++;
    for (const c of result.contributions) {
      const key = `${c.side}:${c.cardId}`;
      const existing = aggregate.get(key);
      aggregate.set(key, {
        cardId: c.cardId,
        name: c.name,
        side: c.side,
        impact: round1((existing?.impact ?? 0) + c.impact),
        appearances: (existing?.appearances ?? 0) + c.appearances,
      });
    }
  }

  const topContributors = [...aggregate.values()]
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 8);
  const metrics = analyzeResults(results, playerDeck);
  metrics.ablation = estimateAblations(
    playerDeck,
    opponentDeck,
    topContributors,
    games,
    seed,
    cpuSkill,
    games === 0 ? 0 : playerWins / games,
  );

  return {
    games,
    playerWins,
    opponentWins,
    playerWinRate: games === 0 ? 0 : playerWins / games,
    avgTurns: games === 0 ? 0 : round1(turns / games),
    topContributors,
    metrics,
    replays: results.map((result) => result.replay),
  };
}

export function deckEvalCards(deck: PracticeDeck): EvalCard[] {
  return deck.entries.map(({ card, count }) => ({
    id: card.id,
    cardType: card.cardType,
    colors: card.colors,
    features: card.features,
    cost: card.cost,
    power: card.power,
    counter: card.counter,
    hasTrigger: card.hasTrigger,
    mechanics: card.mechanics,
    count,
  }));
}

function rankDrillActions(
  hand: CardListItem[],
  context: {
    don: number;
    boardPressure: number;
    playerLife: number;
    opponentLife: number;
  },
): PracticeAction[] {
  const playable = hand
    .filter((card) => (card.cost ?? 99) <= context.don)
    .sort((a, b) => drillCardScore(b, context) - drillCardScore(a, context));

  const actions: PracticeAction[] = playable.slice(0, 3).map((card, index) => {
    const score = drillCardScore(card, context);
    return {
      id: `play:${card.id}`,
      label: `${card.name} を使う`,
      score,
      donUsed: card.cost ?? 0,
      cardIds: [card.id],
      rationale: actionRationale(card, context),
      risk: index === 0 ? "low" : score > 45 ? "medium" : "high",
    };
  });

  actions.push({
    id: "hold",
    label: "手札を温存して受けを厚くする",
    score: round1(
      20 +
        hand.reduce((acc, card) => acc + (card.counter ?? 0) / 250, 0) +
        context.boardPressure * 4,
    ),
    donUsed: 0,
    cardIds: [],
    rationale: "相手の圧が高い局面では、カウンター値を残す判断も候補になります。",
    risk: context.playerLife <= 2 ? "medium" : "high",
  });

  return actions.sort((a, b) => b.score - a.score);
}

function drillCardScore(
  card: CardListItem,
  context: {
    don: number;
    boardPressure: number;
    playerLife: number;
    opponentLife: number;
  },
): number {
  const cost = card.cost ?? 0;
  const curveFit = cost === context.don ? 22 : Math.max(0, 18 - (context.don - cost) * 4);
  const power = card.power ? card.power / 350 : 0;
  const pressureAnswer =
    context.boardPressure >= 3 &&
    (card.mechanics.includes("KORemoval") ||
      card.mechanics.includes("RestOpponentCard") ||
      card.mechanics.includes("ReturnToHand"))
      ? 18
      : 0;
  const lethalPush =
    context.opponentLife <= 2 &&
    (card.mechanics.includes("Rush") || card.mechanics.includes("PowerBuff"))
      ? 16
      : 0;
  const defense =
    context.playerLife <= 2 &&
    (card.mechanics.includes("Blocker") || (card.counter ?? 0) >= 2000)
      ? 14
      : 0;
  return round1(curveFit + power + pressureAnswer + lethalPush + defense + (card.hasTrigger ? 3 : 0));
}

function actionRationale(
  card: CardListItem,
  context: { don: number; boardPressure: number; opponentLife: number },
): string {
  if ((card.cost ?? 99) === context.don) {
    return "DONをきれいに使い切り、テンポを落としにくい選択です。";
  }
  if (
    context.boardPressure >= 3 &&
    (card.mechanics.includes("KORemoval") ||
      card.mechanics.includes("RestOpponentCard") ||
      card.mechanics.includes("ReturnToHand"))
  ) {
    return "相手の盤面圧が高いため、除去やレストでテンポを戻す価値があります。";
  }
  if (context.opponentLife <= 2 && card.mechanics.includes("Rush")) {
    return "終盤寄りの局面では、即時打点を作る判断が勝ち筋になります。";
  }
  return "手札内では最も期待値が高い展開候補です。";
}

interface MatchState {
  side: PracticeSide;
  deck: PracticeDeck;
  pile: CardListItem[];
  cursor: number;
  hand: CardListItem[];
  lifeCards: CardListItem[];
  life: number;
  tempo: number;
  donAvailable: number;
  donUsed: number;
  donDeck: number;
  mulligan: "keep" | "redraw";
  remainingCounterOnLoss: number;
  evaluation: ReturnType<typeof evaluateDeck>;
}

function createMatchState(
  side: PracticeSide,
  deck: PracticeDeck,
  rng: () => number,
  firstPlayer: PracticeSide,
  skill: CpuSkill,
): MatchState {
  const pile = materialize(deck);
  shuffle(pile, rng);
  let cursor = 0;
  let hand = pile.slice(cursor, cursor + 5);
  cursor += 5;
  const redraw = shouldMulligan(hand, deck, skill);
  if (redraw) {
    pile.push(...hand);
    shuffle(pile, rng);
    cursor = 0;
    hand = pile.slice(cursor, cursor + 5);
    cursor += 5;
  }
  const lifeValue = deck.leader.life ?? 5;
  const lifeCards = pile.slice(cursor, cursor + lifeValue).reverse();
  cursor += lifeValue;

  return {
    side,
    deck,
    pile,
    cursor,
    hand,
    lifeCards,
    life: lifeCards.length,
    tempo: 0,
    donAvailable: 0,
    donUsed: 0,
    donDeck: 10,
    mulligan: redraw ? "redraw" : "keep",
    remainingCounterOnLoss: 0,
    evaluation: evaluateDeck(deckEvalCards(deck)),
  };
}

function logMulligan(
  recorder: ReturnType<typeof createRecorder>,
  player: MatchState,
  opponent: MatchState,
): void {
  for (const state of [player, opponent]) {
    recorder.push(
      "mulligan_decision",
      0,
      state.side,
      {
        decision: state.mulligan,
        handSize: state.hand.length,
        handHash: hashCards(state.hand),
      },
      snapshot(player, opponent),
    );
  }
}

function takeTurn(
  side: PracticeSide,
  turn: number,
  active: MatchState,
  defending: MatchState,
  rng: () => number,
  log: string[],
  contributions: Map<string, Contribution>,
  recorder: ReturnType<typeof createRecorder>,
  cpuSkill: CpuSkill,
): void {
  active.donUsed = 0;
  recorder.push("turn_start", turn, side, {}, snapshotBySide(active, defending));
  recorder.push("refresh_phase", turn, side, {}, snapshotBySide(active, defending));

  const skipsFirstDraw = side === recorder.firstPlayer && turn === 1;
  if (!skipsFirstDraw && active.cursor < active.pile.length) {
    active.hand.push(active.pile[active.cursor]);
    active.cursor++;
  }
  recorder.push("draw_phase", turn, side, { skipped: skipsFirstDraw }, snapshotBySide(active, defending));

  const donToAdd = side === recorder.firstPlayer && turn === 1 ? 1 : 2;
  const actualDon = Math.min(donToAdd, active.donDeck);
  active.donDeck -= actualDon;
  active.donAvailable = Math.min(10, active.donAvailable + actualDon);
  recorder.push("don_phase", turn, side, { added: actualDon }, snapshotBySide(active, defending));

  const chosen = choosePlay(active, defending, cpuSkill);
  if (chosen) {
    active.hand = removeOne(active.hand, chosen.id);
    const cost = chosen.cost ?? 0;
    active.donUsed += cost;
    const impact = matchCardScore(chosen, active, defending, active.donAvailable, cpuSkill);
    active.tempo += impact;
    addContribution(contributions, side, chosen, impact);
    log.push(`${turn}T ${sideLabel(side)}: ${chosen.name}`);
    recorder.push(
      "main_phase_action",
      turn,
      side,
      { action: "play_card", cardId: chosen.id, cardName: chosen.name, donUsed: cost, impact },
      snapshotBySide(active, defending),
    );
  } else {
    active.tempo += active.evaluation.stability.score / 20;
    log.push(`${turn}T ${sideLabel(side)}: 手札温存`);
    recorder.push("main_phase_action", turn, side, { action: "hold" }, snapshotBySide(active, defending));
  }

  if (turn > 1) {
    const attackPower = active.deck.leader.power ?? 5000;
    recorder.push("attack_declared", turn, side, { attacker: active.deck.leader.id, target: defending.deck.leader.id, attackPower }, snapshotBySide(active, defending));
    const attackRoll =
      active.tempo / 35 +
      active.evaluation.attack.score / 35 +
      skillAttackBonus(cpuSkill, side) +
      rng() * 2.2 -
      defending.evaluation.defense.score / 65;
    if (attackRoll > 2.7) {
      dealLeaderDamage(active, defending, turn, side, rng, log, recorder);
    }
  }

  recorder.push("turn_end", turn, side, {}, snapshotBySide(active, defending));
}

function choosePlay(active: MatchState, defending: MatchState, cpuSkill: CpuSkill): CardListItem | null {
  const playable = active.hand
    .filter((card) => (card.cost ?? 99) <= active.donAvailable - active.donUsed)
    .sort(
      (a, b) =>
        matchCardScore(b, active, defending, active.donAvailable, cpuSkill) -
        matchCardScore(a, active, defending, active.donAvailable, cpuSkill),
    );
  if (playable.length === 0) return null;
  if (active.side === "opponent") {
    const rank = cpuSkillRank(cpuSkill);
    if (rank === 1) {
      return playable[playable.length - 1];
    }
    if (rank === 2) {
      return (
        playable.find((card) => (card.cost ?? 99) <= Math.max(1, active.donAvailable - 1)) ??
        playable[0]
      );
    }
  }
  return playable[0];
}

function dealLeaderDamage(
  active: MatchState,
  defending: MatchState,
  turn: number,
  side: PracticeSide,
  rng: () => number,
  log: string[],
  recorder: ReturnType<typeof createRecorder>,
): void {
  if (defending.life <= 0) return;
  const lifeCard = defending.lifeCards.shift();
  defending.life = defending.lifeCards.length;
  active.tempo *= 0.74;
  log.push(`  ${sideLabel(side)}が1点通す`);
  recorder.push(
    "life_changed",
    turn,
    defending.side,
    { delta: -1, source: "battle_damage", revealedCardId: lifeCard?.id },
    snapshotBySide(active, defending),
  );
  if (lifeCard?.hasTrigger) {
    const activated = rng() > 0.35;
    recorder.push(
      "trigger_revealed",
      turn,
      defending.side,
      { cardId: lifeCard.id, cardName: lifeCard.name, activated },
      snapshotBySide(active, defending),
    );
    if (activated) {
      defending.tempo += 4;
    } else {
      defending.hand.push(lifeCard);
    }
  } else if (lifeCard) {
    defending.hand.push(lifeCard);
  }
}

function matchCardScore(
  card: CardListItem,
  active: MatchState,
  defending: MatchState,
  don: number,
  cpuSkill: CpuSkill,
): number {
  const curve = card.cost === don ? 12 : Math.max(0, 9 - (don - (card.cost ?? 0)) * 2);
  const power = (card.power ?? 0) / 700;
  const mechanics =
    card.mechanics.filter((m) =>
      ["Rush", "OnPlay", "OnAttack", "Draw", "Search", "KORemoval", "Blocker"].includes(m),
    ).length * 3.5;
  const defenseNeed = active.life <= 2 && (card.counter ?? 0) >= 2000 ? 8 : 0;
  const closeout = defending.life <= 2 && card.mechanics.includes("Rush") ? 10 : 0;
  const rank = active.side === "opponent" ? cpuSkillRank(cpuSkill) : 4;
  const skill = active.side === "opponent" ? (rank - 3) * 2 : 0;
  const highLevelCloseout = active.side === "opponent" && rank >= 4 && defending.life <= 2 ? 4 : 0;
  return round1(
    curve +
      power +
      mechanics +
      defenseNeed +
      closeout +
      skill +
      highLevelCloseout +
      active.evaluation.composite / 25,
  );
}

function finishMatch(
  winner: PracticeSide,
  reason: WinReason,
  turns: number,
  player: MatchState,
  opponent: MatchState,
  log: string[],
  contributions: Map<string, Contribution>,
  recorder: ReturnType<typeof createRecorder>,
): MatchResult {
  const loser = winner === "player" ? opponent : player;
  loser.remainingCounterOnLoss = loser.hand.reduce((acc, card) => acc + (card.counter ?? 0), 0);
  const result = {
    winner,
    loser: loser.side,
    turns,
    reason,
    playerLife: Math.max(0, player.life),
    opponentLife: Math.max(0, opponent.life),
  };
  recorder.push(
    "game_end",
    turns,
    winner,
    { ...result, counterOverflow: loser.remainingCounterOnLoss },
    snapshot(player, opponent),
  );
  const replay: GameReplayLog = {
    header: recorder.header,
    events: recorder.events,
    result,
  };
  return {
    winner,
    turns,
    reason,
    playerLife: result.playerLife,
    opponentLife: result.opponentLife,
    playerScore: round1(player.tempo + player.evaluation.composite),
    opponentScore: round1(opponent.tempo + opponent.evaluation.composite),
    log,
    contributions: [...contributions.values()].sort((a, b) => b.impact - a.impact),
    replay,
  };
}

function analyzeResults(results: MatchResult[], playerDeck: PracticeDeck): AnalysisMetrics {
  const games = results.length || 1;
  const firstGames = results.filter((r) => r.replay.header.firstPlayer === "player");
  const secondGames = results.filter((r) => r.replay.header.firstPlayer === "opponent");
  const triggerEvents = results.flatMap((r) => r.replay.events.filter((e) => e.type === "trigger_revealed"));
  const actionEvents = results.flatMap((r) => r.replay.events.filter((e) => e.type === "main_phase_action"));
  const turnEndEvents = results.flatMap((r) => r.replay.events.filter((e) => e.type === "turn_end"));
  const keepGames = results.filter((r) => playerMulligan(r) === "keep");
  const redrawGames = results.filter((r) => playerMulligan(r) === "redraw");
  const winReasons: AnalysisMetrics["winReasons"] = {
    leader_damage: 0,
    deck_out: 0,
    effect_win: 0,
    score_at_limit: 0,
  };
  for (const result of results) winReasons[result.reason]++;

  return {
    winRate: results.filter((r) => r.winner === "player").length / games,
    firstPlayerWinRate: rate(firstGames, (r) => r.winner === "player"),
    secondPlayerWinRate: rate(secondGames, (r) => r.winner === "player"),
    triggerRevealRate: triggerEvents.length / Math.max(1, damageEvents(results).length),
    triggerSuccessRate: rate(triggerEvents, (e) => e.payload.activated === true),
    mulliganKeepWinRate: keepGames.length > 0 ? rate(keepGames, (r) => r.winner === "player") : null,
    mulliganRedrawWinRate: redrawGames.length > 0 ? rate(redrawGames, (r) => r.winner === "player") : null,
    averageDonEfficiency: averageDonEfficiency(turnEndEvents),
    counterOverflowOnLoss: averageCounterOverflow(results),
    winReasons,
    lifeCurve: averageLifeCurve(turnEndEvents),
    cardTiming: cardTiming(actionEvents),
    drawProbability: drawProbability(playerDeck),
    ablation: [],
  };
}

function drawProbability(deck: PracticeDeck): DrawProbabilityStat[] {
  return deck.entries
    .slice()
    .sort((a, b) => cardPriority(b.card, deck.leader) - cardPriority(a.card, deck.leader))
    .slice(0, 6)
    .map((entry) => {
      const rows = exactTurnProbabilities(
        deck.totalCards,
        [{ id: entry.card.id, size: entry.count }],
        7,
      );
      const probabilityAt = (turn: number) =>
        rows.find((row) => row.turn === turn)?.probabilities[entry.card.id] ?? 0;
      return {
        cardId: entry.card.id,
        name: entry.card.name,
        copies: entry.count,
        turn3: probabilityAt(3),
        turn5: probabilityAt(5),
        turn7: probabilityAt(7),
      };
    });
}

function estimateAblations(
  playerDeck: PracticeDeck,
  opponentDeck: PracticeDeck,
  topContributors: Contribution[],
  games: number,
  seed: number,
  cpuSkill: CpuSkill,
  baselineWinRate: number,
): AblationResult[] {
  const candidateIds = new Set<string>();
  for (const contribution of topContributors) {
    if (contribution.side === "player") candidateIds.add(contribution.cardId);
    if (candidateIds.size >= 3) break;
  }
  for (const entry of playerDeck.entries) {
    if (candidateIds.size >= 3) break;
    candidateIds.add(entry.card.id);
  }

  const ablationGames = Math.max(1, Math.min(80, Math.floor(games / 2)));
  return [...candidateIds]
    .map((cardId, index) => {
      const ablated = createAblatedDeck(playerDeck, cardId);
      if (!ablated) return null;
      const target = playerDeck.entries.find((entry) => entry.card.id === cardId);
      const ablatedWinRate = runPlayerWinRate(
        ablated.deck,
        opponentDeck,
        ablationGames,
        seed + 10_000 + index * 1_009,
        cpuSkill,
      );
      return {
        cardId,
        name: target?.card.name ?? cardId,
        replacementName: ablated.replacementName,
        games: ablationGames,
        baselineWinRate,
        ablatedWinRate,
        delta: round1((baselineWinRate - ablatedWinRate) * 100),
      };
    })
    .filter((result): result is AblationResult => result !== null)
    .sort((a, b) => b.delta - a.delta);
}

function runPlayerWinRate(
  playerDeck: PracticeDeck,
  opponentDeck: PracticeDeck,
  games: number,
  seed: number,
  cpuSkill: CpuSkill,
): number {
  if (games <= 0) return 0;
  let wins = 0;
  for (let i = 0; i < games; i++) {
    const result = simulateMatch(playerDeck, opponentDeck, {
      seed: seed + i * 97,
      cpuSkill,
      firstPlayer: i % 2 === 0 ? "player" : "opponent",
    });
    if (result.winner === "player") wins++;
  }
  return wins / games;
}

function createAblatedDeck(
  deck: PracticeDeck,
  cardId: string,
): { deck: PracticeDeck; replacementName: string } | null {
  const target = deck.entries.find((entry) => entry.card.id === cardId);
  const replacement = selectGenericReplacement(deck, cardId);
  if (!target || !replacement) return null;

  const entries = deck.entries
    .filter((entry) => entry.card.id !== cardId)
    .map((entry) => ({ card: entry.card, count: entry.count }));
  const existing = entries.find((entry) => entry.card.id === replacement.card.id);
  if (existing) existing.count += target.count;
  else entries.push({ card: replacement.card, count: target.count });

  return {
    deck: {
      ...deck,
      id: `${deck.id}:ablation:${cardId}`,
      name: `${deck.name} without ${target.card.name}`,
      entries,
      source: "generated",
      totalCards: totalCount(entries),
    },
    replacementName: replacement.card.name,
  };
}

function selectGenericReplacement(
  deck: PracticeDeck,
  excludedCardId: string,
): PracticeDeckEntry | null {
  return (
    deck.entries
      .filter((entry) => entry.card.id !== excludedCardId)
      .sort((a, b) => genericReplacementScore(b) - genericReplacementScore(a))[0] ?? null
  );
}

function genericReplacementScore(entry: PracticeDeckEntry): number {
  const cost = entry.card.cost ?? 3;
  const curve = Math.max(0, 5 - Math.abs(cost - 2));
  const counter = (entry.card.counter ?? 0) / 1000;
  const stability = entry.count / 2;
  return curve + counter + stability + (entry.card.hasTrigger ? 0.5 : 0);
}

function playerMulligan(result: MatchResult): "keep" | "redraw" {
  const event = result.replay.events.find((e) => e.type === "mulligan_decision" && e.side === "player");
  return event?.payload.decision === "redraw" ? "redraw" : "keep";
}

function damageEvents(results: MatchResult[]): GameEvent[] {
  return results.flatMap((r) => r.replay.events.filter((e) => e.type === "life_changed"));
}

function averageDonEfficiency(events: GameEvent[]): number {
  const values = events
    .map((event) => {
      const side = event.side;
      if (!side) return null;
      const used = side === "player" ? event.state.playerDonUsed : event.state.opponentDonUsed;
      const available = side === "player" ? event.state.playerDonAvailable : event.state.opponentDonAvailable;
      return available > 0 ? used / available : null;
    })
    .filter((value): value is number => value !== null);
  return values.length === 0 ? 0 : round1(values.reduce((a, b) => a + b, 0) / values.length);
}

function averageCounterOverflow(results: MatchResult[]): number {
  const losses = results.filter((r) => r.winner !== "player");
  if (losses.length === 0) return 0;
  const total = losses.reduce((acc, result) => {
    const end = result.replay.events[result.replay.events.length - 1];
    return acc + Number(end?.payload.counterOverflow ?? 0);
  }, 0);
  return round1(total / losses.length);
}

function averageLifeCurve(events: GameEvent[]): LifeCurvePoint[] {
  const byTurn = new Map<number, { p: number; o: number; n: number }>();
  for (const event of events) {
    const existing = byTurn.get(event.turn) ?? { p: 0, o: 0, n: 0 };
    existing.p += event.state.playerLife;
    existing.o += event.state.opponentLife;
    existing.n += 1;
    byTurn.set(event.turn, existing);
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, value]) => ({
      turn,
      playerLife: round1(value.p / value.n),
      opponentLife: round1(value.o / value.n),
    }));
}

function cardTiming(events: GameEvent[]): CardTimingStat[] {
  const map = new Map<string, { name: string; side: PracticeSide; turns: number[] }>();
  for (const event of events) {
    const cardId = typeof event.payload.cardId === "string" ? event.payload.cardId : null;
    if (!cardId || !event.side) continue;
    const key = `${event.side}:${cardId}`;
    const existing = map.get(key) ?? {
      name: String(event.payload.cardName ?? cardId),
      side: event.side,
      turns: [],
    };
    existing.turns.push(event.turn);
    map.set(key, existing);
  }
  return [...map.entries()]
    .map(([key, value]) => ({
      cardId: key.split(":")[1],
      name: value.name,
      side: value.side,
      uses: value.turns.length,
      averageTurn: round1(value.turns.reduce((a, b) => a + b, 0) / value.turns.length),
    }))
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 8);
}

function rate<T>(items: T[], pred: (item: T) => boolean): number {
  if (items.length === 0) return 0;
  return items.filter(pred).length / items.length;
}

function createRecorder(
  seed: number,
  cpuSkill: CpuSkill,
  firstPlayer: PracticeSide,
  playerDeck: PracticeDeck,
  opponentDeck: PracticeDeck,
) {
  const events: GameEvent[] = [];
  return {
    firstPlayer,
    events,
    header: {
      schemaVersion: 1 as const,
      seed,
      rulesVersion: OFFICIAL_RULES_REFERENCE.version,
      cpuSkill,
      firstPlayer,
      decks: {
        player: deckSummary(playerDeck),
        opponent: deckSummary(opponentDeck),
      },
    },
    push(
      type: GameEvent["type"],
      turn: number,
      side: PracticeSide | undefined,
      payload: Record<string, unknown>,
      state: ReplayStateSnapshot,
    ) {
      events.push({ index: events.length, type, turn, side, payload, state });
    },
  };
}

function deckSummary(deck: PracticeDeck) {
  return {
    leaderId: deck.leader.id,
    leaderName: deck.leader.name,
    source: deck.source,
    totalCards: deck.totalCards,
  };
}

function snapshotBySide(active: MatchState, defending: MatchState): ReplayStateSnapshot {
  return active.side === "player" ? snapshot(active, defending) : snapshot(defending, active);
}

function snapshot(player: MatchState, opponent: MatchState): ReplayStateSnapshot {
  return {
    playerLife: player.life,
    opponentLife: opponent.life,
    playerHand: player.hand.length,
    opponentHand: opponent.hand.length,
    playerDeck: Math.max(0, player.pile.length - player.cursor),
    opponentDeck: Math.max(0, opponent.pile.length - opponent.cursor),
    playerDonAvailable: player.donAvailable,
    opponentDonAvailable: opponent.donAvailable,
    playerDonUsed: player.donUsed,
    opponentDonUsed: opponent.donUsed,
  };
}

function shouldMulligan(hand: CardListItem[], deck: PracticeDeck, skill: CpuSkill): boolean {
  const lowCost = hand.filter((card) => (card.cost ?? 99) <= 2).length;
  const sameFeature = hand.some((card) => card.features.some((f) => deck.leader.features.includes(f)));
  const rank = cpuSkillRank(skill);
  if (rank >= 5) return lowCost === 0 || (!sameFeature && lowCost < 2);
  if (rank >= 4) return lowCost === 0 || (!sameFeature && lowCost < 2);
  if (rank >= 2) return lowCost === 0 || (!sameFeature && lowCost < 1);
  return lowCost === 0 && !sameFeature;
}

function skillAttackBonus(skill: CpuSkill, side: PracticeSide): number {
  if (side !== "opponent") return 0;
  return [-0.45, -0.15, 0.15, 0.45, 0.75][cpuSkillRank(skill) - 1] ?? 0;
}

function addContribution(
  map: Map<string, Contribution>,
  side: PracticeSide,
  card: CardListItem,
  impact: number,
): void {
  const key = `${side}:${card.id}`;
  const current = map.get(key);
  map.set(key, {
    cardId: card.id,
    name: card.name,
    side,
    impact: round1((current?.impact ?? 0) + impact),
    appearances: (current?.appearances ?? 0) + 1,
  });
}

function sampleHand(deck: PracticeDeck, size: number, rng: () => number): CardListItem[] {
  const cards = materialize(deck);
  shuffle(cards, rng);
  return cards.slice(0, Math.min(size, cards.length));
}

function materialize(deck: PracticeDeck): CardListItem[] {
  const cards: CardListItem[] = [];
  for (const entry of deck.entries) {
    for (let i = 0; i < entry.count; i++) cards.push(entry.card);
  }
  return cards;
}

function removeOne(cards: CardListItem[], id: string): CardListItem[] {
  const next = cards.slice();
  const index = next.findIndex((card) => card.id === id);
  if (index >= 0) next.splice(index, 1);
  return next;
}

function cardPriority(card: CardListItem, leader: CardListItem): number {
  const leaderFeatures = new Set(leader.features);
  const featureMatch = card.features.some((feature) => leaderFeatures.has(feature)) ? 30 : 0;
  const curve = card.cost === null ? 0 : 18 - Math.abs(card.cost - 3) * 2;
  const power = (card.power ?? 0) / 700;
  const mechanics = card.mechanics.length * 2;
  const counter = (card.counter ?? 0) / 500;
  return featureMatch + curve + power + mechanics + counter + (card.hasTrigger ? 2 : 0);
}

function totalCount(entries: PracticeDeckEntry[]): number {
  return entries.reduce((acc, entry) => acc + entry.count, 0);
}

function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

function hashCards(cards: CardListItem[]): string {
  return cards.map((card) => card.id).sort().join("|");
}

function sideLabel(side: PracticeSide): string {
  return side === "player" ? "自分" : "CPU";
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
