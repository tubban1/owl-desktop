import {execFileSync} from "node:child_process";

// On Windows, user environment changes are saved in HKCU and are not copied
// into already-running Connection Host processes. Read only two named,
// owner-controlled values at each staging decision.
const ALLOWED_NAMES=new Set(["OWL_AGENT_UPLOAD_ROOTS","OWL_AGENT_UPLOAD_ORIGINS","OWL_AGENT_FORM_SUBMISSION_GRANT"]);
export function readWindowsUserUploadSetting(name,{platform=process.platform,runner=execFileSync}={}){
  if(platform!=="win32"||!ALLOWED_NAMES.has(name))return undefined;
  try{
    const out=String(runner("reg.exe",["query","HKCU\\Environment","/v",name],{
      encoding:"utf8",windowsHide:true,timeout:2000,maxBuffer:16*1024
    }));
    const prefix=new RegExp("^\\s*"+name+"\\s+REG_(?:SZ|EXPAND_SZ)\\s+","i");
    const line=out.split(/\r?\n/).find(l=>prefix.test(l));
    return line ? line.replace(prefix,"").trim() : undefined;
  }catch{return undefined;}
}
export function currentUploadScope(name,{platform=process.platform,env=process.env,readRegistry=readWindowsUserUploadSetting}={}){
  const stored=readRegistry(name,{platform});
  if(stored!==undefined)return stored;
  return String(env[name]||"");
}
