import {describe,it,expect} from "vitest";
import {readFile} from "node:fs/promises";

describe("Windows owned DEV Runtime permission state",()=>{
 it("persists changes and applies them to the managed running Runtime",async()=>{
  const src=await readFile(new URL("../electron/main.mjs",import.meta.url),"utf8");
  expect(src).toContain("const applied=await applyRuntimeUserPreferences(store.getSettings());");
  expect(src).toContain('process.env.OWL_WIN_DEV_MANAGE_RUNTIME==="true"');
 });
 it("shows actual launched Runtime permission flags rather than a stale saved projection",async()=>{
  const main=await readFile(new URL("../electron/main.mjs",import.meta.url),"utf8");
  const bootstrap=await readFile(new URL("../electron/services/windows-dev-runtime.mjs",import.meta.url),"utf8");
  expect(main).toContain("getWindowsDevAppliedPermissionFlags()");
  expect(main).toContain("liveVerified:true");
  expect(bootstrap).toContain("appliedPermissionFlags=new Map(");
  expect(bootstrap).toContain("getWindowsDevAppliedPermissionFlags");
 });
});
