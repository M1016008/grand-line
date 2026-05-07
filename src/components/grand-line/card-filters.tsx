"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const COLORS = [
  { value: "red", label: "赤" },
  { value: "green", label: "緑" },
  { value: "blue", label: "青" },
  { value: "purple", label: "紫" },
  { value: "black", label: "黒" },
  { value: "yellow", label: "黄" },
];

const TYPES = [
  { value: "LEADER", label: "リーダー" },
  { value: "CHARACTER", label: "キャラ" },
  { value: "EVENT", label: "イベント" },
  { value: "STAGE", label: "ステージ" },
];

const COSTS = ["0", "1", "2", "3", "4", "5", "6", "7", "8+"];

export function CardFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.push(`/cards?${next.toString()}`));
  }

  function reset() {
    startTransition(() => router.push("/cards"));
  }

  return (
    <div className="border-border/40 bg-card/40 rounded-lg border p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <Input
          name="text"
          defaultValue={params.get("text") ?? ""}
          placeholder="カード名・特徴で検索"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              update({ text: (e.target as HTMLInputElement).value });
            }
          }}
        />
        <Select
          value={params.get("cardType") ?? "all"}
          onValueChange={(v) => update({ cardType: v })}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="種類" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            {TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          name="feature"
          defaultValue={params.get("feature") ?? ""}
          placeholder="特徴 (麦わらの一味…)"
          className="w-48"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              update({ feature: (e.target as HTMLInputElement).value });
            }
          }}
        />
        <Button variant="outline" onClick={reset} disabled={pending}>
          リセット
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-xs tracking-wider uppercase">
          色
        </span>
        <ToggleGroup
          type="single"
          value={params.get("color") ?? ""}
          onValueChange={(v) => update({ color: v || undefined })}
          variant="outline"
          size="sm"
        >
          {COLORS.map((c) => (
            <ToggleGroupItem key={c.value} value={c.value}>
              {c.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <span className="text-muted-foreground ml-3 text-xs tracking-wider uppercase">
          コスト
        </span>
        <ToggleGroup
          type="single"
          value={params.get("cost") ?? ""}
          onValueChange={(v) => update({ cost: v || undefined })}
          variant="outline"
          size="sm"
        >
          {COSTS.map((c) => (
            <ToggleGroupItem key={c} value={c} className="font-mono text-xs">
              {c}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
