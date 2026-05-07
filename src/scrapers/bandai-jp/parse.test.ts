import test from "node:test";
import assert from "node:assert/strict";

import { parseSetHtml } from "./parse";
import type { RawSetFixture } from "./types";

/**
 * Synthetic fixture mirroring the real Bandai cardlist DOM as captured
 * on 2026-05-08 (see `data/raw/bandai-jp/OP01.html`). Two cards plus a
 * parallel-artwork duplicate to exercise the dedupe path.
 */
const FIXTURE_HTML = `
<!doctype html>
<html><body>
  <div class="resultCol">

    <dl class="modalCol" id="OP01-001">
      <dt>
        <button class="scrollBtn">ボタン</button>
        <div class="infoCol">
          <span>OP01-001</span> | <span>L</span> | <span>LEADER</span>
        </div>
        <div class="cardName">モンキー・D・ルフィ</div>
      </dt>
      <dd>
        <div class="frontCol">
          <img class="lazy" src="/images/cardlist/dummy.gif"
               data-src="../images/cardlist/card/OP01-001.png?260428"
               alt="モンキー・D・ルフィ">
        </div>
        <div class="backCol">
          <div class="col2">
            <div class="cost"><h3>ライフ</h3>5</div>
            <div class="attribute">
              <h3>属性</h3>
              <img src="/images/cardlist/attribute/ico_type01.png" alt="打">
            </div>
          </div>
          <div class="col2">
            <div class="power"><h3>パワー</h3>5000</div>
            <div class="counter"><h3>カウンター</h3>-</div>
          </div>
          <div class="col2">
            <div class="color"><h3>色</h3>赤</div>
          </div>
          <div class="feature"><h3>特徴</h3>超新星/麦わらの一味</div>
          <div class="text"><h3>テキスト</h3>【アタック時】このリーダーをアクティブにする。</div>
        </div>
      </dd>
    </dl>

    <!-- Parallel artwork — same id with _p2 suffix; should be deduped away. -->
    <dl class="modalCol" id="OP01-001_p2">
      <dt>
        <div class="infoCol">
          <span>OP01-001</span> | <span>L</span> | <span>LEADER</span>
        </div>
        <div class="cardName">モンキー・D・ルフィ</div>
      </dt>
      <dd>
        <div class="frontCol">
          <img class="lazy" data-src="../images/cardlist/card/OP01-001_p2.png">
        </div>
        <div class="backCol">
          <div class="col2"><div class="cost"><h3>ライフ</h3>5</div>
            <div class="attribute"><h3>属性</h3><img alt="打"></div></div>
          <div class="col2"><div class="power"><h3>パワー</h3>5000</div>
            <div class="counter"><h3>カウンター</h3>-</div></div>
          <div class="col2"><div class="color"><h3>色</h3>赤</div></div>
          <div class="feature"><h3>特徴</h3>超新星/麦わらの一味</div>
          <div class="text"><h3>テキスト</h3>【アタック時】このリーダーをアクティブにする。</div>
        </div>
      </dd>
    </dl>

    <dl class="modalCol" id="OP01-016">
      <dt>
        <div class="infoCol">
          <span>OP01-016</span> | <span>R</span> | <span>CHARACTER</span>
        </div>
        <div class="cardName">ナミ</div>
      </dt>
      <dd>
        <div class="frontCol">
          <img class="lazy" data-src="../images/cardlist/card/OP01-016.png">
        </div>
        <div class="backCol">
          <div class="col2"><div class="cost"><h3>コスト</h3>1</div>
            <div class="attribute"><h3>属性</h3><img alt="特"></div></div>
          <div class="col2"><div class="power"><h3>パワー</h3>2000</div>
            <div class="counter"><h3>カウンター</h3>1000</div></div>
          <div class="col2"><div class="color"><h3>色</h3>赤</div></div>
          <div class="feature"><h3>特徴</h3>麦わらの一味</div>
          <div class="text"><h3>テキスト</h3>【登場時】自分のデッキの上から5枚を見る。</div>
          <div class="trigger"><h3>トリガー</h3>【トリガー】このキャラを登場させる。</div>
        </div>
      </dd>
    </dl>

  </div>
</body></html>`;

const FIXTURE: RawSetFixture = {
  setCode: "OP01",
  fetchedAt: new Date("2026-05-07T00:00:00Z"),
  url: "https://www.onepiece-cardgame.com/cardlist/?series=550101",
  html: FIXTURE_HTML,
};

test("parses leader card with life and power, drops cost", () => {
  const cards = parseSetHtml(FIXTURE);
  const luffy = cards.find((c) => c.id === "OP01-001");
  assert.ok(luffy, "expected to find OP01-001");
  assert.equal(luffy.cardType, "LEADER");
  assert.deepEqual(luffy.colors, ["red"]);
  assert.equal(luffy.life, 5);
  assert.equal(luffy.power, 5000);
  assert.equal(luffy.cost, null, "leaders have no cost field");
  assert.deepEqual(luffy.features, ["超新星", "麦わらの一味"]);
  assert.deepEqual(luffy.attributes, ["打"]);
  assert.equal(luffy.rarity, "L");
});

test("parses character card with cost / counter / trigger and folds 【】 → []", () => {
  const cards = parseSetHtml(FIXTURE);
  const nami = cards.find((c) => c.id === "OP01-016");
  assert.ok(nami, "expected to find OP01-016");
  assert.equal(nami.cardType, "CHARACTER");
  assert.equal(nami.cost, 1);
  assert.equal(nami.counter, 1000);
  assert.equal(nami.life, null, "characters have no life field");
  assert.equal(nami.hasTrigger, true);
  assert.match(nami.triggerText ?? "", /\[トリガー\]/);
  assert.match(nami.effectText ?? "", /\[登場時\]/);
});

test("dedupes parallel artworks (_p2) by base id", () => {
  const cards = parseSetHtml(FIXTURE);
  const luffyMatches = cards.filter((c) => c.id === "OP01-001");
  assert.equal(luffyMatches.length, 1);
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
