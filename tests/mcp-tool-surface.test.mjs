import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function startFakeRuntime() {
  const server = http.createServer(async (_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      result: { apiVersion: "0.1", runtimeVersion: "test-runtime" },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

describe("OWL MCP compatibility surface", () => {
  it("registers the connector-visible core compatibility tools", async () => {
    const runtimeBaseUrl = await startFakeRuntime();
    const mcp = await startOwlMcpHttpServer({ port: 0, runtimeBaseUrl });
    closers.push(() => mcp.close());

    const client = new Client({ name: "surface-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: { headers: { "x-owl-owner-id": "surface-test-owner" } },
    });
    await client.connect(transport);
    closers.push(() => transport.close().catch(() => undefined));

    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));

    const required = [
      "runtime_info",
      "provider_status",
      "primitive_call",
      "primitive_catalog",
      "skill_run",
      "skill_catalog",
      "get_capabilities",
      "list_directory",
      "list_directory_tree",
      "read_file",
      "read_multiple_files",
      "file_info",
      "search_files",
      "create_directory",
      "write_file",
      "append_file",
      "edit_file",
      "batch_edit_files",
      "move_path",
      "copy_path",
      "delete_path",
      "execute_command",
      "start_process",
      "list_processes",
      "send_process_input",
      "get_process_output",
      "kill_process",
      "git_status",
      "git_diff",
      "git_log",
      "git_add",
      "git_commit",
      "git_pull",
      "git_push",
      "apply_patch",
      "begin_transaction",
      "transaction_status",
      "list_transactions",
      "rollback_transaction",
      "complete_transaction",
      "device_list",
      "device_commands",
      "remote_task_submit",
      "remote_task_status",
      "remote_task_cancel",
      "task_create",
      "task_run",
      "task_pause",
      "task_cancel",
      "task_resolve_step",
      "task_delete",
      "task_submit",
      "workstream_open",
      "workstream_progress",
      "workstream_status",
      "workstream_complete",
      "planner_checkpoint",
      "planner_checkpoint_status",
      "planner_checkpoint_complete",
      "conversation_continuity_status",
      "conversation_handoff_prepare",
      "conversation_handoff_latest",
      "conversation_handoff_get",
      "conversation_handoff_consume",
      "orchestration_snapshot",
      "task_list",
      "task_start",
      "task_status",
      "browser_open",
      "browser_list_tabs",
      "browser_use_tab",
      "browser_close",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_screenshot",
      "desktop_screenshot",
      "desktop_click",
      "desktop_type",
      "desktop_key",
      "desktop_open_app",
      "desktop_frontmost_app",
      "capability_manifest",
      "router_catalog",
      "computer_action",
      "computer_batch",
      "computer_graph",
      "execute_command_transactional",
      "get_audit_log",
    ];

    const missing = required.filter((name) => !names.has(name));
    expect(missing).toEqual([]);

    const browserOpen = listed.tools.find((tool) => tool.name === "browser_open");
    expect(browserOpen?.description).toContain("last-resort interaction path");

    const workstreamProgress = listed.tools.find(
      (tool) => tool.name === "workstream_progress",
    );
    const progressProperties =
      workstreamProgress?.inputSchema?.properties ?? {};
    expect(progressProperties).toHaveProperty("progress_boundary_id");
    expect(progressProperties).toHaveProperty("user_visible_progress");
  });
});
