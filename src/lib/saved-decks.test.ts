import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("activeRegulations fails closed when restrictions cannot be loaded", async () => {
  const originalMode = process.env.GRAND_LINE_DATABASE_MODE;
  const originalLocalDbPath = process.env.LOCAL_DB_PATH;
  const dir = await mkdtemp(path.join(tmpdir(), "grand-line-regulations-"));

  try {
    process.env.GRAND_LINE_DATABASE_MODE = "local";
    process.env.LOCAL_DB_PATH = path.join(dir, "missing-tables.db");
    const { activeRegulations, DeckRegulationsUnavailableError } = await import(
      "./saved-decks"
    );

    await assert.rejects(
      () => activeRegulations(),
      DeckRegulationsUnavailableError,
    );
  } finally {
    if (originalMode === undefined) {
      delete process.env.GRAND_LINE_DATABASE_MODE;
    } else {
      process.env.GRAND_LINE_DATABASE_MODE = originalMode;
    }
    if (originalLocalDbPath === undefined) {
      delete process.env.LOCAL_DB_PATH;
    } else {
      process.env.LOCAL_DB_PATH = originalLocalDbPath;
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
