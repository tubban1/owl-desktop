import {describe,it,expect,vi} from "vitest";
import {instagramAuthorizationUrl,instagramRedirectUri,
 finishInstagramOauth,connectInstagramBrowser,verifyInstagramRelay,validateInstagramAppSecret} from "../electron/services/instagram-oauth.mjs";
const appId="123456789012345",secret="a".repeat(32),
 redirectUri="https://api.example.com/oauth/instagram/callback";
function fakeMeta({username="bloomroom.lab",id="12345678901234567",
 userId=id,profileId=id,wrappedProfile=false,accountType="BUSINESS",scopeFail=false,omitPermissions=false,quotaInvalid=false}={}){
 const calls=[];
 const fetch=vi.fn(async(url,options={})=>{
  const uri=new URL(url);calls.push(uri.hostname+uri.pathname);
  expect(options.redirect).toBe("manual");
  if(uri.pathname==="/oauth/instagram/ready")
   return new Response(JSON.stringify({ok:true,relay:"instagram-loopback-v1"}),{status:200});
  if(uri.hostname==="api.instagram.com"){
   const form=new URLSearchParams(options.body);
   expect(form.get("client_secret")).toBe(secret);
   expect(form.get("redirect_uri")).toBe(redirectUri);
   return new Response(JSON.stringify({access_token:"FAKE_SHORT",user_id:id,
    permissions:omitPermissions?undefined:scopeFail?["instagram_business_basic"]:["instagram_business_basic","instagram_business_content_publish"]}),{status:200});
  }
  if(uri.pathname==="/access_token"){
   expect(uri.searchParams.get("client_secret")).toBe(secret);
   expect(uri.searchParams.get("grant_type")).toBe("ig_exchange_token");
   return new Response(JSON.stringify({access_token:"FAKE_LONG",expires_in:5184000}),{status:200});
  }
  if(uri.pathname==="/v26.0/me"){
   expect(options.headers?.Authorization).toBe("Bearer FAKE_LONG");
   const profile={id:profileId,user_id:userId,username,account_type:accountType};
   return new Response(JSON.stringify(wrappedProfile?{data:[profile]}:profile),{status:200});
  }
  if(uri.pathname.endsWith("/content_publishing_limit")){
   expect(uri.pathname).toBe("/v26.0/"+userId+"/content_publishing_limit");
   expect(options.headers?.Authorization).toBe("Bearer FAKE_LONG");
   return new Response(JSON.stringify({data:quotaInvalid?[]:[{quota_usage:0,config:{quota_total:100,quota_duration:86400}}]}),{status:200});
  }
  throw Error("UNKNOWN_TEST_ENDPOINT");
 });
 return {fetch,calls};
}
describe("OWL official Instagram Login",()=>{
 it("rejects incomplete credentials before opening OAuth",()=>{
  for(const value of ["undefined","[redacted]","password",""])
   expect(()=>validateInstagramAppSecret(value)).toThrow("INSTAGRAM_OAUTH_APP_SECRET_INVALID");
  expect(()=>validateInstagramAppSecret(secret)).not.toThrow();
 });
 it("rejects non-HTTPS callback and creates exact new scopes",()=>{
  expect(()=>instagramRedirectUri("http://127.0.0.1:8788")).toThrow(/CLOUD_HTTPS_REQUIRED/);
  const uri=new URL(instagramAuthorizationUrl({appId,redirectUri,
   state:"ig1.38518."+"Q".repeat(43)}));
  expect(uri.hostname).toBe("www.instagram.com");
  expect(uri.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish");
  expect(uri.searchParams.get("redirect_uri")).toBe(redirectUri);
 });
 it("does not open Meta browser when Cloud HTTPS relay isn't deployed",async()=>{
  const browser=vi.fn();
  await expect(connectInstagramBrowser({appId,appSecret:secret,
   cloudBaseUrl:"https://api.example.com",expectedUsername:"@bloomroom.lab",
   openExternal:browser,fetchImpl:vi.fn(async()=>new Response("not found",{status:404}))
  })).rejects.toThrow("INSTAGRAM_OAUTH_RELAY_UNAVAILABLE");
  expect(browser).not.toHaveBeenCalled();
 });
 it("finishes browser callback and validates Instagram professional ID",async()=>{
  const meta=fakeMeta();
  const opened=vi.fn(async(url)=>{
   const authorize=new URL(url);
   const state=authorize.searchParams.get("state");
   const port=Number(state.split(".")[1]);
   const local=new URL("http://127.0.0.1:"+port+"/oauth/instagram/callback");
   local.searchParams.set("state",state);local.searchParams.set("code","FAKE_CODE_FROM_META");
   const response=await fetch(local);
   expect(response.status).toBe(200);
  });
  const result=await connectInstagramBrowser({appId,appSecret:secret,
   cloudBaseUrl:"https://api.example.com",expectedUsername:"@bloomroom.lab",
   openExternal:opened,fetchImpl:meta.fetch,timeoutMs:5000});
  expect(result.accountId).toBe("12345678901234567");
  expect(result.username).toBe("bloomroom.lab");
  expect(result.grant.accessToken).toBe("FAKE_LONG");
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(meta.calls).toEqual([
   "api.example.com/oauth/instagram/ready",
   "api.instagram.com/oauth/access_token",
   "graph.instagram.com/access_token",
   "graph.instagram.com/v26.0/me",
   "graph.instagram.com/v26.0/12345678901234567/content_publishing_limit"
  ]);
 });
 it("exits promptly when Instagram access is declined",async()=>{
  const meta=fakeMeta();
  const browser=vi.fn(async url=>{
   const authorize=new URL(url);
   const state=authorize.searchParams.get("state");
   const port=Number(state.split(".")[1]);
   const local=new URL("http://127.0.0.1:"+port+"/oauth/instagram/callback");
   local.searchParams.set("state",state);local.searchParams.set("error","access_denied");
   const response=await fetch(local);
   expect(response.status).toBe(200);
  });
  await expect(connectInstagramBrowser({appId,appSecret:secret,
   cloudBaseUrl:"https://api.example.com",expectedUsername:"@bloomroom.lab",
   openExternal:browser,fetchImpl:meta.fetch,timeoutMs:5000}))
    .rejects.toThrow("INSTAGRAM_OAUTH_DECLINED");
  expect(meta.calls).toEqual(["api.example.com/oauth/instagram/ready"]);
 });
 it("rejects forged state and accepts only the first matching callback",async()=>{
  const meta=fakeMeta();
  await connectInstagramBrowser({appId,appSecret:secret,cloudBaseUrl:"https://api.example.com",
   expectedUsername:"@bloomroom.lab",fetchImpl:meta.fetch,timeoutMs:5000,
   openExternal:async url=>{
    const state=new URL(url).searchParams.get("state");
    const callback=new URL("http://127.0.0.1:"+state.split(".")[1]+"/oauth/instagram/callback");
    callback.searchParams.set("code","FAKE_CODE");
    callback.searchParams.set("state",state.slice(0,-1)+(state.endsWith("Q")?"R":"Q"));
    expect((await fetch(callback)).status).toBe(400);
    callback.searchParams.set("state",state);
    expect((await fetch(callback)).status).toBe(200);
    expect((await fetch(callback)).status).toBe(409);
   }});
  expect(meta.calls.filter(p=>p==="api.instagram.com/oauth/access_token")).toHaveLength(1);
 });
 it("times out and closes the loopback listener without exchanging tokens",async()=>{
  const meta=fakeMeta();let callback;
  await expect(connectInstagramBrowser({appId,appSecret:secret,
   cloudBaseUrl:"https://api.example.com",fetchImpl:meta.fetch,timeoutMs:30,
   openExternal:async url=>{
    const state=new URL(url).searchParams.get("state");
    callback="http://127.0.0.1:"+state.split(".")[1]+"/oauth/instagram/callback";
   }})).rejects.toThrow("INSTAGRAM_OAUTH_TIMEOUT");
  await expect(fetch(callback)).rejects.toThrow();
  expect(meta.calls).toEqual(["api.example.com/oauth/instagram/ready"]);
 });
 it("uses the professional user_id, preserving the app-scoped ID separately",async()=>{
  const result=await finishInstagramOauth({appId,appSecret:secret,code:"FAKE_CODE",
   redirectUri,expectedUsername:"@bloomroom.lab",
   fetchImpl:fakeMeta({userId:"17841400000000000",profileId:"9900000000000000",
    wrappedProfile:true,accountType:"Media_Creator"}).fetch});
  expect(result.accountId).toBe("17841400000000000");
  expect(result.grant.appScopedUserId).toBe("9900000000000000");
  expect(result.grant.oauthUserId).toBe("12345678901234567");
  expect(result.accountType).toBe("MEDIA_CREATOR");
  expect(result.grant.publishingQuota.quota_usage).toBe(0);
 });
 it.each([
  [{omitPermissions:true},"INSTAGRAM_OAUTH_SCOPES_MISSING"],
  [{accountType:null},"INSTAGRAM_OAUTH_PROFESSIONAL_REQUIRED"],
  [{accountType:""},"INSTAGRAM_OAUTH_PROFESSIONAL_REQUIRED"],
  [{accountType:"PERSONAL"},"INSTAGRAM_OAUTH_PROFESSIONAL_REQUIRED"],
  [{quotaInvalid:true},"INSTAGRAM_OAUTH_PUBLISHING_INVALID"]
 ])("refuses unverified readiness for %j",async(options,error)=>{
  await expect(finishInstagramOauth({appId,appSecret:secret,code:"FAKE_CODE",
   redirectUri,expectedUsername:"@bloomroom.lab",fetchImpl:fakeMeta(options).fetch}))
   .rejects.toThrow(error);
 });
 it("classifies token failures without echoing Meta error bodies",async()=>{
  const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({
   error_message:"Error validating client secret. Sensitive value MUST_NOT_ESCAPE"
  }),{status:400}));
  const result=finishInstagramOauth({appId,appSecret:secret,code:"FAKE_CODE",redirectUri,fetchImpl});
  await expect(result).rejects.toThrow("INSTAGRAM_OAUTH_TOKEN_CLIENT_SECRET_INVALID");
  await expect(result).rejects.not.toThrow("MUST_NOT_ESCAPE");
 });
 it("rejects wrong username and missing publishing scope",async()=>{
  const base={appId,appSecret:secret,code:"FAKE_CODE_FROM_META",
   redirectUri,expectedUsername:"@bloomroom.lab"};
  await expect(finishInstagramOauth({...base,fetchImpl:fakeMeta({username:"wrong.account"}).fetch}))
   .rejects.toThrow("INSTAGRAM_OAUTH_WRONG_ACCOUNT");
  await expect(finishInstagramOauth({...base,fetchImpl:fakeMeta({scopeFail:true}).fetch}))
   .rejects.toThrow("INSTAGRAM_OAUTH_SCOPES_MISSING");
 });
});
