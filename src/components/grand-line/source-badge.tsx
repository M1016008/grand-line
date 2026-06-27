/**
 * SourceBadge — visual signal of where a piece of card text came from and
 * whether a human has signed off on it. This is the UI half of the
 * hallucination-honesty contract enforced by `card_translations.source` /
 * `verified` in the schema.
 */
import { cn } from "@/lib/utils";
import type { CardTranslationSource } from "@/db/schema";

interface SourceBadgeProps {
  source: CardTranslationSource;
  verified: boolean;
  className?: string;
}

const PRESETS: Record<
  CardTranslationSource,
  { label: string; tone: string; tooltip: string }
> = {
  official_jp: {
    label: "公式 JP",
    tone: "border-source-verified/40 text-source-verified bg-source-verified/10",
    tooltip: "バンダイ公式 (日本語) のカードリストから取得した一次情報。",
  },
  official_en: {
    label: "Official EN",
    tone: "border-source-verified/40 text-source-verified bg-source-verified/10",
    tooltip: "Bandai official English source.",
  },
  ai_translated: {
    label: "AI 翻訳",
    tone: "border-source-ai/40 text-source-ai bg-source-ai/10",
    tooltip:
      "Claude による翻訳。一次ソースで未確認のため誤りが含まれる可能性があります。",
  },
  manual: {
    label: "手入力",
    tone: "border-source-unverified/40 text-source-unverified bg-source-unverified/10",
    tooltip: "Yoshio が手動で入力した暫定データ。",
  },
};

export function SourceBadge({ source, verified, className }: SourceBadgeProps) {
  const preset = PRESETS[source];
  const verifiedSuffix = verified ? " · ✓" : " · 未確認";
  const label = `${preset.label}${verifiedSuffix}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        preset.tone,
        className,
      )}
      title={preset.tooltip}
      aria-label={`${label}: ${preset.tooltip}`}
    >
      {preset.label}
      <span className="opacity-70">{verifiedSuffix}</span>
    </span>
  );
}
