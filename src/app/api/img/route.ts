/**
 * GET /api/img?u=<encoded-bandai-url>
 *
 * Server-side image proxy for Bandai card art. Required because Bandai
 * serves their card images with `Cross-Origin-Resource-Policy: same-site`
 * (or similar) which prevents browsers from embedding them across origins.
 *
 * We cap the allow-list to the two known Bandai cardlist hosts so this
 * endpoint can't be abused as an open SSRF proxy for arbitrary URLs.
 *
 * Caching:
 *   - We pass through Bandai's content-type and ask the browser to cache
 *     for 1 day. Card art is effectively immutable; 24h gives Bandai time
 *     to fix any visual bugs without us needing a cache-buster.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Card art doesn't change per request — let the framework cache the
// route segment if it wants to. The `cache-control` header on the
// response governs the browser side.
export const dynamic = "auto";

const ALLOWED_HOSTS = new Set([
  "www.onepiece-cardgame.com",
  "en.onepiece-cardgame.com",
]);
const ALLOWED_PATH_PREFIX = "/images/";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u");
  if (!u) {
    return new NextResponse("missing u param", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return new NextResponse("invalid url", { status: 400 });
  }
  if (target.protocol !== "https:") {
    return new NextResponse("https only", { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return new NextResponse("host not allowed", { status: 400 });
  }
  if (!target.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
    return new NextResponse("path not allowed", { status: 400 });
  }

  const upstream = await fetch(target.toString(), {
    headers: {
      // A few Bandai endpoints reject requests without a UA.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      // Hint that we accept image bytes; some CDNs vary on this.
      accept: "image/png,image/jpeg,image/webp,image/*;q=0.8,*/*;q=0.5",
    },
    // Don't forward auth/cookies.
  });

  if (!upstream.ok) {
    return new NextResponse(`upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "image/png",
      // Browser caches 1 day; CDN can hold longer if we ever ship one.
      "cache-control": "public, max-age=86400, stale-while-revalidate=86400",
    },
  });
}
