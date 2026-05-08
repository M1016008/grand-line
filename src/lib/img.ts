/**
 * Convert a Bandai card art URL into our same-origin proxy URL.
 * Returns null when the input is null/undefined so callers can render a
 * placeholder.
 *
 * The proxy itself lives at `src/app/api/img/route.ts` and exists because
 * Bandai serves card art with a same-site CORP header that blocks
 * browser hot-linking.
 */
export function proxiedCardImage(src: string | null | undefined): string | null {
  if (!src) return null;
  return `/api/img?u=${encodeURIComponent(src)}`;
}
