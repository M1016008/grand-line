import assert from "node:assert/strict";
import test from "node:test";

import {
  isMockDataAllowed,
  resolveDatabaseConfig,
  type DatabaseConfig,
} from "./config";
import { databaseVerificationIssues } from "./database-verification";
import { imageCacheRoot } from "../lib/card-image-cache";

const SSD_PATH = "/Volumes/Test SSD/grand-line-data/grand-line.db";

test("shared workstation DB pointer prevents fresh clones from using an empty repo DB", () => {
  const config = resolveDatabaseConfig({}, { sharedLocalDbPath: SSD_PATH });

  assert.equal(config.kind, "local");
  assert.equal(config.localPath, SSD_PATH);
});

test("shared local pointer wins over ambient Turso unless Turso mode is explicit", () => {
  const local = resolveDatabaseConfig(
    { TURSO_DATABASE_URL: "libsql://example.invalid" },
    { sharedLocalDbPath: SSD_PATH },
  );
  const turso = resolveDatabaseConfig(
    {
      GRAND_LINE_DATABASE_MODE: "turso",
      TURSO_DATABASE_URL: "libsql://example.invalid",
    },
    { sharedLocalDbPath: SSD_PATH },
  );

  assert.equal(local.kind, "local");
  assert.equal(turso.kind, "turso");
});

test("project LOCAL_DB_PATH overrides the workstation pointer", () => {
  const config = resolveDatabaseConfig(
    { GRAND_LINE_DATABASE_MODE: "local", LOCAL_DB_PATH: "/tmp/project.db" },
    { sharedLocalDbPath: SSD_PATH },
  );

  assert.equal(config.kind, "local");
  assert.equal(config.localPath, "/tmp/project.db");
});

test("mock data requires an explicit opt-in", () => {
  assert.equal(isMockDataAllowed({}), false);
  assert.equal(isMockDataAllowed({ GRAND_LINE_ALLOW_MOCK_DATA: "0" }), false);
  assert.equal(isMockDataAllowed({ GRAND_LINE_ALLOW_MOCK_DATA: "1" }), true);
  assert.equal(isMockDataAllowed({ GRAND_LINE_ALLOW_MOCK_DATA: "true" }), true);
});

test("image cache follows the resolved local database directory", () => {
  const config: DatabaseConfig = {
    kind: "local",
    url: `file:${SSD_PATH}`,
    localPath: SSD_PATH,
    label: "test SSD",
  };

  assert.equal(
    imageCacheRoot({}, config),
    "/Volumes/Test SSD/grand-line-data/image-cache",
  );
});

test("database verification rejects empty or incomplete card data", () => {
  const healthy = {
    integrityCheck: "ok",
    foreignKeyViolations: 0,
    cards: 2_803,
    leaders: 143,
    translations: 2_803,
    officialVerifiedTranslations: 2_803,
    sets: 63,
    memberships: 3_932,
    missingCanonicalMemberships: 0,
    missingLeaderFacts: 0,
    missingJapaneseImages: 0,
    invalidJsonFacts: 0,
    invalidActiveRestrictions: 0,
  };

  assert.deepEqual(databaseVerificationIssues(healthy), []);
  assert.match(
    databaseVerificationIssues({ ...healthy, cards: 0 }).join("\n"),
    /cards table is empty/,
  );
  assert.match(
    databaseVerificationIssues({
      ...healthy,
      officialVerifiedTranslations: 2_802,
    }).join("\n"),
    /official verified\/card mismatch/,
  );
});
