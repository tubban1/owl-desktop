import {describe,it,expect} from "vitest";
import {projectWindowsDevDocumentRoots} from "../electron/services/windows-dev-file-permissions.mjs";
import {windowsDevWorkspacePermissions} from "../electron/services/windows-dev-runtime.mjs";
import {applyRuntimePermissionModes} from "../electron/services/runtime-permissions.mjs";
const home="C:\\Users\\i95i";
const workspace=home+"\\mcp-workspace";
const settings={allowedDirectories:[home+"\\Desktop",home+"\\Documents",home+"\\Downloads","C:\\"]};
const opts={workspaceRoot:workspace,exists:()=>true,realpath:p=>p};

describe("Windows Desktop explicit user authorization",()=>{
 it("honors user-selected C drive root and normal document folders",()=>{
  const r=projectWindowsDevDocumentRoots({settings,...opts});
  expect(r.allowedDirectories).toEqual([
   workspace,home+"\\Desktop",home+"\\Documents",home+"\\Downloads","C:\\"]);
  expect(r.blockedDirectories).toEqual([]);
 });
 it("does not invent a protected-folder ban beyond Windows ACLs",()=>{
  const locations=["C:\\","C:\\Users",home,"C:\\Windows",
   "C:\\Program Files",home+"\\AppData"];
  const r=projectWindowsDevDocumentRoots({settings:{allowedDirectories:locations},...opts});
  expect(r.allowedDirectories).toEqual([workspace,...locations]);
  expect(r.blockedDirectories).toEqual([]);
 });
 it("still rejects malformed relative paths and missing directories",()=>{
  const locations=["not-absolute",".\\folder",home+"\\missing"];
  const r=projectWindowsDevDocumentRoots({settings:{allowedDirectories:locations},...opts,
    exists:p=>!p.endsWith("missing")});
  expect(r.allowedDirectories).toEqual([workspace]);
  expect(r.blockedDirectories.map(x=>x.reason)).toEqual(["INVALID_ROOT","INVALID_ROOT","NOT_FOUND"]);
 });
 it("uses canonical paths and deduplicates case insensitive",()=>{
  const r=projectWindowsDevDocumentRoots({settings:{allowedDirectories:[
   home+"\\Desktop",home.toLowerCase()+"\\desktop",home+"\\LinkToFiles"
  ]},...opts,realpath:p=>p.endsWith("LinkToFiles")?"D:\\Archive":p});
  expect(r.allowedDirectories).toEqual([workspace,home+"\\Desktop","D:\\Archive"]);
 });
 it("maps explicit enabled settings to actual Runtime capability flags",()=>{
  const flags=new Map(Object.entries(windowsDevWorkspacePermissions({})));
  const modes={write:"enabled",delete:"enabled",shell:"enabled",
    gitPush:"enabled",rollback:"enabled"};
  applyRuntimePermissionModes(flags,{runtimePermissionModes:modes});
  for(const key of ["ALLOW_WRITE","ALLOW_DELETE","ALLOW_SHELL","ALLOW_GIT_PUSH","ALLOW_ROLLBACK"]){
   expect(flags.get(key)).toBe("true");
  }
 });
 it("uses the Windows-native shell executable",async()=>{
  const fs=await import("node:fs/promises");
  const source=await fs.readFile(new URL("../electron/services/windows-dev-runtime.mjs",import.meta.url),"utf8");
  expect(source).toContain('SHELL: "powershell.exe"');
 });
 it("preserves off switches, no silent enabling",()=>{
  const flags=new Map(Object.entries(windowsDevWorkspacePermissions({})));
  const modes={write:"blocked",delete:"blocked",shell:"blocked",
   gitPush:"blocked",rollback:"blocked"};
  applyRuntimePermissionModes(flags,{runtimePermissionModes:modes});
  for(const key of ["ALLOW_WRITE","ALLOW_DELETE","ALLOW_SHELL","ALLOW_GIT_PUSH","ALLOW_ROLLBACK"]){
   expect(flags.get(key)).toBe("false");
  }
 });
});
