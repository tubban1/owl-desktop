import fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";

// Meta's local binary/resumable upload requires Facebook Login for Business.
// Instagram Login uses video_url and cannot safely be treated as this transport.
const BASE="https://graph.facebook.com/v26.0/";
const ID=/^[0-9]{4,32}$/;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const bad=code=>{throw Error("INSTAGRAM_PUBLISH_"+code);};
function numberId(value){
 if(!ID.test(String(value??"")))bad("ID_INVALID");
 return String(value);
}
function safeUploadUri(raw,containerId){
 let url;try{url=new URL(raw);}catch{bad("UPLOAD_URI_INVALID");}
 if(url.protocol!=="https:"||url.hostname!=="rupload.facebook.com"||
   url.username||url.password||url.port||url.search||url.hash||
   url.pathname!=="/ig-api-upload/v26.0/"+containerId)
   bad("UPLOAD_URI_DENIED");
 return url.toString();
}
async function request(fetchImpl,url,options,stage){
 let response;
 try{response=await fetchImpl(url,{...options,redirect:"manual",
   signal:AbortSignal.timeout(stage==="UPLOAD"?120000:25000)});}
 catch{bad(stage+"_NETWORK_FAILED");}
 if(response.status<200||response.status>=300){
  let error;
  try{const raw=await response.text();if(raw.length<=8192)error=JSON.parse(raw)?.error;}catch{}
  const code=Number.isInteger(error?.code)&&error.code>=0&&error.code<100000
    ?"_E"+error.code:"";
  const sub=Number.isInteger(error?.error_subcode)&&error.error_subcode>=0&&error.error_subcode<10000000
    ?"_S"+error.error_subcode:"";
  bad(stage+"_HTTP_"+response.status+code+sub);
 }
 if(stage==="UPLOAD")return {};
 let raw;try{raw=await response.text();}catch{bad(stage+"_RESPONSE_INVALID");}
 if(raw.length>32768)bad(stage+"_RESPONSE_TOO_LARGE");
 let result;try{result=JSON.parse(raw);}catch{bad(stage+"_RESPONSE_INVALID");}
 if(!result||typeof result!=="object"||Array.isArray(result))bad(stage+"_RESPONSE_INVALID");
 return result;
}
async function persist(file,state,first=false){
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=file+"."+randomUUID()+".tmp";
 await fs.writeFile(tmp,JSON.stringify(state),{flag:"wx",mode:0o600});
 try{if(first)await fs.link(tmp,file);else await fs.rename(tmp,file);}
 finally{await fs.rm(tmp,{force:true});}
}
export async function publishInstagramReel({accountId,username,accessToken,mediaPath,
 caption,approved,authorizationMode,journalDir,fetchImpl=fetch,pollDelay=pause,maxPolls=16}){
 if(approved!==true)bad("APPROVAL_REQUIRED");
 // Fail closed before a file read, network request or journal mutation.
 if(authorizationMode!=="facebook_login_for_business")
  bad("DIRECT_UPLOAD_REQUIRES_FACEBOOK_LOGIN");
 const id=numberId(accountId);
 if(typeof username!=="string"||!/^[A-Za-z0-9_.]{1,30}$/.test(username))bad("USERNAME_INVALID");
 if(typeof accessToken!=="string"||accessToken.length<12)bad("AUTH_INVALID");
 if(typeof caption!=="string"||caption.length>2200)bad("CAPTION_INVALID");
 if(!path.isAbsolute(journalDir)||!path.isAbsolute(mediaPath)||!mediaPath.toLowerCase().endsWith(".mp4"))
  bad("PATH_INVALID");
 const initial=await fs.lstat(mediaPath).catch(()=>bad("FILE_NOT_FOUND"));
 if(initial.isSymbolicLink())bad("FILE_LINK_DENIED");
 let canonical;try{canonical=await fs.realpath(mediaPath);}catch{bad("FILE_NOT_FOUND");}
 const st=await fs.lstat(canonical);
 if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>150*1024*1024)bad("MEDIA_INVALID");
 const bytes=await fs.readFile(canonical);
 if(bytes.length!==st.size)bad("MEDIA_CHANGED");
 const sha=createHash("sha256").update(bytes).digest("hex");
 const key=createHash("sha256").update(id+":"+sha+":"+caption).digest("hex");
 const file=path.join(journalDir,key+".json");
 try{
  const prior=JSON.parse(await fs.readFile(file,"utf8"));
  if(prior.state==="VERIFIED")return {published:true,replayed:true,
    mediaId:prior.mediaId,permalink:prior.permalink};
  // Earlier S3 staging and rejected CREATE failures had no container or publish request.
  if(prior.state==="NEEDS_ATTENTION"&&!prior.containerId&&
     /^INSTAGRAM_PUBLISH_(?:CREATE_HTTP_400|STAGING_|SOURCE_|VIDEO_URI_DENIED)/.test(prior.reason??""))
    await fs.rename(file,file+".rejected."+Date.now());
  else bad("PREVIOUS_ATTEMPT_NEEDS_REVIEW");
 }catch(e){if(e.code!=="ENOENT")throw e;}
 const state={state:"STARTED",accountId:id,mediaSha256:sha,createdAt:new Date().toISOString()};
 try{await persist(file,state,true);}catch(e){if(e.code==="EEXIST")bad("ALREADY_STARTED");throw e;}
 const move=async(status,fields={})=>{Object.assign(state,fields,{state:status});await persist(file,state);};
 const auth={Authorization:"Bearer "+accessToken};
 try{
  const init=await request(fetchImpl,BASE+id+"/media",{
    method:"POST",headers:{...auth,"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({media_type:"REELS",upload_type:"resumable",caption}).toString()
  },"CREATE");
  const cid=numberId(init.id);
  await move("CONTAINER_CREATED",{containerId:cid});
  const uploadUri=safeUploadUri(init.uri,cid);
  // Binary is sent from the user's machine straight to Meta, never to OWL Cloud/S3.
  await move("UPLOAD_REQUESTED");
  await request(fetchImpl,uploadUri,{
    method:"POST",headers:{Authorization:"OAuth "+accessToken,offset:"0",
      file_size:String(bytes.length),"Content-Type":"application/octet-stream"},body:bytes
  },"UPLOAD");
  await move("UPLOADED");
  let finished=false;
  for(let i=0;i<maxPolls;i++){
   const status=await request(fetchImpl,BASE+cid+"?fields=status_code",{headers:auth},"STATUS");
   if(status.status_code==="FINISHED"){finished=true;break;}
   if(status.status_code==="ERROR"||status.status_code==="EXPIRED")bad("PROCESSING_FAILED");
   if(status.status_code!=="IN_PROGRESS")bad("PROCESSING_UNKNOWN");
   await pollDelay(5000);
  }
  if(!finished)bad("PROCESSING_TIMEOUT");
  // Irreversible step: never auto-retry after a publish attempt.
  await move("PUBLISH_REQUESTED");
  const published=await request(fetchImpl,BASE+id+"/media_publish",{
    method:"POST",headers:{...auth,"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({creation_id:cid}).toString()
  },"PUBLISH");
  const mediaId=numberId(published.id);
  await move("PUBLISHED",{mediaId});
  const result=await request(fetchImpl,BASE+mediaId+"?fields=id,username,permalink,media_type",
    {headers:auth},"VERIFY");
  if(String(result.id)!==mediaId||String(result.username??"").toLowerCase()!==username.toLowerCase()||
    typeof result.permalink!=="string"||
    !/^https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?(?:\?.*)?$/.test(result.permalink))
    bad("VERIFY_FAILED");
  await move("VERIFIED",{permalink:result.permalink});
  return {published:true,replayed:false,mediaId,permalink:result.permalink};
 }catch(e){
  const reason=/^INSTAGRAM_PUBLISH_[A-Z0-9_]+$/.test(e?.message??"")
    ?e.message:"INSTAGRAM_PUBLISH_UNKNOWN_FAILURE";
  await move("NEEDS_ATTENTION",{reason}).catch(()=>{});
  throw Error(reason);
 }
}
