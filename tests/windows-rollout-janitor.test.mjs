import fs from "node:fs";
import {describe,it,expect} from "vitest";
const script=fs.readFileSync(new URL("../scripts/windows/cleanup-completed-rollout.ps1",import.meta.url),"utf8");
const updater=fs.readFileSync(new URL("../scripts/auto-version-updater.mjs",import.meta.url),"utf8");
describe("safe Windows one-shot OTA task cleanup",()=>{
 it("verifies full SHA and activated receipt before deleting a completed task",()=>{
  for(const key of ["ROLL_CLEAN_INVALID_SHA","ROLL_CLEAN_NOT_ACTIVATED",
    "ROLL_CLEAN_TASK_ACTION_UNEXPECTED","Export-ScheduledTask",
    "Unregister-ScheduledTask","archived-rollout-tasks-","deferred-future-run",
    "deferred-running","deferred-nonzero-result","deferred-never-executed"]){
   expect(script).toContain(key);
  }
  expect(script.indexOf("Export-ScheduledTask")).toBeLessThan(script.indexOf("Unregister-ScheduledTask"));
 });
 it("keeps janitor work outside the critical release/rollback path",()=>{
  expect(updater).toContain("cleanupCompletedWindowsRollout(live.sha)");
  expect(updater).toContain("async function tick()");
 });
});
