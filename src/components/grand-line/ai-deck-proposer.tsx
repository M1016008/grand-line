"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CardListItem } from "@/lib/cards";
import { useDeckDraft } from "@/stores/deck";

interface AiDeckProposerProps {
  leader: CardListItem;
  pool: CardListItem[];
}

interface ProposalResponse {
  modelVersion: string;
  archetypeName: string;
  cards: Array<{ cardId: string; count: number }>;
  winCondition: string;
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

export function AiDeckProposer({ leader, pool }: AiDeckProposerProps) {
  const [preference, setPreference] = useState("");
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, startTransition] = useTransition();
  const replace = useDeckDraft((s) => s.replace);

  // Pool lookup so we can hydrate the AI's bare {cardId,count} into full cards.
  const poolById = new Map(pool.map((c) => [c.id, c]));

  async function fetchProposal() {
    setError(null);
    setProposal(null);
    const res = await fetch(`/api/ai/decks/${leader.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preference: preference.trim() || undefined }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as ApiError;
      setError(err);
      return;
    }
    const data = (await res.json()) as ProposalResponse;
    setProposal(data);
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
            AI に提案させる
          </h3>
          <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
            Phase 4 · Opus
          </span>
        </div>

        <div className="flex gap-2">
          <Input
            value={preference}
            onChange={(e) => setPreference(e.target.value)}
            placeholder="任意: 速攻寄り / 防御重視 / 対 OP01-001 等"
            maxLength={200}
            className="text-xs"
          />
          <Button
            onClick={() => startTransition(fetchProposal)}
            disabled={pending}
            size="sm"
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
              </div>
              <Button onClick={applyProposal} size="sm" variant="outline">
                下書きに反映
              </Button>
            </div>

            <Section label="勝ち筋">
              <p>{proposal.winCondition}</p>
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
              <div className="flex flex-wrap gap-1">
                {proposal.cards.map((c) => {
                  const card = poolById.get(c.cardId);
                  return (
                    <Badge
                      key={c.cardId}
                      variant="outline"
                      className={cn(
                        "font-mono text-[10px]",
                        !card && "border-destructive/60 text-destructive",
                      )}
                    >
                      {c.cardId}
                      <span className="text-muted-foreground ml-1">×{c.count}</span>
                      {card ? (
                        <span className="ml-1 max-w-32 truncate">{card.name}</span>
                      ) : null}
                    </Badge>
                  );
                })}
              </div>
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
