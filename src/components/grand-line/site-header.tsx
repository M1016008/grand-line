"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type MainNavItem = {
  href: `/${string}`;
  label: string;
  matchPrefixes: `/${string}`[];
};

const PRIMARY_NAV: MainNavItem[] = [
  { href: "/decks", label: "デッキ", matchPrefixes: ["/decks"] },
  { href: "/cards", label: "カード", matchPrefixes: ["/cards"] },
  { href: "/battle", label: "CPU対戦", matchPrefixes: ["/battle"] },
  { href: "/practice", label: "検証", matchPrefixes: ["/practice"] },
];

const DATA_NAV: { href: `/${string}`; label: string }[] = [
  { href: "/sets", label: "セット" },
  { href: "/synergy", label: "シナジー" },
  { href: "/regulations", label: "禁止/制限" },
];

export function isNavigationPathActive(
  pathname: string,
  href: `/${string}`,
): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();

  const isActive = (item: MainNavItem) =>
    item.matchPrefixes.some((prefix) =>
      isNavigationPathActive(pathname, prefix),
    );

  const isDataItemActive = (href: `/${string}`) =>
    isNavigationPathActive(pathname, href);

  const isDataActive = DATA_NAV.some((item) => isDataItemActive(item.href));

  return (
    <header className="border-border/40 sticky top-0 z-30 w-full border-b backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex shrink-0 items-baseline gap-2">
          <span className="font-display text-primary text-xl font-semibold tracking-[0.18em]">
            GRAND LINE
          </span>
          <span className="text-muted-foreground hidden text-xs tracking-widest sm:inline">
            ONE PIECE TCG COMPASS
          </span>
        </Link>
        <nav
          className="flex min-w-0 flex-1 items-center gap-1 text-sm"
          aria-label="グローバルナビゲーション"
        >
          <div
            data-primary-navigation-scroll
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          >
            {PRIMARY_NAV.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "hover:bg-accent/50 hover:text-foreground shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 transition",
                    active
                      ? "text-foreground bg-accent/40 font-semibold"
                      : "text-muted-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <details data-data-navigation-menu className="relative shrink-0">
            <summary
              className={cn(
                "hover:bg-accent/50 hover:text-foreground list-none cursor-pointer shrink-0 rounded-md px-3 py-1.5 text-muted-foreground transition",
                isDataActive ? "text-foreground bg-accent/40 font-semibold" : "",
              )}
              aria-current={isDataActive ? "page" : undefined}
            >
              データ
            </summary>
            <div className="bg-background border-border/40 absolute top-full right-0 z-20 mt-1 min-w-40 rounded-md border p-1 shadow-lg">
              {DATA_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "hover:bg-accent/50 block rounded-sm px-3 py-1.5 text-sm transition",
                    isDataItemActive(item.href)
                      ? "bg-accent/40 font-semibold"
                      : "text-muted-foreground",
                  )}
                  aria-current={isDataItemActive(item.href) ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        </nav>
      </div>
    </header>
  );
}
