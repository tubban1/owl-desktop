import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {
 normalizeWindowsGuiMode,assertWindowsGuiMode,inspectWindowsGuiHelper,
 windowsGuiRuntimeFlags,windowsGuiConsentCopy,
} from "../electron/services/windows-gui-consent.mjs";

describe("Windows GUI consent and Helper verification",()=>{
 it("rejects invalid/remote-provided modes and defaults to Off",()=>{
  expect(normalizeWindowsGuiMode(undefined)).toBe("off");
  expect(normalizeWindowsGuiMode("foreground")).toBe("foreground");
  for(const invalid of [true,"on","enabled","all","__proto__","",{}])
   expect(()=>assertWindowsGuiMode(invalid)).toThrow("WINDOWS_GUI_MODE_INVALID");
 });
 it("does not enable even read-only GUI with missing or tampered Helper",()=>{
  for(const mode of ["off","inspect","semantic","foreground"]){
   const denied=windowsGuiRuntimeFlags(mode,{verified:false,reason:"WINDOWS_GUI_HELPER_NOT_INSTALLED"});
   expect(denied.effective).toBe("off");
   expect(denied.ALLOW_GUI).toBe("false");
   expect(denied.OWL_WIN_GUI_INPUT).toBe("false");
   expect(denied.OWL_WIN_GUI_FOREGROUND_INPUT).toBe("false");
  }
 });
 it("makes foreground takeover separate from semantic UI Automation",()=>{
  const proof={verified:true,reason:null};
  expect(windowsGuiRuntimeFlags("inspect",proof)).toMatchObject({
   effective:"inspect",ALLOW_GUI:"true",OWL_WIN_GUI_INPUT:"false",OWL_WIN_GUI_FOREGROUND_INPUT:"false",
  });
  expect(windowsGuiRuntimeFlags("semantic",proof)).toMatchObject({
   effective:"semantic",ALLOW_GUI:"true",OWL_WIN_GUI_INPUT:"true",OWL_WIN_GUI_FOREGROUND_INPUT:"false",
  });
  expect(windowsGuiRuntimeFlags("foreground",proof)).toMatchObject({
   effective:"foreground",ALLOW_GUI:"true",OWL_WIN_GUI_INPUT:"true",OWL_WIN_GUI_FOREGROUND_INPUT:"true",
  });
  expect(windowsGuiConsentCopy("foreground").detail).toMatch(/physical mouse movement/);
 });
 it("verifies local helper SHA-256 and fails closed after binary tampering",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-gui-consent-"));
  try{
   const binary=path.join(root,"OWLHelper.exe");
   fs.writeFileSync(binary,Buffer.from("OWL test-only fake helper; not executable"));
   const sha=createHash("sha256").update(fs.readFileSync(binary)).digest("hex");
   fs.writeFileSync(path.join(root,"component.json"),JSON.stringify({
    component:"owl-windows-gui-helper",architecture:"win32-x64",sha256:sha,
   }));
   expect(inspectWindowsGuiHelper(binary)).toMatchObject({verified:true,reason:null});
   fs.appendFileSync(binary," tampered");
   expect(inspectWindowsGuiHelper(binary)).toMatchObject({
    verified:false,reason:"WINDOWS_GUI_HELPER_INTEGRITY_FAILED",
   });
   expect(inspectWindowsGuiHelper(path.join(root,"other.exe")).verified).toBe(false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it("requires local UI confirmation and rejects generic settings bypass",async()=>{
  const main=fs.readFileSync(new URL("../electron/main.mjs",import.meta.url),"utf8");
  const store=fs.readFileSync(new URL("../electron/store.mjs",import.meta.url),"utf8");
  expect(main).toContain('WINDOWS_GUI_PACKAGED_RUNTIME_HOST_NOT_READY');
  expect(main).toContain('if(app.isPackaged&&mode!=="off")');
  expect(main).toContain('ipcMain.handle("windows-gui:set",');
  expect(main).toContain("dialog.showMessageBox");
  expect(main).toContain("store.setWindowsGuiMode(mode)");
  expect(store).toContain("WINDOWS_GUI_REQUIRES_LOCAL_USER_CONSENT");
  expect(store).toContain('windowsGuiMode: "off"');
 });
});
