import { describe, expect, it } from "vitest";
import {createAgentTabController} from "../chrome-companion/agent-tabs-controller.mjs";
import {permittedOrigin, originPattern, validSiteGrant} from "../chrome-companion/agent-tab-policy.mjs";

function fixture() {
  const items=new Map(), chromeTabs=new Map();
  let lastId=70, foreground=7, created=[];
  const permissions=new Set(["https://www.reddit.com/*"]);
  const chrome={
    permissions:{contains:async({origins})=>origins.every(x=>permissions.has(x))},
    tabs:{
      create:async({url,active})=>{
        expect(active).toBe(false);
        const tab={id:++lastId,url,active:false};
        chromeTabs.set(tab.id,tab);created.push(tab);
        return tab;
      },
      get:async id=>{
        const tab=chromeTabs.get(id);
        if(!tab)throw new Error("Tab gone");
        return tab;
      },
      remove:async(id)=>{chromeTabs.delete(id);},
      update:async(id,patch)=>{
        expect(patch).toEqual({active:true});
        foreground=id;return chromeTabs.get(id);
      }
    }
  };
  const controller=createAgentTabController(chrome,{
    get:async k=>items.get(k),
    put:async(k,v)=>items.set(k,v),
    clear:async k=>items.delete(k),
  });
  return {controller,items,chromeTabs,permissions,created,get foreground(){return foreground;}};
}
describe("Chrome agent-owned background tabs and site consent",()=>{
  it("cannot open or inspect sites without explicit Chrome site permission",async()=>{
    const f=fixture();
    await expect(f.controller.open("https://www.reddit.com/settings")).rejects.toThrow("AGENT_SITE_AUTHORIZATION_REQUIRED");
    await expect(f.controller.authorize("https://example.org")).rejects.toThrow("AGENT_SITE_CHROME_PERMISSION_REQUIRED");
    expect(f.created).toHaveLength(0);
    expect(permittedOrigin("javascript:alert(1)")).toBeNull();
    expect(permittedOrigin("https://user:secret@www.reddit.com")).toBeNull();
  });
  it("opens agent-owned tabs without disturbing the user's selected tab",async()=>{
    const f=fixture();
    await f.controller.authorize("https://www.reddit.com");
    const a=await f.controller.open("https://www.reddit.com/settings/profile");
    const b=await f.controller.open("https://www.reddit.com/r/programming/");
    expect(a.background).toBe(true);
    expect(b.background).toBe(true);
    expect(f.foreground).toBe(7);
    expect((await f.controller.tabs())).toHaveLength(2);
    expect((await f.controller.active()).tab.id).toBe(b.tabId);
    await f.controller.authorize("https://www.reddit.com");
    expect((await f.controller.active()).tab.id).toBe(b.tabId);
    await f.controller.select(a.tabId);
    expect((await f.controller.active()).tab.id).toBe(a.tabId);
    expect(f.foreground).toBe(7);
    await expect(f.controller.open("https://accounts.google.com")).rejects.toThrow("AGENT_SITE_AUTHORIZATION_REQUIRED");
    await expect(f.controller.select(7)).rejects.toThrow("AGENT_TAB_NOT_OWNED");
    await expect(f.controller.close(7)).rejects.toThrow("AGENT_TAB_NOT_OWNED");
    await f.controller.close(a.tabId);
    expect(f.foreground).toBe(7);
    expect((await f.controller.tabs())).toHaveLength(1);
    await f.controller.close(b.tabId);
    await expect(f.controller.active()).rejects.toThrow("AGENT_TAB_NOT_SELECTED");
  });
  it("blocks cross-origin login redirects until human opens the agent tab",async()=>{
    const f=fixture();
    await f.controller.authorize("https://www.reddit.com");
    const created=await f.controller.open("https://www.reddit.com/settings");
    f.chromeTabs.get(created.tabId).url="https://accounts.google.com/oauth2/authorize";
    const state=await f.controller.active();
    expect(state.loginRequired).toBe(true);
    expect((await f.controller.tabs())[0].loginRequired).toBe(true);
    expect(f.foreground).toBe(7);
    await f.controller.focusForLogin();
    expect(f.foreground).toBe(created.tabId);
    f.chromeTabs.get(created.tabId).url="https://www.reddit.com/settings";
    expect((await f.controller.active()).loginRequired).toBe(false);
  });
  it("revoke/expiry leaves tabs open but removes agent authority",async()=>{
    const f=fixture();
    await f.controller.authorize("https://www.reddit.com");
    const tab=await f.controller.open("https://www.reddit.com");
    await f.controller.revoke();
    expect(f.created).toHaveLength(1);
    expect((await f.controller.tabs())).toHaveLength(0);
    await expect(f.controller.select(tab.tabId)).rejects.toThrow("AGENT_TAB_NOT_OWNED");
    await f.controller.authorize("https://www.reddit.com");
    f.permissions.clear();
    await expect(f.controller.open("https://www.reddit.com")).rejects.toThrow("AGENT_SITE_CHROME_PERMISSION_REVOKED");
  });
  it("does not accept arbitrary origins or expired grants",()=>{
    expect(originPattern("https://www.reddit.com/a")).toBe("https://www.reddit.com/*");
    expect(originPattern("http://127.0.0.1:8080/login")).toBe("http://127.0.0.1/*");
    expect(validSiteGrant({origin:"https://www.reddit.com",expiresAt:40},"https://www.reddit.com/a",39)).toBe(true);
    expect(validSiteGrant({origin:"https://www.reddit.com",expiresAt:40},"https://www.reddit.com/a",40)).toBe(false);
  });
});
