import test from "node:test";
import assert from "node:assert/strict";

import { parseDropdown } from "./discover";

const FIXTURE = `
<select id="series" class="selectModal">
  <option value="">ALL</option>
  <option value="550101">ブースターパック ROMANCE DAWN【OP-01】</option>
  <option value="550116">ブースターパック 仮の新弾【OP-16】</option>
  <option value="550107">ブースターパック <br class="spInline">500年後の未来【OP-07】</option>
  <option value="550031">スタートデッキ 仮の新スターター&仲間達【ST-31】</option>
  <option value="550901">プロモーションカード</option>
</select>
`;

test("parseDropdown extracts seriesId + setCode from labels", () => {
  const out = parseDropdown(FIXTURE);
  assert.equal(out.length, 5);
  const op01 = out.find((o) => o.seriesId === "550101");
  assert.ok(op01);
  assert.equal(op01.setCode, "OP01");
  assert.match(op01.label, /ROMANCE DAWN/);
});

test("parseDropdown handles <br> inside option labels", () => {
  const out = parseDropdown(FIXTURE);
  const op07 = out.find((o) => o.seriesId === "550107");
  assert.ok(op07);
  assert.equal(op07.setCode, "OP07");
  // The <br class="spInline"> should be replaced with a space, not dropped entirely.
  assert.match(op07.label, /500年後の未来/);
});

test("parseDropdown decodes &amp; into &", () => {
  const out = parseDropdown(FIXTURE);
  const st31 = out.find((o) => o.seriesId === "550031");
  assert.ok(st31);
  assert.equal(st31.setCode, "ST31");
  assert.match(st31.label, /仲間達/);
  assert.ok(!st31.label.includes("&amp;"), "should decode &amp;");
  assert.ok(st31.label.includes("&"));
});

test("parseDropdown returns null setCode for labels without 【XX-NN】", () => {
  const out = parseDropdown(FIXTURE);
  const promo = out.find((o) => o.seriesId === "550901");
  assert.ok(promo);
  assert.equal(promo.setCode, null);
});

test("parseDropdown skips the empty 'ALL' placeholder option", () => {
  const out = parseDropdown(FIXTURE);
  for (const o of out) {
    assert.ok(o.seriesId !== "");
  }
});

test("parseDropdown set code parser accepts 1-4 letter prefixes", () => {
  const html = `
    <select id="series">
      <option value="550301">PRB【PRB-01】</option>
      <option value="550901">P single letter【P-01】</option>
    </select>`;
  const out = parseDropdown(html);
  assert.equal(out.find((o) => o.seriesId === "550301")?.setCode, "PRB01");
  assert.equal(out.find((o) => o.seriesId === "550901")?.setCode, "P01");
});
