// Core types for routeproof — MCP tool-routing evaluation.

/** A tool exactly as an AI host sees it: name, description, input schema. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** One thing a user might ask, and the tool that should handle it. */
export interface Intent {
  id: string;
  query: string;
  /** Expected tool name. Use "none" to assert that NO tool should be called. */
  expect: string;
  /** Optional human note; ignored by the evaluator. */
  note?: string;
}

export interface IntentSuite {
  /** Optional default server command, overridable on the CLI. */
  server?: string;
  intents: Intent[];
}

/** One model sample for one intent — what the host's-eye model decided. */
export interface RouteSample {
  /** Tool name the model chose, or null for "no tool fits". */
  picked: string | null;
  /** The model's stated reason (why none, or — later — why this one). */
  reason: string;
}

/** Why a misroute happened, and the concrete edit that would fix it. */
export interface Diagnosis {
  why: string;
  suggestedFix: string;
}

/** Aggregated result for one intent across N samples. */
export interface IntentResult {
  intent: Intent;
  samples: RouteSample[];
  /** Most frequent pick across samples. */
  pick: string | null;
  /** Fraction of samples that chose `pick` (0..1). */
  confidence: number;
  /** True if the majority pick matches intent.expect. */
  pass: boolean;
  /** Passed, but below the confidence threshold — routing is a coin flip. */
  flaky?: boolean;
  /** Populated for misroutes AND flaky passes: why it went wrong + how to fix it. */
  diagnosis?: Diagnosis;
}

export interface EvalReport {
  server: string;
  model: string;
  samplesPerIntent: number;
  /** Confidence below which a passing intent is flagged as flaky (0..1). */
  minConfidence?: number;
  tools: ToolSpec[];
  results: IntentResult[];
  score: { passed: number; total: number };
}
