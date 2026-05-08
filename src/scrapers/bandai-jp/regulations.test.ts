import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseRestrictionsHtml } from "./regulations";

/**
 * Live-data snapshot test. The fixture is the saved
 * `data/raw/bandai-jp/regulations.html` (gitignored). When that file
 * exists, the test asserts the parser extracts the well-known current
 * bans + pairs. When absent (fresh checkout, no scrape yet), the test
 * is skipped — we don't ship the Bandai HTML in version control.
 */

const FIXTURE = path.resolve(
  __dirname,
  "../../../data/raw/bandai-jp/regulations.html",
);

let html: string | null;
try {
  html = readFileSync(FIXTURE, "utf-8");
} catch {
  html = null;
}

test("parser extracts the known 5 current bans (live fixture)", { skip: !html }, () => {
  const out = parseRestrictionsHtml(html!);
  const ids = out.bans.map((b) => b.cardId).sort();
  // Snapshot of the live regulation as of 2026-05-09.
  for (const expected of [
    "OP03-040",
    "OP06-047",
    "OP06-086",
    "OP06-116",
    "ST10-001",
  ]) {
    assert.ok(ids.includes(expected), `expected ${expected} in bans, got ${ids.join(",")}`);
  }
  assert.equal(out.restricted.length, 0, "no restricted cards as of 2026-05-09");
});

test("parser extracts the 3 known banned pairs (live fixture)", { skip: !html }, () => {
  const out = parseRestrictionsHtml(html!);
  const seen = new Set(out.pairs.map((p) => `${p.cardIdA}|${p.cardIdB}`));
  // Pairs are stored with card_id_a < card_id_b alphabetically.
  for (const expected of [
    "OP08-069|OP11-040", // ルフィ + リンリン
    "OP11-040|OP11-067", // ルフィ + カタクリ
    "EB04-058|OP07-115", // 助けてクエーサ + ボルサリーノ
  ]) {
    assert.ok(seen.has(expected), `expected pair ${expected}, got ${[...seen].join(",")}`);
  }
});

test("parser throws when the section heading is missing", () => {
  assert.throws(
    () => parseRestrictionsHtml("<html><body><h1>nothing</h1></body></html>"),
    /施行済み/,
  );
});

test("parser handles empty 制限カード block (該当カード無し)", { skip: !html }, () => {
  const out = parseRestrictionsHtml(html!);
  assert.equal(out.restricted.length, 0);
});

test("parser normalizes pair ordering (a < b lexicographically)", { skip: !html }, () => {
  const out = parseRestrictionsHtml(html!);
  for (const pair of out.pairs) {
    assert.ok(
      pair.cardIdA < pair.cardIdB,
      `pair must be ordered: got ${pair.cardIdA} >= ${pair.cardIdB}`,
    );
  }
});
