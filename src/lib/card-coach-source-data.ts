import { createHash } from "node:crypto";

export type CardCoachCompatibleSource = "rules" | "ai";

export function cardCoachCompatibleReasoningForPrompt(
  source: CardCoachCompatibleSource,
  reasoningJa: string,
): string {
  return source === "rules" ? reasoningJa : "";
}

export function isCardCoachSourceDataStale(
  storedSourceDataHash: string,
  currentSourceDataHash: string | null,
): boolean {
  return currentSourceDataHash !== null && storedSourceDataHash !== currentSourceDataHash;
}

export function hashSourceData(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}
