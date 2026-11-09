import {describe,it,expect} from "vitest";
import {createOtaAdmissionFence} from "../mcp/ota-admission-fence.mjs";
describe("OTA short-lived request admission fencing",()=>{
 it("blocks new tool entry until explicit release; stale/foreign releases cannot disable it",()=>{
  let clock=100;
  const f=createOtaAdmissionFence({now:()=>clock,maxTtlMs:5000});
  const a=f.arm({ttlMs:2000});
  expect(f.isBlockingTools()).toBe(true);
  expect(()=>f.arm({ttlMs:2000})).toThrow("OTA_FENCE_ALREADY_ARMED");
  expect(f.release("wrong-fence")).toBe(false);
  expect(f.isBlockingTools()).toBe(true);
  expect(f.release(a.nonce)).toBe(true);
  expect(f.isBlockingTools()).toBe(false);
 });
 it("expires automatically even if the updater crashes",()=>{
  let clock=100;
  const f=createOtaAdmissionFence({now:()=>clock,maxTtlMs:5000});
  f.arm({ttlMs:2000});
  clock=2099;expect(f.isBlockingTools()).toBe(true);
  clock=2100;expect(f.isBlockingTools()).toBe(false);
  expect(f.snapshot().armed).toBe(false);
 });
 it("rejects unbounded TTLs and invalid tokens",()=>{
  const f=createOtaAdmissionFence({maxTtlMs:5000});
  expect(()=>f.arm({ttlMs:99999})).toThrow();
  expect(()=>f.arm({ttlMs:-1})).toThrow();
  expect(f.release("unknown")).toBe(false);
 });
});
