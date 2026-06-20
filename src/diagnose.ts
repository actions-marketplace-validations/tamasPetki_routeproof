// The diagnosis pass — the part that makes routeproof actionable.
//
// A score tells you that you have a misroute. This tells you WHY (what wording
// was missing, ambiguous, or overlapping) and proposes the concrete description
// edit that would fix it. It runs only on misroutes, so it costs nothing when a
// suite is green.

import type { ToolSpec, Intent, Diagnosis } from "./types.ts";
import type { Provider } from "./providers/types.ts";

export async function diagnoseMisroute(
  provider: Provider,
  tools: ToolSpec[],
  intent: Intent,
  picked: string | null,
): Promise<Diagnosis> {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  const pickedStr = picked ?? "no tool";
  const shouldHave =
    intent.expect === "none"
      ? "It should have called NO tool — this query is out of scope for these tools."
      : `It should have called: ${intent.expect}`;

  const prompt = [
    "You are debugging an MCP server's tool descriptions — the exact text an AI host uses to decide which tool to call. The descriptions ARE the interface; if routing is wrong, the wording is the bug.",
    "",
    "Tools the host sees:",
    toolList,
    "",
    `A user asked: "${intent.query}"`,
    `The host called: ${pickedStr}`,
    shouldHave,
    "",
    "Explain WHY the descriptions led to the wrong choice (what wording was missing, ambiguous, or overlapping between tools), then propose ONE concrete, minimal edit — name the tool whose description to change and the exact phrase to add or clarify. Do not suggest changing code or schemas; only the description text.",
    "",
    "Answer in exactly this format, nothing else:",
    "WHY: <one or two sentences>",
    "FIX: <which tool's description, and the specific phrase to add or change>",
  ].join("\n");

  return parseDiagnosis(await provider.complete(prompt));
}

/** Tolerant parser — if the model ignores the format, the whole reply becomes `why`. */
export function parseDiagnosis(text: string): Diagnosis {
  const whyMatch = text.match(/WHY:\s*([\s\S]*?)(?:\n\s*FIX:|$)/i);
  const fixMatch = text.match(/FIX:\s*([\s\S]*)$/i);
  const why = whyMatch?.[1]?.trim() || text.trim();
  const suggestedFix = fixMatch?.[1]?.trim() || "";
  return { why, suggestedFix };
}
