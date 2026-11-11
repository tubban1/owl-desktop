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

it("Windows GUI consent, not a launcher env flag, controls native input", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../electron/services/windows-dev-runtime.mjs", import.meta.url), "utf8");
  expect(source).toContain("windowsGuiRuntimeFlags(");
  expect(source).toContain("inspectWindowsGuiHelper(");
  expect(source).toContain("OWL_WIN_GUI_HELPER_PATH:helperFile");
  expect(source).toContain("ALLOW_GUI:gui.ALLOW_GUI");
  expect(source).toContain("OWL_WIN_GUI_INPUT:gui.OWL_WIN_GUI_INPUT");
  expect(source).toContain("OWL_WIN_GUI_FOREGROUND_INPUT:gui.OWL_WIN_GUI_FOREGROUND_INPUT");
  expect(source).toContain('ALLOW_SHELL:"false"');
  expect(source).toContain('ALLOW_DELETE:"false"');
  const launcher = await fs.readFile(new URL("../scripts/windows/dev-desktop.ps1", import.meta.url), "utf8");
  expect(launcher).not.toContain("OWL_WIN_DEV_UIA_READ_ONLY=");
  expect(launcher).toContain("WINDOWS_DEV_PINNED_RUNTIME_SHA_MISMATCH");
  expect(launcher).toContain("OWL_RUNTIME_SOURCE_ROOT=$runtime");
  expect(launcher).not.toContain('$runtime=(Join-Path $workspace "owl-runtime-pin")');
});
