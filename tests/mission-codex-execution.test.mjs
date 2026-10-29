import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {generateKeyPairSync,sign} from "node:crypto";
import {assertMissionAction,missionApprovalScope,missionApprovalDigest,missionApprovalMessage} from "../electron/services/mission-approval.mjs";
import {afterEach,describe,it,expect} from "vitest";
import {compileApprovedCodexResume} from "../mcp/mission-codex-execution.mjs";

const cleanup=[];
afterEach(()=>{while(cleanup.length)fs.rmSync(cleanup.pop(),{recursive:true,force:true})});
function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-mission-codex-"));
  cleanup.push(dir);
  const root=path.join(dir,"project",".tmp","botanical32-assessment-20261028","worktree");
  const home=path.join(dir,"home");
  const art=path.join(root,".tmp/botanical32-quality/art-directed");
  const out=path.join(art,"r3");
  const report=path.join(art,"reports");
  const bin=path.join(home,".codex/plugins/.plugin-appserver/codex-cli/bin/codex");
  for(const p of [path.dirname(bin),path.join(home,".codex/sessions"),path.join(home,".codex/log"),out,path.join(out,".codex-tmp"),report,path.join(root,"public/models")])fs.mkdirSync(p,{recursive:true});
  fs.writeFileSync(bin,"#!/bin/sh\n# test program, no user Codex\n"+
    'echo allowed > "$PWD/.tmp/botanical32-quality/art-directed/r3/new.txt"\n'+
    'echo shouldfail > "$PWD/public/models/production.glb" 2>/dev/null\n'+
    'echo shouldfail > "$PWD/.tmp/botanical32-quality/art-directed/reports/historical.md" 2>/dev/null\n'+
    'ln -s "$PWD/public/models" "$PWD/.tmp/botanical32-quality/art-directed/r3/unsafe" 2>/dev/null || true\n'+
    'echo shouldfail > "$PWD/.tmp/botanical32-quality/art-directed/r3/unsafe/escape.glb" 2>/dev/null\n'+
    "exit 0\n");
  fs.chmodSync(bin,0o700);
  fs.writeFileSync(path.join(home,".codex","installation_id"),"fixture-installation-id");
  fs.writeFileSync(path.join(report,"historical.md"),"HISTORICAL");
  const prompt=path.join(report,"CODEX_R3_ART_REWORK_ORDER_20261029.md");
  fs.writeFileSync(prompt,"No edits to production; Garden Rose art R3.");
  return {
    root,home,art,out,prompt,bin,dir,
    owner:{checkpoint:{workspace:{worktree:root}},workstream:{missionContract:{
      originalGoal:"Finish Bloomroom botanical32 art-directed QA",
      prohibitedChanges:["No writes outside .tmp/botanical32-quality/art-directed",
        "No edits of public/models or production GLBs"],
    }}},
    args:{cwd:root,thread_id:"01a184da-0ca6-7d83-b596-0ca602d17b3d",instruction_file:prompt},
  };
}
const runOptions=f=>({userHome:f.home,codexBin:f.bin,platform:"darwin",sandboxExecutable:process.platform==="darwin"?"/usr/bin/sandbox-exec":"/bin/echo"});

describe("Mission-scoped, non-shell Codex continuation",()=>{
  it("rejects unaudited scope, forged paths and arbitrary instructions",()=>{
    const f=fixture();
    const valid=compileApprovedCodexResume(f.owner,f.args,runOptions(f));
    expect(valid.sandbox.writeDir).toBe(fs.realpathSync(f.out));
    expect(valid.command).toContain(runOptions(f).sandboxExecutable);
    expect(valid.sandbox.policy).toContain("(deny default)");
    expect(valid.sandbox.policy).toContain("(allow sysctl-read)");
    expect(valid.sandbox.policy).toContain('(allow file-write* (literal "'+path.join(fs.realpathSync(f.home),'.codex','installation_id')+'"))');
    expect(valid.sandbox.policy).not.toContain('(allow file-write* (subpath "'+path.join(f.home,'.codex')+'"))');
    expect(valid.sandbox.policy).not.toContain("file-write* (subpath "+JSON.stringify(f.root)+")");
    expect(()=>compileApprovedCodexResume({checkpoint:f.owner.checkpoint,workstream:{missionContract:{originalGoal:"other project"}}},f.args,runOptions(f))).toThrow("MISSION_CODEX_PROFILE_NOT_AUTHORIZED");
    expect(()=>compileApprovedCodexResume(f.owner,{...f.args,thread_id:"id;rm -rf /"},runOptions(f))).toThrow("MISSION_CODEX_THREAD_INVALID");
    const outsider=path.join(f.dir,"outsider.md");
    fs.writeFileSync(outsider,"No edits to production; Garden Rose art R3");
    expect(()=>compileApprovedCodexResume(f.owner,{...f.args,instruction_file:outsider},runOptions(f))).toThrow("MISSION_CODEX_INSTRUCTION_OUTSIDE_SCOPE");
    expect(()=>compileApprovedCodexResume(f.owner,{...f.args,cwd:path.dirname(f.root)},runOptions(f))).toThrow("MISSION_CODEX_WORKTREE_MISMATCH");
  });
  it.skipIf(process.platform!=="darwin")("permits only the exact signed sandbox command via existing start_process",()=>{
    const f=fixture();
    f.owner.workstream.workstreamId="owl-workstream:demo";
    f.owner.workstream.missionContract.allowedRepositories=["worktree"];
    const {privateKey,publicKey}=generateKeyPairSync("ed25519");
    const signer=path.join(f.dir,"human-approval-signer.json");
    fs.writeFileSync(signer,JSON.stringify({publicKeyB64:publicKey.export({format:"der",type:"spki"}).toString("base64")}));
    const scope=missionApprovalScope(f.owner);
    f.owner.workstream.missionContract.approval={
      digest:missionApprovalDigest(scope),
      signature:sign(null,Buffer.from(missionApprovalMessage(scope)),privateKey).toString("base64"),
    };
    // Use the actual fixed user Codex binary in the bridge, never a fake program.
    const realBin=path.join(os.homedir(),".codex/plugins/.plugin-appserver/codex-cli/bin/codex");
    if(!fs.existsSync(realBin))return; // Native CLI unavailable on CI macOS.
    // The compiler must see an authentic, preverified user-home Codex path.
    const constructed=compileApprovedCodexResume(f.owner,f.args,{userHome:os.homedir()});
    const allowed={cwd:constructed.cwd,command:constructed.command,workspace_mode:"write"};
    expect(()=>assertMissionAction(f.owner,signer,"start_process",allowed)).not.toThrow();
    expect(()=>assertMissionAction(f.owner,signer,"start_process",{...allowed,command:allowed.command+" ; echo unauthorized"})).toThrow("MISSION_OPAQUE_ACTION_BLOCKED");
    expect(()=>assertMissionAction(f.owner,signer,"execute_command",allowed)).toThrow("MISSION_OPAQUE_ACTION_BLOCKED");
  });
  it.skipIf(process.platform!=="darwin")("real Rust Codex boots with restricted sysctl-read but no project-write grant",()=>{
    const bin=path.join(os.homedir(),".codex/plugins/.plugin-appserver/codex-cli/bin/codex");
    if(!fs.existsSync(bin))return;
    const f=fixture();
    const launch=compileApprovedCodexResume(f.owner,f.args,{userHome:os.homedir(),codexBin:bin});
    const started=spawnSync("/usr/bin/sandbox-exec",["-p",launch.sandbox.policy,bin,"--version"],{
      cwd:f.root,encoding:"utf8",timeout:20_000,
      env:{...process.env,TMPDIR:path.join(f.out,".codex-tmp")+"/"},
    });
    expect(started.status,"Actual Codex failed to boot: "+started.stderr).toBe(0);
    expect(started.stdout).toMatch(/codex-cli/);
    expect(fs.existsSync(path.join(f.root,"public/models/production.glb"))).toBe(false);
  });
  it.skipIf(process.platform!=="darwin")("real Codex app-server initializes with installation_id-only write, protected art unchanged",()=>{
    const bin=path.join(os.homedir(),".codex/plugins/.plugin-appserver/codex-cli/bin/codex");
    if(!fs.existsSync(bin))return;
    const f=fixture();
    const launch=compileApprovedCodexResume(f.owner,f.args,{userHome:os.homedir(),codexBin:bin});
    const result=spawnSync("/usr/bin/sandbox-exec",[
      "-p",launch.sandbox.policy,bin,"exec","resume","--json",
      "00000000-0000-0000-0000-000000000000","diagnostic only",
    ],{cwd:f.root,encoding:"utf8",timeout:20_000,
      env:{...process.env,TMPDIR:path.join(f.out,".codex-tmp")+"/"}});
    expect(result.stderr).not.toContain("failed to initialize in-process app-server client");
    expect(result.stderr).toContain("Not inside a trusted directory");
    expect(fs.existsSync(path.join(f.root,"public/models/production.glb"))).toBe(false);
  });
  it.skipIf(process.platform!=="darwin")("macOS kernel denies production/historical writes and symlink escape",()=>{
    const f=fixture();
    const launch=compileApprovedCodexResume(f.owner,f.args,runOptions(f));
    const proc=spawnSync("/bin/sh",["-c",launch.command],{cwd:f.root,encoding:"utf8",timeout:20_000});
    expect(proc.status,proc.stderr).toBe(0);
    expect(fs.readFileSync(path.join(f.out,"new.txt"),"utf8")).toBe("allowed\n");
    expect(fs.existsSync(path.join(f.root,"public/models/production.glb"))).toBe(false);
    expect(fs.readFileSync(path.join(f.art,"reports/historical.md"),"utf8")).toBe("HISTORICAL");
    expect(fs.existsSync(path.join(f.root,"public/models/escape.glb"))).toBe(false);
  });
});
