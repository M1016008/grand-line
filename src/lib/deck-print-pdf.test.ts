import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import {
  parseAllowedCardImageUrl,
  readCachedCardImage,
  writeCachedCardImage,
} from "./card-image-cache";
import { buildDeckPrintPdf, printLayout } from "./deck-print-pdf";
import type { SavedDeckDetail } from "./saved-decks";

const OFFICIAL_IMAGE_URL =
  "https://www.onepiece-cardgame.com/images/card/card/OP01-002.png";

function card(id: string) {
  return {
    id,
    setCode: "OP01",
    cardType: "CHARACTER",
    name: id,
    colors: ["red"],
    features: [],
    attributes: [],
    cost: 1,
    power: 1000,
    counter: 1000,
    life: null,
    rarity: "C",
    hasTrigger: false,
    imageUrlJp: null,
    mechanics: [],
    source: "official_jp" as const,
    verified: true,
  };
}

function deckWith(cardImageUrl: string | null): SavedDeckDetail {
  return {
    id: "deck-1",
    name: "Print test",
    format: "standard",
    notes: null,
    leader: {
      ...card("OP01-001"),
      cardType: "LEADER",
      life: 5,
      power: 5000,
    },
    entries: Array.from({ length: 13 }).map((_, index) => ({
      card: {
        ...card(`OP01-${String(index + 2).padStart(3, "0")}`),
        imageUrlJp: index === 0 ? cardImageUrl : null,
      },
      count: index === 12 ? 2 : 4,
    })),
    totalCards: 50,
    evaluationScores: {},
    ruleReport: { legal: true, totalCount: 50, violations: [] },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

test("print PDF uses A4, 63x88mm cards, and a 3x3 grid", async () => {
  const deck = deckWith(null);

  const pdf = await buildDeckPrintPdf(deck);
  const withoutLeader = await buildDeckPrintPdf(deck, { includeLeader: false });
  const text = Buffer.from(pdf).toString("latin1");
  const textWithoutLeader = Buffer.from(withoutLeader).toString("latin1");

  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /\/MediaBox \[0 0 595\.276 841\.89\]/);
  assert.ok(text.includes("(LEADER OP01-001)"));
  assert.ok(!textWithoutLeader.includes("(LEADER OP01-001)"));
  assert.equal(printLayout.page.widthMm, 210);
  assert.equal(printLayout.card.widthMm, 63);
  assert.equal(printLayout.card.heightMm, 88);
  assert.equal(printLayout.grid.cols, 3);
  assert.equal(printLayout.grid.rows, 3);
});

test("print PDF embeds cached PNG card images without stretching", async () => {
  const originalFetch = globalThis.fetch;
  const originalCacheDir = process.env.IMAGE_CACHE_DIR;
  const cacheDir = await mkdtemp(path.join(tmpdir(), "grand-line-pdf-cache-"));
  try {
    process.env.IMAGE_CACHE_DIR = cacheDir;
    const target = parseAllowedCardImageUrl(OFFICIAL_IMAGE_URL);
    await writeCachedCardImage(target, Buffer.from(tinyPng(2, 1)), "image/png");
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("unexpected fetch");
    }) as typeof fetch;

    const pdf = await buildDeckPrintPdf(deckWith(OFFICIAL_IMAGE_URL), {
      includeLeader: false,
    });
    const text = Buffer.from(pdf).toString("latin1");

    assert.match(text, /\/Subtype \/Image/);
    assert.match(text, /\/Filter \/FlateDecode/);
    assert.match(text, /\/Width 2/);
    assert.match(text, /\/Height 1/);
    assert.equal(fetchCalled, false);
    assert.ok(text.includes(firstCardWideImageMatrix()), text);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCacheDir === undefined) {
      delete process.env.IMAGE_CACHE_DIR;
    } else {
      process.env.IMAGE_CACHE_DIR = originalCacheDir;
    }
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("print PDF fetches image cache misses through the shared cache", async () => {
  const originalFetch = globalThis.fetch;
  const originalCacheDir = process.env.IMAGE_CACHE_DIR;
  const cacheDir = await mkdtemp(path.join(tmpdir(), "grand-line-pdf-cache-"));
  try {
    process.env.IMAGE_CACHE_DIR = cacheDir;
    let fetchCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls += 1;
      assert.equal(String(input), OFFICIAL_IMAGE_URL);
      const png = tinyPng();
      const body = new ArrayBuffer(png.byteLength);
      new Uint8Array(body).set(png);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;

    const target = parseAllowedCardImageUrl(OFFICIAL_IMAGE_URL);
    const pdf = await buildDeckPrintPdf(deckWith(OFFICIAL_IMAGE_URL), {
      includeLeader: false,
    });
    const text = Buffer.from(pdf).toString("latin1");
    const cached = await readCachedCardImage(target);

    assert.equal(fetchCalls, 1);
    assert.equal(cached.contentType, "image/png");
    assert.match(text, /\/Subtype \/Image/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCacheDir === undefined) {
      delete process.env.IMAGE_CACHE_DIR;
    } else {
      process.env.IMAGE_CACHE_DIR = originalCacheDir;
    }
    await rm(cacheDir, { recursive: true, force: true });
  }
});

function firstCardWideImageMatrix(): string {
  const mmToPt = 72 / 25.4;
  const pageWidth = printLayout.page.widthMm * mmToPt;
  const pageHeight = printLayout.page.heightMm * mmToPt;
  const cardWidth = printLayout.card.widthMm * mmToPt;
  const cardHeight = printLayout.card.heightMm * mmToPt;
  const gridWidth = cardWidth * printLayout.grid.cols;
  const gridHeight = cardHeight * printLayout.grid.rows;
  const gridLeft = (pageWidth - gridWidth) / 2;
  const gridBottom = (pageHeight - gridHeight) / 2;
  const slotY = pageHeight - gridBottom - cardHeight;
  const imageHeight = cardWidth / 2;
  const imageY = slotY + (cardHeight - imageHeight) / 2;

  return `${pdfNum(cardWidth)} 0 0 ${pdfNum(imageHeight)} ${pdfNum(gridLeft)} ${pdfNum(imageY)} cm`;
}

function pdfNum(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function tinyPng(width = 1, height = 1): Uint8Array {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    rows[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 3;
      rows[pixelOffset] = 255;
    }
  }
  const ihdr = pngChunk("IHDR", header);
  const idat = pngChunk("IDAT", deflateSync(rows));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([
    length,
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ]);
}
