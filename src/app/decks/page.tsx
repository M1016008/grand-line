import Link from "next/link";

import { ColorChip } from "@/components/grand-line/color-chip";
import { SiteHeader } from "@/components/grand-line/site-header";
import { SourceBadge } from "@/components/grand-line/source-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listSavedDecks, type SavedDeckSummary } from "@/lib/saved-decks";

export const dynamic = "force-dynamic";

export default async function DecksIndexPage() {
  const { decks, needsMigration } = await loadDecks();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
              保存デッキ
            </p>
            <h1 className="font-display text-3xl tracking-wide">保存デッキ</h1>
          </div>
          <Button asChild>
            <Link href="/decks/new">新しいデッキ</Link>
          </Button>
        </div>

        {needsMigration ? (
          <Card className="border-source-unverified/40 bg-source-unverified/10">
            <CardContent className="p-4 text-sm">
              The deck tables are not available yet. Run the Drizzle migrations,
              then return here to save decks.
            </CardContent>
          </Card>
        ) : null}

        {decks.length > 0 ? (
          <ul className="grid gap-3">
            {decks.map((deck) => (
              <li key={deck.id}>
                <Card className="border-border/40 bg-card/40">
                  <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/decks/${deck.id}`} className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-xl tracking-wide">
                          {deck.name}
                        </span>
                        <Badge variant="outline">{deck.totalCards}/50</Badge>
                      </div>
                      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono">{deck.leader.id}</span>
                        <span>{deck.leader.name}</span>
                        {deck.leader.colors.map((color) => (
                          <ColorChip key={color} color={color} />
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <SourceBadge
                          source={deck.leader.source}
                          verified={deck.leader.verified}
                        />
                        <span className="text-muted-foreground text-xs">
                          Updated {formatDate(deck.updatedAt)}
                        </span>
                      </div>
                    </Link>
                    <div className="flex shrink-0 gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/decks/${deck.id}`}>開く</Link>
                      </Button>
                      <Button asChild size="sm">
                        <a
                          href={`/api/decks/${deck.id}/print?includeLeader=1`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          印刷用PDF
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="border-border/40 bg-card/40">
            <CardContent className="space-y-3 p-6 text-sm">
              <p className="text-muted-foreground">
                まだ保存デッキがありません。まず合法な50枚を作って保存し、ここからPDFを作成できます。
              </p>
              <Button asChild variant="outline">
                <Link href="/decks/new">リーダーを選ぶ</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

async function loadDecks(): Promise<{
  decks: SavedDeckSummary[];
  needsMigration: boolean;
}> {
  try {
    return { decks: await listSavedDecks(), needsMigration: false };
  } catch (err) {
    if (isMissingDeckTableError(err)) {
      return { decks: [], needsMigration: true };
    }
    throw err;
  }
}

function isMissingDeckTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such table: decks|no such table: deck_cards/i.test(message);
}

function formatDate(value: Date | number | string): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value < 10_000_000_000 ? value * 1000 : value)
        : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("ja-JP");
}
