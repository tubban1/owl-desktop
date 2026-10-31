import {describe,it,expect} from "vitest";
import {isRetryablePeerFailure,shouldBackoffFailedRelease} from "../scripts/lib/ota-retry-policy.mjs";
describe("Unattended OTA peer freshness & release backoff",()=>{
 it("retries transient peer drift instead of 6 hour failure backoff",()=>{
  for(const reason of ["ROLL_PEER_OR_LOCAL_CHANGED","ROLL_PEER_NOT_READY_AFTER_BUILD","ROLL_PEER_CHANGED_AFTER_INTENT","ROLL_LOCAL_TEMPORARY_UNHEALTHY_AFTER_BUILD","OTA_COORDINATOR_peer-unhealthy-or-stale","OTA_COORDINATOR_rollout-in-progress"]){
   expect(isRetryablePeerFailure(reason)).toBe(true);
   expect(shouldBackoffFailedRelease({status:"failed",target:"a",error:reason,at:100},"a",200)).toBe(false);
  }
 });
 it("retries transient GitHub DNS outages without losing six-hour backoff for actual bad releases",()=>{
  const failed={status:"failed",target:"abc",at:100,
    error:"ROLL_COMMAND_FAILED:git:128:fatal: unable to access 'https://github.com/tubban1/owl-desktop.git/': Could not resolve host: github.com"};
  expect(isRetryablePeerFailure(failed.error)).toBe(true);
  expect(shouldBackoffFailedRelease(failed,"abc",200)).toBe(false);
  expect(isRetryablePeerFailure("ROLL_COMMAND_FAILED:git:128:fatal: repository not found")).toBe(false);
  expect(isRetryablePeerFailure("ROLL_CUTOVER_TIMEOUT")).toBe(false);
 });
 it("backs off real failures for six hours, never an unrelated target",()=>{
  const failure={status:"failed",target:"abc",error:"ROLL_CUTOVER_ROLLED_BACK",at:100};
  expect(shouldBackoffFailedRelease(failure,"abc",200)).toBe(true);
  expect(shouldBackoffFailedRelease(failure,"other",200)).toBe(false);
  expect(shouldBackoffFailedRelease(failure,"abc",100+6*3600e3)).toBe(false);
  expect(shouldBackoffFailedRelease({status:"deferred",target:"abc",at:100},"abc",200)).toBe(false);
 });
});
