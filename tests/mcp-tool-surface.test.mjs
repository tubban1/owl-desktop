import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function startFakeRuntime(accessState = null) {
  const server = http.createServer(async (req, res) => {
    let body="";for await(const chunk of req)body+=chunk;
    const method=JSON.parse(body||"{}").method;
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      result: method === "access.get" ? {mode:"enforced",state:accessState||"LOCKED"} : { apiVersion: "0.1", runtimeVersion: "test-runtime" },
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
      "mail_accounts","mail_list","mail_search","mail_read","mail_create_draft","mail_send_draft",
      "provider_status",
      "primitive_call",
      "primitive_catalog",
      "skill_run",
      "skill_catalog",
      "get_capabilities",
      "list_directory",
      "list_directory_tree",
      "read_file",
      "read_image",
      "report_external_tool_fallback",
      "send_file",
      "revoke_file_delivery",
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
      "browser_agent_open",
      "browser_agent_status",
      "browser_agent_extension_info",
      "browser_agent_reload_extension",
      "browser_agent_tabs",
      "browser_agent_snapshot",
      "browser_agent_fill",
      "browser_agent_click",
      "browser_agent_screenshot",
      "browser_agent_focus_login",
      "browser_agent_close_tab",
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
    expect(browserOpen?.description).toContain("OPTIONAL isolated managed browser");
    const agentOpen = listed.tools.find(tool => tool.name === "browser_agent_open");
    expect(agentOpen?.description).toContain("existing signed-in Chrome");
    expect(agentOpen?.description).toContain("Reuse an existing inactive tab");
    expect(agentOpen?.description).toContain("foreground and background");
    expect(browserOpen?.description).toContain("DEFAULT user Chrome");
    expect(browserOpen?.description).toContain("Never switch global headless mode");
    const useTab = listed.tools.find((tool) => tool.name === "browser_use_tab");
    expect(useTab?.description).toContain("tab_id");

    const workstreamProgress = listed.tools.find(
      (tool) => tool.name === "workstream_progress",
    );
    const progressProperties =
      workstreamProgress?.inputSchema?.properties ?? {};
    expect(progressProperties).toHaveProperty("progress_boundary_id");
    expect(progressProperties).toHaveProperty("user_visible_progress");
  });
});


describe("OWL Mail MCP invocation",()=>{
  it("lists accounts through authorized desktop bridge but never exposes app credentials",async()=>{
    const runtimeBaseUrl=await startFakeRuntime('READY');
    const mailService={accounts:async()=>[{id:'ef08d47b-a456-4cbc-9e7a-1433cdfcc7d0',provider:'yahoo',address:'user@yahoo.com'}]};
    const mcp=await startOwlMcpHttpServer({port:0,runtimeBaseUrl,mailService});
    closers.push(()=>mcp.close());
    const client=new Client({name:'mail-test',version:'0.1.0'});
    const transport=new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{'x-owl-owner-id':'mail-test-owner'}}});
    await client.connect(transport);closers.push(()=>transport.close().catch(()=>{}));
    const reply=await client.callTool({name:'mail_accounts',arguments:{}});
    expect(reply.isError).toBeFalsy();
    const content=reply.content[0].text;
    expect(content).toContain('user@yahoo.com');expect(content).not.toMatch(/password|credential|secret/);
  });
  it("does not expose account data while Runtime is LOCKED",async()=>{
    const runtimeBaseUrl=await startFakeRuntime('LOCKED');
    let lookedUp=false;
    const mcp=await startOwlMcpHttpServer({port:0,runtimeBaseUrl,mailService:{accounts:async()=>{lookedUp=true;return []}}});
    closers.push(()=>mcp.close());
    const client=new Client({name:'mail-lock-test',version:'0.1.0'});
    const transport=new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{'x-owl-owner-id':'mail-lock-test-owner'}}});
    await client.connect(transport);closers.push(()=>transport.close().catch(()=>{}));
    const reply=await client.callTool({name:'mail_accounts',arguments:{}});
    expect(reply.isError).toBe(true);expect(reply.content[0].text).toContain('MAIL_RUNTIME_AUTHORIZATION_REQUIRED');
    expect(lookedUp).toBe(false);
  });
});
