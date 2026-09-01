import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("Card Coach section shows a stale source-data badge", async () => {
  const source = await readFile(
    path.join(
      process.cwd(),
      "src",
      "components",
      "grand-line",
      "card-coach-section.tsx",
    ),
    "utf8",
  );

  assert.match(source, /sourceDataStale/);
  assert.match(source, /再生成推奨/);
});
