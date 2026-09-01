import { z } from "zod";

export const cardCoachLevelSchema = z.enum(["easy"]);
export type CardCoachLevel = z.infer<typeof cardCoachLevelSchema>;

export const cardCoachGuideSchema = z
  .object({
    summaryJa: z.string().min(1).max(260),
    roles: z.array(z.string().min(1).max(80)).min(1).max(4),
    purposeJa: z.string().min(1).max(260),
    timing: z.array(z.string().min(1).max(160)).min(1).max(4),
    strongSituations: z.array(z.string().min(1).max(160)).min(1).max(4),
    terms: z
      .array(
        z.object({
          term: z.string().min(1).max(40),
          explanationJa: z.string().min(1).max(140),
        }),
      )
      .max(8),
    compatibleCards: z
      .array(
        z.object({
          cardId: z.string().min(1),
          reasonJa: z.string().min(1).max(180),
        }),
      )
      .max(5),
    combos: z
      .array(
        z.object({
          titleJa: z.string().min(1).max(80),
          cardIds: z.array(z.string().min(1)).min(2).max(3),
          stepsJa: z.array(z.string().min(1).max(140)).min(1).max(4),
          whyJa: z.string().min(1).max(180),
        }),
      )
      .max(3),
    exampleJa: z.string().min(1).max(260),
    playRoutes: z
      .array(
        z.object({
          donCount: z.number().int().min(0).max(10),
          titleJa: z.string().min(1).max(80),
          stepsJa: z.array(z.string().min(1).max(140)).min(1).max(5),
        }),
      )
      .max(3),
    fallbackPlanJa: z.string().min(1).max(260),
    commonMistakesJa: z.array(z.string().min(1).max(160)).max(5),
  })
  .strict();

export type CardCoachGuide = z.infer<typeof cardCoachGuideSchema>;

export interface CardCoachCardRef {
  id: string;
  name: string;
  cardType: string;
  colors: string[];
  imageUrlJp: string | null;
}

export interface StoredCardCoachGuide {
  cardId: string;
  level: CardCoachLevel;
  guide: CardCoachGuide;
  sourceDataHash: string;
  promptVersion: string;
  aiModelVersion: string;
  generatedAt: string | null;
  updatedAt: string | null;
}

export interface CardCoachGuideView extends StoredCardCoachGuide {
  source: "card_coach" | "playstyle_fallback";
  cardRefs: Record<string, CardCoachCardRef>;
}
