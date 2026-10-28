import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {versionSnapshot,verifyStagedDirectory,OWL_DESKTOP_REPOSITORY,resolveBundledNpm,safeCommand} from "../scripts/lib/version-sync.mjs";

function git(dir,...args){return execFileSync("git",["-C",dir,...args],{encoding:"utf8"}).trim();}
function fixture(work){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-version-sync-"));
 try{
  git(dir,"init","-q");
  git(dir,"config","user.name","OWL Sync Test");
  git(dir,"config","user.email","sync-test@example.invalid");
  fs.writeFileSync(path.join(dir,"package.json"),'{"version":"1.2.3"}\n');
  git(dir,"add","package.json");
  git(dir,"commit","-m","fixture");
  return work(dir);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
describe("multi-device version sync",()=>{
 it("records a verified source SHA and version without touching checkout",()=>fixture(dir=>{
  const expected=git(dir,"rev-parse","HEAD");
  const info=versionSnapshot(dir);
  expect(info.sourceCommit).toBe(expected);
  expect(info.buildVersion).toBe("1.2.3");
  expect(info.sourceDirty).toBe(false);
  expect(info.remoteStatus).toBe("not-checked");
  expect(info.updateAvailable).toBeNull();
  expect(verifyStagedDirectory(dir,expected)).toBe(true);
 }));
 it("rejects any dirty checkout as an immutable promoted stage",()=>fixture(dir=>{
  const sha=git(dir,"rev-parse","HEAD");
  fs.writeFileSync(path.join(dir,"local-settings.txt"),"user work; must never be reset");
  expect(versionSnapshot(dir).sourceDirty).toBe(true);
  expect(verifyStagedDirectory(dir,sha)).toBe(false);
  expect(fs.readFileSync(path.join(dir,"local-settings.txt"),"utf8")).toContain("never");
 }));
 it("does not claim remote parity when host lacks a Git working tree",()=>{
  const p=fs.mkdtempSync(path.join(os.tmpdir(),"owl-sync-unknown-"));
  try{
   const status=versionSnapshot(p);
   expect(status.sourceCommit).toBeNull();
   expect(status.remoteStatus).toBe("not-checked");
   expect(verifyStagedDirectory(p,"not-a-sha")).toBe(false);
  }finally{fs.rmSync(p,{recursive:true,force:true});}
 });
 it("only trusts the designated GitHub repository as the default source",()=>{
  expect(OWL_DESKTOP_REPOSITORY).toBe("https://github.com/tubban1/owl-desktop.git");
 });
});

it("resolves bundled npm without assuming launchd or Task Scheduler PATH",()=>{
 const npmCli=resolveBundledNpm();
 expect(npmCli).toMatch(/npm-cli\.js$/);
 expect(fs.existsSync(npmCli)).toBe(true);
});

it("runs npm lifecycle scripts without a login-shell PATH",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-sync-npm-path-"));
 const original=process.env.PATH;
 try{
  fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({name:"owl-sync-npm-test",version:"1.0.0",
    scripts:{check:"node --version"}}));
  process.env.PATH=process.platform==="win32"?"C:\\Windows\\System32":"/usr/bin:/bin";
  const stdout=safeCommand(process.execPath,[resolveBundledNpm(),"run","check"],{cwd:dir,timeout:15000});
  expect(stdout).toContain(process.version);
 }finally{
  if(original===undefined)delete process.env.PATH;else process.env.PATH=original;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
