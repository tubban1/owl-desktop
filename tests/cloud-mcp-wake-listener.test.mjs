import { describe, it, expect, vi } from "vitest";
import { CloudMcpWakeListener } from "../connection-host/cloud-mcp-wake-listener.mjs";

describe("secure Cloud MCP wake listener", () => {
  it("gets one-time ticket from the authorized Cloud client and only wakes on valid hints", async () => {
    const connections = [];
    class MockWebSocket {
      constructor(url) { this.url = url; this.handlers = new Map(); connections.push(this); }
      addEventListener(name, fn) { this.handlers.set(name, fn); }
      emit(name, data) { this.handlers.get(name)?.(data); }
      close() { this.closed = true; }
    }
    const onWake = vi.fn();
    const client = { getMcpWakeTicket: vi.fn(async () => ({
      url: "wss://example.execute-api.eu-central-1.amazonaws.com/live",
      ticket: "abcdefghijklmnopABCDEFGHIJKL1234567890_abcDEF",
    })) };
    const l = new CloudMcpWakeListener({
      cloudClient: client, onWake, WebSocketImpl: MockWebSocket,
      setTimeoutImpl: () => ({ unref() {} }),
    });
    expect(l.start()).toBe(true);
    await vi.waitFor(() => expect(connections).toHaveLength(1));
    expect(connections[0].url).toContain("ticket=");
    connections[0].emit("open");
    connections[0].emit("message", { data: JSON.stringify({type:"mcp_wake",callId:"mcp_test123456"}) });
    connections[0].emit("message", { data: JSON.stringify({type:"run_shell",command:"rm -rf /"}) });
    connections[0].emit("message", { data: JSON.stringify({type:"mcp_wake",callId:"../../bad"}) });
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(l.snapshot()).toMatchObject({ connected:true, hintsReceived:1 });
    l.stop();
    expect(connections[0].closed).toBe(true);
  });
  it("fails safely when ticket endpoint is missing", () => {
    const l = new CloudMcpWakeListener({ cloudClient:{}, onWake:()=>{} });
    expect(l.start()).toBe(false);
  });
});
