"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  ChevronDown,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  DeckCoachCardRef,
  DeckCoachGuideView,
} from "@/lib/deck-coach-schema";

interface DeckCoachSectionProps {
  deckId: string;
  deckLegal: boolean;
  guide: DeckCoachGuideView | null;
}

interface ApiError {
  error: string;
  detail?: string;
}

export function DeckCoachSection({
  deckId,
  deckLegal,
  guide,
}: DeckCoachSectionProps) {
  const [current, setCurrent] = useState(guide);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, startTransition] = useTransition();

  async function generate() {
    setError(null);
    const response = await fetch(
      `/api/ai/deck-coach/${encodeURIComponent(deckId)}`,
      { method: "POST" },
    );
    if (!response.ok) {
      setError(
        (await response.json().catch(() => ({
          error: "unknown_error",
        }))) as ApiError,
      );
      return;
    }
    const data = (await response.json()) as { guide: DeckCoachGuideView };
    setCurrent(data.guide);
    setOpen(false);
  }

  const coach = current?.guide;
  const generatedAt = current?.updatedAt ?? current?.generatedAt;
  const generationBlocked = !deckLegal || Boolean(current?.generationBlockedReason);

  return (
    <Card
      className={
        current
          ? "border-primary/30 bg-card/40"
          : "border-dashed border-border/40 bg-card/20"
      }
    >
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display flex items-center gap-2 text-sm tracking-wide">
                <BookOpenCheck className="size-4 text-primary" />
                Deck Coach
              </h2>
              <Badge variant="outline" className="text-[10px]">
                easy
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                AI戦術解説
              </Badge>
              {current?.stale ? (
                <Badge
                  variant="outline"
                  className="border-amber-400/50 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
                >
                  再生成推奨
                </Badge>
              ) : null}
            </div>
            {generatedAt ? (
              <p className="text-muted-foreground text-[10px]">
                更新: <time dateTime={generatedAt}>{formatDate(generatedAt)}</time>
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            size="sm"
            variant={current ? "outline" : "default"}
            onClick={() => startTransition(generate)}
            disabled={pending || generationBlocked}
          >
            {pending ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : current ? (
              <RefreshCw className="size-4" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {pending ? "生成中" : current ? "再生成" : "生成"}
          </Button>
        </div>

        {current?.stale ? (
          <Notice>
            元データが更新されています。現在のカード事実・制限・デッキ内容で再生成をおすすめします。
          </Notice>
        ) : null}
        {current?.generationBlockedReason ? (
          <Notice>{current.generationBlockedReason}</Notice>
        ) : !deckLegal ? (
          <Notice>
            Deck Coachは、現在の公式構築条件を満たす50枚デッキだけ生成できます。
          </Notice>
        ) : null}
        {error ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive flex gap-2 rounded-md border p-3 text-xs leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <strong className="block">{errorLabel(error.error)}</strong>
              {error.detail ? <p className="opacity-90">{error.detail}</p> : null}
            </div>
          </div>
        ) : null}

        {coach && current ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <CoachBlock label="このデッキはどんなデッキ？" accent="leader">
                <Badge variant="secondary" className="mb-2 text-[10px]">
                  {coach.archetypeJa}
                </Badge>
                <p>{coach.deckSummaryJa}</p>
              </CoachBlock>
              <CoachList
                label="勝ち筋"
                items={coach.winConditionsJa}
                accent="tempo"
              />
              <CoachBlock label="主要カード" accent="resource">
                <div className="space-y-2">
                  {coach.keyCards.map((entry) => (
                    <div key={entry.cardId}>
                      <CardLink cardId={entry.cardId} refs={current.cardRefs} />
                      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                        {entry.roleJa}
                      </p>
                    </div>
                  ))}
                </div>
              </CoachBlock>
              <CoachBlock label="マリガン基準" accent="defense">
                <Mulligan guide={current} />
              </CoachBlock>
            </div>

            <section className="border-border/30 space-y-3 border-t pt-4">
              <h3 className="text-primary text-xs tracking-widest uppercase">
                先攻 / 後攻の基本方針
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                <PlanColumn title="先攻" items={coach.firstPlayerPlan} />
                <PlanColumn title="後攻" items={coach.secondPlayerPlan} />
              </div>
            </section>

            <div className="border-border/30 border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-between px-2"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
              >
                <span>もっと詳しく見る</span>
                <ChevronDown
                  className="size-4 transition-transform"
                  style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </Button>
              {open ? <DeckCoachDetails guide={current} /> : null}
            </div>

            <p className="text-muted-foreground text-[10px]">
              モデル: <code className="font-mono">{current.aiModelVersion}</code>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Deck Coachはまだありません。合法な50枚デッキなら、初心者向けの使い方ガイドを生成できます。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DeckCoachDetails({ guide }: { guide: DeckCoachGuideView }) {
  const coach = guide.guide;
  return (
    <div className="space-y-6 px-1 py-3">
      <DetailSection title="理想初手">
        <BulletList items={coach.idealOpeningJa} />
      </DetailSection>

      <DetailSection title="DON!!数別の基本行動">
        <div className="space-y-2">
          {coach.donPlan.map((entry) => (
            <div
              key={entry.donCount}
              className="border-border/30 bg-background/35 rounded-md border p-3"
            >
              <Badge variant="secondary" className="font-mono">
                DON!! {entry.donCount}
              </Badge>
              <p className="mt-2 text-sm leading-relaxed">{entry.actionJa}</p>
              <CardChips cardIds={entry.referencedCardIds} refs={guide.cardRefs} />
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection title="主要コンボ">
        {coach.combos.length > 0 ? (
          <div className="space-y-3">
            {coach.combos.map((combo) => (
              <div
                key={`${combo.titleJa}:${combo.cardIds.join(":")}`}
                className="border-border/30 bg-background/35 rounded-md border p-3"
              >
                <h4 className="text-sm font-semibold">{combo.titleJa}</h4>
                <CardChips cardIds={combo.cardIds} refs={guide.cardRefs} />
                <ol className="text-muted-foreground mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed">
                  {combo.stepsJa.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="mt-2 text-xs leading-relaxed">{combo.purposeJa}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine>主要コンボはまだありません。</EmptyLine>
        )}
      </DetailSection>

      <DetailSection title="Plan A / Plan B / Plan C">
        <div className="grid gap-2 md:grid-cols-3">
          <PlanCard title="Plan A">{coach.plans.planAJa}</PlanCard>
          <PlanCard title="Plan B">{coach.plans.planBJa}</PlanCard>
          <PlanCard title="Plan C">{coach.plans.planCJa}</PlanCard>
        </div>
      </DetailSection>

      <DetailSection title="フィニッシュ方法">
        <BulletList items={coach.finishMethodsJa} />
      </DetailSection>
      <DetailSection title="苦手な盤面">
        <BulletList items={coach.weakBoardsJa} />
      </DetailSection>
      <DetailSection title="苦手な対面">
        <BulletList items={coach.weakMatchupsJa} />
      </DetailSection>
      <DetailSection title="よくあるプレイミス">
        <BulletList items={coach.commonMistakesJa} />
      </DetailSection>
    </div>
  );
}

function Mulligan({ guide }: { guide: DeckCoachGuideView }) {
  const mulligan = guide.guide.mulligan;
  return (
    <div className="space-y-2">
      <MulliganGroup
        label="優先してキープ"
        ids={mulligan.keepCardIds}
        refs={guide.cardRefs}
      />
      <MulliganGroup
        label="手札しだい"
        ids={mulligan.flexibleCardIds}
        refs={guide.cardRefs}
      />
      <MulliganGroup
        label="戻す候補"
        ids={mulligan.returnCardIds}
        refs={guide.cardRefs}
      />
      <p className="text-muted-foreground text-xs leading-relaxed">
        {mulligan.explanationJa}
      </p>
    </div>
  );
}

function MulliganGroup({
  label,
  ids,
  refs,
}: {
  label: string;
  ids: string[];
  refs: Record<string, DeckCoachCardRef>;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-[10px] tracking-widest uppercase">
        {label}
      </p>
      {ids.length > 0 ? (
        <CardChips cardIds={ids} refs={refs} compact />
      ) : (
        <p className="text-muted-foreground text-xs">なし</p>
      )}
    </div>
  );
}

function CoachBlock({
  label,
  accent,
  children,
}: {
  label: string;
  accent: Accent;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-md border-l-2 pl-3 ${accentClass(accent)}`}>
      <h3 className="text-muted-foreground mb-2 text-[10px] tracking-widest uppercase">
        {label}
      </h3>
      <div className="text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

function CoachList({
  label,
  items,
  accent,
}: {
  label: string;
  items: string[];
  accent: Accent;
}) {
  return (
    <CoachBlock label={label} accent={accent}>
      <BulletList items={items} />
    </CoachBlock>
  );
}

function PlanColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="border-border/30 bg-background/35 rounded-md border p-3">
      <Badge variant="secondary">{title}</Badge>
      <BulletList items={items} className="mt-2" />
    </div>
  );
}

function PlanCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-border/30 rounded-md border p-3">
      <Badge variant="outline">{title}</Badge>
      <p className="mt-2 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-primary text-xs tracking-widest uppercase">{title}</h3>
      {children}
    </section>
  );
}

function BulletList({ items, className = "" }: { items: string[]; className?: string }) {
  return (
    <ul className={`list-disc space-y-1 pl-4 text-sm leading-relaxed ${className}`}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function CardLink({
  cardId,
  refs,
}: {
  cardId: string;
  refs: Record<string, DeckCoachCardRef>;
}) {
  const card = refs[cardId];
  return (
    <Link href={`/cards/${cardId}`} className="hover:text-primary transition">
      <span className="font-semibold">{card?.name ?? cardId}</span>
      <span className="text-muted-foreground ml-1 font-mono text-[10px]">
        {cardId}
      </span>
    </Link>
  );
}

function CardChips({
  cardIds,
  refs,
  compact = false,
}: {
  cardIds: string[];
  refs: Record<string, DeckCoachCardRef>;
  compact?: boolean;
}) {
  if (cardIds.length === 0) return null;
  return (
    <div className={compact ? "mt-1 flex flex-wrap gap-1" : "mt-2 flex flex-wrap gap-1.5"}>
      {cardIds.map((cardId) => (
        <Link
          key={cardId}
          href={`/cards/${cardId}`}
          className="border-border/40 bg-background/60 hover:border-primary/40 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition"
        >
          <span className="truncate">{refs[cardId]?.name ?? cardId}</span>
          <span className="text-muted-foreground font-mono">{cardId}</span>
        </Link>
      ))}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="border-amber-400/40 bg-amber-500/10 flex gap-2 rounded-md border p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs leading-relaxed">{children}</p>;
}

type Accent = "leader" | "tempo" | "resource" | "defense";

function accentClass(accent: Accent): string {
  if (accent === "leader") return "border-amber-400/40";
  if (accent === "tempo") return "border-orange-400/40";
  if (accent === "resource") return "border-emerald-400/40";
  return "border-sky-400/40";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function errorLabel(error: string): string {
  if (error === "missing_api_key") return "AIキーが未設定です";
  if (error === "deck_not_found") return "保存デッキが見つかりません";
  if (error === "illegal_deck") return "現在のルールでは合法ではありません";
  if (error === "restrictions_unavailable") return "制限情報を確認できません";
  if (error === "unknown_card_id") return "不明なカードIDがあります";
  if (error === "unverified_card_facts") return "公式確認済みデータが必要です";
  if (error === "deck_coach_validation_failed") return "AI出力の検証に失敗しました";
  return "Deck Coachの生成に失敗しました";
}
