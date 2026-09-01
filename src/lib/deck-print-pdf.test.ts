import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import { buildDeckPrintPdf, printLayout } from "./deck-print-pdf";
import type { SavedDeckDetail } from "./saved-decks";

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

test("print PDF embeds PNG card images when available", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const png = tinyPng();
    const body = new ArrayBuffer(png.byteLength);
    new Uint8Array(body).set(png);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };

  try {
    const pdf = await buildDeckPrintPdf(deckWith("https://example.test/card.png"));
    const text = Buffer.from(pdf).toString("latin1");

    assert.match(text, /\/Subtype \/Image/);
    assert.match(text, /\/Filter \/FlateDecode/);
    assert.match(text, /\/Width 1/);
    assert.match(text, /\/Height 1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function tinyPng(): Uint8Array {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = pngChunk(
    "IHDR",
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
  );
  const idat = pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0])));
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
