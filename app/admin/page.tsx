
"use client";

import { useEffect, useState } from "react";

type Strategy = "llm" | "dm" | "dm+llm";

type TicketEvaluation = {
  ticketId: string;
  predictedCategory: string;
  expectedCategory: string | null;
  predictedPriority: string;
  expectedPriority: string | null;
  predictedHumanReview: boolean;
  expectedHumanReview: boolean | null;
};

type Run = {
  id: string;
  createdAt: string;
  dataset: "labelled" | "unlabelled";
  strategy: Strategy;
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
  status: string;
  errors: string[];
  ticketResults?: TicketEvaluation[];
};

export default function AdminPage() {
  const [dataset, setDataset] = useState<"labelled" | "unlabelled">("labelled");
  const [sampleSize, setSampleSize] = useState("10");
  const [strategy, setStrategy] = useState<Strategy>("llm");
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadRuns() {
    const response = await fetch("/api/admin/runs", { cache: "no-store" });
    const data: unknown = await response.json();

    if (
      !response.ok ||
      typeof data !== "object" ||
      data === null ||
      !("runs" in data) ||
      !Array.isArray(data.runs)
    ) {
      throw new Error("Unable to load previous runs.");
    }

    setRuns(data.runs as Run[]);
  }

  useEffect(() => {
    loadRuns()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load runs.");
      })
      .finally(() => setPageLoading(false));
  }, []);

  async function startRun() {
    const size = Number(sampleSize);

    if (!Number.isInteger(size) || size < 1 || size > 100) {
      setError("Sample size must be between 1 and 100.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/smoke-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset, sampleSize: size, strategy }),
      });

      const data: unknown = await response.json();

      if (
        !response.ok ||
        typeof data !== "object" ||
        data === null ||
        !("run" in data)
      ) {
        const detail =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Smoke test failed.";
        throw new Error(detail);
      }

      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Smoke test failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="chat">
      <header>
        <h1>Smoke tests and admin</h1>
        <p>Evaluate the LLM, Decision Model, and hybrid strategies.</p>
        <p><a href="/">← Back to chat and triage</a></p>
      </header>

      <section>
        <h2>Start a smoke test</h2>

        <label htmlFor="dataset">Dataset</label>
        <select
          id="dataset"
          value={dataset}
          onChange={(event) =>
            setDataset(event.target.value as "labelled" | "unlabelled")
          }
          disabled={loading}
        >
          <option value="labelled">Labelled dataset (100 tickets)</option>
          <option value="unlabelled">Unlabelled dataset (500 tickets)</option>
        </select>

        <label htmlFor="strategy">Classification strategy</label>
        <select
          id="strategy"
          value={strategy}
          onChange={(event) => setStrategy(event.target.value as Strategy)}
          disabled={loading}
        >
          <option value="llm">LLM only</option>
          <option value="dm">Decision Model only</option>
          <option value="dm+llm">Decision Model + LLM</option>
        </select>

        <label htmlFor="sample-size">Sample size (1–100)</label>
        <input
          id="sample-size"
          type="number"
          min="1"
          max="100"
          value={sampleSize}
          onChange={(event) => setSampleSize(event.target.value)}
          disabled={loading}
        />

        <button onClick={startRun} disabled={loading}>
          {loading ? "Running — please wait..." : "Run smoke test"}
        </button>

        {error && <p role="alert">{error}</p>}
      </section>

      <hr />

      <section>
        <h2>Previous runs</h2>

        {pageLoading && <p>Loading previous runs…</p>}
        {!pageLoading && runs.length === 0 && <p>No runs recorded yet.</p>}

        {runs.map((run) => (
          <article className="message" key={run.id}>
            <h3>{new Date(run.createdAt).toLocaleString()}</h3>
            <p><strong>Status:</strong> {run.status}</p>
            <p><strong>Dataset:</strong> {run.dataset}</p>
            <p><strong>Strategy:</strong> {run.strategy ?? "llm (older run)"}</p>
            <p><strong>Requested sample:</strong> {run.requestedSampleSize}</p>
            <p><strong>Completed:</strong> {run.completed}</p>
            <p><strong>Failed:</strong> {run.failed}</p>
            <p><strong>Model:</strong> {run.model}</p>
            <p><strong>Average latency:</strong> {run.averageLatencyMs} ms</p>
            <p><strong>Input tokens:</strong> {run.inputTokens}</p>
            <p><strong>Output tokens:</strong> {run.outputTokens}</p>
            <p><strong>Total tokens:</strong> {run.totalTokens}</p>
            <p><strong>Estimated cost:</strong> ${run.estimatedCost.toFixed(6)}</p>

            {run.dataset === "labelled" && (
              <>
                <h4>Accuracy</h4>
                <p>Category: {run.accuracy.category ?? "N/A"}%</p>
                <p>Priority: {run.accuracy.priority ?? "N/A"}%</p>
                <p>Human review: {run.accuracy.needsHumanReview ?? "N/A"}%</p>
                <p>All fields correct: {run.accuracy.allFields ?? "N/A"}%</p>

                <h4>Mismatches</h4>
                <p>Category: {run.mismatches.category}</p>
                <p>Priority: {run.mismatches.priority}</p>
                <p>Human review: {run.mismatches.needsHumanReview}</p>
                <p>Any field mismatched: {run.mismatches.allFields}</p>
              </>
            )}

            {run.ticketResults && run.ticketResults.length > 0 && (
              <>
                <h4>Per-ticket predictions</h4>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Predicted category</th>
                        <th>Labelled category</th>
                        <th>Predicted priority</th>
                        <th>Labelled priority</th>
                        <th>Predicted review</th>
                        <th>Labelled review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.ticketResults.map((ticket) => (
                        <tr key={ticket.ticketId}>
                          <td>{ticket.ticketId}</td>
                          <td>{ticket.predictedCategory}</td>
                          <td>{ticket.expectedCategory ?? "N/A"}</td>
                          <td>{ticket.predictedPriority}</td>
                          <td>{ticket.expectedPriority ?? "N/A"}</td>
                          <td>{ticket.predictedHumanReview ? "Yes" : "No"}</td>
                          <td>
                            {ticket.expectedHumanReview === null
                              ? "N/A"
                              : ticket.expectedHumanReview
                                ? "Yes"
                                : "No"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {run.errors?.length > 0 && (
              <details>
                <summary>Errors ({run.errors.length})</summary>
                <ul>
                  {run.errors.map((message, index) => (
                    <li key={`${run.id}-error-${index}`}>{message}</li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
