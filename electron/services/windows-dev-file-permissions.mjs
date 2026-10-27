import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROTECTED = new Set(["windows","program files","program files (x86)","programdata",
  "system volume information","$recycle.bin","appdata",".ssh",".aws",".gnupg",
  ".config","keychains"]);
function isWithin(root,subject){
 const relative=path.win32.relative(root,subject);
 return relative!=="" && relative!==".." && !relative.startsWith("..\\") &&
   !path.win32.isAbsolute(relative);
}
// The DEV Runtime is not an authority to grant a whole disk or whole user profile.
// This scope is read-only unless the separate explicit workspace permission is on.
export function projectWindowsDevDocumentRoots({settings={},workspaceRoot,homeDir=os.homedir(),
 exists=fs.existsSync,realpath=fs.realpathSync.native}={}){
 if(typeof workspaceRoot!=="string"||!workspaceRoot.trim())throw Error("WINDOWS_DEV_WORKSPACE_REQUIRED");
 const normal=p=>path.win32.normalize(p);
 const blocked=[];
 const allowed=[];
 const seen=new Set();
 const workspace=normal(workspaceRoot);
 const candidateRoots=[workspace,...(Array.isArray(settings?.allowedDirectories)?settings.allowedDirectories:[])];
 for(const raw of candidateRoots){
  if(typeof raw!=="string"||!path.win32.isAbsolute(raw)||raw.startsWith("\\\\")||
    raw.includes("\0")){blocked.push({path:String(raw),reason:"INVALID_ROOT"});continue;}
  const normalized=normal(raw);
  const root=path.win32.parse(normalized).root;
  const parts=normalized.slice(root.length).split("\\").filter(Boolean);
  if(!/^[a-zA-Z]:\\$/.test(root)||parts.length===0){
   blocked.push({path:normalized,reason:"WHOLE_DRIVE_NOT_ALLOWED"});continue;
  }
  if(PROTECTED.has(parts[0].toLowerCase())||
    parts.some(p=>PROTECTED.has(p.toLowerCase()))){
   blocked.push({path:normalized,reason:"PROTECTED_FOLDER"});continue;
  }
  const normalizedHome=normal(homeDir);
  if(normalized.toLowerCase()===normalizedHome.toLowerCase()||
    normalized.toLowerCase()===path.win32.dirname(normalizedHome).toLowerCase()){
   blocked.push({path:normalized,reason:"BROAD_USER_PROFILE"});continue;
  }
  try {
   if(!exists(normalized)){blocked.push({path:normalized,reason:"NOT_FOUND"});continue;}
   const canonical=normal(realpath(normalized));
   if(!/^[a-zA-Z]:\\/.test(canonical)||canonical.startsWith("\\\\")||
      canonical.toLowerCase()===path.win32.parse(canonical).root.toLowerCase()||
      canonical.toLowerCase()===normalizedHome.toLowerCase()||
      (canonical.toLowerCase()!==workspace.toLowerCase()&&!parts.length)){
    blocked.push({path:normalized,reason:"UNSAFE_CANONICAL_ROOT"});continue;
   }
   const canonicalParts=canonical.slice(path.win32.parse(canonical).root.length)
       .split("\\").filter(Boolean);
   if(canonicalParts.some(x=>PROTECTED.has(x.toLowerCase()))){
    blocked.push({path:normalized,reason:"PROTECTED_CANONICAL_ROOT"});continue;
   }
   // The workspace root remains explicitly available for existing DEV tooling.
   if(!seen.has(canonical.toLowerCase())){allowed.push(canonical);seen.add(canonical.toLowerCase());}
  }catch{
   blocked.push({path:normalized,reason:"UNRESOLVED_ROOT"});
  }
 }
 return {allowedDirectories:allowed,blockedDirectories:blocked,writeDeleteShellStillRestricted:true};
}
