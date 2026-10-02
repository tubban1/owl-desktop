import { describe, expect, it } from "vitest";
import { buildMcpInteractionFeed } from "../src/monitor/interactionModel";

describe("buildMcpInteractionFeed", () => {
  it("merges real MCP request/response events by interaction id", () => {
    const activity = [
      {
        id: "2",
        at: "2026-10-02T04:00:01.000Z",
        level: "info",
        source: "mcp",
        message: "MCP interaction response",
        meta: {
          eventKind: "mcp_interaction",
          interactionId: "req_1:execute_command",
          phase: "response",
          status: "success",
          tool: "execute_command",
          clientKind: "chatgpt",
          clientLabel: "ChatGPT · A",
          transportSessionId: "transport-1",
          runtimeSessionId: "owl-workstream:a",
          workstreamId: "owl-workstream:a",
          durationMs: 812,
          payload: "{\n  \"exitCode\": 0,\n  \"stdout\": \"PASS\"\n}",
        },
      },
      {
        id: "1",
        at: "2026-10-02T04:00:00.000Z",
        level: "info",
        source: "mcp",
        message: "MCP interaction request",
        meta: {
          eventKind: "mcp_interaction",
          interactionId: "req_1:execute_command",
          phase: "request",
          status: "running",
          tool: "execute_command",
          clientKind: "chatgpt",
          clientLabel: "ChatGPT · A",
          transportSessionId: "transport-1",
          runtimeSessionId: "owl-workstream:a",
          workstreamId: "owl-workstream:a",
          payload: "{\n  \"command\": \"npm test\"\n}",
        },
      },
    ] as any;

    expect(buildMcpInteractionFeed(activity)).toEqual([
      expect.objectContaining({
        id: "req_1:execute_command",
        tool: "execute_command",
        clientLabel: "ChatGPT · A",
        workstreamId: "owl-workstream:a",
        status: "success",
        durationMs: 812,
        requestPreview: expect.stringContaining("npm test"),
        responsePreview: expect.stringContaining("PASS"),
      }),
    ]);
  });

  it("keeps a request visibly running before the response arrives", () => {
    const feed = buildMcpInteractionFeed([
      {
        id: "1",
        at: "2026-10-02T04:00:00.000Z",
        level: "info",
        source: "mcp",
        message: "MCP interaction request",
        meta: {
          eventKind: "mcp_interaction",
          interactionId: "req_running",
          phase: "request",
          status: "running",
          tool: "read_file",
          clientKind: "mcp",
          payload: "{\"path\":\"/tmp/demo.txt\"}",
        },
      },
    ] as any);

    expect(feed[0]).toMatchObject({
      id: "req_running",
      status: "running",
      clientLabel: "MCP client",
      responsePreview: null,
    });
  });
});
