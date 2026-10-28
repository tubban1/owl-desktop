import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {ownerMatches,processBirth,writeDevOwner,readDevOwner} from "../scripts/lib/dev-full-owner.mjs";

test("one dev-full supervisor across distinct checkouts: a second cannot steal its owner receipt",{skip:process.platform!=="darwin"},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-single-owner-"));
 const original=path.join(dir,"release"),second=path.join(dir,"checkout"),recordFile=path.join(dir,"owner.json");
 const script=path.join(original,"scripts","dev-full.mjs");
 fs.mkdirSync(path.dirname(script),{recursive:true});fs.mkdirSync(second,{recursive:true});
 fs.writeFileSync(script,'process.stdout.write("ready\\n");setInterval(()=>{},1000);\n');
 const child=spawn(process.execPath,[script],{stdio:["ignore","pipe","pipe"]});
 try{
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error("fixture-start-timeout")),6000);
   child.once("error",reject);
   child.stdout.once("data",()=>{clearTimeout(timeout);resolve()});
   child.once("exit",code=>reject(Error("fixture-exit:"+code)));
  });
  const birth=processBirth(child.pid);
  assert.ok(birth);
  const originalRecord={version:1,desktopRoot:original,pid:child.pid,birth};
  fs.writeFileSync(recordFile,JSON.stringify(originalRecord));
  assert.equal(ownerMatches(originalRecord,original),true);
  assert.equal(ownerMatches(originalRecord,second),false);
  assert.throws(()=>writeDevOwner(second,recordFile),/Another owned dev:full supervisor/);
  assert.deepEqual(readDevOwner(recordFile),originalRecord);
  assert.throws(()=>writeDevOwner(original,recordFile),/Another owned dev:full supervisor/);
 }finally{child.kill("SIGTERM");fs.rmSync(dir,{recursive:true,force:true})}
});