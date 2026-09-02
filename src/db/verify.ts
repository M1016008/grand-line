/** Fail-closed preflight for the database used by dev/start. */
import "@/lib/load-env";

import { createDatabaseClient, isMockDataAllowed, resolveDatabaseConfig } from "@/db/config";
import {
  databaseVerificationIssues,
  type DatabaseVerificationSnapshot,
} from "@/db/database-verification";

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

async function main() {
  if (isMockDataAllowed()) {
    console.warn(
      "⚠ GRAND_LINE_ALLOW_MOCK_DATA is enabled; populated database verification was explicitly skipped.",
    );
    return;
  }

  const config = resolveDatabaseConfig();
  const client = createDatabaseClient(config);

  try {
    const [integrity, foreignKeys, aggregate] = await Promise.all([
      client.execute("PRAGMA quick_check"),
      client.execute("PRAGMA foreign_key_check"),
      client.execute(`
        SELECT
          (SELECT COUNT(*) FROM cards) AS cards,
          (SELECT COUNT(*) FROM cards WHERE card_type = 'LEADER') AS leaders,
          (SELECT COUNT(*) FROM card_translations WHERE language = 'ja') AS translations,
          (SELECT COUNT(*) FROM card_translations
            WHERE language = 'ja'
              AND verified = 1
              AND source IN ('official_jp', 'official_en')) AS official_verified_translations,
          (SELECT COUNT(*) FROM card_sets) AS sets,
          (SELECT COUNT(*) FROM card_set_membership) AS memberships,
          (SELECT COUNT(*) FROM cards c
            LEFT JOIN card_set_membership m
              ON m.card_id = c.id AND m.set_code = c.set_code
            WHERE m.card_id IS NULL) AS missing_canonical_memberships,
          (SELECT COUNT(*) FROM cards
            WHERE card_type = 'LEADER'
              AND (life IS NULL OR power IS NULL OR image_url_jp IS NULL)) AS missing_leader_facts,
          (SELECT COUNT(*) FROM cards
            WHERE image_url_jp IS NULL OR trim(image_url_jp) = '') AS missing_japanese_images,
          (SELECT COUNT(*) FROM cards
            WHERE json_valid(colors) = 0
               OR json_valid(attributes) = 0
               OR json_valid(features) = 0
               OR json_valid(mechanics) = 0) AS invalid_json_facts,
          ((SELECT COUNT(*) FROM card_restrictions r
              LEFT JOIN cards c ON c.id = r.card_id
              WHERE r.effective_until IS NULL AND c.id IS NULL)
           +
           (SELECT COUNT(*) FROM card_restriction_pairs p
              LEFT JOIN cards a ON a.id = p.card_id_a
              LEFT JOIN cards b ON b.id = p.card_id_b
              WHERE p.effective_until IS NULL
                AND (a.id IS NULL OR b.id IS NULL))) AS invalid_active_restrictions
      `),
    ]);

    const row = aggregate.rows[0];
    const snapshot: DatabaseVerificationSnapshot = {
      integrityCheck: String(integrity.rows[0]?.quick_check ?? "missing"),
      foreignKeyViolations: foreignKeys.rows.length,
      cards: asNumber(row?.cards),
      leaders: asNumber(row?.leaders),
      translations: asNumber(row?.translations),
      officialVerifiedTranslations: asNumber(row?.official_verified_translations),
      sets: asNumber(row?.sets),
      memberships: asNumber(row?.memberships),
      missingCanonicalMemberships: asNumber(row?.missing_canonical_memberships),
      missingLeaderFacts: asNumber(row?.missing_leader_facts),
      missingJapaneseImages: asNumber(row?.missing_japanese_images),
      invalidJsonFacts: asNumber(row?.invalid_json_facts),
      invalidActiveRestrictions: asNumber(row?.invalid_active_restrictions),
    };
    const issues = databaseVerificationIssues(snapshot);

    console.log(`▶ Verified database: ${config.label}`);
    console.log(
      `  cards=${snapshot.cards.toLocaleString()} leaders=${snapshot.leaders.toLocaleString()} sets=${snapshot.sets.toLocaleString()} verified=${snapshot.officialVerifiedTranslations.toLocaleString()}`,
    );

    if (issues.length > 0) {
      throw new Error(`Database preflight rejected the target:\n- ${issues.join("\n- ")}`);
    }

    console.log("✓ Database preflight passed.");
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("✗ Database preflight failed.");
  console.error(error instanceof Error ? error.message : error);
  console.error(
    "  Check the SSD mount and LOCAL_DB_PATH. Use GRAND_LINE_ALLOW_MOCK_DATA=1 only for intentional mock review.",
  );
  process.exit(1);
});
