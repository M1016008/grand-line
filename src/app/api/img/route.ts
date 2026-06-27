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
 *   - We keep a filesystem cache next to the local SSD database, then ask the
 *     browser to cache for 7 days. Card art is effectively immutable.
 */

import { NextResponse } from "next/server";

import {
  fetchAndCacheCardImage,
  IMAGE_CACHE_CONTROL,
  parseAllowedCardImageUrl,
  readCachedCardImage,
} from "@/lib/card-image-cache";

export const runtime = "nodejs";
// Card art doesn't change per request — let the framework cache the
// route segment if it wants to. The `cache-control` header on the
// response governs the browser side.
export const dynamic = "auto";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u");
  if (!u) {
    return new NextResponse("missing u param", { status: 400 });
  }

  let target: URL;
  try {
    target = parseAllowedCardImageUrl(u);
  } catch {
    return new NextResponse("invalid or disallowed url", { status: 400 });
  }

  try {
    const cached = await readCachedCardImage(target);
    return new NextResponse(new Uint8Array(cached.body), {
      status: 200,
      headers: {
        "content-type": cached.contentType,
        "cache-control": IMAGE_CACHE_CONTROL,
        "x-grand-line-image-cache": "hit",
        "x-grand-line-image-source": cached.meta.fetchedUrl ?? cached.meta.sourceUrl,
      },
    });
  } catch {
    // Cache miss or corrupt cache entry: fetch upstream and rewrite it.
  }

  try {
    const image = await fetchAndCacheCardImage(target);
    return new NextResponse(new Uint8Array(image.body), {
      status: 200,
      headers: {
        "content-type": image.contentType,
        "cache-control": IMAGE_CACHE_CONTROL,
        "x-grand-line-image-cache": "miss",
        "x-grand-line-image-source": image.fetchedUrl,
      },
    });
  } catch (err) {
    return new NextResponse((err as Error).message || "upstream image unavailable", {
      status: 502,
    });
  }
}
