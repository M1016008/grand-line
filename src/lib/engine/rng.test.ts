import test from "node:test";
import assert from "node:assert/strict";

import { createRng, gameSeed, hashSeed } from "./rng";

test("createRng — same seed produces same sequence", () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 100; i++) {
    assert.equal(a.next(), b.next());
  }
});

test("createRng — string seed is deterministic", () => {
  const a = createRng("hello");
  const b = createRng("hello");
  const c = createRng("world");
  assert.equal(a.next(), b.next());
  assert.notEqual(a.next(), c.next());
});

test("createRng — zero seed is rescued to a non-stuck sequence", () => {
  const r = createRng(0);
  const values = Array.from({ length: 5 }, () => r.next());
  // Not all identical, not all zero.
  const allEqual = values.every((v) => v === values[0]);
  assert.equal(allEqual, false);
});

test("createRng — output in [0, 1) bounds", () => {
  const r = createRng(123);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test("nextInt — uniform-ish over small range", () => {
  const r = createRng(7);
  const buckets = [0, 0, 0, 0];
  const n = 4000;
  for (let i = 0; i < n; i++) buckets[r.nextInt(4)]!++;
  // Each bucket should be within ±20% of n/4 = 1000.
  for (const c of buckets) {
    assert.ok(c > 800 && c < 1200, `bucket count out of range: ${c}`);
  }
});

test("shuffle — preserves multiset", () => {
  const r = createRng(999);
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const before = [...a];
  r.shuffle(a);
  assert.deepEqual([...a].sort((x, y) => x - y), before);
});

test("shuffle — deterministic for fixed seed", () => {
  const a = createRng(1);
  const b = createRng(1);
  const arrA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const arrB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  a.shuffle(arrA);
  b.shuffle(arrB);
  assert.deepEqual(arrA, arrB);
});

test("pick — returns undefined for empty array", () => {
  const r = createRng(1);
  assert.equal(r.pick([]), undefined);
});

test("hashSeed — same string → same hash", () => {
  assert.equal(hashSeed("foo"), hashSeed("foo"));
  assert.notEqual(hashSeed("foo"), hashSeed("bar"));
});

test("gameSeed — composes a stable per-game seed", () => {
  assert.equal(gameSeed("run-x", 0), "run-x:0");
  assert.equal(gameSeed("run-x", 99), "run-x:99");
});

test("paired-RNG invariant — same seedBase + index → identical streams", () => {
  // The whole point of seedBase: ablation comparisons must be paired.
  const seedBase = "ablation-run-42";
  const aliceRng = createRng(gameSeed(seedBase, 7));
  const bobRng = createRng(gameSeed(seedBase, 7));
  const aliceSeq = Array.from({ length: 200 }, () => aliceRng.next());
  const bobSeq = Array.from({ length: 200 }, () => bobRng.next());
  assert.deepEqual(aliceSeq, bobSeq);
});
