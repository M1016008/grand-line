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

/**
 * Maps set codes to Bandai's internal `series` query param.
 *
 * Sourced from the live `<select id="series">` dropdown on
 * https://www.onepiece-cardgame.com/cardlist/ as of 2026-05-08.
 * Encoding scheme:
 *   5500NN — Starter Deck         ST-NN
 *   5501NN — Booster Pack         OP-NN
 *   5502NN — Extra Booster        EB-NN
 *   5503NN — Premium Booster      PRB-NN
 *   550701 — ファミリーデッキセット (intentionally skipped, no card_id pattern)
 *   550801 — 限定商品収録カード   (intentionally skipped, promo grab-bag)
 *   550901 — プロモーションカード (intentionally skipped, multi-set mixed promos)
 *
 * If a new pack ships, re-fetch the cardlist root and inspect the dropdown
 * before adding here — Bandai sometimes assigns non-sequential ids.
 */
export const SERIES_PARAM: Record<string, string> = {
  // Starter decks (ST01-ST30)
  ST01: "550001", ST02: "550002", ST03: "550003", ST04: "550004", ST05: "550005",
  ST06: "550006", ST07: "550007", ST08: "550008", ST09: "550009", ST10: "550010",
  ST11: "550011", ST12: "550012", ST13: "550013", ST14: "550014", ST15: "550015",
  ST16: "550016", ST17: "550017", ST18: "550018", ST19: "550019", ST20: "550020",
  ST21: "550021", ST22: "550022", ST23: "550023", ST24: "550024", ST25: "550025",
  ST26: "550026", ST27: "550027", ST28: "550028", ST29: "550029", ST30: "550030",
  // Booster packs (OP01-OP15)
  OP01: "550101", OP02: "550102", OP03: "550103", OP04: "550104", OP05: "550105",
  OP06: "550106", OP07: "550107", OP08: "550108", OP09: "550109", OP10: "550110",
  OP11: "550111", OP12: "550112", OP13: "550113", OP14: "550114", OP15: "550115",
  // Extra boosters
  EB01: "550201", EB02: "550202", EB03: "550203", EB04: "550204",
  // Premium boosters
  PRB01: "550301", PRB02: "550302",
  // Standalone product sets (cards inside use various id prefixes;
  // the scrapedSetCode is just a label that lets us track membership).
  FAM: "550701", // ファミリーデッキセット
  LIM: "550801", // 限定商品収録カード
  PROMO: "550901", // プロモーションカード (P-NNN ids)
};

export const ALL_SET_CODES = Object.keys(SERIES_PARAM);

/**
 * Human-readable set names (Japanese), pulled from the same dropdown.
 * Used by the upsert layer to seed `card_sets.name_ja` with something
 * better than "第NN弾 (OPNN)". Missing entries fall back to the
 * synthetic `defaultSetName` in upsert.ts.
 */
export const SET_NAMES_JP: Record<string, string> = {
  ST01: "スタートデッキ 麦わらの一味【ST-01】",
  ST02: "スタートデッキ 最悪の世代【ST-02】",
  ST03: "スタートデッキ 王下七武海【ST-03】",
  ST04: "スタートデッキ 百獣海賊団【ST-04】",
  ST05: "スタートデッキ ONE PIECE FILM edition【ST-05】",
  ST06: "スタートデッキ 海軍【ST-06】",
  ST07: "スタートデッキ ビッグ・マム海賊団【ST-07】",
  ST08: "スタートデッキ Side モンキー・D・ルフィ【ST-08】",
  ST09: "スタートデッキ Side ヤマト【ST-09】",
  ST10: "アルティメットデッキ “三船長”集結【ST-10】",
  ST11: "スタートデッキ Side ウタ【ST-11】",
  ST12: "スタートデッキ ゾロ&サンジ【ST-12】",
  ST13: "アルティメットデッキ 3兄弟の絆【ST-13】",
  ST14: "スタートデッキ 3D2Y【ST-14】",
  ST15: "スタートデッキ 赤 エドワード・ニューゲート【ST-15】",
  ST16: "スタートデッキ 緑 ウタ【ST-16】",
  ST17: "スタートデッキ 青 ドンキホーテ・ドフラミンゴ【ST-17】",
  ST18: "スタートデッキ 紫 モンキー・D・ルフィ【ST-18】",
  ST19: "スタートデッキ 黒 スモーカー【ST-19】",
  ST20: "スタートデッキ 黄 シャーロット・カタクリ【ST-20】",
  ST21: "スタートデッキEX ギア5【ST-21】",
  ST22: "スタートデッキ エース&ニューゲート【ST-22】",
  ST23: "スタートデッキ 赤 シャンクス【ST-23】",
  ST24: "スタートデッキ 緑 ジュエリー・ボニー【ST-24】",
  ST25: "スタートデッキ 青 バギー【ST-25】",
  ST26: "スタートデッキ 紫黒 モンキー・D・ルフィ【ST-26】",
  ST27: "スタートデッキ 黒 マーシャル・D・ティーチ【ST-27】",
  ST28: "スタートデッキ 緑黄 ヤマト【ST-28】",
  ST29: "スタートデッキ EGGHEAD【ST-29】",
  ST30: "スタートデッキEX ルフィ&エース【ST-30】",
  OP01: "ブースターパック ROMANCE DAWN【OP-01】",
  OP02: "ブースターパック 頂上決戦【OP-02】",
  OP03: "ブースターパック 強大な敵【OP-03】",
  OP04: "ブースターパック 謀略の王国【OP-04】",
  OP05: "ブースターパック 新時代の主役【OP-05】",
  OP06: "ブースターパック 双璧の覇者【OP-06】",
  OP07: "ブースターパック 500年後の未来【OP-07】",
  OP08: "ブースターパック 二つの伝説【OP-08】",
  OP09: "ブースターパック 新たなる皇帝【OP-09】",
  OP10: "ブースターパック 王族の血統【OP-10】",
  OP11: "ブースターパック 神速の拳【OP-11】",
  OP12: "ブースターパック 師弟の絆【OP-12】",
  OP13: "ブースターパック 受け継がれる意志【OP-13】",
  OP14: "ブースターパック 蒼海の七傑【OP-14】",
  OP15: "ブースターパック 神の島の冒険【OP-15】",
  EB01: "エクストラブースター メモリアルコレクション【EB-01】",
  EB02: "エクストラブースター Anime 25th collection【EB-02】",
  EB03: "エクストラブースター ONE PIECE Heroines Edition【EB-03】",
  EB04: "エクストラブースター EGGHEAD CRISIS【EB-04】",
  PRB01: "プレミアムブースター ONE PIECE CARD THE BEST【PRB-01】",
  PRB02: "プレミアムブースター ONE PIECE CARD THE BEST vol.2【PRB-02】",
  // Standalone product sets (cards inside use various id prefixes; the
  // upsert layer routes each card to its canonical set via id prefix
  // and records the standalone product as a reprint membership).
  FAM: "ファミリーデッキセット",
  LIM: "限定商品収録カード",
  PROMO: "プロモーションカード一覧",
  // Pseudo-set used as the canonical owning set for standalone P-NNN
  // promo cards.
  P: "プロモーションカード",
};

const BASE_URL = "https://www.onepiece-cardgame.com/cardlist/";

/**
 * Resolve a set code to its Bandai series id. Checks the static
 * `SERIES_PARAM` table first, then falls back to the `scrape_targets`
 * DB table (populated by the discover flow). Returns `undefined` when
 * neither knows about the code.
 *
 * Imported lazily so this module can be consumed from CLI scripts
 * without paying the libsql connection cost when the static table is
 * sufficient.
 */
async function lookupSeries(setCode: string): Promise<string | undefined> {
  const fromStatic = SERIES_PARAM[setCode];
  if (fromStatic) return fromStatic;
  // DB fallback. Avoid pulling the db client into module init so the
  // unit tests for `parseDropdown` don't open a libsql connection.
  try {
    const { db } = await import("@/db");
    const { scrapeTargets } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ seriesId: scrapeTargets.seriesId })
      .from(scrapeTargets)
      .where(eq(scrapeTargets.setCode, setCode))
      .limit(1);
    return rows[0]?.seriesId;
  } catch {
    return undefined;
  }
}

export async function fetchSetHtml(setCode: string): Promise<RawSetFixture> {
  const series = await lookupSeries(setCode);
  if (!series) {
    throw new Error(
      `Unknown set code "${setCode}". Add it to SERIES_PARAM (or run /api/admin/discover-sets) after verifying the live dropdown.`,
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

    // The cardlist hydrates `<dl class="modalCol">` for each card after JS
    // runs. Waiting on `.modalCol` directly is more reliable than guessing
    // at the wrapper class (which has changed between site refreshes).
    await page.waitForSelector("dl.modalCol", { timeout: 30_000 }).catch(() => {
      console.warn(
        "⚠ Expected dl.modalCol nodes not found — saving the HTML anyway so you can inspect it.",
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
