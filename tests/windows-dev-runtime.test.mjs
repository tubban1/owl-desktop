import {describe,it,expect} from "vitest";
import {startWindowsDevRuntime,stopWindowsDevRuntime} from "../electron/services/windows-dev-runtime.mjs";
describe("Windows developer Runtime bootstrap safety",()=>{
 it("never starts on macOS/Linux, even with the opt-in env set",async()=>{
  if(process.platform==="win32")return;
  const before=process.env.OWL_WIN_DEV_MANAGE_RUNTIME;
  try{
   process.env.OWL_WIN_DEV_MANAGE_RUNTIME="true";
   await expect(startWindowsDevRuntime({store:null,baseUrl:"http://127.0.0.1:8788"}))
     .resolves.toEqual({managed:false});
  }finally{
   if(before===undefined)delete process.env.OWL_WIN_DEV_MANAGE_RUNTIME;
   else process.env.OWL_WIN_DEV_MANAGE_RUNTIME=before;
   stopWindowsDevRuntime();
  }
 });
});

it("Windows DEV UIA opt-in never enables shell, delete or input actions", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../electron/services/windows-dev-runtime.mjs", import.meta.url), "utf8");
  expect(source).toContain('OWL_WIN_DEV_UIA_READ_ONLY');
  expect(source).toContain('ALLOW_GUI:readOnlyUi ? "true" : "false"');
  expect(source).toContain('ALLOW_SHELL:"false"');
  expect(source).toContain('ALLOW_DELETE:"false"');
  const launcher = await fs.readFile(new URL("../scripts/windows/dev-desktop.ps1", import.meta.url), "utf8");
  expect(launcher).toContain('OWL_WIN_DEV_UIA_READ_ONLY="true"');
});
