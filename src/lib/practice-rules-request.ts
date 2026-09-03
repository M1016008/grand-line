import { z } from "zod";

import { CPU_LEVEL_VALUES } from "@/lib/practice-log";

export const rulesPracticeDeckRequestSchema = z.object({
  leaderId: z.string().min(1),
  mode: z.enum(["draft", "generated"]),
  cards: z.array(z.object({
    cardId: z.string().min(1),
    count: z.number().int().positive(),
  }).strict()).optional(),
}).strict();

export const rulesPracticeOpponentRequestSchema = z
  .object({ leaderId: z.string().min(1) }).strict();

export const rulesPracticeCpuSkillSchema = z.enum(CPU_LEVEL_VALUES);
