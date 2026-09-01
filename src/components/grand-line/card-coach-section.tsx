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
import type { CardCoachGuideView } from "@/lib/card-coach-schema";
import { proxiedCardImage } from "@/lib/img";

interface CardCoachSectionProps {
  cardId: string;
  guide: CardCoachGuideView | null;
}

interface ApiError {
  error: string;
  detail?: string;
}

export function CardCoachSection({ cardId, guide }: CardCoachSectionProps) {
  const [current, setCurrent] = useState(guide);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, startTransition] = useTransition();

  async function generate() {
    setError(null);
    const res = await fetch(`/api/ai/card-coach/${encodeURIComponent(cardId)}`, {
      method: "POST",
    });

    if (!res.ok) {
      setError((await res.json().catch(() => ({ error: "unknown_error" }))) as ApiError);
      return;
    }

    const data = (await res.json()) as { guide: CardCoachGuideView };
    setCurrent(data.guide);
    setOpen(false);
  }

  const coach = current?.guide;
  const generatedAt = current?.updatedAt ?? current?.generatedAt;

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
                Card Coach
              </h2>
              <Badge variant="outline" className="text-[10px]">
                easy
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {current?.source === "playstyle_fallback"
                  ? "旧ガイド"
                  : "AI解説"}
              </Badge>
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
            variant={current?.source === "card_coach" ? "outline" : "default"}
            onClick={() => startTransition(generate)}
            disabled={pending}
          >
            {pending ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : current?.source === "card_coach" ? (
              <RefreshCw className="size-4" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {pending ? "生成中" : current?.source === "card_coach" ? "再生成" : "生成"}
          </Button>
        </div>

        {error ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive flex gap-2 rounded-md border p-3 text-xs leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <strong className="block">{errorLabel(error.error)}</strong>
              {error.detail ? <p className="opacity-90">{error.detail}</p> : null}
            </div>
          </div>
        ) : null}

        {coach ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <CoachBlock
                label="このカードは何をするカード？"
                body={coach.summaryJa}
                accent="leader"
              />
              <CoachBlock
                label="このカードの役割"
                body={coach.purposeJa}
                chips={coach.roles}
                accent="tempo"
              />
              <CoachList
                label="いつ使う？"
                items={coach.timing}
                accent="resource"
              />
              <CoachList
                label="どんな場面で強い？"
                items={coach.strongSituations}
                accent="defense"
              />
            </div>

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

              {open ? <Details guide={current} /> : null}
            </div>

            <p className="text-muted-foreground text-[10px]">
              モデル: <code className="font-mono">{current.aiModelVersion}</code>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Card Coach はまだありません。公式確認済みカードなら、初心者向けの使い方ガイドを生成できます。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Details({ guide }: { guide: CardCoachGuideView }) {
  const coach = guide.guide;

  return (
    <div className="space-y-5 px-1 py-3">
      <DetailSection title="用語解説">
        {coach.terms.length > 0 ? (
          <div className="space-y-2">
            {coach.terms.map((term) => (
              <p
                key={`${term.term}:${term.explanationJa}`}
                className="text-sm leading-relaxed"
              >
                <span className="font-semibold">{term.term}</span>
                <span className="text-muted-foreground"> — {term.explanationJa}</span>
              </p>
            ))}
          </div>
        ) : (
          <EmptyLine>追加の用語解説はありません。</EmptyLine>
        )}
      </DetailSection>

      <DetailSection title="相性の良いカード">
        {coach.compatibleCards.length > 0 ? (
          <ol className="space-y-2">
            {coach.compatibleCards.map((entry) => (
              <li
                key={entry.cardId}
                className="border-border/30 bg-background/35 rounded-md border p-2"
              >
                <CardRefLine cardId={entry.cardId} guide={guide} />
                <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                  {entry.reasonJa}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyLine>このガイドでは相性カード候補はありません。</EmptyLine>
        )}
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
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {combo.cardIds.map((comboCardId) => (
                    <CardChip
                      key={comboCardId}
                      cardId={comboCardId}
                      guide={guide}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-foreground/80">
                  {combo.whyJa}
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                  {combo.stepsJa.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine>主要コンボはまだありません。</EmptyLine>
        )}
      </DetailSection>

      <DetailSection title="実戦での使用例">
        <p className="text-sm leading-relaxed text-foreground/85">{coach.exampleJa}</p>
      </DetailSection>

      <DetailSection title="DON!!数を含むプレイルート">
        {coach.playRoutes.length > 0 ? (
          <div className="space-y-2">
            {coach.playRoutes.map((route) => (
              <div
                key={`${route.donCount}:${route.titleJa}`}
                className="border-border/30 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="font-mono">
                    DON!! {route.donCount}
                  </Badge>
                  <h4 className="text-sm font-semibold">{route.titleJa}</h4>
                </div>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                  {route.stepsJa.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine>プレイルートはまだありません。</EmptyLine>
        )}
      </DetailSection>

      <DetailSection title="引けなかった時の代替案">
        <p className="text-sm leading-relaxed text-foreground/85">
          {coach.fallbackPlanJa}
        </p>
      </DetailSection>

      <DetailSection title="よくある使い方のミス">
        {coach.commonMistakesJa.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-foreground/85">
            {coach.commonMistakesJa.map((mistake) => (
              <li key={mistake}>{mistake}</li>
            ))}
          </ul>
        ) : (
          <EmptyLine>よくあるミスはまだありません。</EmptyLine>
        )}
      </DetailSection>
    </div>
  );
}

function CoachBlock({
  label,
  body,
  chips = [],
  accent,
}: {
  label: string;
  body: string;
  chips?: string[];
  accent: Accent;
}) {
  return (
    <div className={`rounded-md border-l-2 pl-3 ${accentClass(accent)}`}>
      <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
        {label}
      </div>
      {chips.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {chips.map((chip) => (
            <Badge key={chip} variant="secondary" className="text-[10px]">
              {chip}
            </Badge>
          ))}
        </div>
      ) : null}
      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{body}</p>
    </div>
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
    <div className={`rounded-md border-l-2 pl-3 ${accentClass(accent)}`}>
      <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
        {label}
      </div>
      <ul className="mt-1 space-y-1 text-sm leading-relaxed text-foreground/90">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-primary text-xs tracking-widest uppercase">{title}</h3>
      {children}
    </section>
  );
}

function CardRefLine({
  cardId,
  guide,
}: {
  cardId: string;
  guide: CardCoachGuideView;
}) {
  const ref = guide.cardRefs[cardId];
  const imageSrc = proxiedCardImage(ref?.imageUrlJp);

  return (
    <Link
      href={`/cards/${cardId}`}
      className="hover:text-primary flex min-w-0 items-center gap-2 transition"
    >
      <span className="border-border/40 bg-background/60 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded">
        {imageSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageSrc}
            alt={ref?.name ?? cardId}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-muted-foreground text-[10px]">ID</span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {ref?.name ?? cardId}
        </span>
        <span className="text-muted-foreground block font-mono text-[10px]">
          {cardId}
          {ref ? ` · ${ref.cardType}` : ""}
        </span>
      </span>
    </Link>
  );
}

function CardChip({
  cardId,
  guide,
}: {
  cardId: string;
  guide: CardCoachGuideView;
}) {
  const ref = guide.cardRefs[cardId];
  return (
    <Link
      href={`/cards/${cardId}`}
      className="border-border/40 bg-background/60 hover:border-primary/40 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition"
    >
      <span className="truncate">{ref?.name ?? cardId}</span>
      <span className="text-muted-foreground font-mono">{cardId}</span>
    </Link>
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
  if (error === "card_not_found") return "カードが見つかりません";
  if (error === "unverified_card_facts") return "公式確認済みデータが必要です";
  if (error === "card_coach_validation_failed") return "AI出力の検証に失敗しました";
  return "Card Coach の生成に失敗しました";
}
