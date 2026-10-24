
import OpenAI from "openai";
import { triageResponseSchema } from "./triage";
import { classifyWithDecisionModel } from "./decision-service";

export type TicketInput = {
  ticket_id?: string;
  subject: string;
  body: string;
};

export type TriageStrategy = "llm" | "dm" | "dm+llm";

export type TriageRunResult = {
  result: {
    category: "technical_bug" | "feature_request" | "account" | "billing";
    priority: "low" | "medium" | "high";
    needs_human_review: boolean;
    reasoning: string;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
  strategy: TriageStrategy;
  latencyMs: number;
};

async function classifyWithLLM(ticket: TicketInput) {
  if (
    !process.env.LLM_API_KEY ||
    !process.env.LLM_BASE_URL ||
    !process.env.LLM_MODEL
  ) {
    throw new Error("The LLM service is not configured.");
  }

  const client = new OpenAI({
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
    timeout: 45_000,
    maxRetries: 1,
  });

  const completion = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    messages: [
      {
        role: "system",
        content: `You classify customer support tickets.
Return only a JSON object with these fields:
- category: one of "technical_bug", "feature_request", "account", "billing"
- priority: one of "low", "medium", "high"
- needs_human_review: a boolean
- reasoning: a short explanation

Use both the subject and body. The subject may be empty.
Use high priority for urgent or service-blocking problems.
Set needs_human_review to true when the issue is sensitive, unclear, or needs human intervention.`,
      },
      {
        role: "user",
        content: JSON.stringify(ticket),
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("The LLM returned no result.");
  }

  let raw: unknown;

  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("The LLM did not return valid JSON.");
  }

  const validated = triageResponseSchema.safeParse(raw);

  if (!validated.success) {
    throw new Error("The LLM returned an invalid triage result.");
  }

  return {
    result: validated.data,
    model: completion.model,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
}

export async function classifyTicket(
  ticket: TicketInput,
  strategy: TriageStrategy = "llm",
): Promise<TriageRunResult> {
  const startedAt = Date.now();

  if (strategy === "llm") {
    const llm = await classifyWithLLM(ticket);

    return {
      result: llm.result,
      usage: {
        inputTokens: llm.inputTokens,
        outputTokens: llm.outputTokens,
        totalTokens: llm.inputTokens + llm.outputTokens,
      },
      model: llm.model,
      strategy,
      latencyMs: Date.now() - startedAt,
    };
  }

  if (strategy === "dm") {
    const dm = await classifyWithDecisionModel(ticket);

    return {
      result: {
        category: dm.category,
        priority: dm.priority,
        needs_human_review: dm.needs_human_review,
        reasoning: dm.reasoning,
      },
      usage: {
        inputTokens: dm.inputTokens,
        outputTokens: 0,
        totalTokens: dm.inputTokens,
      },
      model: dm.model,
      strategy,
      latencyMs: Date.now() - startedAt,
    };
  }

  // Hybrid: use the Decision Model for category and priority,
  // and the LLM for the explanation. Human review is enabled
  // if either model flags it.
  const [dm, llm] = await Promise.all([
    classifyWithDecisionModel(ticket),
    classifyWithLLM(ticket),
  ]);

  return {
    result: {
      category: dm.category,
      priority: dm.priority,
      needs_human_review:
        dm.needs_human_review || llm.result.needs_human_review,
      reasoning:
        `Decision Model: ${dm.reasoning} ` +
        `LLM explanation: ${llm.result.reasoning}`,
    },
    usage: {
      inputTokens: dm.inputTokens + llm.inputTokens,
      outputTokens: llm.outputTokens,
      totalTokens: dm.inputTokens + llm.inputTokens + llm.outputTokens,
    },
    model: `${dm.model} + ${llm.model}`,
    strategy,
    latencyMs: Date.now() - startedAt,
  };
}
