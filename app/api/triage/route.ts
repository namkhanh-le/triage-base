

import { triageRequestSchema } from "../../../lib/triage";
import { classifyTicket } from "../../../lib/triage-service";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = triageRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid ticket. Please provide a subject and body." },
      { status: 400 },
    );
  }

  try {
    const outcome = await classifyTicket(
      parsed.data.ticket,
      parsed.data.strategy,
    );

    return Response.json({
      ticket: parsed.data.ticket,
      result: outcome.result,
      usage: outcome.usage,
      model: outcome.model,
      latencyMs: outcome.latencyMs,
      strategy: outcome.strategy,
    });
  } catch (error) {
    console.error(
      "Triage API error:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Triage failed. Check the server terminal for details.",
      },
      { status: 502 },
    );
  }
}
