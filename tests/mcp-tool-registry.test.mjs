import {describe,it,expect} from "vitest";
import {createOwlMcpServer} from "../mcp/create-server.mjs";
import {toolRegistrySnapshot} from "../mcp/tool-registry.mjs";
import {describeTool,suggestToolProfiles,summarizeToolDomains} from "../shared/tool-taxonomy.mjs";
describe("shared MCP tool presentation governance",()=>{
 it("uses live registered SDK tools as its canonical inventory",()=>{
  const server=createOwlMcpServer();const a=toolRegistrySnapshot(server,{goal:"edit git repository files",includeTools:true});
  expect(a.count).toBe(163);expect(a.namesSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(a.profileCounts.core).toBeGreaterThan(0);expect(a.executionCoverage.runtimePrimitive).toBeGreaterThan(20);
  expect(a.tools.some(t=>t.id==="git_status")).toBe(true);
  expect(a.tools.every(t=>a.suggestedProfiles.includes(t.profile)||t.profile==="legacy")).toBe(true);
  expect(toolRegistrySnapshot(server).namesSha256).toBe(a.namesSha256);
 });
 it("does not misrepresent native browser adapters as Runtime Primitives",()=>{
  const shell=describeTool("execute_command");expect(shell).toMatchObject({primitive:"sys.exec",op:"run",action:"shell.exec",riskTier:"privileged"});
  const edit=describeTool("edit_file");expect(edit).toMatchObject({primitive:"fs.write",action:"fs.edit"});
  const native=describeTool("browser_agent_snapshot");expect(native).toMatchObject({category:"Browser",primitive:null,executionPath:"adapter-native"});
 });
 it("normalizes titles and classifies historical call rows without mutating them",()=>{
  expect(describeTool("git_add").title).toBe("Git Add");
  expect(describeTool("browser_agent_download_status").title).toBe("Browser Agent Download Status");
  const rows=[{tool:"execute_command",calls:4,errors:1},{tool:"get_process_output",calls:2,errors:0},{tool:"git_add",calls:1,errors:0}];
  expect(summarizeToolDomains(rows)).toEqual([{category:"Process",calls:6,errors:1},{category:"Git",calls:1,errors:0}]);
  expect(suggestToolProfiles("浏览器截图")).toContain("browser");
  expect(suggestToolProfiles("Git code review")).toContain("development");
 });
});
