import test from "node:test";
import assert from "node:assert/strict";

import { matchesCardCost, parseCardCostFilter } from "./card-cost-filter";

test("8+ URL bucket means cost 8 or greater", () => {
  const filter = parseCardCostFilter("8+");

  assert.deepEqual(filter, { atLeast: 8 });
  assert.equal(matchesCardCost(7, filter), false);
  assert.equal(matchesCardCost(8, filter), true);
  assert.equal(matchesCardCost(10, filter), true);
  assert.equal(matchesCardCost(null, filter), false);
});

test("exact cost buckets retain exact-match behavior", () => {
  const filter = parseCardCostFilter("7");

  assert.equal(filter, 7);
  assert.equal(matchesCardCost(7, filter), true);
  assert.equal(matchesCardCost(8, filter), false);
});

test("invalid cost query values do not create a filter", () => {
  assert.equal(parseCardCostFilter(undefined), undefined);
  assert.equal(parseCardCostFilter("not-a-cost"), undefined);
  assert.equal(parseCardCostFilter("8plus"), undefined);
});
