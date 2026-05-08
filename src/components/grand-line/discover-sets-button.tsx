"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NewSet {
  setCode: string | null;
  seriesId: string;
  label: string;
}

interface UnresolvedSet {
  seriesId: string;
  label: string;
}

interface DiscoverResponse {
  fetchedAt: string;
  totalDropdownEntries: number;
  newSets: NewSet[];
  unresolved: UnresolvedSet[];
  inserted: number;
}

export function DiscoverSetsButton() {
  const [report, setReport] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrapedCodes, setScrapedCodes] = useState<Set<string>>(new Set());
  const [scrapingCode, setScrapingCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function runDiscover() {
    setError(null);
    setReport(null);
    setScrapedCodes(new Set());
    const res = await fetch("/api/admin/discover-sets", { method: "POST" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
      setError(j.detail ?? j.error ?? `HTTP ${res.status}`);
      return;
    }
    setReport((await res.json()) as DiscoverResponse);
  }

  async function scrapeOne(setCode: string) {
    setScrapingCode(setCode);
    try {
      const res = await fetch("/api/admin/scrape-set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setCode }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(`${setCode}: ${j.detail ?? "scrape failed"}`);
        return;
      }
      setScrapedCodes((prev) => new Set(prev).add(setCode));
    } finally {
      setScrapingCode(null);
    }
  }

  return (
    <Card className="border-primary/40 bg-card/50">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm tracking-wide">新弾チェック</h3>
            <p className="text-muted-foreground text-xs">
              バンダイ公式の cardlist ドロップダウンを再読み込みし、未取り込みのセットを検出します。
            </p>
          </div>
          <Button
            onClick={() => startTransition(runDiscover)}
            disabled={pending}
            size="sm"
          >
            {pending ? "確認中…" : "新弾チェック"}
          </Button>
        </div>

        {error ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-xs">
            {error}
          </div>
        ) : null}

        {report ? (
          <div className="space-y-2 text-xs">
            <p className="text-muted-foreground">
              ドロップダウン {report.totalDropdownEntries} 件 / 新規 {report.newSets.length} 件
              {report.inserted > 0 ? ` (${report.inserted} 件を scrape_targets に登録)` : ""}
              {report.unresolved.length > 0
                ? ` / コード解決不可 ${report.unresolved.length} 件`
                : ""}
            </p>

            {report.newSets.length === 0 && report.unresolved.length === 0 ? (
              <p className="text-foreground/80">最新です。新規セットはありません。</p>
            ) : null}

            {report.newSets.length > 0 ? (
              <ul className="space-y-1">
                {report.newSets.map((s) => {
                  const code = s.setCode!;
                  const scraped = scrapedCodes.has(code);
                  const busy = scrapingCode === code;
                  return (
                    <li
                      key={s.seriesId}
                      className="border-border/30 bg-background/40 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
                          {code} · series {s.seriesId}
                        </div>
                        <div className="text-foreground truncate text-sm">{s.label}</div>
                      </div>
                      {scraped ? (
                        <Badge variant="outline" className="border-source-verified/60 text-source-verified text-[10px]">
                          取り込み済み
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => scrapeOne(code)}
                          disabled={busy || scrapingCode !== null}
                        >
                          {busy ? "取り込み中…" : "取り込む"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {report.unresolved.length > 0 ? (
              <details className="text-muted-foreground">
                <summary className="cursor-pointer">コードが解決できなかったエントリ</summary>
                <ul className={cn("mt-1 space-y-0.5")}>
                  {report.unresolved.map((u) => (
                    <li key={u.seriesId} className="font-mono text-[10px]">
                      series {u.seriesId} — {u.label}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {scrapedCodes.size > 0 ? (
              <p className="text-muted-foreground">
                取り込みが完了したセットは <a href="/sets" className="underline">/sets</a> に反映されます (リロードしてください)。
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
