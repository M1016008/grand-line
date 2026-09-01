import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

test("global nav uses purpose-based primary entries", async () => {
  const header = await source(
    "src",
    "components",
    "grand-line",
    "site-header.tsx",
  );

  const primary = ["デッキ", "カード", "CPU対戦", "検証", "データ"];
  for (const label of primary) {
    assert.match(header, new RegExp(label, "g"));
  }

  assert.doesNotMatch(header, /label:\s*"対戦"/);
  assert.doesNotMatch(header, /label:\s*"練習"/);
  assert.doesNotMatch(header, /SOON/);
  assert.doesNotMatch(header, /\/probability/);
  assert.doesNotMatch(header, /\/tournaments/);
  assert.match(header, /const DATA_NAV/);
});

test("nested routes map to primary active state", async () => {
  const header = await source(
    "src",
    "components",
    "grand-line",
    "site-header.tsx",
  );

  const active = /matchPrefixes:\s*\["\/decks"\]/;
  assert.match(header, active);
  assert.match(header, /item\.matchPrefixes\.some/);
  assert.match(header, /pathname\.startsWith/);
  assert.match(header, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(header, /matchPrefixes/);
  assert.ok(header.includes('"/decks"'));
  assert.ok(header.includes('"/cards"'));
  assert.ok(header.includes('"/battle"'));
  assert.ok(header.includes('"/practice"'));
});

test("mobile header remains usable", async () => {
  const header = await source(
    "src",
    "components",
    "grand-line",
    "site-header.tsx",
  );

  assert.match(header, /overflow-x-auto/);
  assert.match(header, /sticky top-0/);
  assert.match(header, /details /);
});
