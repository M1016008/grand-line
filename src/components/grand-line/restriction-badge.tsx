/**
 * Visual signal for Bandai's banned/restricted card list.
 *
 *  max_copies = 0  → 禁止 (red)
 *  max_copies = 1  → 制限 1 (yellow)
 *  max_copies = 2  → 制限 2 (yellow)
 *  max_copies = 3  → 制限 3 (yellow)
 *  null            → no badge rendered
 *
 * Always uses the same colour family as other "warning"-class chips so
 * the user reads it as an authoritative gameplay constraint, not a soft
 * suggestion.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface RestrictionBadgeProps {
  maxCopies: number;
  effectiveFrom?: string | null;
  className?: string;
  /** Smaller variant for thumbnails. */
  size?: "sm" | "md";
}

export function RestrictionBadge({
  maxCopies,
  effectiveFrom,
  className,
  size = "md",
}: RestrictionBadgeProps) {
  const banned = maxCopies === 0;
  const label = banned ? "禁止" : `制限 ${maxCopies}枚`;
  const tooltip = banned
    ? "デッキに 1 枚も入れられません (バンダイ公式 禁止カード)"
    : `デッキに ${maxCopies} 枚まで (バンダイ公式 制限カード)`;
  const dateLine = effectiveFrom ? `${effectiveFrom} ~` : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border font-semibold tracking-wider uppercase",
            size === "sm"
              ? "px-1.5 py-0 text-[9px]"
              : "px-2 py-0.5 text-[11px]",
            banned
              ? "border-destructive/60 bg-destructive/15 text-destructive"
              : "border-source-unverified/60 bg-source-unverified/15 text-source-unverified",
            className,
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs">
        <div>{tooltip}</div>
        {dateLine ? <div className="text-muted-foreground mt-0.5">{dateLine}</div> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export interface PairBanBadgeProps {
  partnerId: string;
  partnerName?: string;
  className?: string;
  size?: "sm" | "md";
}

export function PairBanBadge({
  partnerId,
  partnerName,
  className,
  size = "md",
}: PairBanBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "border-destructive/40 bg-destructive/10 text-destructive inline-flex items-center gap-1 rounded-full border font-medium",
            size === "sm" ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[11px]",
            className,
          )}
        >
          禁止ペア
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {partnerName ?? partnerId} と同じデッキで使用不可
      </TooltipContent>
    </Tooltip>
  );
}
