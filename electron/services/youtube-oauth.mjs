/** YouTube OAuth 2.0 desktop PKCE via local loopback; no publishing side effects. */
import http from "node:http";
import {randomBytes,createHash,timingSafeEqual} from "node:crypto";

const SCOPES=["https://www.googleapis.com/auth/youtube.readonly",
 "https://www.googleapis.com/auth/youtube.upload","openid","email"];
const error=(name)=>{throw Error(name);};
export const youtubePkce=()=>{
 const verifier=randomBytes(48).toString("base64url");
 return {verifier,challenge:createHash("sha256").update(verifier).digest("base64url"),
  state:randomBytes(32).toString("base64url")};
};
export function youtubeAuthorizationUrl({clientId,redirectUri,challenge,state}){
 if(!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
  !/^http:\/\/127\.0\.0\.1:\d{2,5}\/oauth\/youtube\/callback$/.test(redirectUri))
  error("YOUTUBE_OAUTH_CONFIG_INVALID");
 const uri=new URL("https://accounts.google.com/o/oauth2/v2/auth");
 for(const [k,v] of Object.entries({client_id:clientId,redirect_uri:redirectUri,
  response_type:"code",scope:SCOPES.join(" "),code_challenge:challenge,
  code_challenge_method:"S256",state,access_type:"offline",prompt:"consent"}))
  uri.searchParams.set(k,v);
 return uri.toString();
}
export function checkYoutubeCallback({path,state}){
 const uri=new URL(path,"http://127.0.0.1");
 const expectedHash=createHash("sha256").update(state).digest();
 const supplied=uri.searchParams.get("state")??"";
 if(uri.pathname!=="/oauth/youtube/callback" ||
  !timingSafeEqual(expectedHash,createHash("sha256").update(supplied).digest()))
  error("YOUTUBE_OAUTH_STATE_MISMATCH");
 if(uri.searchParams.has("error"))error("YOUTUBE_OAUTH_DECLINED");
 const code=uri.searchParams.get("code");
 if(!code||code.length>4096)error("YOUTUBE_OAUTH_CODE_MISSING");
 return code;
}
/** Diagnostic codes are stage-specific; never persist Google response bodies. */
async function googleFetch(fetchImpl,url,options,stage){
 const uri=new URL(url);
 if(uri.protocol!=="https:"||uri.username||uri.password||uri.port||
  !["oauth2.googleapis.com","www.googleapis.com","openidconnect.googleapis.com"].includes(uri.hostname))
  error("YOUTUBE_OAUTH_ENDPOINT_BLOCKED");
 const res=await fetchImpl(uri.toString(),{...options,redirect:"manual",signal:AbortSignal.timeout(15000)});
 if(res.status<200||res.status>=300){
  if(stage==="TOKEN"&&res.status===400){
   try{
    const body=await res.text();
    if(body.length<=8192){
     const obj=JSON.parse(body);
     if(typeof obj?.error_description==="string" &&
        /(?:client_secret\s+(?:is\s+)?missing|missing\s+client_secret)/i.test(obj.error_description))
      error("YOUTUBE_OAUTH_TOKEN_CLIENT_SECRET_REQUIRED");
     if(obj?.error==="invalid_grant")error("YOUTUBE_OAUTH_TOKEN_INVALID_GRANT");
    }
   }catch(e){
    if(e instanceof Error&&e.message.startsWith("YOUTUBE_OAUTH_"))throw e;
   }
  }
  error("YOUTUBE_OAUTH_"+stage+"_HTTP_"+res.status);
 }
 const raw=await res.text();
 if(raw.length>65536)error("YOUTUBE_OAUTH_"+stage+"_RESPONSE_TOO_LARGE");
 let obj;try{obj=JSON.parse(raw);}catch{error("YOUTUBE_OAUTH_"+stage+"_INVALID_JSON");}
 if(!obj||typeof obj!=="object"||Array.isArray(obj))
  error("YOUTUBE_OAUTH_"+stage+"_INVALID_JSON");
 return obj;
}
export async function finishYoutubeOauth({fetchImpl=fetch,clientId,code,redirectUri,verifier,expectedEmail,clientSecret}){
 const params=new URLSearchParams({client_id:clientId,code,redirect_uri:redirectUri,
  code_verifier:verifier,grant_type:"authorization_code"});
 if(clientSecret)params.set("client_secret",clientSecret);
 const token=await googleFetch(fetchImpl,"https://oauth2.googleapis.com/token",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:params.toString()},"TOKEN");
 if(typeof token.access_token!=="string"||typeof token.refresh_token!=="string"||
  !token.refresh_token||String(token.token_type).toLowerCase()!=="bearer")
  error("YOUTUBE_OAUTH_REFRESH_TOKEN_REQUIRED");
 const scopes=String(token.scope??"").split(/\s+/).filter(Boolean);
 if(!SCOPES.slice(0,2).every(x=>scopes.includes(x)))error("YOUTUBE_OAUTH_SCOPES_MISSING");
 const headers={Authorization:"Bearer "+token.access_token};
 const profile=await googleFetch(fetchImpl,"https://openidconnect.googleapis.com/v1/userinfo",{headers},"USERINFO");
 if(profile.email_verified!==true||typeof profile.email!=="string")
  error("YOUTUBE_OAUTH_EMAIL_UNVERIFIED");
 if(expectedEmail?.includes("@")&&profile.email.toLowerCase()!==expectedEmail.trim().toLowerCase())
  error("YOUTUBE_OAUTH_WRONG_GOOGLE_ACCOUNT");
 const channels=await googleFetch(fetchImpl,
  "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",{headers},"CHANNEL");
 if(!Array.isArray(channels.items)||channels.items.length!==1)
  error("YOUTUBE_OAUTH_CHANNEL_SELECTION_REQUIRED");
 const channel=channels.items[0];
 if(typeof channel?.id!=="string"||!/^UC[A-Za-z0-9_-]{22}$/.test(channel.id)||
  typeof channel?.snippet?.title!=="string")
  error("YOUTUBE_OAUTH_CHANNEL_INVALID");
 return {channelId:channel.id,channelTitle:channel.snippet.title,
  verifiedEmail:profile.email,grant:{
   accessToken:token.access_token,refreshToken:token.refresh_token,
   scopes,expiresAt:new Date(Date.now()+Math.max(1,Math.min(3600,Number(token.expires_in)||3600))*1000).toISOString()}};
}
export async function connectYoutubeBrowser({clientId,clientSecret,expectedEmail,openExternal,fetchImpl=fetch,timeoutMs=180_000}){
 if(!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId??""))
  error("YOUTUBE_OAUTH_CLIENT_ID_REQUIRED");
 const key=youtubePkce();
 let complete;
 const result=new Promise(resolve=>{complete=resolve;});
 let used=false;
 const server=http.createServer((req,res)=>{
  const uri=new URL(req.url??"/","http://127.0.0.1");
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","text/plain; charset=utf-8");
  if(req.method!=="GET"||uri.pathname!=="/oauth/youtube/callback"){
   res.writeHead(404).end("Not found");return;
  }
  if(used){res.writeHead(409).end("Already handled");return;}
  try{
   const code=checkYoutubeCallback({path:req.url,state:key.state});
   used=true;res.writeHead(200).end("Google callback received. OWL Desktop is verifying YouTube permissions and your channel. Return to OWL Desktop for the final result.");
   complete(code);
  }catch{
   res.writeHead(400).end("Invalid authorization callback.");
  }
 });
 let timer;
 try{
  const port=await new Promise((resolve,reject)=>{
   server.once("error",reject);
   server.listen(0,"127.0.0.1",()=>resolve(server.address().port));
  });
  const redirectUri="http://127.0.0.1:"+port+"/oauth/youtube/callback";
  const url=youtubeAuthorizationUrl({clientId,redirectUri,challenge:key.challenge,state:key.state});
  await openExternal(url);
  const deadline=new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Error("YOUTUBE_OAUTH_TIMEOUT")),timeoutMs);
  });
  const code=await Promise.race([result,deadline]);
  return await finishYoutubeOauth({fetchImpl,clientId,code,redirectUri,
   verifier:key.verifier,expectedEmail,clientSecret});
 }finally{if(timer)clearTimeout(timer);server.close();}
}
