/**
 * Anthropic SDK accessor.
 *
 * The wrapper exists so every Claude call in the project goes through one
 * code path that:
 *   - reads `ANTHROPIC_API_KEY` lazily (so the build doesn't blow up when
 *     the key is missing in dev),
 *   - throws a *typed* error rather than a string, and
 *   - centralizes prompt-cache config and model defaults.
 *
 * Per AGENTS.md, every tool-using call must declare a JSON schema and the
 * model output must be validated server-side before persistence. The
 * higher-level helpers in `src/ai/synergy.ts` etc. enforce that contract.
 */

import Anthropic from "@anthropic-ai/sdk";

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local before running AI-backed features.",
    );
    this.name = "MissingApiKeyError";
  }
}

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();
  cached = new Anthropic({ apiKey });
  return cached;
}

/**
 * Canonical model ids per the roadmap §8.2 — kept here so the rest of the
 * codebase doesn't have to remember version suffixes or spelling.
 *
 *   opus    — heavy reasoning (deck proposals, scenario analysis)
 *   sonnet  — general analytical workhorse (synergy, opponent analysis)
 *   haiku   — high-frequency lightweight tasks (card classification)
 */
export const MODEL = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
} as const;

export type ModelId = (typeof MODEL)[keyof typeof MODEL];
