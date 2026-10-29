import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
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
    expect(valid.command).toContain("sandbox-exec");
    expect(valid.sandbox.policy).toContain("(deny default)");
    expect(valid.sandbox.policy).not.toContain("file-write* (subpath "+JSON.stringify(f.root)+")");
    expect(()=>compileApprovedCodexResume({checkpoint:f.owner.checkpoint,workstream:{missionContract:{originalGoal:"other project"}}},f.args,runOptions(f))).toThrow("MISSION_CODEX_PROFILE_NOT_AUTHORIZED");
    expect(()=>compileApprovedCodexResume(f.owner,{...f.args,thread_id:"id;rm -rf /"},runOptions(f))).toThrow("MISSION_CODEX_THREAD_INVALID");
    const outsider=path.join(f.dir,"outsider.md");
    fs.writeFileSync(outsider,"No edits to production; Garden Rose art R3");
    expect(()=>compileApprovedCodexResume(f.owner,{...f.args,instruction_file:outsider},runOptions(f))).toThrow("MISSION_CODEX_INSTRUCTION_OUTSIDE_SCOPE");
    expect(()=>compileApprovedCodexResume(f.owner,{...f.args,cwd:path.dirname(f.root)},runOptions(f))).toThrow("MISSION_CODEX_WORKTREE_MISMATCH");
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
