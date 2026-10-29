// Shared cross-platform MCP presentation taxonomy. This is not an execution or authorization policy.
// Keep callable IDs unchanged; never infer a Runtime Primitive for direct adapters.
export const TOOL_TAXONOMY_VERSION = 1;
const explicit = {
  execute_command:["Run Command","Process","sys.exec","run","shell.exec","privileged"],
  start_process:["Start Process","Process","process.manage","start","shell.start"],
  mission_codex_resume:["Resume Scoped Codex","Process",null,null,"mission.codex.resume","side-effect"],
  get_process_output:["Get Process Output","Process","process.manage","output","shell.output"],
  list_processes:["List Processes","Process","process.manage","list","shell.processes"],
  send_process_input:["Send Process Input","Process","process.manage","input","shell.input"],
  kill_process:["Kill Process","Process","process.manage","kill","shell.kill"],
  read_file:["Read File","Files","fs.read","one","fs.read"],
  read_multiple_files:["Read Multiple Files","Files","fs.read","many","fs.read_many"],
  write_file:["Write File","Files","fs.write","write","fs.write"],
  edit_file:["Edit File","Files","fs.write","edit","fs.edit"],
  append_file:["Append File","Files","fs.write","append","fs.append"],
  batch_edit_files:["Batch Edit Files","Files","fs.write","batch_edit","fs.batch_edit"],
  list_directory:["List Directory","Files","fs.list","directory","fs.list"],
  list_directory_tree:["List Directory Tree","Files","fs.list","tree","fs.tree"],
  search_files:["Search Files","Files","fs.search","names","fs.search"],
  file_info:["File Information","Files","fs.stat","get","fs.info"],
  create_directory:["Create Directory","Files","fs.manage","mkdir","fs.mkdir"],
  move_path:["Move Path","Files","fs.manage","move","fs.move"],
  copy_path:["Copy Path","Files","fs.manage","copy","fs.copy"],
  delete_path:["Delete Path","Files","fs.manage","delete","fs.delete"],
  git_status:["Git Status","Git","git.query","status","git.status"],
  git_diff:["Git Diff","Git","git.query","diff","git.diff"],
  git_log:["Git Log","Git","git.query","log","git.log"],
  git_add:["Git Add","Git","git.mutate","add","git.add"],
  git_commit:["Git Commit","Git","git.mutate","commit","git.commit"],
  git_pull:["Git Pull","Git","git.mutate","pull","git.pull"],
  git_push:["Git Push","Git","git.mutate","push","git.push"],
  apply_patch:["Apply Patch","Git","git.mutate","patch","git.patch"],
  begin_transaction:["Begin Transaction","Transactions","tx.manage","begin","tx.begin"],
  transaction_status:["Transaction Status","Transactions","tx.manage","status","tx.status"],
  rollback_transaction:["Rollback Transaction","Transactions","tx.manage","rollback","tx.rollback"],
  complete_transaction:["Complete Transaction","Transactions","tx.manage","complete","tx.complete"],
  list_transactions:["List Transactions","Transactions","tx.manage","list","tx.list"],
  workstream_open:["Open Workstream","Orchestration"],
  workstream_progress:["Report Progress","Orchestration"],
  workstream_complete:["Complete Workstream","Orchestration"],
  runtime_info:["Runtime Information","Core"],
  primitive_call:["Call Primitive","Core"],
  primitive_catalog:["Primitive Catalog","Core"],
  skill_run:["Run Skill","Core"],
  skill_catalog:["Skill Catalog","Core"],
  capability_manifest:["Capability Manifest","Core"],
  get_capabilities:["Get Capabilities","Core"],
  browser_agent_snapshot:["Browser Snapshot","Browser"],
};
const acronyms=new Set(["mcp","api","ui","git","url","id","http","https","os","oauth","json","svg","pdf","csv","qa","ota"]);
const titleFor=(id)=>id.split("_").map(w=>acronyms.has(w)?w.toUpperCase():w? w[0].toUpperCase()+w.slice(1):"").join(" ");
function domainFor(id){
 if(id.startsWith("browser_")||id.startsWith("desktop_")||id.startsWith("pointer_")) return "Browser";
 if(id.startsWith("mail_")) return "Communication";
 if(id.startsWith("git_")) return "Git";
 if(id.startsWith("workstream_")||id.startsWith("planner_")||id.startsWith("conversation_")) return "Orchestration";
 if(id.startsWith("task_")||id.startsWith("orchestration_")||id.startsWith("agent_requests_")) return "Orchestration";
 if(id.startsWith("remote_task_")||id.startsWith("device_")||id.startsWith("windows_")) return "Devices";
 if(id.startsWith("provider_")||id.startsWith("admin_")) return "Administration";
 if(id.startsWith("runtime_")||id.endsWith("_catalog")||id.includes("capabilit")) return "Core";
 if(id.startsWith("fs_")||id.includes("file")||id.includes("directory")||id.includes("path")) return "Files";
 if(id.includes("process")||id.includes("command")) return "Process";
 if(id.includes("transaction"))return "Transactions";
 return "Utilities";
}
const categoryToProfile={Core:"core",Orchestration:"core",Browser:"browser",Communication:"communication",Git:"development",Files:"development",Process:"development",Transactions:"development",Devices:"administration",Administration:"administration",Utilities:"core"};
export function describeTool(id,source={}){
 if(typeof id!=="string"||!/^[a-z][a-z0-9_]{1,100}$/.test(id))throw Error("Invalid tool ID");
 const [title,category,primitive,op,action,tier]=explicit[id]??[];
 const group=category??domainFor(id);
 const legacy= /^(Compatibility tool:|Legacy compatibility)/.test(source.description??"") || ["router_catalog","computer_action","computer_batch","computer_graph"].includes(id);
 const profile=legacy?"legacy":categoryToProfile[group]??"core";
 return Object.freeze({id,title:title??titleFor(id),category:group,profile,visibility:legacy?"legacy":profile==="core"?"core":"domain",
  primitive:primitive??null,op:op??null,action:action??null,
  executionPath:primitive?"runtime-primitive":group==="Browser"&&id.startsWith("browser_agent_")?"adapter-native":group==="Orchestration"?"runtime-control":"capability-dependent",
  riskTier:tier??(source.annotations?.destructiveHint?"side-effect":"standard"),
  supportedPlatforms:id==="mission_codex_resume"?["darwin"]:["darwin","win32"],availability:"probe-provider",deprecated:legacy,
  replacement:["computer_action","computer_batch","computer_graph","router_catalog"].includes(id)?"primitive_call":null});
}
export function summarizeToolDomains(rows){
 const groups=new Map();
 for(const {tool,calls=0,errors=0} of rows??[]){
  const info=describeTool(tool);const prev=groups.get(info.category)??{category:info.category,calls:0,errors:0};
  prev.calls+=calls;prev.errors+=errors;groups.set(info.category,prev);
 }
 return [...groups.values()].sort((a,b)=>b.calls-a.calls||a.category.localeCompare(b.category));
}
export function suggestToolProfiles(goal=""){
 const g=String(goal).toLowerCase();
 const profiles=new Set(["core"]);
 if(/\b(git|code|build|test|repo|file|shell|npm|commit|代码|仓库|文件|测试|开发|部署)\b|代码|仓库|文件|测试|开发|部署/.test(g))profiles.add("development");
 if(/\b(browser|chrome|website|web|tab|网页|浏览器)\b|网页|浏览器/.test(g))profiles.add("browser");
 if(/\b(mail|email|gmail|message|邮件|邮箱)\b|邮件|邮箱/.test(g))profiles.add("communication");
 if(/\b(device|windows|mac|permission|诊断|设备|权限)\b|诊断|设备|权限/.test(g))profiles.add("administration");
 return [...profiles];
}
