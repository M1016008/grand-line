export type PracticeRequestedEventStorageMode =
  | "auto"
  | "full"
  | "sampled"
  | "summary_only";

export type PracticeEventStorageMode = Exclude<
  PracticeRequestedEventStorageMode,
  "auto"
>;

export interface PracticeStoragePolicy {
  requestedMode: PracticeRequestedEventStorageMode;
  mode: PracticeEventStorageMode;
  eventSampleLimit: number;
  autoFullEventGameLimit: number;
  maxStoredEventGames: number;
  capped: boolean;
}

const DEFAULT_AUTO_FULL_EVENT_GAME_LIMIT = 20;
const DEFAULT_EVENT_SAMPLE_LIMIT = 25;
const DEFAULT_MAX_STORED_EVENT_GAMES = 100;

function readPositiveInt(
  key: string,
  fallback: number,
  max: number,
): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(parsed)));
}

export function practiceStorageLimits() {
  const maxStoredEventGames = readPositiveInt(
    "PRACTICE_MAX_STORED_EVENT_GAMES",
    DEFAULT_MAX_STORED_EVENT_GAMES,
    1_000,
  );
  return {
    autoFullEventGameLimit: Math.min(
      maxStoredEventGames,
      readPositiveInt(
        "PRACTICE_AUTO_FULL_EVENT_GAME_LIMIT",
        DEFAULT_AUTO_FULL_EVENT_GAME_LIMIT,
        1_000,
      ),
    ),
    defaultEventSampleLimit: Math.min(
      maxStoredEventGames,
      readPositiveInt(
        "PRACTICE_DEFAULT_EVENT_SAMPLE_LIMIT",
        DEFAULT_EVENT_SAMPLE_LIMIT,
        1_000,
      ),
    ),
    maxStoredEventGames,
  };
}

export function resolvePracticeStoragePolicy(
  games: number,
  requestedMode: PracticeRequestedEventStorageMode,
  requestedLimit: number | undefined,
): PracticeStoragePolicy {
  const limits = practiceStorageLimits();
  let mode: PracticeEventStorageMode =
    requestedMode === "auto"
      ? games <= limits.autoFullEventGameLimit
        ? "full"
        : "sampled"
      : requestedMode;

  let eventSampleLimit =
    mode === "full"
      ? games
      : mode === "summary_only"
        ? 0
        : Math.min(
            games,
            Math.max(0, requestedLimit ?? limits.defaultEventSampleLimit),
          );

  let capped = false;
  if (eventSampleLimit > limits.maxStoredEventGames) {
    eventSampleLimit = limits.maxStoredEventGames;
    capped = true;
    if (mode === "full" && games > limits.maxStoredEventGames) {
      mode = "sampled";
    }
  }

  return {
    requestedMode,
    mode,
    eventSampleLimit,
    autoFullEventGameLimit: limits.autoFullEventGameLimit,
    maxStoredEventGames: limits.maxStoredEventGames,
    capped,
  };
}

export function selectPracticeEventGameIndexes(
  games: number,
  limit: number,
  mode: PracticeEventStorageMode,
): Set<number> {
  if (mode === "summary_only" || limit <= 0) return new Set();
  if (mode === "full" || limit >= games) {
    return new Set(Array.from({ length: games }, (_, index) => index));
  }

  const target = Math.min(limit, games);
  const indexes = new Set<number>([0]);
  if (target === 1) return indexes;

  indexes.add(games - 1);
  const middleSlots = target - indexes.size;
  for (let i = 1; i <= middleSlots; i++) {
    indexes.add(Math.round((i * (games - 1)) / (middleSlots + 1)));
  }
  for (let index = 0; indexes.size < target && index < games; index++) {
    indexes.add(index);
  }
  return indexes;
}
