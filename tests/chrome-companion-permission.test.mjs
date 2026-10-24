import {beforeAll, afterAll, beforeEach, describe, expect, it} from "vitest";
import fs from "node:fs/promises";
import {grantFor, grantIsCurrent, sanitizeSnapshot} from "../chrome-companion/permission-policy.mjs";

const listeners = {};
const stored = new Map();
let active = {id: 42, url: "https://www.reddit.com/settings/profile?view=1", title: "Profile"};
const tabs = new Map([[42, active], [43, {id: 43, url: "https://other.example/", title: "Other"}]]);
let injected = 0;
const fakeChrome = {
  action: {setBadgeText: async () => {},setBadgeBackgroundColor: async () => {}},
  alarms: {create: () => {},onAlarm: {addListener: fn => {listeners.alarm = fn;}}},
  tabCapture: {getMediaStreamId: async ({targetTabId}) => {expect(targetTabId).toBe(42);return "test-stream";}},
  offscreen: {createDocument: async () => {},closeDocument: async () => {}},
  runtime: {
    id: "owl-test-extension", getURL: file => "chrome-extension://owl-test-extension/" + file,
    sendMessage: async (message) => message.type === "start" ? {ok:true,data:{capturing:true}} : {ok:true,data:{capturing:false}},
    getContexts: async () => [],
    onMessage: {addListener: fn => { listeners.message = fn; }}
  },
  storage: {session: {
    get: async key => ({[key]: stored.get(key)}),
    set: async entries => {for (const [k,v] of Object.entries(entries)) stored.set(k,v);},
    remove: async key => {stored.delete(key);}
  }},
  tabs: {
    query: async () => [active],
    get: async id => {
      const tab = tabs.get(id);
      if (!tab) throw new Error("No tab");
      return tab;
    },
    onRemoved: {addListener: fn => {listeners.removed = fn;}},
    onUpdated: {addListener: fn => {listeners.updated = fn;}}
  },
  scripting: {executeScript: async ({target,func}) => {
    expect(typeof func).toBe("function");
    expect(target.tabId).toBe(42);
    injected++;
    return [{result: {
      url: tabs.get(42).url, title: "Private Profile",
      text: "X".repeat(7000),
      controls: [{tag: "input", type: "password", label: "Password"}]
    }}];
  }}
};
async function command(op, sender = {
  id: "owl-test-extension", url: "chrome-extension://owl-test-extension/popup.html"
}) {
  return await new Promise(resolve => {
    listeners.message({op}, sender, resolve);
  });
}
beforeAll(async () => {
  globalThis.chrome = fakeChrome;
  await import("../chrome-companion/service-worker.mjs");
});
afterAll(() => {delete globalThis.chrome;});
beforeEach(() => {
  stored.clear();
  active = {id: 42, url: "https://www.reddit.com/settings/profile?view=1", title: "Profile"};
  tabs.set(42, active);
  injected = 0;
});

describe("Chrome Companion explicit single-tab pilot", () => {
  it("does not accept internal browser pages, file URLs or invalid tabs", () => {
    for (const url of ["chrome://settings", "file:///tmp/a", "javascript:alert(1)"]) {
      expect(() => grantFor({id: 4, url})).toThrow(/Only an active HTTP/);
    }
    expect(() => grantFor({id: -1, url: "https://example.com"})).toThrow();
  });
  it("service worker ignores the private offscreen capture response channel", () => {
    let called=false;
    const result=listeners.message({channel:"owl-offscreen",type:"frame"}, {id:"owl-test-extension"},()=>{called=true;});
    expect(result).toBe(false);
    expect(called).toBe(false);
  });
  it("only grants after explicit attach from its own popup and never exposes URL path", async () => {
    expect((await command("status")).data.authorized).toBe(false);
    const before = await command("attach", {id: "another", url: "https://malicious.site"});
    expect(before).toMatchObject({ok: false, error: "UNTRUSTED_SENDER"});
    expect(stored.size).toBe(0);
    const attached = await command("attach");
    expect(attached).toMatchObject({ok:true,data:{authorized:true,tabId:42,origin:"https://www.reddit.com"}});
    expect(JSON.stringify(stored.get("owlAttachedTab"))).not.toContain("/settings/");
    expect(injected).toBe(0);
  });
  it("inspects only the authorized original tab while another tab is active", async () => {
    await command("attach");
    active = tabs.get(43);
    const result = await command("snapshot");
    expect(result).toMatchObject({ok:true,data:{tabId:42,origin:"https://www.reddit.com"}});
    expect(result.data.text).toHaveLength(5000);
    expect(result.data.controls[0].type).toBe("password");
    expect(injected).toBe(1);
    expect(tabs.get(43).url).toBe("https://other.example/");
  });
  it("revokes access on origin change, expiry, close or explicit disconnect", async () => {
    await command("attach");
    const changed = {...tabs.get(42), url:"https://accounts.google.com/"};
    tabs.set(42, changed);
    await listeners.updated(42, {url: changed.url}, changed);
    expect((await command("snapshot")).ok).toBe(false);
    expect(stored.size).toBe(0);

    tabs.set(42, active);
    await command("attach");
    stored.get("owlAttachedTab").expiresAt = Date.now() - 100;
    expect((await command("status")).data.authorized).toBe(false);
    await command("attach");
    await listeners.removed(42);
    expect((await command("status")).data.authorized).toBe(false);
    await command("attach");
    expect((await command("detach")).data.authorized).toBe(false);
    expect(stored.size).toBe(0);
  });
  it("requires explicit extension popup gesture to start independent tab capture", async () => {
    await command("attach");
    const start = await command("startCapture");
    expect(start).toMatchObject({ok:true,data:{capturing:true,tabId:42}});
    expect(stored.get("owlCaptureTab")).toBe(42);
    expect((await command("status")).data.capturing).toBe(true);
    await command("stopCapture");
    expect((await command("status")).data.capturing).toBe(false);
  });
  it("policy enforces origin and expiry, snapshots omit input values", () => {
    const tab = {id: 11, url:"https://reddit.com/user/a?token=private"};
    const grant = grantFor(tab, 0);
    expect(grantIsCurrent(grant, tab, 119999)).toBe(true);
    expect(grantIsCurrent(grant, tab, 120000)).toBe(false);
    expect(grantIsCurrent(grant, {id:12,url:tab.url}, 5)).toBe(false);
    expect(sanitizeSnapshot({url:tab.url,title:"hi",text:"abc",controls:[{tag:"input",type:"text",label:"Name",value:"SECRET"}]}).controls[0]).not.toHaveProperty("value");
  });
  it("extension declares no debugger, cookies, website host access or external inbound bridge", async () => {
    const manifest = JSON.parse(await fs.readFile(new URL("../chrome-companion/manifest.json", import.meta.url),"utf8"));
    expect(manifest.permissions.sort()).toEqual(["activeTab","scripting","storage","alarms","tabCapture","offscreen"].sort());
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*"]);
    expect(manifest.optional_permissions).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
  });
});
