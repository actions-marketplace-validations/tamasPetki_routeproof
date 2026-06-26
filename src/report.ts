// Turn eval results into something a developer can act on: a score, a table,
// and — for every misroute — what it picked instead and why. The "why" is the
// product; a bare percentage tells you that you have a problem, not where.

import type { EvalReport, IntentResult, Intent, ToolSpec, RouteMode, Tier } from "./types.ts";
import { resolveTier } from "./tiers.ts";

export function summarize(results: IntentResult[]): { passed: number; total: number } {
  return { passed: results.filter((r) => r.pass).length, total: results.length };
}

export function toMarkdown(report: EvalReport): string {
  const { score } = report;
  const pct = score.total ? Math.round((score.passed / score.total) * 100) : 0;
  const flakyCount = report.results.filter((r) => r.flaky).length;
  const minPct = Math.round((report.minConfidence ?? 0.8) * 100);
  const lines: string[] = [];

  lines.push(`# routeproof report`, "");
  // Name the mode only when it's the non-default `select` (forced pick), so
  // existing host-mode reports and pinned baselines stay byte-identical.
  const modeNote = report.mode === "select" ? "  ·  **Mode:** select (forced pick)" : "";
  lines.push(
    `**Server:** \`${report.server}\`  ·  **Model:** ${report.model}  ·  **Samples/intent:** ${report.samplesPerIntent}${modeNote}`,
    "",
  );
  const escalations = report.results.filter((r) => r.escalation);
  let headline = `**Routing score: ${score.passed}/${score.total} (${pct}%)**`;
  if (flakyCount) headline += `  ·  ⚠️ ${flakyCount} flaky (passed below ${minPct}% confidence)`;
  if (escalations.length) headline += `  ·  🚨 ${escalations.length} privilege-escalating`;
  lines.push(headline, "");

  // Lead with the escalations: a misroute that crossed a capability boundary is a
  // safety issue, not just a wrong answer, and the routing score alone hides it.
  const esc1 = escalationSection(report.results);
  if (esc1.length) lines.push(...esc1, "");

  lines.push(`| intent | query | expected | picked | conf | |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of report.results) {
    const conf = `${Math.round(r.confidence * 100)}%`;
    const mark = r.pass ? (r.flaky ? "⚠️" : "✅") : "❌";
    lines.push(
      `| ${r.intent.id} | ${esc(r.intent.query)} | \`${r.intent.expect}\` | \`${r.pick ?? "none"}\` | ${conf} | ${mark} |`,
    );
  }

  // Both hard misroutes and flaky passes are issues worth a fix.
  const issues = report.results.filter((r) => !r.pass || r.flaky);
  if (issues.length) {
    lines.push("", `## Issues (${issues.length})`);
    for (const r of issues) {
      const confPct = Math.round(r.confidence * 100);
      if (r.pass) {
        lines.push("", `### ⚠️ ${r.intent.id} (flaky) — "${esc(r.intent.query)}"`);
        lines.push(
          `- routes to \`${r.pick ?? "none"}\` only ${confPct}% of the time (${r.samples.length} samples); the rest go elsewhere. Expected \`${r.intent.expect}\`.`,
        );
      } else {
        lines.push("", `### ❌ ${r.intent.id} (misroute) — "${esc(r.intent.query)}"`);
        lines.push(
          `- expected \`${r.intent.expect}\`, got \`${r.pick ?? "none"}\` (${confPct}% of ${r.samples.length} samples)`,
        );
      }
      if (r.diagnosis) {
        lines.push(`- **why:** ${esc(r.diagnosis.why)}`);
        if (r.diagnosis.suggestedFix) lines.push(`- **fix:** ${esc(r.diagnosis.suggestedFix)}`);
      } else {
        const reason = r.samples.find((s) => (s.picked ?? "none") === (r.pick ?? "none"))?.reason;
        if (reason) lines.push(`- model's reasoning: ${esc(reason)}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * The 🚨 privilege-escalation section, as markdown lines (empty when none).
 * Shared by the standard report and the regression gate so an escalating
 * misroute reads identically wherever it surfaces.
 */
export function escalationSection(results: IntentResult[]): string[] {
  const escalations = results.filter((r) => r.escalation);
  if (!escalations.length) return [];
  const lines: string[] = [];
  lines.push(`## 🚨 Privilege-escalating misroutes (${escalations.length})`);
  lines.push(
    "These queries reached a more-privileged tool than they should have — a wrong pick that also crosses a capability boundary. Fix these first.",
  );
  for (const r of escalations) {
    const e = r.escalation!;
    const detail =
      e.from === "none"
        ? `should route to **no tool**, but a **${e.to}**-tier tool \`${r.pick}\` answered it`
        : `expected \`${r.intent.expect}\` (**${e.from}**), got \`${r.pick}\` (**${e.to}**)`;
    lines.push("", `### 🚨 ${r.intent.id} — "${esc(r.intent.query)}"`);
    lines.push(`- ${detail}`);
  }
  return lines;
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Dry-run: confirm a setup WITHOUT a model call or an API key, and print the
 * exact host's-eye view the routing model would receive. This is the no-key
 * first win — a cloner can see their suite parse, their server handshake, and
 * the routing menu the model commits against, before spending a single credit.
 * The same view doubles as an offline CI smoke test.
 */
export function dryRunMarkdown(input: {
  server: string;
  mode: RouteMode;
  suitePath?: string;
  intents: Intent[];
  tools: ToolSpec[];
  tiers?: Record<string, Tier>;
  unknown: Array<{ id: string; expect: string }>;
  fuzz: boolean;
  fuzzPerTool: number;
}): string {
  const { server, mode, suitePath, intents, tools, tiers, unknown, fuzz, fuzzPerTool } = input;
  const hasTiers = !!tiers && Object.keys(tiers).length > 0;
  const lines: string[] = [];

  lines.push(`# routeproof — dry run`, "");
  lines.push(
    "No model calls, no API key needed. This confirms your setup and shows the",
    "host's-eye view the routing model would get — name, description, schema.",
    "",
  );
  const modeNote = mode === "select" ? "  ·  **Mode:** select (forced pick)" : "  ·  **Mode:** host";
  lines.push(`**Server:** \`${server}\`${modeNote}`, "");

  // The checks, as the user-visible confirmations they are.
  if (fuzz) {
    lines.push(`- ✓ fuzz mode: would generate ${fuzzPerTool} queries/tool from the descriptions below`);
  } else {
    const tierNote = hasTiers ? `  ·  ${Object.keys(tiers!).length} tier rule(s) declared` : "";
    lines.push(`- ✓ suite parsed: \`${suitePath}\` — ${intents.length} intent(s)${tierNote}`);
  }
  lines.push(`- ✓ server handshake OK: ${tools.length} tool(s) advertised`);
  if (unknown.length) {
    lines.push(
      `- ⚠️ ${unknown.length} intent(s) expect a tool this server doesn't advertise (typo?): ` +
        unknown.map((u) => `\`${u.id}\` → \`${u.expect}\``).join(", "),
    );
  }
  lines.push("");

  // The routing menu — the whole point. This is literally what the model sees.
  lines.push(`## Routing menu — exactly what the model sees (${tools.length} tools)`);
  lines.push(hasTiers ? `| tool | tier | args | description |` : `| tool | args | description |`);
  lines.push(hasTiers ? `|---|---|---|---|` : `|---|---|---|`);
  for (const t of tools) {
    const desc = esc(trunc(t.description || "—", 90));
    const args = argNames(t.inputSchema);
    if (hasTiers) {
      lines.push(`| \`${t.name}\` | ${resolveTier(t.name, tiers)} | ${args} | ${desc} |`);
    } else {
      lines.push(`| \`${t.name}\` | ${args} | ${desc} |`);
    }
  }

  // The intents the user wrote, so they can eyeball "did I assert the right thing".
  if (!fuzz && intents.length) {
    lines.push("", `## Intents to route (${intents.length})`);
    lines.push(`| intent | expects | query |`);
    lines.push(`|---|---|---|`);
    for (const i of intents) {
      lines.push(`| ${i.id} | \`${i.expect}\` | ${esc(trunc(i.query, 80))} |`);
    }
  }

  lines.push(
    "",
    unknown.length
      ? "Fix the typo above, then set ANTHROPIC_API_KEY and drop `--dry-run` to evaluate routing."
      : "✓ Setup looks good. Set ANTHROPIC_API_KEY and drop `--dry-run` to evaluate routing.",
  );
  return lines.join("\n") + "\n";
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// The argument names the model sees for a tool, from its JSON-Schema properties.
function argNames(schema: unknown): string {
  const props =
    schema && typeof schema === "object" ? (schema as { properties?: unknown }).properties : undefined;
  if (!props || typeof props !== "object") return "—";
  const keys = Object.keys(props as Record<string, unknown>);
  if (!keys.length) return "—";
  const shown = keys.slice(0, 4).join(", ");
  return keys.length > 4 ? `${shown}, …` : shown;
}
