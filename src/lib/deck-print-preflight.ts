import type { DeckRuleReport, RuleViolation } from "@/lib/deck-rules";

export interface DeckPrintPreflightFailure {
  status: 422;
  body: {
    error: "illegal_deck";
    detail: string;
    violations: RuleViolation[];
  };
}

export function deckPrintPreflightFailure(
  ruleReport: DeckRuleReport,
): DeckPrintPreflightFailure | null {
  if (ruleReport.legal) return null;

  return {
    status: 422,
    body: {
      error: "illegal_deck",
      detail: "Deck is not legal under the current restrictions.",
      violations: ruleReport.violations,
    },
  };
}
