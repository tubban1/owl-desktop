#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpUrl = new URL(process.env.OWL_MCP_URL || "http://127.0.0.1:8790/mcp");
const repo = process.env.OWL_E2E_REPO || process.cwd();
const owner = process.env.OWL_E2E_OWNER || "owl-desktop:stream-recovery-e2e";

function textResult(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function connect(label) {
  const client = new Client({
    name: `owl-stream-recovery-${label}`,
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: { headers: { "x-owl-owner-id": owner } },
  });
  await client.connect(transport);
  return { client, transport };
}

const first = await connect("first");
let taskId;
try {
  const compiled = await first.client.callTool({
    name: "skill_run",
    arguments: {
      skill: "runtime.compile_task",
      args: {
        label: "Desktop stream recovery durable task",
        steps: [
          {
            id: "slow",
            primitive: "sys.exec",
            op: "run",
            args: {
              command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
                "setTimeout(() => process.stdout.write('done\\n'), 3500)",
              )}`,
              cwd: repo,
              timeout_ms: 10_000,
              workspace_mode: "read",
            },
            verify: {
              id: "stream-recovery-shell-completed",
              description:
                "The recovery probe must finish and emit its expected completion marker.",
              expectations: [
                {
                  path: "state",
                  operator: "equals",
                  expected: "finished",
                },
                {
                  path: "data.stdout",
                  operator: "contains",
                  expected: "done",
                },
              ],
            },
          },
        ],
        max_concurrency: 1,
        fail_fast: true,
      },
      dry_run: false,
    },
  });
  if (compiled.isError) throw new Error(textResult(compiled));
  const payload = JSON.parse(textResult(compiled));
  taskId = payload?.result?.id ?? payload?.id;
  if (!taskId) throw new Error("No durable task id returned.");

  const started = await first.client.callTool({
    name: "task_start",
    arguments: { task_id: taskId },
  });
  if (started.isError) throw new Error(textResult(started));
  const startPayload = JSON.parse(textResult(started));
  if (startPayload.accepted !== true) {
    throw new Error("Detached task was not accepted.");
  }
  console.log(`PASS first connection started durable Task ${taskId}`);
} finally {
  await first.transport.close().catch(() => undefined);
}

await new Promise((resolve) => setTimeout(resolve, 250));

const second = await connect("recovered");
try {
  const listed = await second.client.callTool({
    name: "task_list",
    arguments: { active_only: true },
  });
  if (listed.isError) throw new Error(textResult(listed));
  const tasks = JSON.parse(textResult(listed));
  if (!Array.isArray(tasks) || !tasks.some((task) => task?.id === taskId)) {
    throw new Error("Recovered connection could not rediscover the active durable Task.");
  }
  console.log("PASS fresh MCP transport rediscovered active Task through task_list");

  let final;
  let sawActive = false;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const result = await second.client.callTool({
      name: "task_status",
      arguments: { task_id: taskId },
    });
    if (result.isError) throw new Error(textResult(result));
    final = JSON.parse(textResult(result));
    if (final?.progress?.phase === "executing") sawActive = true;
    if (final?.progress?.terminal === true) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  if (!sawActive) {
    throw new Error("Recovered connection never observed the running Task.");
  }
  if (final?.status !== "completed" || final?.progress?.terminal !== true) {
    throw new Error("Recovered connection did not observe canonical completion.");
  }

  console.log("PASS recovered connection resumed truthful progress polling");
  console.log("PASS durable Task completed after initiating transport disconnected");
  console.log(JSON.stringify({
    ok: true,
    taskId,
    initiatingTransportDisconnected: true,
    rediscoveredByTaskList: true,
    recoveredProgressPolling: true,
    finalStatus: final.status,
    finalRevision: final.progress.revision,
  }, null, 2));
} finally {
  await second.transport.close().catch(() => undefined);
}
