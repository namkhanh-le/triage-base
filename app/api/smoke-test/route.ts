
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { classifyTicket, type TicketInput, type TriageStrategy } from "../../../lib/triage-service";

export const maxDuration = 300;

const requestSchema = z.object({
  dataset: z.enum(["labelled", "unlabelled"]),
  sampleSize: z.number().int().min(1).max(100),
  strategy: z.enum(["llm", "dm", "dm+llm"]).default("llm"),
});

type LabelledTicket = TicketInput & {
  category: "technical_bug" | "feature_request" | "account" | "billing";
  priority: "low" | "medium" | "high";
  needs_human_review: boolean;
};

type TicketEvaluation = {
  ticketId: string;
  predictedCategory: string;
  expectedCategory: string | null;
  predictedPriority: string;
  expectedPriority: string | null;
  predictedHumanReview: boolean;
  expectedHumanReview: boolean | null;
};

type RunRecord = {
  id: string;
  createdAt: string;
  dataset: "labelled" | "unlabelled";
  strategy: TriageStrategy;
  requestedSampleSize: number;
  completed: number;
  failed: number;
  accuracy: {
    category: number | null;
    priority: number | null;
    needsHumanReview: number | null;
    allFields: number | null;
  };
  mismatches: {
    category: number;
    priority: number;
    needsHumanReview: number;
    allFields: number;
  };
  averageLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  model: string;
  status: "completed" | "partial" | "failed";
  errors: string[];
  ticketResults: TicketEvaluation[];
};

const dataDirectory = path.join(process.cwd(), "data");
const logPath = path.join(dataDirectory, "triage_runs.json");

async function readRuns(): Promise<RunRecord[]> {
  try {
    const content = await readFile(logPath, "utf8");
    const parsed: unknown = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

function ratePerMillion(name: string): number {
  const value = Number(process.env[name] ?? "0");
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function percent(correct: number, total: number, labelled: boolean) {
  return labelled && total > 0
    ? Math.round((correct / total) * 10000) / 100
    : null;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Choose a dataset, strategy, and sample size from 1 to 100." },
      { status: 400 },
    );
  }

  const { dataset, sampleSize, strategy } = parsed.data;
  const filename =
    dataset === "labelled"
      ? "support_tickets_100_labelled.json"
      : "support_tickets_500.json";

  try {
    const rawFile = await readFile(path.join(dataDirectory, filename), "utf8");
    const rawTickets: unknown = JSON.parse(rawFile);

    if (!Array.isArray(rawTickets)) {
      throw new Error(`${filename} must contain a JSON array.`);
    }

    const selected = [...rawTickets]
      .sort(() => Math.random() - 0.5)
      .slice(0, sampleSize);

    const errors: string[] = [];
    const ticketResults: TicketEvaluation[] = [];
    let completed = 0;
    let categoryCorrect = 0;
    let priorityCorrect = 0;
    let reviewCorrect = 0;
    let allCorrect = 0;
    let categoryMismatch = 0;
    let priorityMismatch = 0;
    let reviewMismatch = 0;
    let allMismatch = 0;
    let totalLatency = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let model = "unknown";

    for (let index = 0; index < selected.length; index++) {
      const row = selected[index] as Record<string, unknown>;

      if (typeof row.body !== "string" || typeof row.subject !== "string") {
        errors.push(`Ticket ${index + 1}: missing subject or body.`);
        continue;
      }

      const ticket: TicketInput = {
        ticket_id:
          typeof row.ticket_id === "string" ? row.ticket_id : undefined,
        subject: row.subject,
        body: row.body,
      };

      try {
        const outcome = await classifyTicket(ticket, strategy);
        completed++;
        totalLatency += outcome.latencyMs;
        inputTokens += outcome.usage.inputTokens;
        outputTokens += outcome.usage.outputTokens;
        model = outcome.model;

        const labelled =
          dataset === "labelled" ? (row as unknown as LabelledTicket) : null;

        ticketResults.push({
          ticketId: ticket.ticket_id ?? `Ticket ${index + 1}`,
          predictedCategory: outcome.result.category,
          expectedCategory: labelled?.category ?? null,
          predictedPriority: outcome.result.priority,
          expectedPriority: labelled?.priority ?? null,
          predictedHumanReview: outcome.result.needs_human_review,
          expectedHumanReview: labelled?.needs_human_review ?? null,
        });

        if (labelled) {
          const categoryOk = outcome.result.category === labelled.category;
          const priorityOk = outcome.result.priority === labelled.priority;
          const reviewOk =
            outcome.result.needs_human_review === labelled.needs_human_review;
          const allOk = categoryOk && priorityOk && reviewOk;

          if (categoryOk) categoryCorrect++;
          else categoryMismatch++;

          if (priorityOk) priorityCorrect++;
          else priorityMismatch++;

          if (reviewOk) reviewCorrect++;
          else reviewMismatch++;

          if (allOk) allCorrect++;
          else allMismatch++;
        }
      } catch (error) {
        errors.push(
          `${ticket.ticket_id ?? `Ticket ${index + 1}`}: ${
            error instanceof Error ? error.message : "Classification failed."
          }`,
        );
      }
    }

    const totalTokens = inputTokens + outputTokens;
    const estimatedCost =
      (inputTokens / 1_000_000) *
        ratePerMillion("LLM_INPUT_COST_PER_MILLION") +
      (outputTokens / 1_000_000) *
        ratePerMillion("LLM_OUTPUT_COST_PER_MILLION");

    const isLabelled = dataset === "labelled";

    const run: RunRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      dataset,
      strategy,
      requestedSampleSize: sampleSize,
      completed,
      failed: selected.length - completed,
      accuracy: {
        category: percent(categoryCorrect, completed, isLabelled),
        priority: percent(priorityCorrect, completed, isLabelled),
        needsHumanReview: percent(reviewCorrect, completed, isLabelled),
        allFields: percent(allCorrect, completed, isLabelled),
      },
      mismatches: {
        category: categoryMismatch,
        priority: priorityMismatch,
        needsHumanReview: reviewMismatch,
        allFields: allMismatch,
      },
      averageLatencyMs: completed ? Math.round(totalLatency / completed) : 0,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost,
      model,
      status:
        completed === 0
          ? "failed"
          : completed < selected.length
            ? "partial"
            : "completed",
      errors,
      ticketResults,
    };

    await mkdir(dataDirectory, { recursive: true });
    const previousRuns = await readRuns();

    await writeFile(
      logPath,
      JSON.stringify([run, ...previousRuns], null, 2),
      "utf8",
    );

    return Response.json({ run });
  } catch (error) {
    console.error("Smoke test error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Smoke test failed. Check the server terminal.",
      },
      { status: 500 },
    );
  }
}
