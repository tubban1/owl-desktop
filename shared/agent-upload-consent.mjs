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
export function normalizeUploadOrigin(value){
  if(typeof value!=="string"||value.length>300)throw Error("UPLOAD_ORIGIN_INVALID");
  const text=value.trim();
  let url;
  try{url=new URL(text);}catch{throw Error("UPLOAD_ORIGIN_INVALID");}
  if(url.protocol!=="https:"||!url.hostname||url.username||url.password||
     text!==url.origin||url.hostname.includes("*"))throw Error("UPLOAD_ORIGIN_INVALID");
  return url.origin;
}
function readConsent(file){
  try {
    const s=fs.lstatSync(file);
    if(!s.isFile()||s.isSymbolicLink())return {roots:[],origins:[]};
    if(process.platform!=="win32" && ((s.mode&0o077)!==0 ||
        (typeof process.getuid==="function"&&s.uid!==process.getuid())))return {roots:[],origins:[]};
    const doc=JSON.parse(fs.readFileSync(file,"utf8"));
    if(doc.version!==1||!Array.isArray(doc.roots)||!Array.isArray(doc.origins))return {roots:[],origins:[]};
    const roots=doc.roots.filter(v=>typeof v==="string"&&path.isAbsolute(v)&&v!==path.parse(v).root);
    const origins=doc.origins.filter(v=>{
      try{return normalizeUploadOrigin(v)===v;}catch{return false;}
    });
    return {roots:[...new Set(roots)],origins:[...new Set(origins)]};
  }catch{return {roots:[],origins:[]};}
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
    fs.writeFileSync(tmp,JSON.stringify({version:1,roots:state.roots,origins:state.origins},null,2)+"\n",{mode:0o600,flag:"wx"});
    fs.renameSync(tmp,file);fs.chmodSync(file,0o600);
  }finally{try{fs.unlinkSync(tmp);}catch{}}
}
export function changeUploadConsent({file=defaultUploadConsentFile(),addRoot,removeRoot,addOrigin,removeOrigin}={}){
  const current=readConsent(file);
  if(addRoot){const v=validateRoot(addRoot);current.roots=[...new Set([...current.roots,v])];}
  if(removeRoot){
    // macOS /var and /private/var resolve to the same folder. Revocation must
    // match the canonical root saved at approval time.
    let canonical=path.resolve(removeRoot);
    try{canonical=fs.realpathSync(canonical);}catch{}
    current.roots=current.roots.filter(v=>v!==canonical);
  }
  if(addOrigin){const v=normalizeUploadOrigin(addOrigin);current.origins=[...new Set([...current.origins,v])];}
  if(removeOrigin){current.origins=current.origins.filter(v=>v!==normalizeUploadOrigin(removeOrigin));}
  saveConsent(file,current);
  return readConsent(file);
}
