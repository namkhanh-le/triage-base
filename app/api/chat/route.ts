
import OpenAI from "openai";
import { z } from "zod";

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(50),
});

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

  const parsed = chatRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        error:
          "Invalid chat history. Send between 1 and 50 non-empty user or assistant messages.",
      },
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
            "You are a helpful assistant for a support ticket triage application. Use the conversation history to answer the user's latest message.",
        },
        ...parsed.data.messages,
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
      {
        error:
          "The AI request failed. Check the server terminal for details.",
      },
      { status: 502 },
    );
  }
}
