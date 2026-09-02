export interface DatabaseVerificationSnapshot {
  integrityCheck: string;
  foreignKeyViolations: number;
  cards: number;
  leaders: number;
  translations: number;
  officialVerifiedTranslations: number;
  sets: number;
  memberships: number;
  missingCanonicalMemberships: number;
  missingLeaderFacts: number;
  missingJapaneseImages: number;
  invalidJsonFacts: number;
  invalidActiveRestrictions: number;
}

export function databaseVerificationIssues(
  snapshot: DatabaseVerificationSnapshot,
): string[] {
  const issues: string[] = [];

  if (snapshot.integrityCheck !== "ok") {
    issues.push(`SQLite integrity check failed: ${snapshot.integrityCheck}`);
  }
  if (snapshot.foreignKeyViolations !== 0) {
    issues.push(`foreign-key violations: ${snapshot.foreignKeyViolations}`);
  }
  if (snapshot.cards === 0) issues.push("cards table is empty");
  if (snapshot.leaders === 0) issues.push("leader card pool is empty");
  if (snapshot.translations !== snapshot.cards) {
    issues.push(
      `translation/card mismatch: ${snapshot.translations}/${snapshot.cards}`,
    );
  }
  if (snapshot.officialVerifiedTranslations !== snapshot.cards) {
    issues.push(
      `official verified/card mismatch: ${snapshot.officialVerifiedTranslations}/${snapshot.cards}`,
    );
  }
  if (snapshot.sets === 0) issues.push("card_sets table is empty");
  if (snapshot.memberships < snapshot.cards) {
    issues.push(`membership/card mismatch: ${snapshot.memberships}/${snapshot.cards}`);
  }
  if (snapshot.missingCanonicalMemberships !== 0) {
    issues.push(
      `missing canonical memberships: ${snapshot.missingCanonicalMemberships}`,
    );
  }
  if (snapshot.missingLeaderFacts !== 0) {
    issues.push(`leaders missing facts: ${snapshot.missingLeaderFacts}`);
  }
  if (snapshot.missingJapaneseImages !== 0) {
    issues.push(`cards missing Japanese images: ${snapshot.missingJapaneseImages}`);
  }
  if (snapshot.invalidJsonFacts !== 0) {
    issues.push(`cards with invalid JSON facts: ${snapshot.invalidJsonFacts}`);
  }
  if (snapshot.invalidActiveRestrictions !== 0) {
    issues.push(
      `active restrictions with invalid references: ${snapshot.invalidActiveRestrictions}`,
    );
  }

  return issues;
}
