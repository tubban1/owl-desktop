import {describe,it,expect,vi} from "vitest";
import {createRuntimeLeaseMaintenance} from "../electron/services/runtime-lease-maintenance.mjs";
const now=()=>Date.parse("2026-10-11T00:00:00Z");
const cloud=()=>({status:"ready",access:{canRun:true},entitlement:{canRun:true,features:{runtime:true}}});
const ready=(milliseconds)=>({state:"READY",mode:"cloud_enforced",grant:{expiresAt:new Date(now()+milliseconds).toISOString()}});
function make({state=cloud,inspect=async()=>ready(60*60000),recover=async()=>ready(12*3600000),events=[],clock=now}={}){
 return createRuntimeLeaseMaintenance({
  getCloudState:state,inspectRuntimeAccess:inspect,recover,
  onEvent:(level,msg,meta)=>events.push({level,msg,meta}),now:clock,
  setIntervalImpl:(f,ms)=>({f,ms,unref:()=>{}}),
  clearIntervalImpl:()=>{},
 });
}
describe("proactive signed Runtime lease maintenance",()=>{
 it("does not refresh a healthy 12-hour lease",async()=>{
  const recover=vi.fn(async()=>ready(12*3600000));
  const gate=make({recover});
  expect(await gate.check()).toMatchObject({state:"READY"});
  expect(recover).not.toHaveBeenCalled();
 });
 it("renews before expiry and saves no signed token",async()=>{
  const events=[],recover=vi.fn(async()=>ready(12*3600000));
  const gate=make({inspect:async()=>ready(10*60000),recover,events});
  const outcome=await gate.check("periodic");
  expect(outcome.state).toBe("READY");
  expect(recover).toHaveBeenCalledTimes(1);
  expect(gate.snapshot().last).toMatchObject({status:"renewed",reason:"periodic"});
  expect(JSON.stringify(events)).not.toContain("leaseToken");
 });
 it("renews when Runtime reports LEASE_EXPIRED rather than waiting for UI refresh",async()=>{
  const recover=vi.fn(async()=>ready(12*3600000));
  const gate=make({inspect:async()=>({state:"LOCKED",reasonCode:"LEASE_EXPIRED"}),recover});
  await gate.check("power_resume");
  expect(recover).toHaveBeenCalledTimes(1);
 });
 it("deduplicates overlapping UI/wake/timer attempts",async()=>{
  let resolve,inspectCalls=0;
  const recover=vi.fn(()=>new Promise(r=>{resolve=r;}));
  const gate=make({inspect:async()=>{inspectCalls++;return ready(1000)},recover});
  const a=gate.check("periodic"),b=gate.check("power_resume");
  expect(a).toBe(b);
  await Promise.resolve();await Promise.resolve();
  resolve(ready(12*3600000));
  await Promise.all([a,b]);
  expect(recover).toHaveBeenCalledTimes(1);
  expect(inspectCalls).toBe(1);
 });
 it("never renews on revoked, disabled entitlement, or signed-out account",async()=>{
  const recover=vi.fn(async()=>ready(12*3600000));
  await make({inspect:async()=>({state:"REVOKED"}),recover}).check();
  await make({state:()=>({...cloud(),status:"signed_out"}),recover}).check();
  await make({state:()=>({...cloud(),entitlement:{canRun:false,features:{runtime:false}}}),recover}).check();
  expect(recover).not.toHaveBeenCalled();
 });
 it("does not authorize anything when Cloud is unreachable; later periodic checks can retry",async()=>{
  const events=[],recover=vi.fn().mockRejectedValueOnce(new Error("cloud offline")).mockResolvedValueOnce(ready(12*3600000));
  const gate=make({inspect:async()=>ready(1000),recover,events});
  await expect(gate.check()).rejects.toThrow("cloud offline");
  expect(await gate.check()).toMatchObject({state:"READY"});
  expect(gate.snapshot().last.status).toBe("renewed");
 });
 it("timer and shutdown do not create duplicate schedules",async()=>{
  const gate=make(),snapshot=gate.snapshot();
  expect(snapshot.running).toBe(false);
  gate.start();gate.start();
  expect(gate.snapshot().running).toBe(true);
  gate.stop();expect(gate.snapshot().running).toBe(false);
  expect(await gate.check()).toBeNull();
 });
});
