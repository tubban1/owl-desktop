import fs from "node:fs";
import path from "node:path";

// Windows Desktop saved folders are the user's explicit access grants.
// OS ACLs and the Runtime's per-action policy remain separate authority layers.
export function projectWindowsDevDocumentRoots({settings={},workspaceRoot,
 exists=fs.existsSync,realpath=fs.realpathSync.native}={}){
 if(typeof workspaceRoot!=="string"||!path.win32.isAbsolute(workspaceRoot))
   throw Error("WINDOWS_DEV_WORKSPACE_REQUIRED");
 const blocked=[];
 const allowed=[];
 const seen=new Set();
 const candidates=[workspaceRoot,...(Array.isArray(settings?.allowedDirectories)?settings.allowedDirectories:[])];
 for(const raw of candidates){
  if(typeof raw!=="string"||!path.win32.isAbsolute(raw)||raw.includes("\0")){
   blocked.push({path:String(raw),reason:"INVALID_ROOT"});continue;
  }
  const normalized=path.win32.normalize(raw);
  try{
   if(!exists(normalized)){
    blocked.push({path:normalized,reason:"NOT_FOUND"});continue;
   }
   const canonical=path.win32.normalize(realpath(normalized));
   if(!path.win32.isAbsolute(canonical)){
    blocked.push({path:normalized,reason:"INVALID_CANONICAL_ROOT"});continue;
   }
   const key=canonical.toLowerCase();
   if(!seen.has(key)){allowed.push(canonical);seen.add(key);}
  }catch{
   blocked.push({path:normalized,reason:"UNRESOLVED_ROOT"});
  }
 }
 return {allowedDirectories:allowed,blockedDirectories:blocked};
}
