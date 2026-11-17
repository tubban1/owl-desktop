import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  startWindowsDevCloudMcpConsumer,
  stopWindowsDevCloudMcpConsumer,
  windowsDevCloudMcpSnapshot,
  wakeWindowsDevCloudMcpConsumer,
} from "../electron/services/windows-dev-cloud-mcp-consumer.mjs";

test("Windows DEV consumer uses existing local MCP and durable store; lifecycle and wake are idempotent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-win-cloud-test-"));
  let stopCount = 0, wakeCount = 0, started = 0, opts = null, executorArgs = null;
  const mock = {
    start: async () => { started++; return {running:true, ready:true, processed:0}; },
    stop: async () => { stopCount++; },
    snapshot: () => ({running:true, ready:true, processed:0}),
    revalidateAfterWake: async () => { wakeCount++; return {running:true, ready:true}; },
  };
  try {
    const snapshot = await startWindowsDevCloudMcpConsumer({
      cloudClient: {pinned:true},
      settings: {cloudDeviceId:"dev-test",mcpPort:8790,cloudPollIntervalMs:5000},
      userDataRoot:root,
      mcpToken:undefined,
      executorFactory: (args) => {executorArgs=args;return {probe:async()=>{}};},
      consumerFactory: (args) => {opts=args;return mock;},
    });
    assert.equal(snapshot.ready,true);
    assert.equal(started,1);
    assert.equal(executorArgs.mcpUrl,"http://127.0.0.1:8790/mcp");
    assert.equal(executorArgs.mcpToken,undefined);
    assert.equal(opts.maxConcurrentCalls,2);
    assert.equal(opts.pollIntervalMs,5000);
    assert.equal(windowsDevCloudMcpSnapshot().configured,true);
    assert.equal(await wakeWindowsDevCloudMcpConsumer().then(x=>x.ready),true);
    assert.equal(wakeCount,1);
    assert.equal(fs.existsSync(path.join(root,"connectivity","cloud-mcp-completions")),true);
  } finally {
    await stopWindowsDevCloudMcpConsumer();
    fs.rmSync(root,{recursive:true,force:true});
  }
  assert.equal(stopCount,1);
  assert.equal(windowsDevCloudMcpSnapshot().configured,false);
  assert.equal(await wakeWindowsDevCloudMcpConsumer(),null);
});

test("Windows DEV consumer rejects missing Cloud device identity without creating a poller", async () => {
  await assert.rejects(() => startWindowsDevCloudMcpConsumer({cloudClient:{},settings:{},userDataRoot:os.tmpdir()}), /CONFIG_INCOMPLETE/);
});
