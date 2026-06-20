import { describe, expect, test } from "bun:test";
import { summarize, toMarkdown } from "../src/report.ts";
import type { EvalReport, IntentResult } from "../src/types.ts";

const results: IntentResult[] = [
  {
    intent: { id: "own", query: "what do I own?", expect: "get_holdings" },
    samples: [{ picked: "get_holdings", reason: "called get_holdings" }],
    pick: "get_holdings",
    confidence: 1,
    pass: true,
  },
  {
    intent: { id: "wallets", query: "which wallets am I tracking?", expect: "list_accounts" },
    samples: [{ picked: "get_holdings", reason: "triggers said 'exchanges', not 'wallets'" }],
    pick: "get_holdings",
    confidence: 1,
    pass: false,
  },
];

describe("summarize", () => {
  test("counts passes vs total", () => {
    expect(summarize(results)).toEqual({ passed: 1, total: 2 });
  });
});

describe("toMarkdown", () => {
  const md = toMarkdown({
    server: "npx demo mcp",
    model: "claude-haiku-4-5-20251001",
    samplesPerIntent: 1,
    tools: [],
    results,
    score: summarize(results),
  } satisfies EvalReport);

  test("shows the headline score", () => {
    expect(md).toContain("Routing score: 1/2 (50%)");
  });

  test("lists an Issues section with the model's reasoning fallback", () => {
    expect(md).toContain("## Issues (1)");
    expect(md).toContain("(misroute)");
    expect(md).toContain("which wallets");
    expect(md).toContain("triggers said 'exchanges', not 'wallets'");
  });

  test("flags a flaky pass (passed below confidence threshold) with its diagnosis", () => {
    const flaky = toMarkdown({
      server: "s",
      model: "m",
      samplesPerIntent: 5,
      minConfidence: 0.8,
      tools: [],
      results: [
        {
          intent: { id: "split", query: "stablecoins vs crypto?", expect: "get_allocations" },
          samples: [{ picked: "get_allocations", reason: "" }],
          pick: "get_allocations",
          confidence: 0.6,
          pass: true,
          flaky: true,
          diagnosis: { why: "overlap with get_holdings", suggestedFix: "clarify get_allocations" },
        },
      ],
      score: { passed: 1, total: 1 },
    });
    expect(flaky).toContain("⚠️ 1 flaky (passed below 80% confidence)");
    expect(flaky).toContain("(flaky)");
    expect(flaky).toContain("only 60% of the time");
    expect(flaky).toContain("**why:** overlap with get_holdings");
  });

  test("renders the diagnosis why + fix when present (instead of the thin reason)", () => {
    const withDiag = toMarkdown({
      server: "s",
      model: "m",
      samplesPerIntent: 1,
      tools: [],
      results: [
        {
          intent: { id: "split", query: "stablecoins vs crypto?", expect: "get_allocations" },
          samples: [{ picked: "get_holdings", reason: "called get_holdings" }],
          pick: "get_holdings",
          confidence: 1,
          pass: false,
          diagnosis: {
            why: "get_allocations never says it handles 'X vs Y' splits",
            suggestedFix: "add 'stablecoins vs crypto' to get_allocations' description",
          },
        },
      ],
      score: { passed: 0, total: 1 },
    });
    expect(withDiag).toContain("**why:** get_allocations never says");
    expect(withDiag).toContain("**fix:** add 'stablecoins vs crypto'");
    expect(withDiag).not.toContain("called get_holdings"); // thin reason suppressed
  });

  test("escapes pipes so the table can't break", () => {
    const piped = toMarkdown({
      server: "s",
      model: "m",
      samplesPerIntent: 1,
      tools: [],
      results: [
        {
          intent: { id: "x", query: "a | b", expect: "t" },
          samples: [{ picked: "t", reason: "" }],
          pick: "t",
          confidence: 1,
          pass: true,
        },
      ],
      score: { passed: 1, total: 1 },
    });
    expect(piped).toContain("a \\| b");
  });
});
