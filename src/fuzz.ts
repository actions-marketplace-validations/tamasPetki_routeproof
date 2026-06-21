// Fuzz mode — the blind-spot finder. A hand-written intent suite only tests the
// queries you thought of. Fuzz writes the ones you didn't: it reads your tool
// descriptions, asks a model to invent realistic user queries for each tool IN A
// USER'S OWN WORDS, then routes them like any other intent. The ones that
// mis-route are the gaps — plausible questions your descriptions don't own.
//
// The prompt deliberately pushes for vocabulary the description does NOT use. If
// the generator just paraphrases the description, every query trivially routes
// right and fuzz finds nothing; the whole value is in the user-words-vs-doc-words
// gap (the "cash" that never said it meant "stablecoins").
//
// Honest limitation (named, not hidden): the same model class generates and
// routes, so fuzz surfaces blind spots relative to that model's sense of how
// users talk — it's a discovery aid that proposes queries worth pinning, not a
// proof of coverage. Promote the keepers into a real suite and baseline them.

import type { ToolSpec, Intent } from "./types.ts";
import type { Provider } from "./providers/types.ts";

/** Build the generation prompt for one target tool. Exported for testing. */
export function fuzzPrompt(tools: ToolSpec[], target: ToolSpec, perTool: number): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return [
    "You are stress-testing an MCP server's tool descriptions by imagining how REAL users phrase requests. The descriptions are the only thing a host's model sees when routing, so the test is whether they cover how people actually ask — not how the tool describes itself.",
    "",
    "All tools the host can choose from:",
    toolList,
    "",
    `Write ${perTool} realistic user queries that SHOULD be answered by \`${target.name}\` (and by that tool specifically, not the others).`,
    "",
    "Rules:",
    "- Write as a real person would type or speak: casual, indirect, varied in length and phrasing.",
    "- Do NOT reuse the wording from this tool's own description. Use the synonyms, slang, and indirect phrasings a real user would — the point is to probe the gap between how the tool is described and how people actually ask.",
    `- Each query must be clearly answerable by ${target.name}, not by another tool in the list.`,
    "- No numbering, no commentary, no explanation.",
    "",
    `Return ONLY a JSON array of exactly ${perTool} strings.`,
  ].join("\n");
}

/** Generate synthetic intents that should route to `target`. */
export async function generateIntentsForTool(
  provider: Provider,
  tools: ToolSpec[],
  target: ToolSpec,
  perTool: number,
): Promise<Intent[]> {
  const raw = await provider.complete(fuzzPrompt(tools, target, perTool));
  return parseQueries(raw, perTool).map((query, i) => ({
    id: `fuzz-${target.name}-${i + 1}`,
    query,
    expect: target.name,
    note: "generated",
  }));
}

/**
 * Tolerant parser: prefer a JSON array (the asked-for shape), fall back to
 * line-splitting if the model fenced it, numbered it, or chatted around it.
 */
export function parseQueries(raw: string, limit: number): string[] {
  const arr = tryJsonArray(raw);
  const lines = arr ?? raw.split(/\r?\n/).map(stripLinePrefix);
  return lines.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, limit);
}

function tryJsonArray(raw: string): string[] | null {
  const m = raw.match(/\[[\s\S]*\]/); // first [...] block, even if fenced or prefixed
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(m[0]);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    /* fall through to line-splitting */
  }
  return null;
}

function stripLinePrefix(line: string): string {
  return line
    .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "") // "1. ", "- ", "* ", "• "
    .replace(/^["'`]+|["'`,]+$/g, "") // surrounding quotes / trailing comma
    .trim();
}
