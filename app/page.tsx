
"use client";

import { useState, type FormEvent } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type TriageResult = {
  category: string;
  priority: string;
  needs_human_review: boolean;
  reasoning: string;
};

type TriageResponse = {
  ticket: {
    subject: string;
    body: string;
  };
  result: TriageResult;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
};

export default function HomePage() {
  const [strategy, setStrategy] = useState<"llm" | "dm" | "dm+llm">("llm");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [ticketBody, setTicketBody] = useState("");
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [triageResult, setTriageResult] = useState<TriageResponse | null>(null);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chatLoading || !text.trim()) return;

    const message = text.trim();
    const history = [
      ...messages.map(({ role, text }) => ({ role, content: text })),
      { role: "user" as const, content: message },
    ];

    setChatLoading(true);
    setChatError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const detail =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Unable to send your message.";
        throw new Error(detail);
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("answer" in data) ||
        typeof data.answer !== "string"
      ) {
        throw new Error("The server returned an invalid reply.");
      }

      setMessages((previous) => [
        ...previous,
        { role: "user", text: message },
        { role: "assistant", text: data.answer as string },
      ]);
      setText("");
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Unable to send your message.",
      );
    } finally {
      setChatLoading(false);
    }
  }

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (triageLoading || !subject.trim() || !ticketBody.trim()) return;

    setTriageLoading(true);
    setTriageError(null);
    setTriageResult(null);

    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket: {
            subject: subject.trim(),
            body: ticketBody.trim(),
          },
          strategy: "llm",
        }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const detail =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Unable to triage this ticket.";
        throw new Error(detail);
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("result" in data) ||
        !("usage" in data) ||
        !("model" in data)
      ) {
        throw new Error("The server returned an invalid triage result.");
      }

      setTriageResult(data as TriageResponse);
    } catch (error) {
      setTriageError(
        error instanceof Error ? error.message : "Unable to triage this ticket.",
      );
    } finally {
      setTriageLoading(false);
    }
  }

  return (
    <main className="chat">
      <h1>Support Ticket Triage</h1>
      <p>Classify a support ticket with AI, or chat with the assistant.</p>

      <section aria-labelledby="triage-heading">
        <h2 id="triage-heading">Triage a ticket</h2>
        <form onSubmit={submitTicket}>
          <label htmlFor="subject">Ticket subject</label>
          <input
            id="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            required
            disabled={triageLoading}
          />

          <label htmlFor="ticket-body">Ticket description</label>
          <textarea
            id="ticket-body"
            value={ticketBody}
            onChange={(event) => setTicketBody(event.target.value)}
            rows={4}
            required
            disabled={triageLoading}
          />

          <button
            type="submit"
            disabled={triageLoading || !subject.trim() || !ticketBody.trim()}
          >
            {triageLoading ? "Classifying..." : "Classify ticket"}
          </button>
          {triageError && <p role="alert">{triageError}</p>}
        </form>

        {triageResult && (
          <section aria-labelledby="result-heading">
            <h3 id="result-heading">Triage result</h3>
            <p><strong>Category:</strong> {triageResult.result.category}</p>
            <p><strong>Priority:</strong> {triageResult.result.priority}</p>
            <p>
              <strong>Human review:</strong>{" "}
              {triageResult.result.needs_human_review ? "Yes" : "No"}
            </p>
            <p><strong>Reasoning:</strong> {triageResult.result.reasoning}</p>
            <p><strong>Model:</strong> {triageResult.model}</p>
            <p><strong>Input tokens:</strong> {triageResult.usage.inputTokens}</p>
            <p><strong>Output tokens:</strong> {triageResult.usage.outputTokens}</p>
            <p><strong>Total tokens:</strong> {triageResult.usage.totalTokens}</p>
          </section>
        )}
      </section>

      <hr />

      <section aria-labelledby="chat-heading">
        <h2 id="chat-heading">Support chat</h2>
        <div
          className="messages"
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
        >
          {messages.length === 0 && <p>No messages yet.</p>}
          {messages.map((message, index) => (
            <div className={`message ${message.role}`} key={index}>
              <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
              <p>{message.text}</p>
            </div>
          ))}
        </div>

        <form onSubmit={sendMessage} aria-busy={chatLoading}>
          <label htmlFor="chat-message">Your message</label>
          <textarea
            id="chat-message"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            required
            disabled={chatLoading}
          />
          <button type="submit" disabled={chatLoading || !text.trim()}>
            {chatLoading ? "Sending..." : "Send message"}
          </button>
          {chatError && <p role="alert">{chatError}</p>}
        </form>
      </section>
    </main>
  );
}
