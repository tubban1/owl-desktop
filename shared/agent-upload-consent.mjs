import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE_NAME="agent-upload-consent.json";
export function defaultUploadConsentFile({platform=process.platform,home=os.homedir(),appData=process.env.APPDATA}={}){
  const base=platform==="darwin" ? path.join(home,"Library","Application Support")
    : platform==="win32" ? (appData||path.join(home,"AppData","Roaming"))
    : path.join(home,".config");
  return path.join(base,"OWL LAB","desktop",FILE_NAME);
}
function readConsent(file){
  try {
    const s=fs.lstatSync(file);
    if(!s.isFile()||s.isSymbolicLink())return {roots:[]};
    if(process.platform!=="win32" && ((s.mode&0o077)!==0 ||
        (typeof process.getuid==="function"&&s.uid!==process.getuid())))return {roots:[]};
    const doc=JSON.parse(fs.readFileSync(file,"utf8"));
    // Preserve already-approved folder grants from the previous consent file;
    // destination restrictions are no longer a part of the upload policy.
    if(![1,2].includes(doc.version)||!Array.isArray(doc.roots))return {roots:[]};
    const roots=doc.roots.filter(v=>typeof v==="string"&&path.isAbsolute(v)&&v!==path.parse(v).root);
    return {roots:[...new Set(roots)]};
  }catch{return {roots:[]};}
}
export function getUploadConsent({file=defaultUploadConsentFile()}={}){return readConsent(file);}
function validateRoot(candidate){
  if(typeof candidate!=="string"||!path.isAbsolute(candidate))throw Error("UPLOAD_ROOT_INVALID");
  const absolute=path.resolve(candidate);
  if(absolute===path.parse(absolute).root||absolute===os.homedir())throw Error("UPLOAD_ROOT_TOO_BROAD");
  const s=fs.lstatSync(absolute);
  if(!s.isDirectory()||s.isSymbolicLink())throw Error("UPLOAD_ROOT_INVALID");
  return fs.realpathSync(absolute);
}
function saveConsent(file,state){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  // The owner should grant access only via a local Desktop dialog. Neither
  // generic settings:update nor an MCP endpoint can write this file.
  const tmp=file+".tmp-"+process.pid+"-"+Math.random().toString(16).slice(2);
  try{
    fs.writeFileSync(tmp,JSON.stringify({version:2,roots:state.roots},null,2)+"\n",{mode:0o600,flag:"wx"});
    fs.renameSync(tmp,file);fs.chmodSync(file,0o600);
  }finally{try{fs.unlinkSync(tmp);}catch{}}
}
export function changeUploadConsent({file=defaultUploadConsentFile(),addRoot,removeRoot}={}){
  const current=readConsent(file);
  if(addRoot){const v=validateRoot(addRoot);current.roots=[...new Set([...current.roots,v])];}
  if(removeRoot){
    // macOS /var and /private/var resolve to the same folder. Revocation must
    // match the canonical root saved at approval time.
    let canonical=path.resolve(removeRoot);
    try{canonical=fs.realpathSync(canonical);}catch{}
    current.roots=current.roots.filter(v=>v!==canonical);
  }
  saveConsent(file,current);
  return readConsent(file);
}
