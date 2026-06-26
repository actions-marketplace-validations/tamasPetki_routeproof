import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadToolsFromServer } from "../src/mcp-client.ts";
import { VERSION } from "../src/version.ts";

// version.ts is the single source of truth for the handshake version AND
// `--version`. If it drifts from package.json, `--version` lies to CI users who
// pinned a tag. Guard the two together.
test("VERSION matches package.json", () => {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  expect(VERSION).toBe(pkg.version);
});

// The dogfood-found defect: a mistyped --server script path used to let Node's
// raw "Cannot find module" stack leak straight to the user's terminal (inherited
// stderr), reading as "routeproof is broken" rather than "your command is wrong".
// Now the child's stderr is captured and folded into routeproof's own framed
// error. Assert both: the framing is present, and the child's reason rode along.
test("a bad --server script path is framed, not leaked raw", async () => {
  const bogus = "node /routeproof-does-not-exist-zzz.mjs";
  let message = "";
  try {
    await loadToolsFromServer(bogus);
    throw new Error("expected loadToolsFromServer to reject");
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  // routeproof's own framing — the user sees a single, attributable message.
  expect(message).toContain("could not start an MCP server");
  expect(message).toContain(bogus);
  // The child's actual reason is carried inside that message (best-effort
  // capture; Node reports a missing module by name).
  expect(message.toLowerCase()).toContain("cannot find module");
}, 15000);
