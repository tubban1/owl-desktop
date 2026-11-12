import {afterEach,describe,expect,it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {syncMacGuardFromVerifiedRelease,MAC_GUARD_FILES} from "../scripts/lib/ota-mac-guard-sync.mjs";

const fixtures=[];
function setup() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-guard-sync-test-"));
  fixtures.push(root);
  const releaseRoot=path.join(root,"release");
  const agentRoot=path.join(root,"agent");
  fs.mkdirSync(path.join(releaseRoot,"scripts","lib"),{recursive:true});
  fs.mkdirSync(path.join(agentRoot,"lib"),{recursive:true});
  for(const file of MAC_GUARD_FILES) {
    fs.writeFileSync(path.join(releaseRoot,"scripts",file),"// safe release: "+file+"\n");
    fs.writeFileSync(path.join(agentRoot,file),"// stale agent: "+file+"\n");
  }
  return {root,releaseRoot,agentRoot};
}
afterEach(()=>{for(const d of fixtures.splice(0))fs.rmSync(d,{recursive:true,force:true});});

describe("macOS independent OTA watchdog bundle synchronization",()=>{
  it("updates BOTH stale scripts to the verified candidate, without starting processes",()=>{
    const {releaseRoot,agentRoot}=setup();
    const result=syncMacGuardFromVerifiedRelease({releaseRoot,agentRoot});
    expect(result.verified).toBe(true);
    expect(result.changed).toEqual([...MAC_GUARD_FILES]);
    for(const file of MAC_GUARD_FILES){
      expect(fs.readFileSync(path.join(agentRoot,file))).toEqual(
        fs.readFileSync(path.join(releaseRoot,"scripts",file)));
      expect(result.checksums[file]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("is idempotent when the independent agent is already current",()=>{
    const {releaseRoot,agentRoot}=setup();
    syncMacGuardFromVerifiedRelease({releaseRoot,agentRoot});
    expect(syncMacGuardFromVerifiedRelease({releaseRoot,agentRoot}).changed).toEqual([]);
  });

  it("does not change either target if any required source file is missing",()=>{
    const {releaseRoot,agentRoot}=setup();
    const original=fs.readFileSync(path.join(agentRoot,MAC_GUARD_FILES[0]),"utf8");
    fs.unlinkSync(path.join(releaseRoot,"scripts",MAC_GUARD_FILES[1]));
    expect(()=>syncMacGuardFromVerifiedRelease({releaseRoot,agentRoot})).toThrow();
    expect(fs.readFileSync(path.join(agentRoot,MAC_GUARD_FILES[0]),"utf8")).toBe(original);
  });

  it("rejects symlink targets rather than writing through links",()=>{
    const {releaseRoot,agentRoot,root}=setup();
    const target=path.join(agentRoot,MAC_GUARD_FILES[1]);
    fs.unlinkSync(target);
    const external=path.join(root,"outside");
    fs.writeFileSync(external,"protected");
    fs.symlinkSync(external,target);
    expect(()=>syncMacGuardFromVerifiedRelease({releaseRoot,agentRoot})).toThrow(/SYMLINK/);
    expect(fs.readFileSync(external,"utf8")).toBe("protected");
  });

  it("the installed OTA runner syncs guard BEFORE creating launchd jobs",()=>{
    const updater=fs.readFileSync(new URL("../scripts/auto-version-updater.mjs",import.meta.url),"utf8");
    const installer=fs.readFileSync(new URL("../scripts/install-auto-ota.mjs",import.meta.url),"utf8");
    const sync=updater.indexOf("const guard=syncMacGuardFromVerifiedRelease(");
    const job=updater.indexOf("const name=\"fan.fde.owl.rollout.\"");
    expect(sync).toBeGreaterThan(0);
    expect(job).toBeGreaterThan(sync);
    expect(updater).toContain("if(!cleanRoot(newRoot,newSha,{built:true}))");
    expect(installer).toContain('["scripts/lib/ota-mac-guard-sync.mjs","lib/ota-mac-guard-sync.mjs"]');
  });
});
