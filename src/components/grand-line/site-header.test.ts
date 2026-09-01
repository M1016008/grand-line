import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { isNavigationPathActive } from "./site-header";

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

test("data dropdown is outside the horizontally scrollable primary navigation", async () => {
  const header = await source(
    "src",
    "components",
    "grand-line",
    "site-header.tsx",
  );

  const primaryScroll = header.indexOf("data-primary-navigation-scroll");
  const primaryScrollEnd = header.indexOf("</div>", primaryScroll);
  const dataMenu = header.indexOf("data-data-navigation-menu");

  assert.notEqual(primaryScroll, -1);
  assert.notEqual(primaryScrollEnd, -1);
  assert.ok(dataMenu > primaryScrollEnd);
  assert.match(
    header.slice(primaryScroll, primaryScrollEnd),
    /overflow-x-auto/,
  );
  assert.doesNotMatch(header.slice(dataMenu), /overflow-x-auto/);
});

test("data navigation remains active for all data routes", async () => {
  const header = await source(
    "src",
    "components",
    "grand-line",
    "site-header.tsx",
  );

  for (const route of ["/sets", "/synergy", "/regulations"] as const) {
    assert.equal(isNavigationPathActive(route, route), true);
  }
  assert.equal(isNavigationPathActive("/synergy/OP01-001", "/synergy"), true);
  assert.equal(isNavigationPathActive("/cards", "/sets"), false);

  assert.match(header, /const isDataItemActive/);
  assert.match(header, /DATA_NAV\.some\(\(item\) => isDataItemActive\(item\.href\)\)/);
  assert.match(header, /isNavigationPathActive\(pathname, href\)/);
  assert.match(header, /aria-current=\{isDataActive \? "page" : undefined\}/);
  assert.ok(header.includes('{ href: "/sets", label: "セット" }'));
  assert.ok(header.includes('{ href: "/synergy", label: "シナジー" }'));
  assert.ok(
    header.includes('{ href: "/regulations", label: "禁止/制限" }'),
  );
});
