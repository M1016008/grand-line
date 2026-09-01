import { z } from "zod";

export const deckCoachLevelSchema = z.literal("easy");
export type DeckCoachLevel = z.infer<typeof deckCoachLevelSchema>;

const shortLine = z.string().trim().min(1).max(220);
const paragraph = z.string().trim().min(1).max(600);
const cardId = z.string().trim().min(1).max(40);

export const deckCoachGuideSchema = z
  .object({
    level: deckCoachLevelSchema,
    deckSummaryJa: paragraph,
    archetypeJa: z.string().trim().min(1).max(120),
    winConditionsJa: z.array(shortLine).min(1).max(6),
    keyCards: z
      .array(
        z
          .object({
            cardId,
            roleJa: z.string().trim().min(1).max(220),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    mulligan: z
      .object({
        keepCardIds: z.array(cardId).max(12),
        flexibleCardIds: z.array(cardId).max(12),
        returnCardIds: z.array(cardId).max(12),
        explanationJa: paragraph,
      })
      .strict(),
    idealOpeningJa: z.array(shortLine).min(1).max(8),
    firstPlayerPlan: z.array(shortLine).min(1).max(8),
    secondPlayerPlan: z.array(shortLine).min(1).max(8),
    donPlan: z
      .array(
        z
          .object({
            donCount: z.number().int().min(1).max(10),
            actionJa: z.string().trim().min(1).max(320),
            referencedCardIds: z.array(cardId).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    combos: z
      .array(
        z
          .object({
            titleJa: z.string().trim().min(1).max(100),
            cardIds: z.array(cardId).min(1).max(5),
            stepsJa: z.array(shortLine).min(1).max(6),
            purposeJa: z.string().trim().min(1).max(320),
          })
          .strict(),
      )
      .max(6),
    plans: z
      .object({
        planAJa: paragraph,
        planBJa: paragraph,
        planCJa: paragraph,
      })
      .strict(),
    finishMethodsJa: z.array(shortLine).min(1).max(6),
    weakBoardsJa: z.array(shortLine).min(1).max(6),
    weakMatchupsJa: z.array(shortLine).min(1).max(6),
    commonMistakesJa: z.array(shortLine).min(1).max(8),
  })
  .strict();

export type DeckCoachGuide = z.infer<typeof deckCoachGuideSchema>;

export interface DeckCoachCardRef {
  id: string;
  name: string;
  cardType: string;
  colors: string[];
  imageUrlJp: string | null;
}

export interface StoredDeckCoachGuide {
  deckId: string;
  level: DeckCoachLevel;
  guide: DeckCoachGuide;
  deckHash: string;
  sourceDataHash: string;
  promptVersion: string;
  aiModelVersion: string;
  generatedAt: string;
  updatedAt: string;
}

export interface DeckCoachGuideView extends StoredDeckCoachGuide {
  currentDeckHash: string | null;
  currentSourceDataHash: string | null;
  deckDataStale: boolean;
  sourceDataStale: boolean;
  stale: boolean;
  generationBlockedReason: string | null;
  cardRefs: Record<string, DeckCoachCardRef>;
}
