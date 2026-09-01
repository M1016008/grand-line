"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { CardListItem } from "@/lib/cards";
import {
  FEATURE_TAG_IDS,
  FEATURE_TAG_LABELS,
  MAIN_STYLE_IDS,
  MAIN_STYLE_LABELS,
  MAX_FEATURE_TAGS,
  type FeatureTag,
  type LeaderStyleAptitude,
  type MainStyle,
} from "@/lib/deck-intelligence-preferences";
import { proxiedCardImage } from "@/lib/img";
import { useDeckDraft } from "@/stores/deck";

interface AiDeckProposerProps {
  leader: CardListItem;
  pool: CardListItem[];
  styleAptitudes: LeaderStyleAptitude[];
}

interface ProposalResponse {
  modelVersion: string;
  selectedStyle: MainStyle;
  selectedTags: FeatureTag[];
  effectiveStyle: Exclude<MainStyle, "auto">;
  styleAptitudes: LeaderStyleAptitude[];
  archetypeName: string;
  cards: Array<{
    cardId: string;
    count: number;
    roleJa: string;
    selectionReasonJa: string;
  }>;
  winCondition: string;
  deckConceptJa: string;
  styleAptitudeReasonJa: string;
  keyCards: string[];
  majorCombos: Array<{
    titleJa: string;
    cardIds: string[];
    explanationJa: string;
  }>;
  curveExplanationJa: string;
  metrics: {
    costCurve: Record<string, number>;
    counterDistribution: Record<string, number>;
    triggerRatio: number;
    evaluationScores: Record<string, number>;
    majorMechanics: Array<{ mechanic: string; count: number }>;
  };
  strengths: string[];
  weaknesses: string[];
  favorable: string[];
  unfavorable: string[];
  warnings: string[];
}

interface ApiError {
  error: string;
  detail?: string;
  attempts?: number;
}

export function AiDeckProposer({
  leader,
  pool,
  styleAptitudes,
}: AiDeckProposerProps) {
  const [selectedStyle, setSelectedStyle] = useState<MainStyle>("auto");
  const [selectedTags, setSelectedTags] = useState<FeatureTag[]>([]);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, startTransition] = useTransition();
  const replace = useDeckDraft((s) => s.replace);
  const displayedAptitudes = proposal?.styleAptitudes ?? styleAptitudes;
  const aptitudeByStyle = new Map(
    displayedAptitudes.map((aptitude) => [aptitude.style, aptitude]),
  );

  // Pool lookup so we can hydrate the AI's bare {cardId,count} into full cards.
  const poolById = new Map(pool.map((c) => [c.id, c]));

  async function fetchProposal() {
    setError(null);
    setProposal(null);
    const res = await fetch(`/api/ai/decks/${leader.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedStyle, selectedTags }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as ApiError;
      setError(err);
      return;
    }
    const data = (await res.json()) as ProposalResponse;
    setProposal(data);
  }

  function toggleTag(tag: FeatureTag) {
    setSelectedTags((current) => {
      if (current.includes(tag)) {
        return current.filter((candidate) => candidate !== tag);
      }
      if (current.length >= MAX_FEATURE_TAGS) return current;
      return [...current, tag];
    });
  }

  function applyProposal() {
    if (!proposal) return;
    const entries = proposal.cards
      .map((c) => {
        const card = poolById.get(c.cardId);
        return card ? { card, count: c.count } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    replace(entries);
  }

  return (
    <Card className="border-primary/40 bg-card/50">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm tracking-wide">
            Deck Intelligence Builder
          </h3>
          <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
            Phase 4 · Opus
          </span>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-[10px] tracking-widest uppercase">
              Main Style · 1つ
            </label>
            <Select
              value={selectedStyle}
              onValueChange={(value) => setSelectedStyle(value as MainStyle)}
            >
              <SelectTrigger className="w-full text-xs" aria-label="Main Style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAIN_STYLE_IDS.map((style) => (
                  <SelectItem key={style} value={style}>
                    {MAIN_STYLE_LABELS[style]} {renderStars(aptitudeByStyle.get(style)?.stars)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div
              className="border-border/30 bg-background/30 mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border p-2"
              aria-label="Leader Style Aptitude"
            >
              {MAIN_STYLE_IDS.filter((style) => style !== "auto").map((style) => {
                const aptitude = aptitudeByStyle.get(style);
                return (
                  <div
                    key={style}
                    className="flex items-center justify-between gap-2 text-[10px]"
                  >
                    <span>{MAIN_STYLE_LABELS[style]}</span>
                    <span
                      className={cn(
                        "font-mono tracking-tight",
                        aptitude && aptitude.stars <= 2
                          ? "text-muted-foreground"
                          : "text-primary",
                      )}
                    >
                      {renderStars(aptitude?.stars)}
                      {aptitude && aptitude.stars <= 2 ? " 相性低め" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-muted-foreground text-[10px]">
              Leader効果・特徴・legal pool・support availabilityからsystemが算出。
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
                Feature Tags · 0〜3個
              </span>
              <span className="text-muted-foreground font-mono text-[10px]">
                {selectedTags.length}/{MAX_FEATURE_TAGS}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FEATURE_TAG_IDS.map((tag) => {
                const selected = selectedTags.includes(tag);
                const disabled =
                  !selected && selectedTags.length >= MAX_FEATURE_TAGS;
                return (
                  <Button
                    key={tag}
                    type="button"
                    size="xs"
                    variant={selected ? "secondary" : "outline"}
                    aria-pressed={selected}
                    disabled={disabled || pending}
                    onClick={() => toggleTag(tag)}
                  >
                    {FEATURE_TAG_LABELS[tag]}
                  </Button>
                );
              })}
            </div>
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              Main Styleを主軸に、タグは候補順位へ補助的に加点します。
            </p>
          </div>

          <Button
            onClick={() => startTransition(fetchProposal)}
            disabled={pending}
            size="sm"
            className="w-full"
          >
            {pending ? "生成中…" : "提案"}
          </Button>
        </div>

        {error ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-xs">
            <strong className="block">{error.error}</strong>
            {error.detail ? <p className="opacity-90">{error.detail}</p> : null}
            {error.error === "missing_api_key" ? (
              <p className="text-muted-foreground mt-2">
                <code className="font-mono text-[10px]">.env.local</code> の{" "}
                <code className="font-mono text-[10px]">ANTHROPIC_API_KEY</code>{" "}
                を設定して dev サーバを再起動してください。
              </p>
            ) : null}
          </div>
        ) : null}

        {proposal ? (
          <div className="space-y-3 text-xs">
            <Separator />
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
                  アーキタイプ
                </div>
                <div className="text-foreground font-display text-base font-semibold">
                  {proposal.archetypeName}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="secondary" className="text-[9px]">
                    {MAIN_STYLE_LABELS[proposal.selectedStyle]}
                  </Badge>
                  {proposal.selectedStyle === "auto" ? (
                    <Badge variant="outline" className="text-[9px]">
                      採用軸: {MAIN_STYLE_LABELS[proposal.effectiveStyle]}
                    </Badge>
                  ) : null}
                  {proposal.selectedTags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[9px]">
                      {FEATURE_TAG_LABELS[tag]}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button onClick={applyProposal} size="sm" variant="outline">
                下書きに反映
              </Button>
            </div>

            <Section label="デッキコンセプト">
              <p>{proposal.deckConceptJa}</p>
            </Section>

            <Section label="Leader Style Aptitude 理由">
              <p>{proposal.styleAptitudeReasonJa}</p>
            </Section>

            <Section label="勝ち筋">
              <p>{proposal.winCondition}</p>
            </Section>

            <Section label="キーカード">
              <div className="flex flex-wrap gap-1">
                {proposal.keyCards.map((cardId) => (
                  <Badge key={cardId} variant="outline" className="text-[9px]">
                    {poolById.get(cardId)?.name ?? cardId}
                  </Badge>
                ))}
              </div>
            </Section>

            {proposal.majorCombos.length > 0 ? (
              <Section label="主要コンボ">
                <ul className="space-y-1.5">
                  {proposal.majorCombos.map((combo, index) => (
                    <li key={`${combo.titleJa}-${index}`}>
                      <strong>{combo.titleJa}</strong>
                      <span className="text-muted-foreground ml-1 font-mono text-[9px]">
                        {combo.cardIds.join(" + ")}
                      </span>
                      <p>{combo.explanationJa}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            <Section label="コストカーブ方針">
              <p>{proposal.curveExplanationJa}</p>
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <Section label="強み">
                <Bullets items={proposal.strengths} />
              </Section>
              <Section label="弱み">
                <Bullets items={proposal.weaknesses} />
              </Section>
            </div>

            {proposal.favorable.length + proposal.unfavorable.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                <Section label="相性◯">
                  <Bullets items={proposal.favorable} />
                </Section>
                <Section label="相性✕">
                  <Bullets items={proposal.unfavorable} />
                </Section>
              </div>
            ) : null}

            <Section label={`提案デッキ (${proposal.cards.length} 種 / ${proposal.cards.reduce((a, b) => a + b.count, 0)} 枚)`}>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {proposal.cards.map((c) => {
                  const card = poolById.get(c.cardId);
                  return (
                    <li
                      key={c.cardId}
                      className={cn(
                        "border-border/30 bg-background/40 flex items-center gap-2 rounded-md border p-1.5",
                        !card && "border-destructive/60 text-destructive",
                      )}
                    >
                      <div className="border-border/30 bg-card/60 relative aspect-[3/4] w-7 shrink-0 overflow-hidden rounded-sm border">
                        {card?.imageUrlJp ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={proxiedCardImage(card.imageUrlJp)!}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-muted-foreground font-mono text-[9px]">
                          {c.cardId} ×{c.count}
                        </div>
                        {card ? (
                          <div className="truncate text-[10px]">{card.name}</div>
                        ) : null}
                        <div className="text-primary text-[9px]">{c.roleJa}</div>
                        <p className="text-muted-foreground mt-0.5 text-[9px] leading-snug">
                          {c.selectionReasonJa}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>

            <Section label="Deterministic Metrics">
              <div className="grid grid-cols-2 gap-2">
                <MetricList title="Cost Curve" values={proposal.metrics.costCurve} />
                <MetricList
                  title="Counter"
                  values={proposal.metrics.counterDistribution}
                />
              </div>
              <p className="mt-1">
                Trigger ratio: {(proposal.metrics.triggerRatio * 100).toFixed(1)}%
              </p>
              <p className="mt-1">
                Evaluation: {Object.entries(proposal.metrics.evaluationScores)
                  .map(([key, value]) => `${key} ${value}`)
                  .join(" / ")}
              </p>
              <p className="mt-1">
                Major mechanics: {proposal.metrics.majorMechanics
                  .map(({ mechanic, count }) => `${mechanic}×${count}`)
                  .join(" / ") || "なし"}
              </p>
            </Section>

            {proposal.warnings.length > 0 ? (
              <div className="text-source-unverified text-[10px]">
                ⚠ {proposal.warnings.join(" / ")}
              </div>
            ) : null}

            <p className="text-muted-foreground text-[10px]">
              モデル: <code className="font-mono">{proposal.modelVersion}</code>
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-[10px] tracking-widest uppercase">
        {label}
      </div>
      <div className="text-foreground/90 leading-relaxed">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">(なし)</span>;
  return (
    <ul className="list-inside list-disc space-y-0.5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function MetricList({
  title,
  values,
}: {
  title: string;
  values: Record<string, number>;
}) {
  return (
    <div>
      <strong className="text-[10px]">{title}</strong>
      <p className="text-muted-foreground font-mono text-[9px]">
        {Object.entries(values)
          .map(([key, value]) => `${key}:${value}`)
          .join(" / ")}
      </p>
    </div>
  );
}

function renderStars(stars: number | undefined): string {
  if (!stars) return "☆☆☆☆☆";
  return `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
}
