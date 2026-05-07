import Link from "next/link";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/cards" as const, label: "カード" },
  { href: "/decks" as const, label: "デッキ" },
  { href: "/synergy" as const, label: "シナジー", soon: true },
  { href: "/probability" as const, label: "確率", soon: true },
  { href: "/tournaments" as const, label: "大会", soon: true },
];

export function SiteHeader() {
  return (
    <header className="border-border/40 sticky top-0 z-30 w-full border-b backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-primary text-xl font-semibold tracking-[0.18em]">
            GRAND LINE
          </span>
          <span className="text-muted-foreground hidden text-xs tracking-widest sm:inline">
            ONE PIECE TCG COMPASS
          </span>
        </Link>
        <nav className="flex flex-1 items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "hover:bg-accent/50 hover:text-foreground rounded-md px-3 py-1.5 transition",
                item.soon && "text-muted-foreground/50 pointer-events-none",
              )}
            >
              {item.label}
              {item.soon ? (
                <span className="ml-1 align-super text-[9px] tracking-wider opacity-70">
                  SOON
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
