import {describe,it,expect} from "vitest";
import {projectWindowsDevDocumentRoots} from "../electron/services/windows-dev-file-permissions.mjs";
import {windowsDevWorkspacePermissions} from "../electron/services/windows-dev-runtime.mjs";
const home="C:\\Users\\i95i";
const workspace=home+"\\mcp-workspace";
const settings={allowedDirectories:[
  home+"\\Desktop",home+"\\Documents",home+"\\Downloads","C:\\",
]};
const opts={homeDir:home,workspaceRoot:workspace,exists:()=>true,realpath:p=>p};
describe("Windows DEV settings authority projection",()=>{
 it("applies saved narrow folders plus the explicit DEV workspace",()=>{
  const result=projectWindowsDevDocumentRoots({settings,...opts});
  expect(result.allowedDirectories).toEqual([
   workspace,home+"\\Desktop",home+"\\Documents",home+"\\Downloads"]);
  expect(result.blockedDirectories).toContainEqual({path:"C:\\",reason:"WHOLE_DRIVE_NOT_ALLOWED"});
  expect(result.writeDeleteShellStillRestricted).toBe(true);
 });
 it("refuses drive roots, profile roots, protected folders, UNC and traversal",()=>{
  const unsafe=["C:\\","C:\\Users","C:\\Users\\i95i",
     "C:\\Windows","C:\\Program Files","C:\\Users\\i95i\\AppData",
     "C:\\Users\\i95i\\Downloads\\..\\..\\Windows",
     "\\\\server\\share\\path"];
  const r=projectWindowsDevDocumentRoots({settings:{allowedDirectories:unsafe},...opts});
  expect(r.allowedDirectories).toEqual([workspace]);
  expect(r.blockedDirectories).toHaveLength(unsafe.length);
 });
 it("deduplicates case-insensitively and blocks protected realpath targets",()=>{
  const r=projectWindowsDevDocumentRoots({settings:{allowedDirectories:[home+"\\Desktop",
      home.toLowerCase()+"\\desktop",home+"\\LinkToWindows"]},...opts,
    realpath:p=>p.endsWith("LinkToWindows")?"C:\\Windows\\System32":p});
  expect(r.allowedDirectories).toEqual([workspace,home+"\\Desktop"]);
  expect(r.blockedDirectories.some(x=>x.reason==="PROTECTED_CANONICAL_ROOT")).toBe(true);
 });
 it("never silently upgrades requested delete/shell/write in developer mode",()=>{
  const e=windowsDevWorkspacePermissions({});
  expect(e.ALLOW_SHELL).toBe("false");
  expect(e.ALLOW_DELETE).toBe("false");
  expect(e.ALLOW_WRITE).toBe("false");
 });
});
