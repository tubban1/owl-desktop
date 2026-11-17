import path from "node:path";
import { CloudMcpCallConsumer } from "../../connection-host/cloud-mcp-call-consumer.mjs";
import { LocalMcpExecutor } from "../../connection-host/local-mcp-executor.mjs";
import { CloudMcpCompletionStore } from "../../connection-host/cloud-mcp-completion-store.mjs";
import { createCallTimingJournal } from "../../mcp/call-timing-journal.mjs";

// Windows DEV Desktop owns local MCP on 8790, while the packaged Desktop
// delegates to the independent Connection Host. Do not run two Cloud consumers.
let consumer = null;
let completionStore = null;
let configuration = null;

export async function stopWindowsDevCloudMcpConsumer() {
  const previous = consumer;
  consumer = null;
  completionStore = null;
  configuration = null;
  if (previous) await previous.stop();
}

export function windowsDevCloudMcpSnapshot() {
  return {
    configured: Boolean(consumer),
    config: configuration,
    consumer: consumer?.snapshot() ?? null,
    completionStore: completionStore?.snapshot() ?? null,
  };
}

export async function wakeWindowsDevCloudMcpConsumer() {
  if (!consumer) return null;
  return consumer.revalidateAfterWake();
}

export async function startWindowsDevCloudMcpConsumer({
  cloudClient,
  settings,
  mcpToken,
  userDataRoot,
  onEvent = () => {},
  executorFactory = (options) => new LocalMcpExecutor(options),
  consumerFactory = (options) => new CloudMcpCallConsumer(options),
} = {}) {
  if (!cloudClient || !settings?.cloudDeviceId || !userDataRoot) {
    throw new Error("WINDOWS_DEV_CLOUD_MCP_CONFIG_INCOMPLETE");
  }
  await stopWindowsDevCloudMcpConsumer();

  const executor = executorFactory({
    mcpUrl: `http://127.0.0.1:${Number(settings.mcpPort || 8790)}/mcp`,
    mcpToken,
    onEvent,
  });
  const localStore = new CloudMcpCompletionStore({
    root: path.join(userDataRoot, "connectivity", "cloud-mcp-completions"),
  });
  const timingJournal = createCallTimingJournal({
    root: path.join(userDataRoot, "connectivity", "cloud-call-timings"),
  });
  const next = consumerFactory({
    cloudClient,
    executor,
    completionStore: localStore,
    timingJournal,
    pollIntervalMs: settings.cloudPollIntervalMs,
    maxConcurrentCalls: 2,
    onEvent,
  });
  consumer = next;
  completionStore = localStore;
  configuration = { deviceId: settings.cloudDeviceId, baseUrl: cloudClient.baseUrl ?? null };
  try {
    const snapshot = await next.start();
    return snapshot;
  } catch (error) {
    await next.stop().catch(() => undefined);
    if (consumer === next) {
      consumer = null;
      completionStore = null;
      configuration = null;
    }
    throw error;
  }
}
