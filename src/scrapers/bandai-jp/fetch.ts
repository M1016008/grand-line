/**
 * Fetch the rendered cardlist HTML for one set from
 * https://www.onepiece-cardgame.com/cardlist/.
 *
 * Why Playwright instead of plain `fetch`?
 *  - The site loads card data into the DOM via client-side scripts; the bare
 *    HTML returned by `fetch` does not include the per-card detail markup
 *    that the parser needs.
 *  - Playwright also handles the Bandai cookie / age-gate banner if it appears.
 *
 * **Politeness**: per AGENTS.md we cap ourselves at a few requests per day.
 * The fetcher writes the rendered HTML to `data/raw/bandai-jp/<setCode>.html`
 * so subsequent parser iterations work entirely from the local fixture.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import type { RawSetFixture } from "./types";

/** Maps set codes to Bandai's internal `series` query param. */
const SERIES_PARAM: Record<string, string> = {
  // TODO(verify): these IDs need to be confirmed by inspecting the live
  // dropdown on https://www.onepiece-cardgame.com/cardlist/. The keys
  // below are the canonical card ID prefixes; the values are placeholders
  // pulled from public references and need a sanity-check pass.
  OP01: "569101",
  OP02: "569102",
  OP03: "569103",
  OP04: "569104",
  OP05: "569105",
  ST01: "569001",
  ST02: "569002",
  ST03: "569003",
};

const BASE_URL = "https://www.onepiece-cardgame.com/cardlist/";

export async function fetchSetHtml(setCode: string): Promise<RawSetFixture> {
  const series = SERIES_PARAM[setCode];
  if (!series) {
    throw new Error(
      `Unknown set code "${setCode}". Add it to SERIES_PARAM in fetch.ts after verifying the live dropdown.`,
    );
  }

  const url = `${BASE_URL}?series=${series}`;
  console.log(`▶ Launching headless Chromium → ${url}`);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      locale: "ja-JP",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });

    // The cardlist hydrates after a `.list` element is populated. If this
    // selector ever moves, swap the wait condition rather than hammering
    // the page with retries.
    await page.waitForSelector(".list, .cardlist", { timeout: 30_000 }).catch(() => {
      console.warn(
        "⚠ Expected .list / .cardlist root not found — saving the HTML anyway so you can inspect it.",
      );
    });

    // Give the late-arriving JS a beat to finish painting card details.
    await page.waitForTimeout(2_000);

    const html = await page.content();
    const fixture: RawSetFixture = {
      setCode,
      fetchedAt: new Date(),
      url,
      html,
    };

    await persistFixture(fixture);
    return fixture;
  } finally {
    await browser.close();
  }
}

export async function persistFixture(fixture: RawSetFixture): Promise<string> {
  const dir = path.resolve("data/raw/bandai-jp");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${fixture.setCode}.html`);
  await writeFile(filePath, fixture.html, "utf-8");
  await writeFile(
    path.join(dir, `${fixture.setCode}.meta.json`),
    JSON.stringify({ url: fixture.url, fetchedAt: fixture.fetchedAt }, null, 2),
    "utf-8",
  );
  console.log(`✓ Saved fixture → ${filePath} (${(fixture.html.length / 1024).toFixed(1)} KiB)`);
  return filePath;
}

export async function loadFixture(setCode: string): Promise<RawSetFixture> {
  const { readFile } = await import("node:fs/promises");
  const filePath = path.resolve("data/raw/bandai-jp", `${setCode}.html`);
  const metaPath = path.resolve("data/raw/bandai-jp", `${setCode}.meta.json`);
  const [html, metaRaw] = await Promise.all([
    readFile(filePath, "utf-8"),
    readFile(metaPath, "utf-8").catch(() => "{}"),
  ]);
  const meta = JSON.parse(metaRaw) as { url?: string; fetchedAt?: string };
  return {
    setCode,
    html,
    url: meta.url ?? `${BASE_URL}?series=unknown`,
    fetchedAt: meta.fetchedAt ? new Date(meta.fetchedAt) : new Date(0),
  };
}
