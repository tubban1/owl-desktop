import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,it,expect} from "vitest";
import {tryAcquireLocalRolloutLock} from "../scripts/lib/ota-local-rollout-lock.mjs";

const created=[];
afterEach(()=>{for(const root of created.splice(0))fs.rmSync(root,{recursive:true,force:true})});

describe("Single-writer OTA local rollout admission",()=>{
 it("defer concurrent manual/launchd ticks without clobbering owner lock",()=>{
   const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-ota-lock-"));created.push(root);
   const first=tryAcquireLocalRolloutLock(root,{pid:345,now:()=>123});
   expect(first).toBeTypeOf("function");
   const lockfile=path.join(root,"rollout.lock");
   expect(JSON.parse(fs.readFileSync(lockfile,"utf8"))).toEqual({pid:345,at:123});
   const competing=tryAcquireLocalRolloutLock(root,{pid:567});
   expect(competing).toBe(null);
   expect(JSON.parse(fs.readFileSync(lockfile,"utf8")).pid).toBe(345);
   first();
   first(); // idempotent cleanup, no exception
   expect(fs.existsSync(lockfile)).toBe(false);
   const next=tryAcquireLocalRolloutLock(root,{pid:567});
   expect(next).toBeTypeOf("function");
   next();
 });
 it("fail-closed on stale lock, never remove another process' lock",()=>{
   const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-ota-lock-"));created.push(root);
   const lockfile=path.join(root,"rollout.lock");
   fs.writeFileSync(lockfile,JSON.stringify({pid:99999,at:1}));
   expect(tryAcquireLocalRolloutLock(root)).toBe(null);
   expect(fs.existsSync(lockfile)).toBe(true);
 });
});
