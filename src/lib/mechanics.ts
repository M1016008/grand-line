/**
 * Extract canonical rule-keyword mechanics from a card's effect text.
 *
 * The "mechanics" array is meant to be a structured, language-independent
 * fingerprint of *what the card does*, distinct from `features` (麦わらの一味
 * etc.) which describe *what the card is*. Filtering the card pool by
 * `mechanics ⊇ {Blocker, OnPlay}` is dramatically easier on the deck builder
 * than free-text matching against effect text.
 *
 * The extractor is intentionally regex-driven and conservative:
 *  - We match keyword literals anchored by whitespace, brackets, or
 *    punctuation so that "ブロッカー" inside flavor doesn't get false-matched
 *    by a feature keyword that happens to contain the same characters.
 *  - We canonicalize to PascalCase English IDs (`Blocker`, `OnPlay`, `DonAttach`)
 *    so the same array works across `language = ja|en`.
 *  - When in doubt, *don't* tag it. The downstream UI treats missing tags
 *    as "unknown", not "doesn't have it"; over-tagging is harder to debug
 *    later than under-tagging.
 */

import { normalizeEffectText } from "./normalize";

/** Canonical ids — keep in sync with deck-builder filter chips. */
export const MECHANICS = [
  // Permanent / persistent abilities
  "Blocker",
  "Rush",
  "DoubleAttack",
  "Banish",
  "Counter",

  // Timing markers
  "OnPlay", // 登場時
  "OnAttack", // アタック時
  "OnKO", // KO時 (self or other)
  "OnDamage", // ライフ受けた時 / DON!! 受けた時
  "DuringYourTurn", // 自分のターン中
  "DuringOpponentTurn", // 相手のターン中
  "EndOfTurn", // ターン終了時
  "EndOfYourTurn", // 自分のターン終了時

  // Event-card timing
  "MainPhase", // [メイン] — main-phase event activation

  // Activated abilities
  "ActivateMain", // 起動メイン
  "ActivateOpponentTurn", // 起動相手のターン

  // DON-related
  "DonAttach", // ドン!! 装着 (cost reduction or buff requiring attached DON!!)
  "DonActivate", // ドン!! アクティブ化
  "DonAttached", // [ドン!!×N] — static ability gated on N attached DON!!s

  // Card movement / state
  "Search", // サーチ / 山札からカードを公開
  "Look", // 見る (look at top X)
  "Draw",
  "Discard",
  "RestCard", // レストにする
  "ActivateCard", // アクティブにする
  "RestOpponentCard",
  "Trash", // トラッシュに送る (other than your own)
  "ReturnToHand",
  "PlayFromTrash",
  "PlayFromLife", // ライフから登場
  "AddToLife",
  "RemoveFromLife", // ライフからカードを取り除く
  "RestoreLife", // ライフ回復

  // Counters / static modifiers
  "PowerBuff", // パワー +X (activated or static)
  "PowerDebuff", // パワー -X
  "CostReduction",

  // Trigger-zone behavior
  "Trigger", // [トリガー] / [Trigger]
] as const;

export type Mechanic = (typeof MECHANICS)[number];

/** Regex per mechanic, applied against the *normalized* effect text. */
const RULES: ReadonlyArray<{ id: Mechanic; pattern: RegExp }> = [
  // Permanent abilities — usually appear inside [角括弧] on Bandai cards.
  { id: "Blocker", pattern: /\[?ブロッカー\]?|\[Blocker\]/i },
  { id: "Rush", pattern: /\[?速攻\]?|\[Rush\]/i },
  { id: "DoubleAttack", pattern: /\[?二回攻撃\]?|\[Double Attack\]/i },
  { id: "Banish", pattern: /\[?バニッシュ\]?|\[Banish\]/i },
  { id: "Counter", pattern: /\[カウンター\][:：]|\[Counter\]:/i },

  // Timing markers — Bandai writes these as [登場時], [アタック時] etc.
  { id: "OnPlay", pattern: /\[登場時\]|\[On Play\]|登場時に/i },
  { id: "OnAttack", pattern: /\[アタック時\]|\[On Attack\]/i },
  {
    id: "OnKO",
    pattern: /\[KO時\]|\[On KO\]|KOされた時|KOした時/i,
  },
  {
    id: "OnDamage",
    pattern: /\[ライフ受けた時\]|ライフを受けた時|DONを?受けた時/i,
  },
  { id: "DuringYourTurn", pattern: /自分のターン中/i },
  { id: "DuringOpponentTurn", pattern: /相手のターン中/i },
  { id: "EndOfYourTurn", pattern: /自分のターン(?:の)?終了時/i },
  {
    id: "EndOfTurn",
    pattern: /(?<!自分の)(?<!相手の)ターン(?:の)?終了時/i,
  },

  // Event-card timing — `[メイン]` is the activation marker on most events.
  // We require it not to be inside `[起動メイン]` (the activated-ability
  // marker handled below); the substring `[メイン]` does not occur inside
  // `[起動メイン]` so a plain match works.
  { id: "MainPhase", pattern: /\[メイン\]|\[Main\]/i },

  // Activated abilities
  {
    id: "ActivateMain",
    pattern: /\[起動メイン\]|\[Activate: Main\]/i,
  },
  {
    id: "ActivateOpponentTurn",
    pattern: /\[起動相手のターン\]|\[Activate: Opponent's Turn\]/i,
  },

  // DON-related
  {
    id: "DonAttach",
    pattern: /ドン!![\s　]*装着|ドン!!\s*アタッチ|DON!! attached/i,
  },
  {
    id: "DonActivate",
    pattern:
      /ドン!![\s　]*アクティブ化|アクティブにしたドン!!|(?:自分の)?ドン!![^。]{0,12}アクティブに(?:する|して)/i,
  },
  // [ドン!!×N] — static ability that's only "on" while N DONs are
  // attached. Surfaced as its own mechanic so the deck builder /
  // synergy detector can highlight DON-scaling cards.
  { id: "DonAttached", pattern: /\[ドン!!×\d+\]/ },

  // Card movement
  {
    id: "Search",
    pattern: /(?:山札|デッキ)[^。]{0,12}(?:見て|公開し)[^。]{0,40}手札に加え/,
  },
  {
    id: "Look",
    pattern:
      /(?:山札|デッキ)の上から[^。]{0,20}(?:を)?(?:見る|公開する|公開し|見て)/,
  },
  { id: "Draw", pattern: /(?:カードを)?\d+枚(?:まで)?ドロー|ドローする/ },
  { id: "Discard", pattern: /手札から[^。]{0,20}トラッシュ|手札を捨て/ },
  { id: "RestCard", pattern: /(?:キャラ|相手)を?[^。]{0,20}レストに/ },
  { id: "ActivateCard", pattern: /(?:キャラ|ドン)を?[^。]{0,20}アクティブに/ },
  { id: "RestOpponentCard", pattern: /相手の[^。]{0,20}レストに/ },
  { id: "Trash", pattern: /(?:相手の)?(?:キャラ|カード)を[^。]{0,20}トラッシュに送/ },
  { id: "ReturnToHand", pattern: /手札に戻/ },
  { id: "PlayFromTrash", pattern: /トラッシュ[^。]{0,12}登場させ/ },
  { id: "PlayFromLife", pattern: /ライフ[^。]{0,12}登場/ },
  { id: "AddToLife", pattern: /ライフ[^。]{0,12}に(?:加える|追加)/ },
  { id: "RemoveFromLife", pattern: /ライフ[^。]{0,12}を取り除/ },
  { id: "RestoreLife", pattern: /ライフ[^。]{0,12}回復/ },

  // Stat modifiers
  { id: "PowerBuff", pattern: /パワー[\s　]*[\+＋]\d/ },
  { id: "PowerDebuff", pattern: /パワー[\s　]*[\-－‐]\d/ },
  { id: "CostReduction", pattern: /コスト[\s　]*[\-－‐]\d|コストを[^。]{0,8}下げる/ },

  // Trigger zone
  { id: "Trigger", pattern: /\[トリガー\]|\[Trigger\]/i },
];

/**
 * Extract a deduplicated, ordered array of mechanics for a card's effect text.
 *
 * @param effectText  Raw effect text from `cards.effect_text`. May be null.
 * @param triggerText Raw `[トリガー]` text. Optional, treated as additional input.
 */
export function extractMechanics(
  effectText: string | null | undefined,
  triggerText?: string | null,
): Mechanic[] {
  const haystack = [normalizeEffectText(effectText), normalizeEffectText(triggerText)]
    .filter(Boolean)
    .join(" \n ");
  if (!haystack) return [];

  const found = new Set<Mechanic>();
  for (const { id, pattern } of RULES) {
    if (pattern.test(haystack)) {
      found.add(id);
    }
  }
  // Preserve declaration order so consumers can rely on stable serialization.
  return MECHANICS.filter((m) => found.has(m));
}
