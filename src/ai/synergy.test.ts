import test from "node:test";
import assert from "node:assert/strict";

/**
 * AI synergy integration is exercised by:
 *  - schema validation tests that don't hit the network
 *  - a smoke import test that proves the module compiles even when
 *    ANTHROPIC_API_KEY isn't set (the wrapper throws lazily, on first call)
 *
 * Live request tests live under `src/ai/__live__/` and are gated by the
 * presence of the API key — see the comment in that directory.
 */

test("synergy module imports without ANTHROPIC_API_KEY in env", async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const mod = await import("./synergy");
    assert.equal(typeof mod.analyzeSynergy, "function");
  } finally {
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  }
});

test("client throws MissingApiKeyError when key absent", async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { getAnthropic, MissingApiKeyError } = await import("./client");
    assert.throws(() => getAnthropic(), MissingApiKeyError);
  } finally {
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  }
});
