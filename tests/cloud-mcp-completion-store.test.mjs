import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CloudMcpCompletionStore } from "../connection-host/cloud-mcp-completion-store.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CloudMcpCompletionStore", () => {
  it("persists a completion atomically across a new store instance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-mcp-completion-"));
    roots.push(root);
    const first = new CloudMcpCompletionStore({ root });
    first.put("mcp_1", {
      requestDigest: "digest-1",
      payload: { result: { ok: true } },
    });

    const second = new CloudMcpCompletionStore({ root });
    expect(second.get("mcp_1")).toMatchObject({
      callId: "mcp_1",
      requestDigest: "digest-1",
      payload: { result: { ok: true } },
    });
    expect(second.snapshot().pending).toBe(1);
  });

  it("deletes an acknowledged completion and keeps private file permissions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-mcp-completion-"));
    roots.push(root);
    const store = new CloudMcpCompletionStore({ root });
    store.put("mcp_2", {
      payload: { error: { code: "FAIL", message: "failed" } },
    });
    const [name] = fs.readdirSync(root);
    const mode = fs.statSync(path.join(root, name)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(store.delete("mcp_2")).toBe(true);
    expect(store.get("mcp_2")).toBeNull();
    expect(store.snapshot().pending).toBe(0);
  });
});
