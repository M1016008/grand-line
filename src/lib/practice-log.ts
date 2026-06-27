export type PracticeSide = "player" | "opponent";
export const CPU_LEVELS = [
  {
    value: "level1",
    label: "Lv.1 ルーキー",
    detail: "コスト順に素直に動く、はじめての練習相手",
  },
  {
    value: "level2",
    label: "Lv.2 見習い",
    detail: "DON!!の使い切りと基本の攻撃を意識するCPU",
  },
  {
    value: "level3",
    label: "Lv.3 航海士",
    detail: "手札価値、特徴、打点を見て候補手を選ぶCPU",
  },
  {
    value: "level4",
    label: "Lv.4 船長",
    detail: "マリガン、リーサル、守りを強めに評価するCPU",
  },
  {
    value: "level5",
    label: "Lv.5 四皇級",
    detail: "終盤の詰めとテンポ差を厳しく突く練習相手",
  },
] as const;

export type CpuSkill = (typeof CPU_LEVELS)[number]["value"];

export const CPU_LEVEL_VALUES = CPU_LEVELS.map((level) => level.value) as [
  CpuSkill,
  CpuSkill,
  CpuSkill,
  CpuSkill,
  CpuSkill,
];

export function normalizeCpuSkill(value: unknown): CpuSkill | null {
  if (value === "beginner") return "level1";
  if (value === "advanced") return "level4";
  if (typeof value !== "string") return null;
  return CPU_LEVEL_VALUES.includes(value as CpuSkill) ? (value as CpuSkill) : null;
}

export function cpuSkillRank(skill: CpuSkill): number {
  return CPU_LEVEL_VALUES.indexOf(skill) + 1;
}

export function cpuSkillLabel(skill: CpuSkill): string {
  return CPU_LEVELS.find((level) => level.value === skill)?.label ?? skill;
}

export type WinReason = "leader_damage" | "deck_out" | "effect_win" | "score_at_limit";

export interface RulesReference {
  source: string;
  version: string;
  checkedAt: string;
  implementedScope: string[];
  pendingScope: string[];
}

export const OFFICIAL_RULES_REFERENCE: RulesReference = {
  source: "ONE PIECE CARD GAME Comprehensive Rules",
  version: "1.2.0 (2026-01-16)",
  checkedAt: "2026-05-20",
  implementedScope: [
    "50枚デッキ、リーダー1枚、DON!!デッキ10枚の基本構成",
    "リーダー色に合うカードのみでデッキを組む制約",
    "初手5枚、1回だけ全入れ替えできるマリガン判断ログ",
    "リーダーのライフ値、0ライフ時のリーダーダメージ敗北",
    "リフレッシュ、ドロー、DON!!、メイン、アタック、エンドのターン骨格",
    "カード使用、DON使用、ライフ変動、トリガー公開のイベント記録",
  ],
  pendingScope: [
    "全カード効果の完全な解決エンジン",
    "カウンタータイミングとバトル中のパワー比較の完全再現",
    "ブロッカー、対象変更、ブロック時効果",
    "永続効果、置換効果、効果の重複処理",
    "FAQ、エラッタ、個別裁定の取り込み",
  ],
};

export interface ReplayHeader {
  schemaVersion: 1;
  seed: number;
  rulesVersion: string;
  cpuSkill: CpuSkill;
  firstPlayer: PracticeSide;
  decks: Record<PracticeSide, ReplayDeckSummary>;
}

export interface ReplayDeckSummary {
  leaderId: string;
  leaderName: string;
  source: "draft" | "generated";
  totalCards: number;
}

export type GameEventType =
  | "game_start"
  | "mulligan_decision"
  | "turn_start"
  | "refresh_phase"
  | "draw_phase"
  | "don_phase"
  | "main_phase_action"
  | "attack_declared"
  | "trigger_revealed"
  | "life_changed"
  | "turn_end"
  | "game_end";

export interface GameEvent {
  index: number;
  type: GameEventType;
  turn: number;
  side?: PracticeSide;
  payload: Record<string, unknown>;
  state: ReplayStateSnapshot;
}

export interface ReplayStateSnapshot {
  playerLife: number;
  opponentLife: number;
  playerHand: number;
  opponentHand: number;
  playerDeck: number;
  opponentDeck: number;
  playerDonAvailable: number;
  opponentDonAvailable: number;
  playerDonUsed: number;
  opponentDonUsed: number;
}

export interface GameReplayLog {
  header: ReplayHeader;
  events: GameEvent[];
  result: ReplayResult;
}

export interface ReplayResult {
  winner: PracticeSide;
  loser: PracticeSide;
  turns: number;
  reason: WinReason;
  playerLife: number;
  opponentLife: number;
}

export interface LifeCurvePoint {
  turn: number;
  playerLife: number;
  opponentLife: number;
}

export interface CardTimingStat {
  cardId: string;
  name: string;
  side: PracticeSide;
  averageTurn: number;
  uses: number;
}

export interface DrawProbabilityStat {
  cardId: string;
  name: string;
  copies: number;
  turn3: number;
  turn5: number;
  turn7: number;
}

export interface AblationResult {
  cardId: string;
  name: string;
  replacementName: string;
  games: number;
  baselineWinRate: number;
  ablatedWinRate: number;
  delta: number;
}

export interface AnalysisMetrics {
  winRate: number;
  firstPlayerWinRate: number;
  secondPlayerWinRate: number;
  triggerRevealRate: number;
  triggerSuccessRate: number;
  mulliganKeepWinRate: number | null;
  mulliganRedrawWinRate: number | null;
  averageDonEfficiency: number;
  counterOverflowOnLoss: number;
  winReasons: Record<WinReason, number>;
  lifeCurve: LifeCurvePoint[];
  cardTiming: CardTimingStat[];
  drawProbability: DrawProbabilityStat[];
  ablation: AblationResult[];
}

export interface AnalysisMetricDefinition {
  key: keyof AnalysisMetrics;
  label: string;
  method: string;
  requiredData: string;
  implemented: boolean;
}

export const ANALYSIS_METRIC_DEFINITIONS: AnalysisMetricDefinition[] = [
  {
    key: "winRate",
    label: "単純勝率",
    method: "試合結果ログをマッチアップごとに集計し、勝率を算出する。",
    requiredData: "game_end event",
    implemented: true,
  },
  {
    key: "ablation",
    label: "Ablation分析（カード貢献度）",
    method: "対象カードを汎用カードへ差し替え、同じseed系列でN試合を再実行して勝率差を測る。",
    requiredData: "batch runner, deterministic seeds, deck mutation",
    implemented: true,
  },
  {
    key: "drawProbability",
    label: "引く確率（ターン別）",
    method: "既存の確率エンジンで、ターン3、5、7時点の到達確率を算出する。",
    requiredData: "deck list, card groups",
    implemented: true,
  },
  {
    key: "mulliganKeepWinRate",
    label: "マリガン判定精度",
    method: "初手ごとのkeep/redraw判断をログ化し、判断別の勝率を比較する。",
    requiredData: "mulligan_decision event, opening hand hash",
    implemented: true,
  },
  {
    key: "firstPlayerWinRate",
    label: "先攻・後攻差",
    method: "firstPlayer別に勝率を集計し、有利不利を比較する。",
    requiredData: "header.firstPlayer, game_end event",
    implemented: true,
  },
  {
    key: "triggerSuccessRate",
    label: "トリガー確率・成功率",
    method: "ライフから公開されたカードと、発動成功扱いになった割合を集計する。",
    requiredData: "trigger_revealed event",
    implemented: true,
  },
  {
    key: "cardTiming",
    label: "カード使用タイミング分布",
    method: "main_phase_actionのターンをカード別に平均化する。",
    requiredData: "main_phase_action event",
    implemented: true,
  },
  {
    key: "counterOverflowOnLoss",
    label: "カウンター余剰率",
    method: "敗北時に手札へ残ったカウンター値を集計し、防御資源の使い残しを見る。",
    requiredData: "game_end payload, remaining hand",
    implemented: true,
  },
  {
    key: "winReasons",
    label: "勝因分類",
    method: "game_end.reasonをリーサル、デッキ切れ、効果勝利などへ分類する。",
    requiredData: "game_end event",
    implemented: true,
  },
  {
    key: "lifeCurve",
    label: "ライフ推移",
    method: "turn_endごとの平均ライフをマッチアップ別に集計する。",
    requiredData: "turn_end snapshot",
    implemented: true,
  },
  {
    key: "averageDonEfficiency",
    label: "DON使用効率",
    method: "各ターンの使用DON ÷ 利用可能DONを平均する。",
    requiredData: "turn_end snapshot",
    implemented: true,
  },
];
