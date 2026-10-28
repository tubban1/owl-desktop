import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {retireSupersededMacCurrentJobs} from "../scripts/lib/mac-release-startup.mjs";

test("retire inactive macOS stale and QA current jobs; preserve active release, fallback and live jobs",{skip:process.platform!=="darwin"},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-mac-current-"));
 const active="fan.fde.owl.dev-release.4f84e8f0.current";
 const old="fan.fde.owl.dev-release.864ba1e5.current";
 const qa="fan.fde.owl.dev-release.qa.864ba1e5.current";
 const fallback="fan.fde.owl.dev-release.4f84e8f0.fallback";
 const other="fan.fde.owl.dev-release.abc12345.current";
 for(const n of [active,old,qa,fallback,other])fs.writeFileSync(path.join(dir,n+".plist"),n);
 const invocations=[];
 try{
  const action=args=>{
   invocations.push(args);
   if(args[0]==="print"&&args[1].endsWith(other))return {ok:true,stdout:"state = running"};
   return {ok:true,stdout:"state = not running"};
  };
  const result=retireSupersededMacCurrentJobs({agents:dir,activeLabel:active,userId:501,launchctl:action});
  assert.deepEqual(result.retired,[old,qa]);
  assert.deepEqual(result.skipped,[{label:other,reason:"job-still-running"}]);
  for(const n of [active,fallback,other])assert.equal(fs.existsSync(path.join(dir,n+".plist")),true);
  for(const n of [old,qa]){
   assert.equal(fs.existsSync(path.join(dir,n+".plist")),false);
   assert.equal(fs.existsSync(path.join(dir,n+".plist.disabled-after-4f84e8f0")),true);
  }
  assert.equal(invocations.filter(x=>x[0]==="bootout").length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});