/** Official Instagram Login. Cloud relays the code; only Desktop holds tokens. */
import http from "node:http";
import {randomBytes,createHash,timingSafeEqual} from "node:crypto";
export const INSTAGRAM_SCOPES=["instagram_business_basic","instagram_business_content_publish"];
function fail(code){throw Error(code);}
export function validateInstagramAppSecret(secret){
 if(typeof secret!=="string"||!/^[a-fA-F0-9]{32}$/.test(secret))
  fail("INSTAGRAM_OAUTH_APP_SECRET_INVALID");
}
export function instagramRedirectUri(cloudBaseUrl){
 let url;
 try{url=new URL(cloudBaseUrl);}catch{fail("INSTAGRAM_OAUTH_CLOUD_HTTPS_REQUIRED");}
 if(url.protocol!=="https:"||!url.hostname||url.username||url.password||url.port||
   url.pathname!=="/"||url.search||url.hash)
  fail("INSTAGRAM_OAUTH_CLOUD_HTTPS_REQUIRED");
 return new URL("/oauth/instagram/callback",url).toString();
}
export function instagramAuthorizationUrl({appId,redirectUri,state}){
 if(!/^[0-9]{6,30}$/.test(appId??""))fail("INSTAGRAM_OAUTH_APP_ID_REQUIRED");
 if(!/^ig1\.[1-9][0-9]{3,4}\.[A-Za-z0-9_-]{43}$/.test(state??""))
  fail("INSTAGRAM_OAUTH_STATE_INVALID");
 const uri=new URL("https://www.instagram.com/oauth/authorize");
 for(const [k,v] of Object.entries({client_id:appId,redirect_uri:redirectUri,
  response_type:"code",scope:INSTAGRAM_SCOPES.join(","),state}))uri.searchParams.set(k,v);
 return uri.toString();
}
function checkCallback(requestUrl,expectedState){
 const url=new URL(requestUrl,"http://127.0.0.1");
 if(url.pathname!=="/oauth/instagram/callback")fail("INSTAGRAM_OAUTH_CALLBACK_INVALID");
 const expected=createHash("sha256").update(expectedState).digest();
 const actual=createHash("sha256").update(url.searchParams.get("state")??"").digest();
 if(!timingSafeEqual(expected,actual))fail("INSTAGRAM_OAUTH_STATE_MISMATCH");
 if(url.searchParams.has("error"))fail("INSTAGRAM_OAUTH_DECLINED");
 const code=url.searchParams.get("code");
 if(!code||code.length<3||code.length>2048)fail("INSTAGRAM_OAUTH_CODE_INVALID");
 return code;
}
async function apiJson(fetchImpl,endpoint,options,stage){
 const url=new URL(endpoint);
 if(url.protocol!=="https:"||url.port||url.username||url.password||
   !["api.instagram.com","graph.instagram.com"].includes(url.hostname))
  fail("INSTAGRAM_OAUTH_ENDPOINT_BLOCKED");
 let res;
 try{res=await fetchImpl(url.toString(),{...options,redirect:"manual",
   signal:AbortSignal.timeout(15000)});}
 catch{fail("INSTAGRAM_OAUTH_"+stage+"_NETWORK_FAILED");}
 if(res.status<200||res.status>=300){
  // Never propagate Meta response bodies: they may echo credentials or codes.
  let detail;try{detail=await res.json();}catch{}
  const message=String(detail?.error_message??detail?.error?.message??"");
  const reason=/client[_ ]secret/i.test(message)?"CLIENT_SECRET_INVALID"
   :/redirect/i.test(message)?"REDIRECT_INVALID"
   :/matching code|code.*(?:invalid|used|expired)/i.test(message)?"CODE_INVALID"
   :/invalid.*(?:client|app)|(?:client|app).*invalid/i.test(message)?"APP_INVALID"
   :null;
  fail("INSTAGRAM_OAUTH_"+stage+"_"+(reason??"HTTP_"+res.status));
 }
 const raw=await res.text();
 if(raw.length>32768)fail("INSTAGRAM_OAUTH_"+stage+"_RESPONSE_TOO_LARGE");
 let value;try{value=JSON.parse(raw);}catch{fail("INSTAGRAM_OAUTH_"+stage+"_INVALID_RESPONSE");}
 if(!value||typeof value!=="object"||Array.isArray(value))
  fail("INSTAGRAM_OAUTH_"+stage+"_INVALID_RESPONSE");
 return value;
}
export async function finishInstagramOauth({fetchImpl=fetch,appId,appSecret,code,
 redirectUri,expectedUsername}){
 if(!appSecret)fail("INSTAGRAM_OAUTH_APP_SECRET_REQUIRED");
 validateInstagramAppSecret(appSecret);
 const tokenResponse=await apiJson(fetchImpl,"https://api.instagram.com/oauth/access_token",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({client_id:appId,client_secret:appSecret,
   grant_type:"authorization_code",redirect_uri:redirectUri,code}).toString()
 },"TOKEN");
 const short=Array.isArray(tokenResponse.data)
  ?(tokenResponse.data.length===1&&!tokenResponse.access_token?tokenResponse.data[0]:null)
  :tokenResponse;
 if(!short||typeof short.access_token!=="string"||!short.access_token||
   !/^[0-9]{4,32}$/.test(String(short.user_id??"")))
  fail("INSTAGRAM_OAUTH_SHORT_TOKEN_INVALID");
 const scopes=typeof short.permissions==="string"
  ?short.permissions.split(",").map(s=>s.trim())
  :Array.isArray(short.permissions)?short.permissions:[];
 if(!INSTAGRAM_SCOPES.every(s=>scopes.includes(s)))
  fail("INSTAGRAM_OAUTH_SCOPES_MISSING");
 const longUrl=new URL("https://graph.instagram.com/access_token");
 for(const [k,v] of Object.entries({grant_type:"ig_exchange_token",
   client_secret:appSecret,access_token:short.access_token}))longUrl.searchParams.set(k,v);
 const long=await apiJson(fetchImpl,longUrl.toString(),{},"LONG_TOKEN");
 if(typeof long.access_token!=="string"||!long.access_token||
   !(Number(long.expires_in)>0))fail("INSTAGRAM_OAUTH_LONG_TOKEN_INVALID");
 const profileResponse=await apiJson(fetchImpl,
   "https://graph.instagram.com/v26.0/me?fields=id,user_id,username,account_type",{
    headers:{Authorization:"Bearer "+long.access_token}
   },"PROFILE");
 const profile=Array.isArray(profileResponse.data)
  ?(profileResponse.data.length===1&&!profileResponse.username?profileResponse.data[0]:null)
  :profileResponse;
 // /me binds this profile to the exchanged token. OAuth-scoped and professional
 // IDs are different namespaces; verify the expected username and professional ID.
 if(!profile||!/^[0-9]{4,32}$/.test(String(profile.user_id??""))||
   typeof profile.username!=="string"||!profile.username.trim())
  fail("INSTAGRAM_OAUTH_PROFILE_INVALID");
 const accountType=String(profile.account_type??"").toUpperCase();
 if(!["BUSINESS","MEDIA_CREATOR","CREATOR"].includes(accountType))fail("INSTAGRAM_OAUTH_PROFESSIONAL_REQUIRED");
 const requested=String(expectedUsername??"").trim().replace(/^@/,"");
 if(requested&&requested.toLowerCase()!==profile.username.toLowerCase())
  fail("INSTAGRAM_OAUTH_WRONG_ACCOUNT");
 const publishing=await apiJson(fetchImpl,
   "https://graph.instagram.com/v26.0/"+profile.user_id+"/content_publishing_limit?fields=quota_usage,config",
   {headers:{Authorization:"Bearer "+long.access_token}},"PUBLISHING");
 const quota=publishing.data;
 if(!Array.isArray(quota)||quota.length!==1||
   !Number.isInteger(quota[0]?.quota_usage)||quota[0].quota_usage<0)
  fail("INSTAGRAM_OAUTH_PUBLISHING_INVALID");
 return {accountId:String(profile.user_id),username:profile.username,
  accountType,grant:{
   accessToken:long.access_token,scopes:INSTAGRAM_SCOPES.slice(),
   accountType,appScopedUserId:profile.id?String(profile.id):null,
   oauthUserId:String(short.user_id),
   publishingVerifiedAt:new Date().toISOString(),publishingQuota:quota[0],
   expiresAt:new Date(Date.now()+Math.min(60*86400,Number(long.expires_in))*1000).toISOString()}};
}
export async function verifyInstagramRelay(fetchImpl,cloudBaseUrl){
 const url=new URL(instagramRedirectUri(cloudBaseUrl));url.pathname="/oauth/instagram/ready";
 let response;
 try{response=await fetchImpl(url.toString(),{redirect:"manual",signal:AbortSignal.timeout(7500)});}
 catch{fail("INSTAGRAM_OAUTH_RELAY_UNAVAILABLE");}
 if(response.status!==200)fail("INSTAGRAM_OAUTH_RELAY_UNAVAILABLE");
 let value;try{value=await response.json();}catch{fail("INSTAGRAM_OAUTH_RELAY_UNAVAILABLE");}
 if(value?.ok!==true||value?.relay!=="instagram-loopback-v1")
  fail("INSTAGRAM_OAUTH_RELAY_UNAVAILABLE");
}
export async function connectInstagramBrowser({appId,appSecret,cloudBaseUrl,
 expectedUsername,openExternal,fetchImpl=fetch,timeoutMs=180000}){
 const redirectUri=instagramRedirectUri(cloudBaseUrl);
 if(!/^[0-9]{6,30}$/.test(appId??""))fail("INSTAGRAM_OAUTH_APP_ID_REQUIRED");
 if(!appSecret)fail("INSTAGRAM_OAUTH_APP_SECRET_REQUIRED");
 validateInstagramAppSecret(appSecret);
 await verifyInstagramRelay(fetchImpl,cloudBaseUrl);
 let complete;
 const received=new Promise(resolve=>{complete=resolve;});
 let used=false;
 let state;
 const server=http.createServer((req,res)=>{
  res.setHeader("cache-control","no-store");
  res.setHeader("content-type","text/plain; charset=utf-8");
  if(req.method!=="GET"||!req.url?.startsWith("/oauth/instagram/callback?")){
   res.writeHead(404).end("Not found");return;
  }
  if(used){res.writeHead(409).end("Already handled");return;}
  try{
   const code=checkCallback(req.url,state);used=true;
   res.writeHead(200).end("Instagram callback received. Return to OWL Desktop for the verified result.");
   complete(code);
  }catch(error){
   if(error instanceof Error && error.message==="INSTAGRAM_OAUTH_DECLINED"){
    used=true;
    res.writeHead(200).end("Instagram authorization declined. Return to OWL Desktop.");
    complete(error);
   }else res.writeHead(400).end("Invalid Instagram callback. Return to OWL Desktop.");
  }
 });
 let timer;
 try{
  const port=await new Promise((resolve,reject)=>{
   server.once("error",reject);
   server.listen(0,"127.0.0.1",()=>resolve(server.address().port));
  });
  state="ig1."+port+"."+randomBytes(32).toString("base64url");
  await openExternal(instagramAuthorizationUrl({appId,redirectUri,state}));
  const timeout=new Promise((_,reject)=>{timer=setTimeout(
    ()=>reject(Error("INSTAGRAM_OAUTH_TIMEOUT")),timeoutMs);});
  const code=await Promise.race([received,timeout]);
  if(code instanceof Error)throw code;
  return await finishInstagramOauth({fetchImpl,appId,appSecret,code,redirectUri,expectedUsername});
 }finally{if(timer)clearTimeout(timer);server.close();}
}
