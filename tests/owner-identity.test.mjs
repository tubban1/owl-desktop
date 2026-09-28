import { describe, expect, it } from "vitest";
import { resolveOwnerIdentity } from "../mcp/owner-identity.mjs";

describe("OWL MCP logical owner identity", () => {
  it("maps the same explicit owner to the same stable Runtime session", () => {
    const a = resolveOwnerIdentity(
      { "x-owl-owner-id": "chatgpt:conversation:abc" },
      "transport-1",
    );
    const b = resolveOwnerIdentity(
      { "x-owl-owner-id": "chatgpt:conversation:abc" },
      "transport-2",
    );

    expect(a.stable).toBe(true);
    expect(a.source).toBe("explicit-header");
    expect(a.runtimeSessionId).toBe(b.runtimeSessionId);
    expect(a.runtimeSessionId).not.toContain("conversation:abc");
  });

  it("does not merge unrelated owners", () => {
    const a = resolveOwnerIdentity(
      { "x-owl-owner-id": "chat-a" },
      "transport-1",
    );
    const b = resolveOwnerIdentity(
      { "x-owl-owner-id": "chat-b" },
      "transport-1",
    );
    expect(a.runtimeSessionId).not.toBe(b.runtimeSessionId);
  });

  it("fails to transport identity instead of guessing when no owner is supplied", () => {
    const a = resolveOwnerIdentity({}, "transport-1");
    const b = resolveOwnerIdentity({}, "transport-2");
    expect(a.stable).toBe(false);
    expect(a.source).toBe("transport-session");
    expect(a.runtimeSessionId).not.toBe(b.runtimeSessionId);
  });

  it("accepts the legacy owner header during migration", () => {
    const legacy = resolveOwnerIdentity(
      { "x-computer-mcp-owner-id": "legacy-chat" },
      "transport-1",
    );
    expect(legacy.stable).toBe(true);
    expect(legacy.source).toBe("explicit-header");
  });
});
