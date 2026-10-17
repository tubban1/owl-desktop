import {describe,it,expect,vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {publishInstagramReel} from "../electron/services/instagram-publisher.mjs";
const id="17812345678901234",cid="18012345678901234",mediaId="17912345678901234";
const token="fixture_token_never_live_123456789";
const uploadUrl="https://rupload.facebook.com/ig-api-upload/v26.0/"+cid;
const reply=(json,status=200)=>({status,text:async()=>JSON.stringify(json)});
async function setup(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"owl-ig-direct-"));
 const mediaPath=path.join(root,"reel.mp4");
 const bytes=Buffer.from("mock-mp4-content-for-local-binary-upload");
 await fs.writeFile(mediaPath,bytes);
 const opts={accountId:id,username:"bloomroom.lab",accessToken:token,mediaPath,
   caption:"A flower for Manta AI",approved:true,
   authorizationMode:"facebook_login_for_business",
   journalDir:path.join(root,"journal"),pollDelay:async()=>{}};
 return {root,bytes,opts};
}
describe("Instagram local MP4 direct transport",()=>{
 it("uploads MP4 bytes to Meta only, verifies permalink and blocks repeat posts",async()=>{
  const {root,bytes,opts}=await setup();
  try{
   const calls=[];
   let polls=0;
   const fetchImpl=vi.fn(async(raw,o)=>{
    const url=String(raw);calls.push(url);
    if(url===`https://graph.facebook.com/v26.0/${id}/media`){
     const p=new URLSearchParams(o.body);
     expect(p.get("media_type")).toBe("REELS");
     expect(p.get("upload_type")).toBe("resumable");
     expect(p.has("video_url")).toBe(false);
     expect(o.headers.Authorization).toBe("Bearer "+token);
     return reply({id:cid,uri:uploadUrl});
    }
    if(url===uploadUrl){
     expect(o.method).toBe("POST");
     expect(o.body).toEqual(bytes);
     expect(o.headers).toMatchObject({Authorization:"OAuth "+token,offset:"0",
       file_size:String(bytes.length)});
     return reply({success:true,message:"Upload successful."});
    }
    if(url.includes("status_code"))return reply({status_code:++polls===1?"IN_PROGRESS":"FINISHED"});
    if(url.endsWith("/media_publish"))return reply({id:mediaId});
    if(url.includes("permalink"))return reply({id:mediaId,username:"bloomroom.lab",
      permalink:"https://www.instagram.com/reel/D123456789/"});
    throw Error("unexpected URL");
   });
   const result=await publishInstagramReel({...opts,fetchImpl});
   expect(result).toMatchObject({published:true,replayed:false,mediaId});
   expect(calls).toContain(uploadUrl);
   expect(calls.every(x=>x.startsWith("https://graph.facebook.com/")||x===uploadUrl)).toBe(true);
   const count=calls.length;
   const replay=await publishInstagramReel({...opts,fetchImpl});
   expect(replay.replayed).toBe(true);
   expect(calls).toHaveLength(count);
   const journal=await fs.readFile(path.join(opts.journalDir,
     (await fs.readdir(opts.journalDir))[0]),"utf8");
   expect(journal).not.toContain(token);
   expect(journal).not.toContain("rupload.facebook.com");
  }finally{await fs.rm(root,{recursive:true,force:true});}
 });
 it("rejects Instagram Login authorization before file IO or network",async()=>{
  const {root,opts}=await setup();
  try{
   const fetchImpl=vi.fn();
   await expect(publishInstagramReel({...opts,authorizationMode:"instagram_login",
     mediaPath:"/does/not/exist.mp4",fetchImpl}))
     .rejects.toThrow("INSTAGRAM_PUBLISH_DIRECT_UPLOAD_REQUIRES_FACEBOOK_LOGIN");
   expect(fetchImpl).not.toHaveBeenCalled();
   await expect(fs.stat(opts.journalDir)).rejects.toMatchObject({code:"ENOENT"});
  }finally{await fs.rm(root,{recursive:true,force:true});}
 });
 it("requires approval before any transfer",async()=>{
  const {root,opts}=await setup();
  try{
   const fetchImpl=vi.fn();
   await expect(publishInstagramReel({...opts,approved:false,fetchImpl}))
     .rejects.toThrow("INSTAGRAM_PUBLISH_APPROVAL_REQUIRED");
   expect(fetchImpl).not.toHaveBeenCalled();
  }finally{await fs.rm(root,{recursive:true,force:true});}
 });
 it("rejects an untrusted upload URL and preserves created container for review",async()=>{
  const {root,opts}=await setup();
  try{
   const fetchImpl=vi.fn(async()=>reply({id:cid,
     uri:"https://malicious.example/ig-api-upload/v26.0/"+cid}));
   await expect(publishInstagramReel({...opts,fetchImpl}))
     .rejects.toThrow("INSTAGRAM_PUBLISH_UPLOAD_URI_DENIED");
   const journalFile=(await fs.readdir(opts.journalDir))[0];
   const journal=JSON.parse(await fs.readFile(path.join(opts.journalDir,journalFile),"utf8"));
   expect(journal.containerId).toBe(cid);
   expect(journal.state).toBe("NEEDS_ATTENTION");
   await expect(publishInstagramReel({...opts,fetchImpl}))
     .rejects.toThrow("INSTAGRAM_PUBLISH_PREVIOUS_ATTEMPT_NEEDS_REVIEW");
   expect(fetchImpl).toHaveBeenCalledTimes(1);
  }finally{await fs.rm(root,{recursive:true,force:true});}
 });
 it("does not retry after an ambiguous Meta binary upload failure",async()=>{
  const {root,opts}=await setup();
  try{
   const fetchImpl=vi.fn(async(url)=>{
    if(String(url).endsWith("/media"))return reply({id:cid,uri:uploadUrl});
    throw Error("network break");
   });
   await expect(publishInstagramReel({...opts,fetchImpl}))
     .rejects.toThrow("INSTAGRAM_PUBLISH_UPLOAD_NETWORK_FAILED");
   const count=fetchImpl.mock.calls.length;
   await expect(publishInstagramReel({...opts,fetchImpl}))
     .rejects.toThrow("INSTAGRAM_PUBLISH_PREVIOUS_ATTEMPT_NEEDS_REVIEW");
   expect(fetchImpl).toHaveBeenCalledTimes(count);
  }finally{await fs.rm(root,{recursive:true,force:true});}
 });
});
