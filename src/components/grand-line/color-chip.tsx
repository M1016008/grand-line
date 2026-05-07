import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  red: "bg-tcg-red/20 text-tcg-red border-tcg-red/40",
  green: "bg-tcg-green/20 text-tcg-green border-tcg-green/40",
  blue: "bg-tcg-blue/20 text-tcg-blue border-tcg-blue/40",
  purple: "bg-tcg-purple/20 text-tcg-purple border-tcg-purple/40",
  black: "bg-tcg-black/30 text-tcg-yellow border-tcg-black/60",
  yellow: "bg-tcg-yellow/20 text-tcg-yellow border-tcg-yellow/40",
};

const LABEL: Record<string, string> = {
  red: "赤",
  green: "緑",
  blue: "青",
  purple: "紫",
  black: "黒",
  yellow: "黄",
};

export function ColorChip({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold",
        TONE[color] ?? "border-border/40 bg-muted text-muted-foreground",
        className,
      )}
      title={LABEL[color] ?? color}
    >
      {LABEL[color] ?? color.slice(0, 1).toUpperCase()}
    </span>
  );
}
