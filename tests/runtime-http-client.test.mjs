import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("RuntimeHttpClient", () => {
  it("preserves stable logical session headers and reports HTTP transport", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: { apiVersion: "0.1", runtimeVersion: "1.0.0-rc.4", transport: "in-process" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RuntimeHttpClient({
      baseUrl: "http://127.0.0.1:8788/",
      sessionId: "owl-desktop:test-session",
      token: "test-token",
    });
    const info = await client.info();

    expect(info.transport).toBe("http");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8788/runtime/v0.1/rpc");
    expect(options.headers["x-owl-session-id"]).toBe("owl-desktop:test-session");
    expect(options.headers.authorization).toBe("Bearer test-token");
  });

  it("propagates external cancellation to the Runtime HTTP request", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(options.signal.reason ?? new Error("aborted"));
        }, { once: true });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new RuntimeHttpClient({
      baseUrl: "http://127.0.0.1:8788",
      sessionId: "owl-desktop:test-session",
    });
    const controller = new AbortController();
    const pending = client.invoke(
      "health",
      { op: "status" },
      { signal: controller.signal, timeoutMs: 10_000 },
    );
    controller.abort(new Error("MCP client disconnected"));

    await expect(pending).rejects.toThrow("MCP client disconnected");
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("maps User Skill and workflow discovery methods to public Runtime RPC", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RuntimeHttpClient({
      baseUrl: "http://127.0.0.1:8788",
      sessionId: "owl-desktop:test-session",
    });

    await client.discoverWorkflowSkillCandidates({ minSuccessfulRuns: 3 });
    await client.submitSkillCandidate({ schemaVersion: 1 });
    await client.compileSkillCandidateTest(
      "candidate_1",
      "digest_1",
      { date: "2026-09-29" },
    );
    await client.runTask("task_skilltest_1", {
      maxWaves: 100,
      timeBudgetMs: 120_000,
      timeoutMs: 130_000,
    });
    await client.promoteSkillCandidate(
      "candidate_1",
      "digest_1",
      "task_skilltest_1",
      true,
    );

    const payloads = fetchMock.mock.calls.map(([, options]) =>
      JSON.parse(options.body),
    );

    expect(payloads.map((payload) => payload.method)).toEqual([
      "skill-candidates.discover-workflows",
      "skill-candidates.submit",
      "skill-candidates.compile-test",
      "tasks.run",
      "skill-candidates.promote",
    ]);
    expect(payloads[0].params).toEqual({ minSuccessfulRuns: 3 });
    expect(payloads[1].params).toEqual({
      manifest: { schemaVersion: 1 },
    });
    expect(payloads[2].params).toEqual({
      candidateId: "candidate_1",
      expectedDigest: "digest_1",
      inputs: { date: "2026-09-29" },
    });
    expect(payloads[3].params).toEqual({
      taskId: "task_skilltest_1",
      maxWaves: 100,
      timeBudgetMs: 120_000,
    });
    expect(payloads[4].params).toEqual({
      candidateId: "candidate_1",
      expectedDigest: "digest_1",
      testTaskId: "task_skilltest_1",
      confirm: true,
    });
  });

  it("fails closed on Runtime RPC errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        error: { code: "PROCESS_OWNED", message: "owned by another session" },
      }),
    }));
    const client = new RuntimeHttpClient({
      baseUrl: "http://127.0.0.1:8788",
      sessionId: "owl-desktop:test-session",
    });

    await expect(client.processes()).rejects.toMatchObject({
      message: "owned by another session",
      code: "PROCESS_OWNED",
      runtimeResponded: true,
      httpStatus: 409,
    });
  });
});
