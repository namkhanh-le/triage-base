
import { z } from "zod";

export const categorySchema = z.enum([
  "technical_bug",
  "feature_request",
  "account",
  "billing",
]);

export const prioritySchema = z.enum(["low", "medium", "high"]);

export const triageRequestSchema = z.object({
  ticket: z.object({
    ticket_id: z.string().optional(),
    subject: z.string(),
    body: z.string(),
  }),
  strategy: z.enum(["llm", "dm", "dm+llm"]).default("llm"),
});

export const triageResponseSchema = z.object({
  category: categorySchema,
  priority: prioritySchema,
  needs_human_review: z.boolean(),
  reasoning: z.string(),
});

export type TriageRequest = z.infer<typeof triageRequestSchema>;
export type TriageResponse = z.infer<typeof triageResponseSchema>;
