import {describe,it,expect,vi} from "vitest";
import {instagramAuthorizationUrl,instagramRedirectUri,
 finishInstagramOauth,connectInstagramBrowser,verifyInstagramRelay} from "../electron/services/instagram-oauth.mjs";
const appId="123456789012345",secret="META_TEST_SECRET_ONLY",
 redirectUri="https://api.example.com/oauth/instagram/callback";
function fakeMeta({username="bloomroom.lab",id="12345678901234567",scopeFail=false}={}){
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
    permissions:scopeFail?["instagram_business_basic"]:["instagram_business_basic","instagram_business_content_publish"]}),{status:200});
  }
  if(uri.pathname==="/access_token"){
   expect(uri.searchParams.get("client_secret")).toBe(secret);
   expect(uri.searchParams.get("grant_type")).toBe("ig_exchange_token");
   return new Response(JSON.stringify({access_token:"FAKE_LONG",expires_in:5184000}),{status:200});
  }
  if(uri.pathname==="/me"){
   expect(options.headers?.Authorization).toBe("Bearer FAKE_LONG");
   return new Response(JSON.stringify({id,username,account_type:"BUSINESS"}),{status:200});
  }
  throw Error("UNKNOWN_TEST_ENDPOINT");
 });
 return {fetch,calls};
}
describe("OWL official Instagram Login",()=>{
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
   "graph.instagram.com/me"
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
 it("rejects wrong username and missing publishing scope",async()=>{
  const base={appId,appSecret:secret,code:"FAKE_CODE_FROM_META",
   redirectUri,expectedUsername:"@bloomroom.lab"};
  await expect(finishInstagramOauth({...base,fetchImpl:fakeMeta({username:"wrong.account"}).fetch}))
   .rejects.toThrow("INSTAGRAM_OAUTH_WRONG_ACCOUNT");
  await expect(finishInstagramOauth({...base,fetchImpl:fakeMeta({scopeFail:true}).fetch}))
   .rejects.toThrow("INSTAGRAM_OAUTH_SCOPES_MISSING");
 });
});
