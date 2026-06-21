import { describe, expect, test } from "bun:test";
import { fuzzPrompt, parseQueries, generateIntentsForTool } from "../src/fuzz.ts";
import type { Provider } from "../src/providers/types.ts";
import type { ToolSpec } from "../src/types.ts";

const TOOLS: ToolSpec[] = [
  { name: "get_holdings", description: "what you own across venues", inputSchema: {} },
  { name: "get_allocations", description: "breakdown by asset class", inputSchema: {} },
];

/** Fake provider whose complete() returns a scripted generation reply. */
function fakeGen(reply: string): Provider {
  return {
    model: "fake",
    async route() {
      return { picked: null, reason: "" };
    },
    async complete() {
      return reply;
    },
  };
}

describe("fuzzPrompt", () => {
  const p = fuzzPrompt(TOOLS, TOOLS[1]!, 4);

  test("targets the right tool and asks for the right count", () => {
    expect(p).toContain("get_allocations");
    expect(p).toContain("JSON array of exactly 4 strings");
  });

  test("lists every tool so the model can disambiguate", () => {
    expect(p).toContain("get_holdings");
    expect(p).toContain("get_allocations");
  });

  test("pushes for user vocabulary, NOT the description's words (the whole point)", () => {
    expect(p).toMatch(/do NOT reuse the wording/i);
  });
});

describe("parseQueries", () => {
  test("parses a clean JSON array", () => {
    expect(parseQueries('["how much do I own?", "show my bags"]', 5)).toEqual([
      "how much do I own?",
      "show my bags",
    ]);
  });

  test("digs the array out of fenced / chatty output", () => {
    const raw = 'Sure! Here you go:\n```json\n["a", "b", "c"]\n```\nHope that helps.';
    expect(parseQueries(raw, 5)).toEqual(["a", "b", "c"]);
  });

  test("falls back to line-splitting when there's no JSON, stripping numbering and quotes", () => {
    const raw = '1. "what do I hold?"\n2. show me everything\n- the whole picture';
    expect(parseQueries(raw, 5)).toEqual(["what do I hold?", "show me everything", "the whole picture"]);
  });

  test("respects the limit", () => {
    expect(parseQueries('["a","b","c","d"]', 2)).toEqual(["a", "b"]);
  });

  test("drops empty lines and non-string array members", () => {
    expect(parseQueries('["a", 3, "", "b"]', 5)).toEqual(["a", "b"]);
    expect(parseQueries("a\n\n\nb", 5)).toEqual(["a", "b"]);
  });
});

describe("generateIntentsForTool", () => {
  test("turns generated queries into intents that expect the target tool", async () => {
    const provider = fakeGen('["where is my cash sitting?", "stable vs risky split"]');
    const intents = await generateIntentsForTool(provider, TOOLS, TOOLS[1]!, 2);
    expect(intents).toHaveLength(2);
    expect(intents[0]).toEqual({
      id: "fuzz-get_allocations-1",
      query: "where is my cash sitting?",
      expect: "get_allocations",
      note: "generated",
    });
    expect(intents.every((i) => i.expect === "get_allocations")).toBe(true);
  });

  test("tolerates a non-JSON reply without crashing", async () => {
    // A refusal/prose reply has no JSON array, so it line-splits; we guarantee
    // no crash and a bounded result (junk routes to nothing, shows as a gap).
    const intents = await generateIntentsForTool(fakeGen("Sorry, I can't do that."), TOOLS, TOOLS[0]!, 3);
    expect(Array.isArray(intents)).toBe(true);
    expect(intents.length).toBeLessThanOrEqual(3);
  });
});
