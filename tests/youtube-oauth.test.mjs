import {describe,it,expect,vi} from "vitest";
import {youtubePkce,youtubeAuthorizationUrl,checkYoutubeCallback,
 finishYoutubeOauth,connectYoutubeBrowser} from "../electron/services/youtube-oauth.mjs";
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
 it("refuses missing app ID before opening browser",async()=>{
  const browser=vi.fn();
  await expect(connectYoutubeBrowser({clientId:"",openExternal:browser})).rejects.toThrow(/CLIENT_ID_REQUIRED/);
  expect(browser).not.toHaveBeenCalled();
 });
});
