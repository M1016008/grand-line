<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Grand Line — agent contract

Grand Line is a One Piece TCG dashboard. See `README.md` for the full picture and `~/Downloads/grand-line-roadmap.docx` for the original spec.

## Stack snapshot

- Next.js 16 (App Router) + React 19 + TypeScript 5
- Tailwind CSS v4 (uses `@import "tailwindcss"` and `@theme inline`, not v3 config)
- Drizzle ORM + libSQL/Turso client (`@libsql/client`)
- Anthropic Claude API via `@anthropic-ai/sdk`
- Playwright for scraping (Bandai JP + later: US/EU/AU/MX/CN officials)

## Hard rules

1. **No hallucinated card facts.** Card effects, costs, life, attributes etc. must originate from a verified scrape (`source = official_jp` or `official_en`, `verified = 1`). AI translations are stored with `source = ai_translated`, `verified = 0`, and **must** render a "未確認" badge in the UI.
2. **AI is for analysis, not for facts.** Synergy reasoning, deck strategy explanations, scenario play-by-plays — yes. Card text generation — no.
3. **Leader-centric.** Every analytical surface (synergy graph, evaluation, AI prompt) takes the leader as the anchor.
4. **Tool-use Claude calls must declare a JSON schema** and the response **must** be validated server-side before persisting. Reject and retry on schema or rule violation.
5. **Probability math runs in plain TypeScript** in the browser/edge. Don't call Claude for things that are deterministic.
6. **Scrape politely.** ≤ a few requests per day per source. Save raw HTML to `data/raw/` (gitignored) and parse from disk during development.

## Next.js 16 gotchas (read before writing route code)

- `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` are **all Promises**. Always `await`.
- Use `PageProps<'/cards/[id]'>` and `LayoutProps<'/...'>` helpers (run `npx next typegen` after adding new routes).
- Middleware filename is `proxy.ts`, exported function is `proxy`. No edge runtime.
- `revalidateTag('foo', 'max')` — second arg is required.
- `cacheLife` / `cacheTag` are stable (no `unstable_` prefix).
- `images.domains` is dead → use `images.remotePatterns`.
- Turbopack is on by default; don't add `--turbopack` to package.json scripts.
- Linting is via ESLint flat config + `eslint .`, not `next lint`.

## Code style

- Strict TS, no `any` outside of clearly-typed `JSON.parse` boundaries.
- Server Components by default; mark `"use client"` only when you need state, effects, or browser APIs.
- Domain logic (`src/lib/...`) is framework-free and unit-testable.
- Drizzle is the only DB access path; no raw `db.execute("SELECT ...")` in route handlers.
- Keep route handlers thin — call into `src/lib` and `src/db`.

## When in doubt

- Next.js: `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
- Drizzle + libSQL: `https://orm.drizzle.team/docs/connect-turso`
- Anthropic SDK: `node_modules/@anthropic-ai/sdk`
- One Piece TCG card data: `https://www.onepiece-cardgame.com/cardlist/`
