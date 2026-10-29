import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {generateKeyPairSync,sign} from "node:crypto";
import {afterEach,describe,it,expect} from "vitest";
import {PlannerContinuationStore} from "../electron/services/planner-continuation-store.mjs";
import {compileApprovedMissionProcess,compileApprovedCodexResume} from "../mcp/mission-execution-policy.mjs";
import {missionApprovalScope,missionApprovalMessage,missionApprovalStatus,assertMissionAction} from "../electron/services/mission-approval.mjs";

const roots=[];
afterEach(()=>{while(roots.length)fs.rmSync(roots.pop(),{recursive:true,force:true})});

function fixture() {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"owl-signed-execution-"));
  roots.push(tmp);
  const root=path.join(tmp,"workspace"),out=path.join(root,"reviewable-art");
  const report=path.join(root,"reports","instructions.md"),bin=path.join(tmp,"tools","cli");
  fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.dirname(report),{recursive:true});
  fs.mkdirSync(path.dirname(bin),{recursive:true});
  fs.writeFileSync(report,"Test instructions, not executable.");
  fs.writeFileSync(bin,"#!/bin/sh\nexit 0\n");fs.chmodSync(bin,0o700);
  const thread="6dc4bb2c-fb21-4609-a0a6-56b0d73f3dd6";
  const args=["--sandbox","workspace-write","-C",out,"exec","resume","--json",thread,"Read the signed instructions."];
  const grant={
    id:"writer-art-1",
    executable:bin,cwd:out,argv:args,workspaceMode:"write",
    writableRoots:[out],
    sandbox:{type:"tool-native",requiredArgvSegments:[["--sandbox","workspace-write"],["-C",out]]},
    compatibility:{threadId:thread,instructionFile:report},
  };
  const store=new PlannerContinuationStore({file:path.join(tmp,"planner-continuation.json")});
  const opened=store.openWorkstream({
    goal:"Repair the existing 3D art in an isolated workspace",
    workspace:{repo:"workspace",worktree:root},
    missionContract:{
      allowedRepositories:["workspace"],
      prohibitedChanges:["No production writes"],
      acceptanceCriteria:["Existing art sources remain identical"],
      executionPermissions:[grant],
    },
  });
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const signer=path.join(tmp,"human-approval-signer.json");
  fs.writeFileSync(signer,JSON.stringify({
    publicKeyB64:publicKey.export({format:"der",type:"spki"}).toString("base64")}));
  const approve=()=>{
    const current=store.get(opened.ownerId);
    const scope=missionApprovalScope(current);
    const signed=sign(null,Buffer.from(missionApprovalMessage(scope)),privateKey).toString("base64");
    store.attachMissionApproval(opened.ownerId,signed);
    return store.get(opened.ownerId);
  };
  return {tmp,root,out,report,bin,thread,grant,store,owner:store.get(opened.ownerId),signer,approve};
}

describe("Dynamically signed Mission process permissions",()=>{
  it("persists executable, args, writable roots and confinement inside immutable signed scope",()=>{
    const f=fixture();
    expect(f.owner.workstream.missionContract.executionPermissions).toEqual([f.grant]);
    expect(missionApprovalStatus(f.owner,f.signer).approved).toBe(false);
    expect(()=>assertMissionAction(f.owner,f.signer,"mission_process_start",
      {permission_id:f.grant.id})).toThrow("MISSION_APPROVAL_REQUIRED");
    const approved=f.approve();
    expect(missionApprovalStatus(approved,f.signer).approved).toBe(true);
    const scope=missionApprovalScope(approved);
    expect(scope.executionPermissions?.[0]).toEqual(f.grant);
    const restored=new PlannerContinuationStore({file:f.store.file}).get(approved.ownerId);
    expect(missionApprovalStatus(restored,f.signer).approved).toBe(true);
  });

  it("allows only signed exact process invocation and denies altered executable, argv, mode and cwd",()=>{
    const f=fixture(),owner=f.approve();
    const x=compileApprovedMissionProcess(owner,{permission_id:f.grant.id});
    expect(x.executable).toBe(fs.realpathSync(f.bin));
    expect(x.cwd).toBe(fs.realpathSync(f.out));
    expect(x.writableRoots).toEqual([fs.realpathSync(f.out)]);
    expect(x.command).toContain("'--sandbox' 'workspace-write'");
    expect(x.sandboxType).toBe("tool-native");
    const allowed={command:x.command,cwd:x.cwd,workspace_mode:"write"};
    expect(()=>assertMissionAction(owner,f.signer,"mission_process_start",
      {permission_id:f.grant.id})).not.toThrow();
    expect(()=>assertMissionAction(owner,f.signer,"start_process",allowed)).not.toThrow();
    for(const args of [
      {...allowed,command:x.command+" ; echo unknown"},
      {...allowed,command:x.command.replace("'workspace-write'","'danger-full-access'")},
      {...allowed,cwd:f.root},
      {...allowed,workspace_mode:"read"},
    ]){
      expect(()=>assertMissionAction(owner,f.signer,"start_process",args))
        .toThrow("MISSION_OPAQUE_ACTION_BLOCKED");
    }
    expect(()=>assertMissionAction(owner,f.signer,"execute_command",
      {...allowed,command:x.command})).toThrow("MISSION_OPAQUE_ACTION_BLOCKED");
    expect(()=>compileApprovedMissionProcess(owner,{permission_id:"not-in-signed-contract"}))
      .toThrow("MISSION_EXEC_PERMISSION_NOT_GRANTED");
    expect(compileApprovedCodexResume(owner,{
      cwd:f.out,thread_id:f.thread,instruction_file:f.report,
    }).command).toBe(x.command);
  });

  it("rejects symlink workspace escapes and paths or required flags absent from signed grant",()=>{
    const f=fixture(),owner=f.approve();
    const altered=(patch)=>{
      const clone=structuredClone(owner);
      Object.assign(clone.workstream.missionContract.executionPermissions[0],patch);
      return clone;
    };
    expect(()=>compileApprovedMissionProcess(altered({cwd:f.tmp}),{permission_id:f.grant.id}))
      .toThrow("MISSION_EXEC_WORKSPACE_VIOLATION");
    expect(()=>compileApprovedMissionProcess(altered({writableRoots:[f.tmp]}),{permission_id:f.grant.id}))
      .toThrow("MISSION_EXEC_WRITE_SCOPE_VIOLATION");
    expect(()=>compileApprovedMissionProcess(altered({argv:["exec","resume","--json",f.thread]}),
      {permission_id:f.grant.id})).toThrow("MISSION_EXEC_SANDBOX_ARGUMENT_MISSING");
    const link=path.join(f.out,"outside-link");fs.symlinkSync(f.tmp,link);
    expect(()=>compileApprovedMissionProcess(altered({cwd:link}),{permission_id:f.grant.id}))
      .toThrow("MISSION_EXEC_WORKSPACE_VIOLATION");
  });

  it("changing any process grant invalidates the human approval, including for file writes",()=>{
    const f=fixture(),owner=f.approve();
    const state=f.store.read(),grant=state.owners[owner.ownerId].workstream.missionContract.executionPermissions[0];
    grant.argv[1]="danger-full-access";f.store.write(state);
    const changed=f.store.get(owner.ownerId);
    expect(missionApprovalStatus(changed,f.signer).reason).toBe("MISSION_SCOPE_CHANGED");
    expect(()=>assertMissionAction(changed,f.signer,"start_process",
      {command:"irrelevant",cwd:f.out,workspace_mode:"write"}))
      .toThrow("MISSION_APPROVAL_REQUIRED");
    expect(()=>assertMissionAction(changed,f.signer,"write_file",
      {path:path.join(f.root,"safe.txt")})).toThrow("MISSION_APPROVAL_REQUIRED");
  });

  it("legacy signed workstreams gain no execution permissions retroactively",()=>{
    const f=fixture();
    const legacy=f.store.openWorkstream({
      goal:"Review existing files",
      workspace:{repo:"workspace",worktree:f.root},
      missionContract:{allowedRepositories:["workspace"]},
    });
    const owner=f.store.get(legacy.ownerId);
    expect(Object.hasOwn(missionApprovalScope(owner),"executionPermissions")).toBe(false);
    expect(()=>compileApprovedMissionProcess(owner,{permission_id:f.grant.id}))
      .toThrow("MISSION_EXEC_PERMISSION_NOT_GRANTED");
  });

  it("fails closed for duplicate grant IDs and invalid planner-supplied entries",()=>{
    const f=fixture();
    const opts={goal:"Another mission",workspace:{repo:"workspace",worktree:f.root}};
    expect(()=>f.store.openWorkstream({...opts,missionContract:{
      allowedRepositories:["workspace"],executionPermissions:[f.grant,{...f.grant}],
    }})).toThrow("MISSION_EXEC_PERMISSION_INVALID");
    expect(()=>f.store.openWorkstream({...opts,missionContract:{
      allowedRepositories:["workspace"],executionPermissions:[{...f.grant,id:"unsafe;echo"}],
    }})).toThrow("MISSION_EXEC_PERMISSION_INVALID");
  });
});
