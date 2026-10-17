import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";

// Whitelist-only incident data: never store network addresses, command text,
// credentials, request bodies, or provider error messages.
const KIND=new Set(["degraded","evidence","recovered"]);
const LAYER=new Set(["device_network","dns","internet_path","tunnel_local","control_plane","unknown","healthy"]);
const LINK=new Set(["present","missing","unknown"]);
const DNS=new Set(["ok","failed","skipped"]);
const INTERNET=new Set(["reachable","unreachable","skipped"]);
const TUNNEL=new Set(["ready","degraded","recovering","unreachable","stale","stopped","starting","unknown"]);
const STATUS=new Set(["checked","unknown"]);
const IMPACT=new Set(["minor","major","critical"]);
const one=(s,set,def="unknown")=>set.has(s)?s:def;
function safe(row){
 const parsed=Date.parse(row?.at??"");
 return {
  id:typeof row?.id==="string"&&/^[a-f0-9-]{36}$/.test(row.id)?row.id:randomUUID(),
  at:Number.isFinite(parsed)?new Date(parsed).toISOString():new Date().toISOString(),
  kind:one(row?.kind,KIND,"evidence"),
  layer:one(row?.layer,LAYER),
  link:one(row?.link,LINK),
  dns:one(row?.dns,DNS,"skipped"),
  internet:one(row?.internet,INTERNET,"skipped"),
  tunnel:one(row?.tunnel,TUNNEL),
  officialStatus:one(row?.officialStatus,STATUS),
  officialOverlap:row?.officialOverlap===true,
  officialImpact:one(row?.officialImpact,IMPACT),
  durationMs:Number.isFinite(row?.durationMs)?
    Math.max(0,Math.min(Math.round(row.durationMs),30*86400000)):null
 };
}
export function createConnectivityIncidentJournal({file,maxEvents=200}){
 if(!file||!Number.isInteger(maxEvents)||maxEvents<1||maxEvents>1000)
  throw new Error("INVALID_CONNECTIVITY_JOURNAL_CONFIG");
 const load=()=>{
  try{
   const stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)return [];
   const bytes=fs.readFileSync(file);
   if(bytes.length>256_000)return [];
   const rows=JSON.parse(bytes.toString("utf8"));
   return Array.isArray(rows)?rows.slice(-maxEvents).map(safe):[];
  }catch{return [];}
 };
 return {
  list:(limit=maxEvents)=>load().slice(-Math.min(Math.max(Number(limit)||20,1),maxEvents)).reverse(),
  record:(row)=>{
   try{
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    if(fs.existsSync(file)){
      const s=fs.lstatSync(file);
      if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0)return null;
    }
    const item=safe(row);
    const rows=[...load(),item].slice(-maxEvents);
    const temp=file+"."+process.pid+"."+randomUUID()+".tmp";
    try{
      fs.writeFileSync(temp,JSON.stringify(rows)+"\n",{mode:0o600,flag:"wx"});
      fs.renameSync(temp,file);
      return item;
    }finally{try{fs.unlinkSync(temp);}catch{}}
   }catch{return null;} // Diagnostics may not interrupt active Runtime.
  }
 };
}
