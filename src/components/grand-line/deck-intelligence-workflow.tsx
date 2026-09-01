"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DeckIntelligenceStep = 1 | 2 | 3 | 4 | 5;
export type DeckIntelligenceStepStatus = "upcoming" | "current" | "complete";

const STEP_LABELS: Record<DeckIntelligenceStep, string> = {
  1: "構築条件",
  2: "構築案",
  3: "対戦比較",
  4: "改善候補",
  5: "下書き",
};

const STATUS_LABELS: Record<DeckIntelligenceStepStatus, string> = {
  upcoming: "未実行",
  current: "現在",
  complete: "完了",
};

export function DeckIntelligenceStepper({
  currentStep,
  completedSteps,
  enabledSteps,
  onStepChange,
}: {
  currentStep: DeckIntelligenceStep;
  completedSteps: ReadonlySet<DeckIntelligenceStep>;
  enabledSteps: ReadonlySet<DeckIntelligenceStep>;
  onStepChange: (step: DeckIntelligenceStep) => void;
}) {
  return (
    <nav aria-label="Deck Intelligence ワークフロー" className="overflow-x-auto pb-1">
      <ol className="grid min-w-[680px] grid-cols-5 gap-2 sm:min-w-0">
        {([1, 2, 3, 4, 5] as const).map((step) => {
          const status: DeckIntelligenceStepStatus =
            currentStep === step
              ? "current"
              : completedSteps.has(step)
                ? "complete"
                : "upcoming";
          return (
            <li key={step}>
              <button
                type="button"
                aria-current={status === "current" ? "step" : undefined}
                disabled={!enabledSteps.has(step)}
                data-status={status}
                onClick={() => onStepChange(step)}
                className={cn(
                  "border-border/40 bg-background/35 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  status === "current" && "border-primary/60 bg-primary/10",
                  status === "complete" && "border-primary/25",
                  !enabledSteps.has(step) && "cursor-not-allowed opacity-45",
                )}
              >
                <span
                  className={cn(
                    "border-border/60 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px]",
                    status === "current" && "border-primary bg-primary text-primary-foreground",
                    status === "complete" && "border-primary/40 text-primary",
                  )}
                >
                  {step}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {STEP_LABELS[step]}
                  </span>
                  <span className="text-muted-foreground block text-[9px]">
                    {STATUS_LABELS[status]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function DeckIntelligenceStepPanel({
  step,
  title,
  status,
  summary,
  expanded,
  onToggle,
  children,
}: {
  step: DeckIntelligenceStep;
  title: string;
  status: DeckIntelligenceStepStatus;
  summary: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`deck-intelligence-step-${step}`}
      data-workflow-step={step}
      className={cn(
        "border-border/40 bg-background/30 rounded-lg border",
        expanded && "border-primary/35 bg-background/45",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-primary font-mono text-xs">{step}</span>
          <div className="min-w-0">
            <h4 id={`deck-intelligence-step-${step}`} className="font-display text-sm">
              {title}
            </h4>
            <div className="text-muted-foreground mt-0.5 text-[10px] leading-relaxed">
              {summary}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status === "current" ? "secondary" : "outline"}>
            {STATUS_LABELS[status]}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={`deck-intelligence-step-${step}-content`}
            onClick={onToggle}
          >
            {expanded ? "閉じる" : status === "upcoming" ? "開始" : "開く"}
          </Button>
        </div>
      </div>
      {expanded ? (
        <div
          id={`deck-intelligence-step-${step}-content`}
          className="border-border/30 border-t p-3 sm:p-4"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
