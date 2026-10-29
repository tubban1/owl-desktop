import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {generateKeyPairSync,sign} from "node:crypto";
import {afterEach,describe,it,expect} from "vitest";
import {PlannerContinuationStore} from "../electron/services/planner-continuation-store.mjs";
import {missionApprovalScope,missionApprovalDigest,missionApprovalMessage,missionApprovalStatus,
  selectMissionExecutionPermissions,assertMissionAction} from "../electron/services/mission-approval.mjs";
import {compileApprovedMissionProcess} from "../mcp/mission-execution-policy.mjs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MissionReviewCard} from "../src/permissions/MissionReviewPanel.tsx";

const created=[];
afterEach(()=>{while(created.length)fs.rmSync(created.pop(),{recursive:true,force:true})});
function example(){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"owl-mission-switch-"));
  created.push(tmp);
  const root=path.join(tmp,"project"),art=path.join(root,"art");
  fs.mkdirSync(art,{recursive:true});
  const cli=path.join(tmp,"tools","agent");
  fs.mkdirSync(path.dirname(cli),{recursive:true});
  fs.writeFileSync(cli,"#!/bin/sh\nexit 0\n");fs.chmodSync(cli,0o700);
  const grant=id=>({
    id, executable:cli,cwd:art,argv:["--sandbox","workspace-write","-C",art,"exec",id],
    workspaceMode:"write",writableRoots:[art],
    sandbox:{type:"tool-native",requiredArgvSegments:[["--sandbox","workspace-write"]]},
  });
  const store=new PlannerContinuationStore({file:path.join(tmp,"planner-continuation.json")});
  const work=store.openWorkstream({
    goal:"Review 3D art output",label:"Art agent",
    workspace:{repo:"project",worktree:root},
    missionContract:{
      allowedRepositories:["project"],
      prohibitedChanges:["No production modifications"],
      executionPermissions:[grant("art-writer"),grant("secondary-tool")],
    },
  });
  const id=work.ownerId;
  const signer=path.join(tmp,"human-approval-signer.json");
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  fs.writeFileSync(signer,JSON.stringify({publicKeyB64:publicKey.export({format:"der",type:"spki"}).toString("base64")}));
  const approve=selected=>{
    const owner=store.get(id);
    const proposed=missionApprovalScope(owner,null);
    const scope=selectMissionExecutionPermissions(proposed,selected);
    const sig=sign(null,Buffer.from(missionApprovalMessage(scope)),privateKey).toString("base64");
    return store.attachMissionApproval(id,sig,undefined,{enabledPermissionIds:selected});
  };
  return {tmp,root,art,cli,id,signer,store,approve};
}
describe("Inline switch approvals are real signed capabilities",()=>{
  it("supports partially selected grants and refuses all other process permissions",()=>{
    const f=example();
    const before=f.store.get(f.id);
    const proposed=missionApprovalScope(before,null);
    expect(proposed.executionPermissions).toHaveLength(2);
    expect(f.store.listMissionReviews().find(x=>x.workstreamId===f.id)).toMatchObject({
      status:"needs_review",enabledPermissionIds:[],
      reviewDigest:missionApprovalDigest(proposed),
    });
    f.approve(["art-writer"]);
    const owner=f.store.get(f.id);
    const status=missionApprovalStatus(owner,f.signer);
    expect(status).toMatchObject({approved:true,reason:"USER_CONFIRMED"});
    expect(status.scope.executionPermissions.map(x=>x.id)).toEqual(["art-writer"]);
    expect(status.scope.executionPermissionProposalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(f.store.listMissionReviews().find(x=>x.workstreamId===f.id)).toMatchObject({
      status:"approved",enabledPermissionIds:["art-writer"],
    });
    expect(()=>assertMissionAction(owner,f.signer,"mission_process_start",
      {permission_id:"art-writer"})).not.toThrow();
    expect(()=>assertMissionAction(owner,f.signer,"mission_process_start",
      {permission_id:"secondary-tool"})).toThrow("MISSION_EXEC_PERMISSION_NOT_GRANTED");
    expect(()=>compileApprovedMissionProcess(owner,{permission_id:"secondary-tool"}))
      .toThrow("MISSION_EXEC_PERMISSION_NOT_GRANTED");
    const unselected=owner.workstream.missionContract.executionPermissions[1];
    const altered=structuredClone(owner);
    altered.workstream.missionContract.executionPermissions[1]={...unselected,argv:["--sandbox","danger-full-access"]};
    expect(missionApprovalStatus(altered,f.signer).reason).toBe("MISSION_SCOPE_CHANGED");
  });
  it("signs an OFF selection for all process grants, without enabling them",()=>{
    const f=example();
    f.approve([]);
    const owner=f.store.get(f.id);
    expect(missionApprovalStatus(owner,f.signer).approved).toBe(true);
    expect(missionApprovalStatus(owner,f.signer).scope.executionPermissions).toBeUndefined();
    expect(()=>assertMissionAction(owner,f.signer,"mission_process_start",
      {permission_id:"art-writer"})).toThrow("MISSION_EXEC_PERMISSION_NOT_GRANTED");
  });
  it("turning mission OFF persists revocation and stops future approvals",()=>{
    const f=example();
    f.approve(["art-writer"]);
    expect(f.store.revokeMissionApproval(f.id)).toMatchObject({approved:false,revoked:true});
    const owner=f.store.get(f.id);
    expect(missionApprovalStatus(owner,f.signer).reason).toBe("MISSION_APPROVAL_REVOKED");
    expect(f.store.listMissionReviews().find(x=>x.workstreamId===f.id)).toMatchObject({
      status:"needs_review",enabledPermissionIds:[],
    });
    expect(()=>assertMissionAction(owner,f.signer,"mission_process_start",
      {permission_id:"art-writer"})).toThrow("MISSION_APPROVAL_REQUIRED");
    f.approve(["secondary-tool"]);
    expect(missionApprovalStatus(f.store.get(f.id),f.signer).approved).toBe(true);
    expect(f.store.get(f.id).workstream.missionContract.approval.revokedAt).toBeUndefined();
  });
  it("approved mission renders ON switches only for permitted grants; turn-off stays available",()=>{
    const f=example();
    f.approve(["art-writer"]);
    const row=f.store.listMissionReviews().find(x=>x.workstreamId===f.id);
    const html=renderToStaticMarkup(React.createElement(MissionReviewCard,{
      row,busy:false,onApprove:async()=>undefined,onRevoke:async()=>undefined,
    }));
    expect(row.status).toBe("approved");
    expect(row.enabledPermissionIds).toEqual(["art-writer"]);
    expect((html.match(/aria-checked="true"/g)||[])).toHaveLength(2);
    expect((html.match(/aria-checked="false"/g)||[])).toHaveLength(1);
    expect(html).toContain("Turn off mission authorization");
    expect(html).toContain("Already running processes are not stopped automatically");
  });
  it("rejects duplicate, forged or unknown selected IDs at every signing boundary",()=>{
    const f=example();
    const scope=missionApprovalScope(f.store.get(f.id),null);
    for(const selection of [["art-writer","art-writer"],["not-proposed"],[123],null]){
      expect(()=>selectMissionExecutionPermissions(scope,selection)).toThrow();
    }
    const badSig="invalid-signer";
    expect(()=>f.store.attachMissionApproval(f.id,badSig,undefined,{enabledPermissionIds:["art-writer"]}))
      .toThrow("MISSION_SIGNATURE_INVALID");
    expect(missionApprovalStatus(f.store.get(f.id),f.signer).approved).toBe(false);
  });
  it("legacy signatures remain valid without enabling any new unselected mode",()=>{
    const f=example();
    const owner=f.store.get(f.id);
    const scope=missionApprovalScope(owner,null);
    const bare=structuredClone(owner);
    bare.workstream.missionContract.approval={digest:missionApprovalDigest(scope),signature:"invalid"};
    expect(missionApprovalScope(bare)).toEqual(scope);
    expect(Object.hasOwn(scope,"executionPermissionProposalDigest")).toBe(false);
  });
  it("renders the compact switch UI, accessible labels and collapsed full details",()=>{
    const f=example();
    const row=f.store.listMissionReviews().find(x=>x.workstreamId===f.id);
    const html=renderToStaticMarkup(React.createElement(MissionReviewCard,{
      row,busy:false,onApprove:async()=>undefined,onRevoke:async()=>undefined,
    }));
    expect((html.match(/role="switch"/g)||[])).toHaveLength(3);
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("Show exact permissions and commands");
    expect(html).toContain("art-writer");
    expect(html).not.toContain("Review mission");
    expect(html).toContain("<details");
    expect(html).not.toContain("<dialog");
  });
});
