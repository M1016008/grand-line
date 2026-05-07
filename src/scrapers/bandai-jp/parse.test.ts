import test from "node:test";
import assert from "node:assert/strict";

import { parseSetHtml } from "./parse";
import type { RawSetFixture } from "./types";

/**
 * Synthetic fixture mirroring the Bandai cardlist DOM shape we target. Real
 * fixtures land in `data/raw/bandai-jp/<set>.html` once the user authorizes
 * a scrape; this test only proves the parser logic without going to network.
 */
const FIXTURE_HTML = `
<!doctype html>
<html><body>
  <ul class="list">
    <li class="modalCol" id="OP01-001">
      <div class="infoCol">
        <h1 class="cardName">モンキー・D・ルフィ</h1>
        <h2 class="cardNumber">OP01-001</h2>
        <img src="/images/cardlist/card/OP01-001.png" />
      </div>
      <dl>
        <div class="col"><dt>種類</dt><dd>リーダー</dd></div>
        <div class="col"><dt>色</dt><dd>赤</dd></div>
        <div class="col"><dt>ライフ</dt><dd>5</dd></div>
        <div class="col"><dt>パワー</dt><dd>5000</dd></div>
        <div class="col"><dt>属性</dt><dd>打撃</dd></div>
        <div class="col"><dt>特徴</dt><dd>麦わらの一味/超新星</dd></div>
        <div class="col"><dt>効果</dt><dd>[アタック時] このリーダーをアクティブにする。</dd></div>
        <div class="col"><dt>レアリティ</dt><dd>L</dd></div>
      </dl>
    </li>

    <li class="modalCol" id="OP01-016">
      <div class="infoCol">
        <h1 class="cardName">ナミ</h1>
        <h2 class="cardNumber">OP01-016</h2>
        <img src="/images/cardlist/card/OP01-016.png" />
      </div>
      <dl>
        <div class="col"><dt>種類</dt><dd>キャラクター</dd></div>
        <div class="col"><dt>色</dt><dd>赤</dd></div>
        <div class="col"><dt>コスト</dt><dd>1</dd></div>
        <div class="col"><dt>パワー</dt><dd>1000</dd></div>
        <div class="col"><dt>カウンター</dt><dd>1000</dd></div>
        <div class="col"><dt>属性</dt><dd>特殊</dd></div>
        <div class="col"><dt>特徴</dt><dd>麦わらの一味</dd></div>
        <div class="col"><dt>効果</dt><dd>[起動メイン] [ターン1回] 自分のデッキの上から1枚を見る。</dd></div>
        <div class="col"><dt>トリガー</dt><dd>このキャラを登場させる。</dd></div>
        <div class="col"><dt>レアリティ</dt><dd>C</dd></div>
      </dl>
    </li>
  </ul>
</body></html>`;

const FIXTURE: RawSetFixture = {
  setCode: "OP01",
  fetchedAt: new Date("2026-05-07T00:00:00Z"),
  url: "https://www.onepiece-cardgame.com/cardlist/?series=569101",
  html: FIXTURE_HTML,
};

test("parses leader card with life and power", () => {
  const cards = parseSetHtml(FIXTURE);
  const luffy = cards.find((c) => c.id === "OP01-001");
  assert.ok(luffy, "expected to find OP01-001");
  assert.equal(luffy.cardType, "LEADER");
  assert.deepEqual(luffy.colors, ["red"]);
  assert.equal(luffy.life, 5);
  assert.equal(luffy.power, 5000);
  assert.deepEqual(luffy.features, ["麦わらの一味", "超新星"]);
  assert.equal(luffy.rarity, "L");
});

test("parses character card with cost / counter / trigger", () => {
  const cards = parseSetHtml(FIXTURE);
  const nami = cards.find((c) => c.id === "OP01-016");
  assert.ok(nami, "expected to find OP01-016");
  assert.equal(nami.cardType, "CHARACTER");
  assert.equal(nami.cost, 1);
  assert.equal(nami.counter, 1000);
  assert.equal(nami.hasTrigger, true);
  assert.match(nami.triggerText ?? "", /このキャラを登場させる/);
});

test("uses card id prefix as set code", () => {
  const cards = parseSetHtml(FIXTURE);
  for (const card of cards) {
    assert.equal(card.setCode, "OP01");
  }
});

test("absolutizes image URLs against the fixture base URL", () => {
  const cards = parseSetHtml(FIXTURE);
  for (const card of cards) {
    assert.match(card.imageUrlJp ?? "", /^https:\/\/www\.onepiece-cardgame\.com\//);
  }
});

test("throws (non-lenient) when fixture has no .modalCol nodes", () => {
  const empty: RawSetFixture = {
    ...FIXTURE,
    html: "<html><body><p>nothing here</p></body></html>",
  };
  assert.throws(() => parseSetHtml(empty), /No \.modalCol nodes/);
});
