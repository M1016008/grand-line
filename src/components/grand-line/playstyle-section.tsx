"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CardPlaystyle } from "@/lib/playstyle";

interface PlaystyleSectionProps {
  cardId: string;
  playstyle: CardPlaystyle | null;
}

interface ApiError {
  error: string;
  detail?: string;
}

/**
 * Always-visible "このカードの使い方" panel — three short paragraphs
 * authored by Claude in grade-school-friendly Japanese. Shown above the
 * Top 5 collapsible so it's the first thing the player reads when
 * landing on a card detail page.
 */
export function PlaystyleSection({ cardId, playstyle }: PlaystyleSectionProps) {
  const [current, setCurrent] = useState(playstyle);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, startTransition] = useTransition();

  async function generate() {
    setError(null);
    const res = await fetch(`/api/ai/playstyle/${encodeURIComponent(cardId)}`, {
      method: "POST",
    });

    if (!res.ok) {
      setError((await res.json().catch(() => ({ error: "unknown_error" }))) as ApiError);
      return;
    }

    const data = (await res.json()) as { playstyle: CardPlaystyle };
    setCurrent(data.playstyle);
  }

  return (
    <Card className={current ? "border-primary/30 bg-card/40" : "border-dashed border-border/40 bg-card/20"}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm tracking-wide">このカードの使い方</h2>
              <Badge variant="outline" className="text-[10px]">
                AI ガイド
              </Badge>
            </div>
            {current?.generatedAt ? (
              <p className="text-muted-foreground text-[10px]">
                生成: <time dateTime={current.generatedAt}>{formatDate(current.generatedAt)}</time>
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            size="sm"
            variant={current ? "outline" : "default"}
            onClick={() => startTransition(generate)}
            disabled={pending}
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

        {error ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive flex gap-2 rounded-md border p-3 text-xs leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <strong className="block">{errorLabel(error.error)}</strong>
              {error.detail ? <p className="opacity-90">{error.detail}</p> : null}
            </div>
          </div>
        ) : null}

        {current ? (
          <>
            <Block label="いつ使う？" body={current.whenToPlayJa} accent="leader" />
            <Block label="どこで強い？" body={current.shinesInJa} accent="tempo" />
            <Block label="対戦中の使い方" body={current.vsOpponentJa} accent="defense" />
            <p className="text-muted-foreground text-[10px]">
              モデル: <code className="font-mono">{current.aiModelVersion}</code>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-xs leading-relaxed">
            このカードのガイドはまだありません。カード効果をもとに、使うタイミング、強い場面、対戦中の考え方を生成できます。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Block({
  label,
  body,
  accent,
}: {
  label: string;
  body: string;
  accent: "leader" | "tempo" | "defense";
}) {
  const accentClass =
    accent === "leader"
      ? "border-amber-400/40"
      : accent === "tempo"
        ? "border-orange-400/40"
        : "border-sky-400/40";
  return (
    <div className={`rounded-md border-l-2 pl-3 ${accentClass}`}>
      <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
        {label}
      </div>
      <p className="text-foreground/90 text-sm leading-relaxed">{body}</p>
    </div>
  );
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
  return "ガイド生成に失敗しました";
}
