import {describe,it,expect} from "vitest";
import {isRetryablePeerFailure,shouldBackoffFailedRelease} from "../scripts/lib/ota-retry-policy.mjs";
describe("Unattended OTA peer freshness & release backoff",()=>{
 it("retries transient peer drift instead of 6 hour failure backoff",()=>{
  for(const reason of ["ROLL_PEER_OR_LOCAL_CHANGED","ROLL_PEER_NOT_READY_AFTER_BUILD","ROLL_PEER_CHANGED_AFTER_INTENT","ROLL_LOCAL_TEMPORARY_UNHEALTHY_AFTER_BUILD","OTA_COORDINATOR_peer-unhealthy-or-stale","OTA_COORDINATOR_rollout-in-progress"]){
   expect(isRetryablePeerFailure(reason)).toBe(true);
   expect(shouldBackoffFailedRelease({status:"failed",target:"a",error:reason,at:100},"a",200)).toBe(false);
  }
 });
 it("backs off real failures for six hours, never an unrelated target",()=>{
  const failure={status:"failed",target:"abc",error:"ROLL_CUTOVER_ROLLED_BACK",at:100};
  expect(shouldBackoffFailedRelease(failure,"abc",200)).toBe(true);
  expect(shouldBackoffFailedRelease(failure,"other",200)).toBe(false);
  expect(shouldBackoffFailedRelease(failure,"abc",100+6*3600e3)).toBe(false);
  expect(shouldBackoffFailedRelease({status:"deferred",target:"abc",at:100},"abc",200)).toBe(false);
 });
});
