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

  it("uses the MCP transport as a stable session identity when no owner is supplied", () => {
    const a = resolveOwnerIdentity({}, "transport-1");
    const same = resolveOwnerIdentity({}, "transport-1");
    const b = resolveOwnerIdentity({}, "transport-2");
    expect(a.stable).toBe(true);
    expect(a.source).toBe("transport-session");
    expect(a.runtimeSessionId).toBe(same.runtimeSessionId);
    expect(a.runtimeSessionId).not.toBe(b.runtimeSessionId);
  });


  it("uses the persistent Desktop fallback only for explicitly labelled Desktop clients", () => {
    const headers = { "x-owl-client-kind": "desktop" };
    const a = resolveOwnerIdentity(
      headers,
      "transport-1",
      "owl-desktop:persistent-session-1",
    );
    const b = resolveOwnerIdentity(
      headers,
      "transport-2",
      "owl-desktop:persistent-session-1",
    );

    expect(a.stable).toBe(true);
    expect(a.source).toBe("desktop-session");
    expect(a.runtimeSessionId).toBe(b.runtimeSessionId);
  });

  it("prefers an explicit owner over the Desktop fallback", () => {
    const explicit = resolveOwnerIdentity(
      { "x-owl-owner-id": "chat-a" },
      "transport-1",
      "owl-desktop:persistent-session-1",
    );
    const fallback = resolveOwnerIdentity(
      {},
      "transport-1",
      "owl-desktop:persistent-session-1",
    );

    expect(explicit.source).toBe("explicit-header");
    expect(explicit.runtimeSessionId).not.toBe(fallback.runtimeSessionId);
  });

  it("accepts the legacy owner header during migration", () => {
    const legacy = resolveOwnerIdentity(
      { "x-computer-mcp-owner-id": "legacy-chat" },
      "transport-1",
    );
    expect(legacy.stable).toBe(true);
    expect(legacy.source).toBe("explicit-header");
  });

  it("carries explicit client kind/label so Worker and ChatGPT streams stay distinguishable", () => {
    const worker = resolveOwnerIdentity(
      {
        "x-owl-owner-id": "worker:nightly:1",
        "x-owl-client-kind": "worker",
        "x-owl-client-label": "Night Worker",
      },
      "transport-worker",
    );
    const chat = resolveOwnerIdentity(
      { "x-owl-owner-id": "chatgpt:conversation:abc" },
      "transport-chat",
    );

    expect(worker).toMatchObject({
      stable: true,
      clientKind: "worker",
      clientLabel: "Night Worker",
    });
    expect(chat).toMatchObject({
      stable: true,
      clientKind: "chatgpt",
      clientLabel: null,
    });
    expect(worker.runtimeSessionId).not.toBe(chat.runtimeSessionId);
  });
});
