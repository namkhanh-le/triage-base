
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  try {
    const logPath = path.join(process.cwd(), "data", "triage_runs.json");
    const content = await readFile(logPath, "utf8");
    const runs: unknown = JSON.parse(content);

    if (!Array.isArray(runs)) {
      throw new Error("The run log has an invalid format.");
    }

    return Response.json({ runs });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return Response.json({ runs: [] });
    }

    console.error("Admin runs error:", error);
    return Response.json(
      { error: "Unable to read smoke-test history." },
      { status: 500 },
    );
  }
}
