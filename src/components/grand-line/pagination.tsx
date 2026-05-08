import Link from "next/link";

import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  pageCount: number;
  basePath: string;
  /** Pre-built non-page query string, e.g. `text=foo&color=red`. */
  filterParams?: string;
  className?: string;
}

/**
 * Compact numeric pagination — first/prev/{window of 5}/next/last.
 *
 * Renders nothing when there's only one page so it doesn't clutter the
 * UI on niche filters. Uses plain anchors so the server route handler
 * gets the new `page=N` directly without client routing.
 */
export function Pagination({ page, pageCount, basePath, filterParams = "", className }: PaginationProps) {
  if (pageCount <= 1) return null;

  function href(p: number): string {
    const params = new URLSearchParams(filterParams);
    if (p === 1) params.delete("page");
    else params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  // 5-wide page window centered on the current page.
  const start = Math.max(1, page - 2);
  const end = Math.min(pageCount, start + 4);
  const window: number[] = [];
  for (let p = start; p <= end; p++) window.push(p);

  return (
    <nav
      className={cn("mt-2 flex items-center justify-center gap-1.5 text-sm", className)}
      aria-label="Pagination"
    >
      <PageLink href={href(1)} disabled={page === 1} title="最初">
        ‹‹
      </PageLink>
      <PageLink href={href(Math.max(1, page - 1))} disabled={page === 1} title="前">
        ‹
      </PageLink>
      {start > 1 ? <span className="text-muted-foreground px-1">…</span> : null}
      {window.map((p) => (
        <PageLink
          key={p}
          href={href(p)}
          active={p === page}
          title={`page ${p}`}
        >
          {p}
        </PageLink>
      ))}
      {end < pageCount ? <span className="text-muted-foreground px-1">…</span> : null}
      <PageLink
        href={href(Math.min(pageCount, page + 1))}
        disabled={page === pageCount}
        title="次"
      >
        ›
      </PageLink>
      <PageLink
        href={href(pageCount)}
        disabled={page === pageCount}
        title="最後"
      >
        ››
      </PageLink>
      <span className="text-muted-foreground ml-3 font-mono text-xs">
        {page} / {pageCount}
      </span>
    </nav>
  );
}

function PageLink({
  href,
  children,
  active,
  disabled,
  title,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  if (disabled) {
    return (
      <span
        className="border-border/30 text-muted-foreground/50 inline-flex h-8 min-w-8 cursor-not-allowed items-center justify-center rounded-md border px-2 text-xs"
        title={title}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      title={title}
      className={cn(
        "border-border/40 inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs transition",
        active
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "hover:bg-accent/40",
      )}
    >
      {children}
    </Link>
  );
}
