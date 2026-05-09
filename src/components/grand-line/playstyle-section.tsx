import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CardPlaystyle } from "@/lib/playstyle";

interface PlaystyleSectionProps {
  playstyle: CardPlaystyle | null;
}

/**
 * Always-visible "このカードの使い方" panel — three short paragraphs
 * authored by Claude in grade-school-friendly Japanese. Shown above the
 * Top 5 collapsible so it's the first thing the player reads when
 * landing on a card detail page.
 */
export function PlaystyleSection({ playstyle }: PlaystyleSectionProps) {
  if (!playstyle) {
    return (
      <Card className="border-dashed border-border/40 bg-card/20">
        <CardContent className="text-muted-foreground p-4 text-xs leading-relaxed">
          このカードの使い方ガイドはまだ生成されていません。
          <code className="font-mono text-[10px]"> npm run ai:playstyle -- --card …</code>
          で生成できます。
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-card/40">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm tracking-wide">このカードの使い方</h2>
          <Badge variant="outline" className="text-[10px]">
            AI 解釈 · 小学生向け
          </Badge>
        </div>

        <Block label="いつ使う？" body={playstyle.whenToPlayJa} accent="leader" />
        <Block label="どこで強い？" body={playstyle.shinesInJa} accent="tempo" />
        <Block label="対戦中の使い方" body={playstyle.vsOpponentJa} accent="defense" />
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
