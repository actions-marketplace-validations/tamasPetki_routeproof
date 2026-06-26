// Spawn a real MCP server over stdio and read its tool list — the exact
// surface a host consumes. We never look at the implementation; only what the
// server advertises, because that's all the routing model gets either.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolSpec } from "./types.ts";
import { tokenize } from "./shell.ts";
import { VERSION } from "./version.ts"; // identifies routeproof to the server in the MCP handshake

export async function loadToolsFromServer(command: string): Promise<ToolSpec[]> {
  const parts = tokenize(command);
  const cmd = parts[0];
  if (!cmd) throw new Error("Empty server command.");

  // Capture the child's stderr instead of inheriting it. A bad --server (a
  // mistyped script path, a syntax error in the server) makes Node print a raw
  // stack to stderr; inherited, that leaks straight to the user's terminal and
  // reads as "routeproof is broken" even though it's their typo. Piped, we fold
  // it into the one framed error below — the reason ("Cannot find module ...")
  // lands *inside* routeproof's own message instead of beside it.
  const transport = new StdioClientTransport({
    command: cmd,
    args: parts.slice(1),
    stderr: "pipe",
  });
  let childStderr = "";
  // The PassThrough exists immediately (before connect), so this never races the
  // child's first output. Keep the tail and cap it — a server that logs heavily
  // shouldn't balloon memory, and the failure reason is in the last lines.
  transport.stderr?.on("data", (chunk: Buffer) => {
    childStderr += chunk.toString();
    if (childStderr.length > 4000) childStderr = childStderr.slice(-4000);
  });

  const client = new Client({ name: "routeproof", version: VERSION }, { capabilities: {} });

  try {
    await client.connect(transport);
  } catch (e) {
    // The #1 first-run failure: the --server command doesn't actually launch a
    // stdio MCP server (typo, wrong subcommand, missing build). Say so plainly,
    // echo the command, and keep it distinct from an API-unreachable error.
    const why = e instanceof Error ? e.message : String(e);
    const wrote = childStderr.trim();
    const detail = wrote ? `${why}\n  the server command wrote:\n${indent(wrote)}` : why;
    throw new Error(
      `could not start an MCP server from --server "${command}". It must launch a stdio MCP server that speaks JSON-RPC on stdout. Got: ${detail}`,
    );
  }
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
    }));
  } finally {
    await client.close();
  }
}

// Indent captured child output so it reads as a quoted block inside our message,
// not as more top-level error text.
function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
