import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {verifyStagedDirectory} from "./version-sync.mjs";

export const DEFAULT_SYNC_STATE_ROOT=path.join(os.homedir(),".owl-lab","version-sync","desktop");

export function readVerifiedStage(stateRoot=DEFAULT_SYNC_STATE_ROOT){
 let receipt=null;
 try{receipt=JSON.parse(fs.readFileSync(path.join(stateRoot,"last-staged.json"),"utf8"));}catch{}
 const sha=typeof receipt?.commit==="string"&&/^[a-f0-9]{40}$/.test(receipt.commit)?receipt.commit:null;
 const stagePath=sha?path.join(stateRoot,sha):null;
 const exists=Boolean(stagePath&&verifyStagedDirectory(stagePath,sha));
 const gatesPassed=Boolean(exists&&receipt?.localSmokePassed===true&&receipt?.buildPassed===true);
 return {commit:exists?sha:null,verified:exists,gatesPassed,
   verifiedAt:gatesPassed?receipt.verifiedAt??null:null,
   staleReceipt:Boolean(sha&&!exists),receipt:exists?receipt:null};
}

/** Never substitute checked-out source HEAD or an immutable staged SHA for a live MCP process SHA. */
export function deviceVersionState({source,live=null,stage,checkedAt=new Date().toISOString()}){
 const desired=source?.remoteStatus==="verified"?source.remoteCommit:null;
 const checkout=source?.sourceCommit??null;
 const running=live?.sourceCommit??null;
 const stageCommit=stage?.verified?stage.commit:null;
 const relative=(commit)=>!desired?"unknown":!commit?"unknown":commit===desired?"current":"behind-or-diverged";
 const liveKnown=Boolean(running);
 const liveHealthyRevision=liveKnown&&live?.sourceDirty===false;
 return {
  checkedAt,platform:source?.platform??process.platform,architecture:source?.architecture??process.arch,
  desiredMainCommit:desired,githubReachable:source?.remoteStatus==="verified",
  sourceCheckoutCommit:checkout,sourceCheckoutDirty:source?.sourceDirty??null,
  runningMcpCommit:running,runningMcpVersionEvidence:liveKnown?"process-startup":"not-observed",
  liveCodeRevisionVerified:false, // startup SHA != independent runtime-binary attestation
  stagedCandidateCommit:stageCommit,stagingGatesPassed:stage?.gatesPassed===true,
  stagingReceiptVerifiedAt:stage?.verifiedAt??null,
  sourceCheckoutStatus:relative(checkout),runningMcpStatus:relative(running),
  stagingStatus:!stage?.verified?"missing":!stage.gatesPassed?"unverified":relative(stageCommit),
  activationNeeded:liveHealthyRevision&&desired?running!==desired:liveKnown&&desired?true:null,
  sourceStageReadyForPreflight:stage?.gatesPassed===true&&Boolean(desired)&&stageCommit===desired,
  liveActivationAllowed:null, // requires CI, release assets, supervisor, cross-device guard and rollback health gates
  lastStagingAttemptDoesNotProveLiveActivation:true,
 };
}
