#!/usr/bin/env node
/**
 * Safe activation gate. Preflight can run unattended, but NEVER restarts
 * Desktop/Runtime/MCP/Tunnel or overwrites the user's development checkout.
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {DEFAULT_STATE_ROOT,readCandidate,requiredReleaseArtifacts,
  assessActivation,githubMainCi,probeShadowMcp} from "./lib/activation-gate.mjs";

const root=process.env.OWL_VERSION_SYNC_STATE_ROOT?
 path.resolve(process.env.OWL_VERSION_SYNC_STATE_ROOT):DEFAULT_STATE_ROOT;
const mode=process.argv[2]??"status";
function response(v){process.stdout.write(JSON.stringify(v,null,2)+"\n");}
function reportFile(){return path.join(root,"activation-preflight.json");}
function report(){
 try{return JSON.parse(fs.readFileSync(reportFile(),"utf8"));}catch{return null;}
}
function save(v){
 const temp=reportFile()+"."+randomUUID()+".tmp";
 try{
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(root);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error("ACTIVATION_ROOT_UNSAFE");
  fs.writeFileSync(temp,JSON.stringify(v,null,2)+"\n",{mode:0o600,flag:"wx"});
  fs.renameSync(temp,reportFile());
 }finally{try{fs.unlinkSync(temp);}catch{}}
}
async function preflight(){
 const candidate=readCandidate(undefined,root);
 const sha=candidate.sha;
 const ci=candidate.verified?await githubMainCi(sha):{status:"not-checked"};
 // Never execute unreviewed candidate code before GitHub main CI is verified.
 const shadow=candidate.verified&&ci.status==="success"?
  await probeShadowMcp(candidate.stage):{passed:false,reason:"github-main-ci-not-verified"};
 const artifacts=candidate.verified?requiredReleaseArtifacts(candidate.stage):[];
 // An external self-restarting supervisor with independent, tested rollback
 // must attest its own liveness before a live process can ever be promoted.
 // This service intentionally does not synthesize such attestation.
 const guardian={independent:false,rollbackTested:false};
 const gate=assessActivation({candidate,shadow,ci,artifacts,guardian});
 const result={schemaVersion:1,at:new Date().toISOString(),
   candidateSha:sha,candidateVerified:candidate.verified,
   ci,shadow,artifactChecks:artifacts,guardian,gate,
   liveMcpChanged:false,liveTunnelChanged:false,liveRuntimeChanged:false,
   note:"Preflight only. No live activation, no existing checkout modification."};
 save(result);response(result);
 if(!gate.activationAllowed)process.exitCode=3;
}
if(mode==="status"){
 response({candidate:readCandidate(undefined,root),lastPreflight:report(),
  activeRuntimeNotInferred:true,processRestarted:false});
}else if(mode==="preflight"){await preflight();}
else{console.error("Usage: node scripts/version-activation.mjs status|preflight");process.exitCode=2;}
