import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_HOSTS = new Set([
  "www.onepiece-cardgame.com",
  "en.onepiece-cardgame.com",
]);
const ALLOWED_PATH_PREFIX = "/images/";
const DEFAULT_CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=604800";

export interface CachedImageMeta {
  contentType: string;
  sourceUrl: string;
  fetchedUrl?: string;
  cachedAt: string;
}

export interface CachedImage {
  body: Buffer;
  contentType: string;
  meta: CachedImageMeta;
}

export interface FetchedImage {
  body: Buffer;
  contentType: string;
  requestedUrl: string;
  fetchedUrl: string;
}

export const IMAGE_CACHE_CONTROL = DEFAULT_CACHE_CONTROL;

export function parseAllowedCardImageUrl(raw: string): URL {
  const target = new URL(raw);
  if (target.protocol !== "https:") {
    throw new Error("https only");
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    throw new Error("host not allowed");
  }
  if (!target.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
    throw new Error("path not allowed");
  }
  return target;
}

export function imageCacheRoot() {
  if (process.env.IMAGE_CACHE_DIR) {
    return path.resolve(/*turbopackIgnore: true*/ process.env.IMAGE_CACHE_DIR);
  }

  const localDbPath = process.env.LOCAL_DB_PATH;
  if (process.env.GRAND_LINE_DATABASE_MODE === "local" && localDbPath) {
    return path.join(/*turbopackIgnore: true*/ path.dirname(localDbPath), "image-cache");
  }

  return path.join(process.cwd(), "data", "cache", "card-images");
}

export function imageCacheKey(target: URL) {
  return createHash("sha256").update(target.toString()).digest("hex");
}

export function imageCachePaths(target: URL) {
  const key = imageCacheKey(target);
  const dir = imageCacheRoot();
  return {
    bodyPath: path.join(dir, `${key}.bin`),
    metaPath: path.join(dir, `${key}.json`),
  };
}

export async function readCachedCardImage(target: URL): Promise<CachedImage> {
  const { bodyPath, metaPath } = imageCachePaths(target);
  const [body, metaRaw] = await Promise.all([
    readFile(/*turbopackIgnore: true*/ bodyPath),
    readFile(/*turbopackIgnore: true*/ metaPath, "utf-8"),
  ]);
  const meta = JSON.parse(metaRaw) as CachedImageMeta;
  return {
    body,
    contentType: meta.contentType,
    meta,
  };
}

export async function hasCachedCardImage(target: URL): Promise<boolean> {
  try {
    await readCachedCardImage(target);
    return true;
  } catch {
    return false;
  }
}

export async function writeCachedCardImage(
  requested: URL,
  body: Buffer,
  contentType: string,
  fetchedUrl = requested.toString(),
) {
  const { bodyPath, metaPath } = imageCachePaths(requested);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(bodyPath), { recursive: true });
  await Promise.all([
    writeFile(/*turbopackIgnore: true*/ bodyPath, body),
    writeFile(
      /*turbopackIgnore: true*/ metaPath,
      JSON.stringify(
        {
          contentType,
          sourceUrl: requested.toString(),
          fetchedUrl,
          cachedAt: new Date().toISOString(),
        } satisfies CachedImageMeta,
      ),
      "utf-8",
    ),
  ]);
}

export async function fetchAndCacheCardImage(target: URL): Promise<FetchedImage> {
  const candidates = imageUrlCandidates(target);
  const [primary, ...fallbacks] = candidates;
  const primaryResult = await fetchCandidate(primary);

  if (primaryResult.ok) {
    await writeCachedCardImage(target, primaryResult.body, primaryResult.contentType, primary.toString());
    return {
      body: primaryResult.body,
      contentType: primaryResult.contentType,
      requestedUrl: target.toString(),
      fetchedUrl: primary.toString(),
    };
  }

  // Only try alternate art suffixes when the stored DB URL is definitely not
  // present. On transient timeouts, variants just add slow 404s and hide the
  // real reason the primary fetch failed.
  if (primaryResult.status !== 404) {
    throw new Error(primaryResult.detail);
  }

  let lastStatus = primaryResult.detail;
  for (const fallback of fallbacks) {
    const result = await fetchCandidate(fallback);
    if (!result.ok) {
      lastStatus = result.detail;
      continue;
    }

    await writeCachedCardImage(target, result.body, result.contentType, fallback.toString());

    return {
      body: result.body,
      contentType: result.contentType,
      requestedUrl: target.toString(),
      fetchedUrl: fallback.toString(),
    };
  }

  throw new Error(lastStatus);
}

type FetchCandidateResult =
  | {
      ok: true;
      body: Buffer;
      contentType: string;
    }
  | {
      ok: false;
      status: number | null;
      detail: string;
    };

async function fetchCandidate(target: URL): Promise<FetchCandidateResult> {
  const timeoutMs = Math.max(5_000, Number(process.env.IMAGE_FETCH_TIMEOUT_MS ?? 30_000));
  const attempts = Math.max(1, Number(process.env.IMAGE_FETCH_RETRIES ?? 2));
  let lastDetail = "fetch failed";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          accept: "image/png,image/jpeg,image/webp,image/*;q=0.8,*/*;q=0.5",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastDetail = (err as Error).message || "fetch failed";
      continue;
    }

    if (!upstream.ok) {
      lastDetail = `upstream ${upstream.status}`;
      if (upstream.status === 404) break;
      continue;
    }

    const contentType = upstream.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) {
      return {
        ok: false,
        status: upstream.status,
        detail: `unexpected content-type ${contentType}`,
      };
    }

    return {
      ok: true,
      body: Buffer.from(await upstream.arrayBuffer()),
      contentType,
    };
  }

  const status = lastDetail.startsWith("upstream ")
    ? Number(lastDetail.replace("upstream ", ""))
    : null;
  return {
    ok: false,
    status: Number.isFinite(status) ? status : null,
    detail: lastDetail,
  };
}

function imageUrlCandidates(target: URL): URL[] {
  const candidates = [target];
  const match = target.pathname.match(/^(.*\/card\/)([^/]+?)(?:_p\d+)?(\.(?:png|jpg|jpeg|webp))$/i);
  if (!match) return candidates;

  const [, prefix, baseId, ext] = match;
  const variants = [
    `${prefix}${baseId}${ext}`,
    `${prefix}${baseId}_p1${ext}`,
    `${prefix}${baseId}_p2${ext}`,
    `${prefix}${baseId}_p3${ext}`,
    `${prefix}${baseId}_p4${ext}`,
    `${prefix}${baseId}_p5${ext}`,
  ];

  const seen = new Set(candidates.map((url) => url.toString()));
  for (const pathname of variants) {
    const candidate = new URL(target.toString());
    candidate.pathname = pathname;
    const key = candidate.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }

  return candidates;
}
