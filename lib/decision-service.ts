
import { z } from "zod";
import { categorySchema, prioritySchema } from "./triage";

const decisionResponseSchema = z.object({
  answers: z.object({
    category: z.object({
      choice: categorySchema,
      probabilities: z.record(z.string(), z.number()).optional(),
    }),
    priority: z.object({
      choice: prioritySchema,
      probabilities: z.record(z.string(), z.number()).optional(),
    }),
    human_review: z.object({
      noul: z.number().min(0).max(1),
    }),
  }),
  model: z.string().optional(),
  usage: z.object({
    input_tokens: z.number().nonnegative().optional(),
    output_tokens: z.number().nonnegative().optional(),
  }).optional(),
});

export type DecisionResult = {
  category: z.infer<typeof categorySchema>;
  priority: z.infer<typeof prioritySchema>;
  needs_human_review: boolean;
  reasoning: string;
  model: string;
  inputTokens: number;
  latencyMs: number;
};

export async function classifyWithDecisionModel(ticket: {
  ticket_id?: string;
  subject: string;
  body: string;
}): Promise<DecisionResult> {
  const apiKey = process.env.DECISION_API_KEY;
  const model = process.env.DECISION_MODEL || "vllm-sr/d3-flash";

  if (!apiKey) {
    throw new Error("Decision Model is not configured. Add DECISION_API_KEY to .env.local.");
  }

  const startedAt = Date.now();

  const response = await fetch("https://decision.vllm-sr.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      state: JSON.stringify({
        subject: ticket.subject,
        body: ticket.body,
      }),
      questions: {
        category: {
          type: "choice",
          instructions: "Choose the best support ticket category.",
          criteria: {
            technical_bug: "Software malfunction, error, outage, or broken feature.",
            feature_request: "Request for a new capability or improvement.",
            account: "Login, access, profile, or account management.",
            billing: "Payment, invoice, refund, subscription charge, or billing issue.",
          },
        },
        priority: {
          type: "choice",
          instructions: "Choose the ticket priority based on impact and urgency.",
          criteria: {
            low: "Minor inconvenience, workaround available, no urgency.",
            medium: "Meaningful issue affecting some work, but not a critical outage.",
            high: "Urgent, service-blocking, security-sensitive, or major customer impact.",
          },
        },
        human_review: {
          type: "noul",
          instructions: "Does this ticket require human review because it is sensitive, unclear, high impact, or needs human intervention?",
          criteria: {
            false: "Can be handled routinely with the classification.",
            true: "Needs human attention or careful review.",
          },
        },
      },
    }),
    signal: AbortSignal.timeout(35_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Decision Model request failed (${response.status}): ${detail}`);
  }

  const raw: unknown = await response.json();
  const parsed = decisionResponseSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error("Decision Model returned an unexpected response format.");
  }

  const result = parsed.data;
  const reviewProbability = result.answers.human_review.noul;

  return {
    category: result.answers.category.choice,
    priority: result.answers.priority.choice,
    needs_human_review: reviewProbability >= 0.5,
    reasoning:
      `Decision Model classified this as ${result.answers.category.choice} ` +
      `priority ${result.answers.priority.choice}. ` +
      `Estimated human-review probability: ${(reviewProbability * 100).toFixed(1)}%.`,
    model: result.model || model,
    inputTokens: result.usage?.input_tokens ?? 0,
    latencyMs: Date.now() - startedAt,
  };
}
