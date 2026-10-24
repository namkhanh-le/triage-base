import OpenAI from "openai";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("message" in body) ||
    typeof body.message !== "string" ||
    !body.message.trim()
  ) {
    return Response.json(
      { error: "Please provide a non-empty message string." },
      { status: 400 },
    );
  }

  if (
    !process.env.LLM_API_KEY ||
    !process.env.LLM_BASE_URL ||
    !process.env.LLM_MODEL
  ) {
    return Response.json(
      { error: "The LLM API is not configured." },
      { status: 500 },
    );
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    });

    const completion = await client.chat.completions.create({
      model: process.env.LLM_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant for a support ticket triage application.",
        },
        {
          role: "user",
          content: body.message,
        },
      ],
    });

    const answer = completion.choices[0]?.message?.content;

    if (typeof answer !== "string") {
      throw new Error("The model returned no text.");
    }

    return Response.json({
      answer,
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
      },
      model: completion.model,
    });
  } catch (error) {
    console.error(
      "Chat API error:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return Response.json(
      { error: "The AI request failed. Check the server terminal for details." },
      { status: 502 },
    );
  }
}
