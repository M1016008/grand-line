import test from "node:test";
import assert from "node:assert/strict";

import { extractMechanics } from "./mechanics";

/* ──────────────────────────────────────────────────────────────────────── */
/* Permanent abilities                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

test("extracts [ブロッカー] keyword", () => {
  const m = extractMechanics("[ブロッカー]");
  assert.ok(m.includes("Blocker"));
});

test("extracts English [Blocker] keyword", () => {
  const m = extractMechanics("[Blocker]");
  assert.ok(m.includes("Blocker"));
});

test("extracts 速攻 + 二回攻撃 + バニッシュ together", () => {
  const m = extractMechanics("[速攻] [二回攻撃] [バニッシュ]");
  assert.deepEqual(
    m.filter((x) => ["Rush", "DoubleAttack", "Banish"].includes(x)),
    ["Rush", "DoubleAttack", "Banish"],
  );
});

test("[カウンター]: 1000 is recognized as Counter", () => {
  const m = extractMechanics("[カウンター]: 1000");
  assert.ok(m.includes("Counter"));
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Timing markers                                                            */
/* ──────────────────────────────────────────────────────────────────────── */

test("[登場時] is OnPlay; nothing else", () => {
  const m = extractMechanics("[登場時] 自分のデッキの上から1枚を見る。");
  assert.ok(m.includes("OnPlay"));
  assert.ok(m.includes("Look"));
  assert.ok(!m.includes("OnAttack"));
});

test("自分のターン中 → DuringYourTurn, not DuringOpponentTurn", () => {
  const m = extractMechanics("自分のターン中、このキャラのパワー +1000。");
  assert.ok(m.includes("DuringYourTurn"));
  assert.ok(m.includes("PowerBuff"));
  assert.ok(!m.includes("DuringOpponentTurn"));
});

test("自分のターンの終了時 → EndOfYourTurn (NOT bare EndOfTurn)", () => {
  const m = extractMechanics("自分のターンの終了時、このキャラをKOする。");
  assert.ok(m.includes("EndOfYourTurn"));
  assert.ok(!m.includes("EndOfTurn"));
});

test("ターン終了時 (no qualifier) → EndOfTurn only", () => {
  const m = extractMechanics("ターン終了時、このキャラをアクティブにする。");
  assert.ok(m.includes("EndOfTurn"));
  assert.ok(!m.includes("EndOfYourTurn"));
  assert.ok(m.includes("ActivateCard"));
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Activated abilities                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

test("[起動メイン] is recognized", () => {
  const m = extractMechanics("[起動メイン] 自分のデッキの上から3枚を公開する。");
  assert.ok(m.includes("ActivateMain"));
  assert.ok(m.includes("Look"));
});

test("[起動相手のターン] is recognized as ActivateOpponentTurn", () => {
  const m = extractMechanics("[起動相手のターン] このキャラをレストにする。");
  assert.ok(m.includes("ActivateOpponentTurn"));
  assert.ok(m.includes("RestCard"));
});

/* ──────────────────────────────────────────────────────────────────────── */
/* DON-related                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

test("ドン!! 装着 → DonAttach", () => {
  const m = extractMechanics(
    "[アタック時] このキャラにドン!! 装着が2枚以上ある場合、相手のキャラ1枚を選び、レストにする。",
  );
  assert.ok(m.includes("DonAttach"));
  assert.ok(m.includes("OnAttack"));
  assert.ok(m.includes("RestOpponentCard"));
});

test("ドン!! アクティブ化 → DonActivate", () => {
  const m = extractMechanics("[起動メイン] 自分のドン!! 1枚をアクティブにする。");
  assert.ok(m.includes("DonActivate"));
  assert.ok(m.includes("ActivateMain"));
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Card movement                                                             */
/* ──────────────────────────────────────────────────────────────────────── */

test("Search pattern: 山札を見て...手札に加える", () => {
  const m = extractMechanics(
    "[登場時] 自分のデッキの上から5枚を見て、コスト3以下の{麦わらの一味}カード1枚を手札に加える。残りをデッキの下に置く。",
  );
  assert.ok(m.includes("Search"));
  assert.ok(m.includes("OnPlay"));
});

test("Draw pattern", () => {
  const m = extractMechanics("[登場時] カードを2枚ドロー。");
  assert.ok(m.includes("Draw"));
});

test("ライフ回復 → RestoreLife", () => {
  const m = extractMechanics("[アタック時] 自分のライフが3枚以下なら、ライフを1枚回復する。");
  assert.ok(m.includes("RestoreLife"));
  assert.ok(m.includes("OnAttack"));
});

test("PowerBuff matches 全角プラス too", () => {
  const m = extractMechanics("自分のターン中、このキャラのパワー＋2000。");
  assert.ok(m.includes("PowerBuff"));
  assert.ok(m.includes("DuringYourTurn"));
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Event timing + DON gating                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

test("[メイン] event activation → MainPhase, NOT ActivateMain", () => {
  const m = extractMechanics("[メイン] 相手のキャラ1枚を選び、KOする。");
  assert.ok(m.includes("MainPhase"));
  assert.ok(!m.includes("ActivateMain"));
});

test("[起動メイン] does not falsely trigger MainPhase", () => {
  const m = extractMechanics(
    "[起動メイン] [ターン1回] 自分のデッキの上から1枚を見る。",
  );
  assert.ok(m.includes("ActivateMain"));
  assert.ok(!m.includes("MainPhase"));
});

test("[ドン!!×N] static gate → DonAttached", () => {
  const m = extractMechanics(
    "[ドン!!×1] このキャラは、相手のアクティブのキャラにもアタックできる。",
  );
  assert.ok(m.includes("DonAttached"));
  // Should not falsely fire DonAttach (the keyword for ドン!! 装着) or
  // DonActivate (which needs アクティブ化).
  assert.ok(!m.includes("DonAttach"));
  assert.ok(!m.includes("DonActivate"));
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Triggers + nullish input                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

test("[トリガー] picks up Trigger from triggerText param", () => {
  const m = extractMechanics(null, "[トリガー] このカードを登場させる。");
  assert.ok(m.includes("Trigger"));
});

test("returns empty array for empty / nullish input", () => {
  assert.deepEqual(extractMechanics(null), []);
  assert.deepEqual(extractMechanics(""), []);
  assert.deepEqual(extractMechanics("   "), []);
});

test("output order is stable (declaration order in MECHANICS)", () => {
  const a = extractMechanics("[登場時] [ブロッカー]");
  const b = extractMechanics("[ブロッカー] [登場時]");
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["Blocker", "OnPlay"]);
});
