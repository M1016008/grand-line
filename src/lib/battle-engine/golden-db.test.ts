import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { createClient } from "@libsql/client";

import "@/lib/load-env";
import {
  GOLDEN_BLOCKER,
  GOLDEN_BOUNCE,
  GOLDEN_DRAW,
  GOLDEN_KO,
  GOLDEN_ON_ATTACK,
  GOLDEN_REST,
  GOLDEN_RUSH,
  GOLDEN_SEARCH,
  GOLDEN_TRIGGER_DRAW,
} from "./golden-fixtures";

const localPath = process.env.LOCAL_DB_PATH;
const canAuditSsd = Boolean(localPath && existsSync(localPath));

test(
  "golden fixtures exactly match verified official SSD rows",
  { skip: !canAuditSsd },
  async (context) => {
    const client = createClient({ url: `file:${localPath}` });
    const translationCount = await client.execute(
      "SELECT COUNT(*) AS count FROM card_translations",
    );
    if (Number(translationCount.rows[0]?.count ?? 0) === 0) {
      client.close();
      context.skip("ephemeral CI database has no official card corpus");
      return;
    }
    const fixtures = [
      GOLDEN_RUSH,
      GOLDEN_BLOCKER,
      GOLDEN_DRAW,
      GOLDEN_KO,
      GOLDEN_REST,
      GOLDEN_BOUNCE,
      GOLDEN_SEARCH,
      GOLDEN_TRIGGER_DRAW,
      GOLDEN_ON_ATTACK,
    ];
    for (const fixture of fixtures) {
      const result = await client.execute({
        sql: `SELECT t.name, t.effect_text, t.trigger_text, t.source, t.verified
              FROM card_translations t
              WHERE t.card_id = ? AND t.language = 'ja'`,
        args: [fixture.id],
      });
      assert.equal(result.rows.length, 1, fixture.id);
      const row = result.rows[0];
      assert.equal(row.name, fixture.name, `${fixture.id} name`);
      assert.equal(row.effect_text, fixture.effectText, `${fixture.id} effectText`);
      assert.equal(row.trigger_text, fixture.triggerText, `${fixture.id} triggerText`);
      assert.equal(row.source, "official_jp", `${fixture.id} source`);
      assert.equal(Number(row.verified), 1, `${fixture.id} verified`);
    }
    client.close();
  },
);
