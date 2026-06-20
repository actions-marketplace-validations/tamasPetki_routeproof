import { describe, expect, test } from "bun:test";
import { parseDiagnosis, diagnoseMisroute } from "../src/diagnose.ts";
import type { Provider } from "../src/providers/types.ts";
import type { ToolSpec } from "../src/types.ts";

describe("parseDiagnosis", () => {
  test("splits a well-formed WHY/FIX reply", () => {
    const d = parseDiagnosis(
      "WHY: nothing in get_allocations says it answers 'X vs Y' breakdowns.\nFIX: add 'stablecoins vs crypto split' to get_allocations.",
    );
    expect(d.why).toBe("nothing in get_allocations says it answers 'X vs Y' breakdowns.");
    expect(d.suggestedFix).toBe("add 'stablecoins vs crypto split' to get_allocations.");
  });

  test("is case-insensitive and tolerates extra whitespace", () => {
    const d = parseDiagnosis("why:  a\n\nfix:  b\n");
    expect(d.why).toBe("a");
    expect(d.suggestedFix).toBe("b");
  });

  test("falls back to whole text as 'why' when the format is ignored", () => {
    const d = parseDiagnosis("the model just rambled without labels");
    expect(d.why).toBe("the model just rambled without labels");
    expect(d.suggestedFix).toBe("");
  });
});

describe("diagnoseMisroute", () => {
  const tools: ToolSpec[] = [
    { name: "get_holdings", description: "what you own", inputSchema: {} },
    { name: "get_allocations", description: "breakdown by dimension", inputSchema: {} },
  ];

  test("passes the host's-eye tool list + the wrong pick to the model and returns parsed output", async () => {
    let seenPrompt = "";
    const provider: Provider = {
      model: "fake",
      async route() {
        return { picked: null, reason: "" };
      },
      async complete(prompt: string) {
        seenPrompt = prompt;
        return "WHY: overlap between holdings and allocations.\nFIX: get_allocations should mention 'vs' comparisons.";
      },
    };
    const d = await diagnoseMisroute(
      provider,
      tools,
      { id: "x", query: "stablecoins vs crypto?", expect: "get_allocations" },
      "get_holdings",
    );
    // The prompt must contain the descriptions, the query, and both tools — the host's-eye view.
    expect(seenPrompt).toContain("get_allocations: breakdown by dimension");
    expect(seenPrompt).toContain("stablecoins vs crypto?");
    expect(seenPrompt).toContain("get_holdings");
    expect(d.why).toContain("overlap");
    expect(d.suggestedFix).toContain("vs");
  });

  test("frames an expect:none miss as out-of-scope", async () => {
    let seenPrompt = "";
    const provider: Provider = {
      model: "fake",
      async route() {
        return { picked: null, reason: "" };
      },
      async complete(prompt: string) {
        seenPrompt = prompt;
        return "WHY: x\nFIX: y";
      },
    };
    await diagnoseMisroute(
      provider,
      tools,
      { id: "j", query: "tell me a joke", expect: "none" },
      "get_holdings",
    );
    expect(seenPrompt.toLowerCase()).toContain("out of scope");
  });
});
