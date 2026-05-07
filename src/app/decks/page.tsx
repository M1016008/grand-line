import Link from "next/link";

import { SiteHeader } from "@/components/grand-line/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function DecksIndexPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-3xl tracking-wide">デッキ</h1>
          <Button asChild>
            <Link href="/decks/new">+ 新しいデッキ</Link>
          </Button>
        </div>

        <Card className="border-border/40 bg-card/40">
          <CardContent className="space-y-2 p-6 text-sm">
            <p className="text-muted-foreground">
              Phase 2 ではローカル下書きのみサポート (
              <code className="font-mono text-xs">localStorage</code>{" "}
              に保存)。Phase 4 で AI 提案デッキの保存に拡張予定。
            </p>
            <p className="text-muted-foreground">
              <Link href="/decks/new" className="text-primary underline">
                リーダーを選んで構築を始める →
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
