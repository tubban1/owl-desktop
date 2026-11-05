import {it} from "vitest";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {selectMacReleaseOnNextLogin} from "../scripts/lib/mac-release-startup-selection.mjs";
const prefix="fan.fde.owl.dev-release.93ee5fd3";
const current=prefix+".current",fallback=prefix+".fallback";
function fixture({missingRunAtLoad=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-release-login-"));
 for(const [label,enabled] of [[current,true],[fallback,false]]){
  const content='<plist><dict><key>Label</key><string>'+label+'</string>'+
    (missingRunAtLoad?'':'<key>RunAtLoad</key><'+(enabled?'true':'false')+'/>')+'</dict></plist>\n';
  fs.writeFileSync(path.join(dir,label+".plist"),content);
 }
 return dir;
}
it("pins verified rollback as the next login release, idempotently",()=>{
 const dir=fixture();
 try{
  const result=selectMacReleaseOnNextLogin({agents:dir,currentLabel:current,fallbackLabel:fallback,selected:"fallback"});
  assert.equal(result.changed.length,2);
  assert.match(fs.readFileSync(path.join(dir,fallback+".plist"),"utf8"),/<key>RunAtLoad<\/key><true\/>/);
  assert.match(fs.readFileSync(path.join(dir,current+".plist"),"utf8"),/<key>RunAtLoad<\/key><false\/>/);
  assert.deepEqual(selectMacReleaseOnNextLogin({agents:dir,currentLabel:current,fallbackLabel:fallback,selected:"fallback"}).changed,[]);
  assert.equal(selectMacReleaseOnNextLogin({agents:dir,currentLabel:current,fallbackLabel:fallback,selected:"current"}).changed.length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
it("refuses unrelated jobs and does not partially rewrite on malformed plist",()=>{
 const dir=fixture({missingRunAtLoad:true});
 try{
  const before=fs.readFileSync(path.join(dir,current+".plist"),"utf8");
  assert.throws(()=>selectMacReleaseOnNextLogin({agents:dir,currentLabel:current,fallbackLabel:fallback,selected:"fallback"}),/RUN_AT_LOAD_AMBIGUOUS/);
  assert.equal(fs.readFileSync(path.join(dir,current+".plist"),"utf8"),before);
  assert.throws(()=>selectMacReleaseOnNextLogin({agents:dir,currentLabel:"com.other.service",fallbackLabel:fallback,selected:"fallback"}),/LABEL_MISMATCH/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
