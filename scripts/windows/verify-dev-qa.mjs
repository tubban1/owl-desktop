#!/usr/bin/env node
// Windows DEV matrix: run every repository unit test except those that assert
// POSIX permission bits, POSIX symlink privileges, launchd or Mac tunnel
// lifecycle. Their macOS CI acceptance remains REQUIRED and is not treated
// as Windows-passing. Native messaging, upload permissions and Windows DEV
// tests remain mandatory and must pass without skips or TODOs.
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
if(process.platform!=="win32"){
  console.error("WINDOWS_DEV_QA_WINDOWS_ONLY");
  process.exit(2);
}
const windowsInapplicable=new Map([
  ["cloud-mcp-completion-store.test.mjs","POSIX 0600 permission bits"],
  ["connectivity-evidence.test.mjs","POSIX file permission security model"],
  ["connectivity-host-launch-agent.test.mjs","macOS launchd service"],
  ["dev-full-owner.test.mjs","macOS process identity"],
  ["dev-runtime-permissions.test.mjs","POSIX signer file permissions"],
  ["local-runtime-bootstrap.test.mjs","macOS bootstrap and privileged symlinks"],
  ["mcp-native-image.test.mjs","POSIX symlink privileges"],
  ["mcp-send-file.test.mjs","POSIX protected paths"],
  ["mission-approval-guard.test.mjs","POSIX symlink privileges"],
  ["planner-continuation-compact-storage.test.mjs","POSIX 0600 permission bits"],
  ["runtime-host-supervisor.test.mjs","macOS Runtime Host identity"],
  ["tunnel-artifact-prune.test.mjs","POSIX file access permissions"],
  ["tunnel-recovery-plan.test.mjs","macOS tunnel binary path"],
  ["tunnel-supervisor.test.mjs","macOS tunnel subprocess lifecycle"]
]);
const dirname=path.join(root,"tests");
const all=fs.readdirSync(dirname).filter(f=>/\.test\.(?:mjs|ts|tsx)$/.test(f)).sort();
for(const f of windowsInapplicable.keys()){
  if(!all.includes(f)){
    console.error("WINDOWS_DEV_QA_EXCLUSION_NOT_FOUND "+f);process.exit(3);
  }
}
const tests=all.filter(f=>!windowsInapplicable.has(f));
for(const f of [
  "native-messaging-bridge.test.mjs",
  "native-host-lifecycle.test.mjs",
  "agent-browser-upload.test.mjs",
  "browser-approved-form-actions.test.mjs",
  "browser-form-uid-regex.test.mjs",
  "browser-upload-policy-live.test.mjs",
  "windows-dev-direct-mcp.test.mjs",
  "windows-dev-native-browser.test.mjs",
  "windows-dev-runtime.test.mjs",
  "owl-mail.test.mjs",
  "runtime-permissions-p0.test.mjs",
  "mcp-workstream-isolation.test.mjs",
  "mcp-tool-surface.test.mjs"
])if(!tests.includes(f)){
  console.error("WINDOWS_DEV_QA_REQUIRED_TEST_MISSING "+f);process.exit(4);
}
const executable=path.join(root,"node_modules","vitest","vitest.mjs");
if(!fs.existsSync(executable)){console.error("VITEST_NOT_INSTALLED");process.exit(5);}
const native=path.join(root,"connection-host","native-messaging-host.mjs");
const raw=fs.readFileSync(native,"utf8");
if(raw.charCodeAt(0)===0xFEFF||raw.includes("\r\n")){
 console.error("NATIVE_HOST_MUST_USE_LF_WITHOUT_BOM");process.exit(6);
}
const parse=spawnSync(process.execPath,["--check",native],{cwd:root,stdio:"inherit"});
if(parse.status!==0){
 console.error("NATIVE_HOST_SYNTAX_CHECK_FAILED");process.exit(7);
}
console.log("[OWL] Windows DEV QA includes",tests.length,"test files");
console.log("[OWL] Platform-inapplicable POSIX/macOS-only files (NOT counted as passed):");
for(const [file,reason] of windowsInapplicable)console.log("  -",file,":",reason);
console.log("[OWL] Windows native/security/core suites are REQUIRED to pass.");
const result=spawnSync(process.execPath,[executable,"run","--maxWorkers=4",...tests.map(f=>"tests/"+f)],{
 cwd:root,stdio:"inherit",shell:false,windowsHide:false,env:process.env
});
if(result.error){console.error(result.error);process.exit(8)}
if(result.status!==0){console.error("WINDOWS_DEV_QA_FAILED");process.exit(result.status||9)}
console.log("WINDOWS_DEV_QA_PASSED; macOS-only acceptance remains a separate gate");
