#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpUrl = new URL(
  process.env.OWL_MCP_URL || "http://127.0.0.1:8790/mcp",
);
const repo = process.env.OWL_E2E_REPO || process.cwd();
const owner = process.env.OWL_E2E_OWNER || "owl-desktop:local-e2e";

function textResult(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function connect(label) {
  const client = new Client({
    name: `owl-local-e2e-${label}`,
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: {
      headers: { "x-owl-owner-id": owner },
    },
  });
  await client.connect(transport);
  return { client, transport };
}

const first = await connect("first");
try {
  const tools = await first.client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const required of [
    "runtime_info",
    "provider_status",
    "primitive_call",
    "skill_run",
    "git_status",
    "task_start",
    "task_status",
    "agent_requests_status",
    "agent_requests_list",
    "agent_requests_claim",
    "agent_requests_release",
    "agent_requests_complete",
  ]) {
    if (!names.has(required)) {
      throw new Error(`Missing MCP tool: ${required}`);
    }
  }

  const instructions = first.client.getInstructions();
  if (!instructions?.includes("AgentRequests")) {
    throw new Error("OWL MCP server instructions do not describe Agent Inbox.");
  }
  if (!instructions?.includes("task_start") || !instructions?.includes("task_status")) {
    throw new Error("OWL MCP server instructions do not describe detached long-task progress.");
  }

  const info = await first.client.callTool({
    name: "runtime_info",
    arguments: {},
  });
  if (info.isError) throw new Error(textResult(info));

  const inbox = await first.client.callTool({
    name: "agent_requests_status",
    arguments: {},
  });
  if (inbox.isError) throw new Error(textResult(inbox));
  const inboxStatus = JSON.parse(textResult(inbox));
  if (inboxStatus.available !== true) {
    throw new Error("Agent Inbox is not available through OWL MCP.");
  }

  const status = await first.client.callTool({
    name: "git_status",
    arguments: { cwd: repo },
  });
  if (status.isError) throw new Error(textResult(status));

  const parsed = JSON.parse(textResult(status));
  const direct = execFileSync(
    "git",
    ["status", "--short", "--branch"],
    { cwd: repo, encoding: "utf8" },
  );
  if (parsed.stdout !== direct || parsed.exitCode !== 0) {
    throw new Error("MCP Git status does not match direct Git status.");
  }

  const retry = await first.client.callTool({
    name: "git_status",
    arguments: { cwd: repo },
  });
  if (textResult(retry) !== textResult(status)) {
    throw new Error("Read-only retry changed the Git status result.");
  }

  const compiled = await first.client.callTool({
    name: "skill_run",
    arguments: {
      skill: "runtime.compile_task",
      args: {
        label: "Desktop Local E2E detached task",
        steps: [
          {
            id: "slow",
            primitive: "sys.exec",
            op: "run",
            args: {
              command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
                "setTimeout(() => process.stdout.write('done\\n'), 2200)",
              )}`,
              cwd: repo,
              timeout_ms: 10_000,
              workspace_mode: "read",
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
  const compiledPayload = JSON.parse(textResult(compiled));
  const taskId = compiledPayload?.result?.id ?? compiledPayload?.id;
  if (!taskId) {
    throw new Error("runtime.compile_task did not return a durable Task id.");
  }

  const startedAt = Date.now();
  const started = await first.client.callTool({
    name: "task_start",
    arguments: { task_id: taskId },
  });
  if (started.isError) throw new Error(textResult(started));
  const startPayload = JSON.parse(textResult(started));
  const acceptanceMs = Date.now() - startedAt;
  if (startPayload.accepted !== true || acceptanceMs >= 1_500) {
    throw new Error(
      `Detached Task did not return promptly (accepted=${startPayload.accepted}, ${acceptanceMs}ms).`,
    );
  }

  let observedActive = false;
  let lastRevision = Number(startPayload.progress?.revision ?? 0);
  let taskStatus = null;
  const taskDeadline = Date.now() + 12_000;
  while (Date.now() < taskDeadline) {
    const statusResult = await first.client.callTool({
      name: "task_status",
      arguments: { task_id: taskId },
    });
    if (statusResult.isError) throw new Error(textResult(statusResult));
    taskStatus = JSON.parse(textResult(statusResult));
    const revision = Number(taskStatus.progress?.revision ?? 0);
    if (revision < lastRevision) {
      throw new Error("Task progress revision moved backwards.");
    }
    lastRevision = revision;
    if (
      taskStatus.progress?.phase === "executing" &&
      Array.isArray(taskStatus.progress?.activeSteps) &&
      taskStatus.progress.activeSteps.some((step) => step.id === "slow")
    ) {
      observedActive = true;
    }
    if (taskStatus.progress?.terminal === true) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (taskStatus?.status !== "completed" || taskStatus?.progress?.terminal !== true) {
    throw new Error("Detached Task did not reach canonical completed state.");
  }
  if (!observedActive) {
    throw new Error("Desktop MCP task_status never observed the active long-running step.");
  }

  console.log("PASS tool discovery");
  console.log("PASS RuntimeClient info");
  console.log("PASS MCP Agent Inbox discovery");
  console.log("PASS MCP → Runtime git.query → local repository");
  console.log("PASS deterministic read-only retry");
  console.log(`PASS MCP detached task start/status (${acceptanceMs}ms acceptance, revision ${lastRevision})`);
} finally {
  await first.transport.close().catch(() => undefined);
}

const second = await connect("reconnect");
try {
  const info = await second.client.callTool({
    name: "runtime_info",
    arguments: {},
  });
  if (info.isError) throw new Error(textResult(info));
  console.log("PASS same logical owner reconnect");
} finally {
  await second.transport.close().catch(() => undefined);
}
