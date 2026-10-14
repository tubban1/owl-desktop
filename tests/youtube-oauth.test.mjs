import {describe,it,expect,vi} from "vitest";
import {youtubePkce,youtubeAuthorizationUrl,checkYoutubeCallback,
 finishYoutubeOauth,connectYoutubeBrowser,classifyYoutubeChannelHttpError} from "../electron/services/youtube-oauth.mjs";
const clientId="12345678-testdesktopapp.apps.googleusercontent.com";
const channelId="UC"+"a".repeat(22);
function fakeGoogle({email="owner@example.com",channel=channelId,missingScopes=false,missingRefresh=false}={}){
 const calls=[];
 return {calls,fetch:vi.fn(async (url,opts)=>{
  const host=new URL(url).hostname;calls.push(host);
  expect(opts.redirect).toBe("manual");
  if(host==="oauth2.googleapis.com"){
   const body=new URLSearchParams(opts.body);
   expect(body.get("grant_type")).toBe("authorization_code");
   expect(body.get("code_verifier")?.length).toBeGreaterThan(40);
   return new Response(JSON.stringify({access_token:"FAKE_ACCESS_TOKEN",refresh_token:missingRefresh?undefined:"FAKE_REFRESH_TOKEN",
    token_type:"Bearer",expires_in:3600,
    scope:missingScopes?"email openid": "openid email https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly"}),{status:200});
  }
  expect(opts.headers.Authorization).toBe("Bearer FAKE_ACCESS_TOKEN");
  if(host==="openidconnect.googleapis.com")
   return new Response(JSON.stringify({email,email_verified:true}),{status:200});
  if(host==="www.googleapis.com")
   return new Response(JSON.stringify({items:[{id:channel,snippet:{title:"Bloomroom Lab"}}]}),{status:200});
  throw Error("TEST_UNEXPECTED_HOST");
 })};
}
describe("YouTube official OAuth desktop",()=>{
 it("creates unpredictable verifier, state and strict official URL",()=>{
  const a=youtubePkce(),b=youtubePkce();
  expect(a.state).not.toBe(b.state);
  expect(a.verifier).not.toBe(b.verifier);
  const url=new URL(youtubeAuthorizationUrl({...a,clientId,redirectUri:"http://127.0.0.1:35419/oauth/youtube/callback"}));
  expect(url.hostname).toBe("accounts.google.com");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("scope")).toContain("youtube.upload");
  expect(()=>checkYoutubeCallback({path:"/oauth/youtube/callback?state=invalid&code=X",state:a.state})).toThrow(/STATE_MISMATCH/);
 });
 it("accepts loopback callback and persists only after verified email+channel",async()=>{
  const google=fakeGoogle();
  const browser=vi.fn(async url=>{
   const u=new URL(url);
   const callback=new URL(u.searchParams.get("redirect_uri"));
   callback.searchParams.set("state",u.searchParams.get("state"));
   callback.searchParams.set("code","ONE_TIME_FAKE_AUTH_CODE");
   const response=await fetch(callback);
   expect(response.status).toBe(200);
  });
  const result=await connectYoutubeBrowser({clientId,expectedEmail:"owner@example.com",
   openExternal:browser,fetchImpl:google.fetch,timeoutMs:5000});
  expect(result.channelId).toBe(channelId);
  expect(result.channelTitle).toBe("Bloomroom Lab");
  expect(result.grant.refreshToken).toBe("FAKE_REFRESH_TOKEN");
  expect(google.calls).toEqual(["oauth2.googleapis.com","openidconnect.googleapis.com","www.googleapis.com"]);
  expect(browser).toHaveBeenCalledOnce();
 });
 it("denies wrong account, channel, refresh or scopes",async()=>{
  const params={clientId,code:"fake",redirectUri:"http://127.0.0.1:35419/oauth/youtube/callback",
   verifier:youtubePkce().verifier,expectedEmail:"owner@example.com"};
  for(const [variant,pattern] of [
   [{email:"attacker@example.com"},/WRONG_GOOGLE_ACCOUNT/],
   [{channel:"INVALID"},/CHANNEL_INVALID/],
   [{missingRefresh:true},/REFRESH_TOKEN_REQUIRED/],
   [{missingScopes:true},/SCOPES_MISSING/],
  ]){
   const google=fakeGoogle(variant);
   await expect(finishYoutubeOauth({...params,fetchImpl:google.fetch})).rejects.toThrow(pattern);
  }
 });
 it("classifies Google 400 separately for token and YouTube channel",async()=>{
  const base={clientId,code:"FAKE",redirectUri:"http://127.0.0.1:35419/oauth/youtube/callback",
   verifier:youtubePkce().verifier,expectedEmail:"owner@example.com"};
  const missing=vi.fn(async ()=>new Response(JSON.stringify({
   error:"invalid_request",error_description:"client_secret is missing."}),{status:400}));
  await expect(finishYoutubeOauth({...base,fetchImpl:missing})).rejects.toThrow("YOUTUBE_OAUTH_TOKEN_CLIENT_SECRET_REQUIRED");
  const invalid=vi.fn(async()=>new Response(JSON.stringify({error:"invalid_grant"}),{status:400}));
  await expect(finishYoutubeOauth({...base,fetchImpl:invalid})).rejects.toThrow("YOUTUBE_OAUTH_TOKEN_INVALID_GRANT");
  const generic=vi.fn(async()=>new Response(JSON.stringify({error:"invalid_request"}),{status:400}));
  await expect(finishYoutubeOauth({...base,fetchImpl:generic})).rejects.toThrow("YOUTUBE_OAUTH_TOKEN_HTTP_400");
  const fake=fakeGoogle().fetch;
  await expect(finishYoutubeOauth({...base,fetchImpl:async (url,opts)=>{
   if(new URL(url).hostname==="www.googleapis.com")
    return new Response(JSON.stringify({error:{message:"secret details"}}),{status:400});
   return fake(url,opts);
  }})).rejects.toThrow("YOUTUBE_OAUTH_CHANNEL_HTTP_400");
 });
 it("sends optional client secret only to token endpoint",async()=>{
  const base={clientId,code:"FAKE",redirectUri:"http://127.0.0.1:35419/oauth/youtube/callback",
   verifier:youtubePkce().verifier,expectedEmail:"owner@example.com",
   clientSecret:"GOCSPX-SYNTHETIC_ONLY"};
  const fake=fakeGoogle().fetch;
  const spy=vi.fn(async (url,opts)=>{
   if(new URL(url).hostname==="oauth2.googleapis.com")
    expect(new URLSearchParams(opts.body).get("client_secret")).toBe(base.clientSecret);
   else expect(JSON.stringify(opts)).not.toContain(base.clientSecret);
   return fake(url,opts);
  });
  const res=await finishYoutubeOauth({...base,fetchImpl:spy});
  expect(res.channelId).toBe(channelId);
  expect(JSON.stringify(res)).not.toContain(base.clientSecret);
 });
 it("maps only allowlisted Google/YouTube 403 reason codes, never raw error bodies",async()=>{
  const cases=[
   [{error:{errors:[{domain:"usageLimits",reason:"accessNotConfigured",message:"Project 123456 is secret"}]}},403,"YOUTUBE_OAUTH_CHANNEL_API_DISABLED"],
   [{error:{status:"PERMISSION_DENIED",details:[{"@type":"type.googleapis.com/google.rpc.ErrorInfo",reason:"SERVICE_DISABLED",metadata:{consumer:"projects/123456"}}]}},403,"YOUTUBE_OAUTH_CHANNEL_API_DISABLED"],
   [{error:{errors:[{reason:"quotaExceeded"}]}},403,"YOUTUBE_OAUTH_CHANNEL_QUOTA_EXCEEDED"],
   [{error:{errors:[{reason:"insufficientPermissions"}]}},403,"YOUTUBE_OAUTH_CHANNEL_PERMISSION_DENIED"],
   [{error:{errors:[{reason:"rateLimitExceeded"}]}},403,"YOUTUBE_OAUTH_CHANNEL_RATE_LIMITED"],
   [{error:{errors:[{reason:"channelForbidden"}]}},403,"YOUTUBE_OAUTH_CHANNEL_FORBIDDEN"],
   [{error:{errors:[{reason:"youtubeSignupRequired"}]}},401,"YOUTUBE_OAUTH_CHANNEL_YOUTUBE_SIGNUP_REQUIRED"],
  ];
  for(const [body,status,code] of cases){
   const raw=JSON.stringify(body);
   expect(classifyYoutubeChannelHttpError(status,raw)).toBe(code);
   const fake=fakeGoogle().fetch;
   const params={clientId,code:"fake",redirectUri:"http://127.0.0.1:35419/oauth/youtube/callback",
     verifier:youtubePkce().verifier,expectedEmail:"owner@example.com"};
   await expect(finishYoutubeOauth({...params,fetchImpl:async(url,opts)=>
     new URL(url).hostname==="www.googleapis.com"
       ?new Response(raw,{status}):fake(url,opts)})).rejects.toThrow(code);
  }
  expect(classifyYoutubeChannelHttpError(403,JSON.stringify({error:{message:"private user token"}}))).toBeNull();
  expect(classifyYoutubeChannelHttpError(403,"invalid")).toBeNull();
  expect(classifyYoutubeChannelHttpError(403,"x".repeat(8193))).toBeNull();
  expect(classifyYoutubeChannelHttpError(400,JSON.stringify({error:{errors:[{reason:"quotaExceeded"}]}}))).toBeNull();
 });
 it("refuses missing app ID before opening browser",async()=>{
  const browser=vi.fn();
  await expect(connectYoutubeBrowser({clientId:"",openExternal:browser})).rejects.toThrow(/CLIENT_ID_REQUIRED/);
  expect(browser).not.toHaveBeenCalled();
 });
});
