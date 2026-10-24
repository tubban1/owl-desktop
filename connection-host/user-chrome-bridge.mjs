import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MAX_TABS_PER_OWNER = 12;
const MAX_GLOBAL_TABS = 48;
const MAX_RESULT_CHARS = 40_000;
const ALLOWED_URL = /^https?:\/\//i;

function fail(code, detail = "") {
  const error = new Error(detail ? code + ": " + detail : code);
  error.code = code;
  return error;
}

export function pageText(result) {
  return (result?.content || [])
    .filter(item => item.type === "text")
    .map(item => item.text || "")
    .join("\n");
}

export function parseChromePages(result) {
  const pages = [];
  for (const line of pageText(result).split(/\r?\n/)) {
    const match = /^\s*(\d+):\s+(\S.*?)(?:\s+\[selected\])?\s*$/.exec(line);
    if (match) pages.push({ pageId: Number(match[1]), url: match[2].replace(/\s+\[selected\]$/, "") });
  }
  return pages;
}

// Chrome's own per-connection consent gates the DevTools connection. This
// shared Host client stays alive between OWL Agent Sessions. Never copy Chrome
// cookies or attach arbitrary existing human pages to an Agent Session.
export function createUserChromeBridge({connect = defaultConnect} = {}) {
  let client = null, connecting = null;
  let serial = Promise.resolve();
  const owned = new Map(); // pageId -> OWL stable owner
  const selected = new Map(); // OWL owner -> pageId
  const lastSnapshot = new Map(); // OWL owner -> last a11y snapshot

  function requireOwner(owner) {
    if (typeof owner !== "string" || !owner.trim() || owner.length > 220) {
      throw fail("CHROME_OWNER_REQUIRED");
    }
  }
  function requireOwned(owner, pageId) {
    requireOwner(owner);
    if (!Number.isInteger(pageId) || owned.get(pageId) !== owner) {
      throw fail("CHROME_AGENT_TAB_NOT_OWNED");
    }
  }
  async function ready() {
    if (client) return client;
    if (!connecting) {
      connecting = Promise.resolve().then(connect).then(c => {
        if (!c?.callTool) throw fail("CHROME_NATIVE_MCP_UNAVAILABLE");
        client = c;
        return c;
      }).catch(error => {
        connecting = null;
        throw error;
      });
    }
    return connecting;
  }
  async function invoke(name, args = {}, timeoutMs = 70_000) {
    const target = await ready();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await target.callTool(
        { name, arguments: args }, undefined, { signal: controller.signal },
      );
      if (response?.isError) throw fail("CHROME_DEVTOOLS_TOOL_FAILED", pageText(response).slice(0,650));
      return response;
    } catch(error) {
      if (controller.signal.aborted) throw fail("CHROME_CONNECTION_APPROVAL_OR_TOOL_TIMEOUT",
        "Enable chrome://inspect/#remote-debugging and approve Chrome's connection prompt; try again.");
      throw error;
    } finally {clearTimeout(timer);}
  }
  function withLock(operation) {
    const done = serial.then(operation, operation);
    serial = done.catch(() => undefined);
    return done;
  }
  async function pageList() {
    return parseChromePages(await invoke("list_pages", {}, 30_000));
  }
  async function open(owner, url) {
    requireOwner(owner);
    if (typeof url !== "string" || !ALLOWED_URL.test(url) || url.length > 2048) {
      throw fail("CHROME_URL_INVALID");
    }
    return withLock(async () => {
      if ([...owned.values()].filter(x => x === owner).length >= MAX_TABS_PER_OWNER ||
        owned.size >= MAX_GLOBAL_TABS) throw fail("CHROME_AGENT_TAB_LIMIT");
      const before = new Set((await pageList()).map(x => x.pageId));
      await invoke("new_page", { url, background: true }, 80_000);
      const created = (await pageList()).filter(x => !before.has(x.pageId));
      if (created.length !== 1) {
        throw fail("CHROME_NEW_TAB_AMBIGUOUS",
          "The user may have opened another tab concurrently; no tab was claimed.");
      }
      const tab = created[0];
      owned.set(tab.pageId, owner);
      selected.set(owner, tab.pageId);
      lastSnapshot.delete(owner);
      return { pageId: tab.pageId, url: tab.url, background: true,
        loginHandoff: "User may click Focus for Login to complete CAPTCHA/SSO, then Agent resumes same tab.",
        usesExistingChromeProfile: true };
    });
  }
  async function tabs(owner) {
    requireOwner(owner);
    const current = await pageList();
    const pages = current.filter(x => owned.get(x.pageId) === owner);
    return { tabs: pages.map(x => ({...x, selected: x.pageId === selected.get(owner)})) };
  }
  async function use(owner, pageId) {
    requireOwned(owner, pageId);
    if (!(await pageList()).some(x => x.pageId === pageId)) {
      owned.delete(pageId);
      throw fail("CHROME_AGENT_TAB_CLOSED");
    }
    selected.set(owner, pageId);
    lastSnapshot.delete(owner);
    return {pageId,selected:true,foregroundUnchanged:true};
  }
  function active(owner) {
    requireOwner(owner);
    const id = selected.get(owner);
    requireOwned(owner, id);
    return id;
  }
  async function snapshot(owner) {
    const id = active(owner);
    const result = await invoke("take_snapshot", {pageId:id}, 45_000);
    const text = pageText(result).slice(0,MAX_RESULT_CHARS);
    lastSnapshot.set(owner,{pageId:id,text});
    return {pageId:id,snapshot:text};
  }
  async function fill(owner, uid, value) {
    const id=active(owner);
    if (typeof uid!=="string"||!uid||uid.length>180||
      typeof value!=="string"||value.length>4000)throw fail("CHROME_FILL_ARGUMENT_INVALID");
    const snap=lastSnapshot.get(owner);
    const line=snap?.pageId===id ? snap.text.split("\n").find(l=>l.includes("uid="+uid+" ")) : null;
    if (!line)throw fail("CHROME_SNAPSHOT_REQUIRED");
    if (/password|passkey|one.time.code|verification code|credit.card|cc.number|cvv|secret|token|api.key/i.test(line)) {
      throw fail("CHROME_CREDENTIAL_FIELD_REQUIRES_HUMAN");
    }
    const response=await invoke("fill",{pageId:id,uid,value},45_000);
    return {pageId:id,filled:true,response:pageText(response).slice(0,2500)};
  }
  async function click(owner, uid) {
    const id=active(owner);
    if(typeof uid!=="string"||!uid||uid.length>180)throw fail("CHROME_CLICK_ARGUMENT_INVALID");
    const snap=lastSnapshot.get(owner);
    const line=snap?.pageId===id ? snap.text.split("\n").find(l=>l.includes("uid="+uid+" ")) : null;
    if(!line)throw fail("CHROME_SNAPSHOT_REQUIRED");
    if(/delete|destroy|purchase|checkout|payment|transfer|password|logout|sign.out|disable account/i.test(line)) {
      throw fail("CHROME_CONSEQUENTIAL_ACTION_REQUIRES_HUMAN");
    }
    const response=await invoke("click",{pageId:id,uid},45_000);
    lastSnapshot.delete(owner);
    return {pageId:id,clicked:true,response:pageText(response).slice(0,2500)};
  }
  async function screenshot(owner) {
    const id=active(owner);
    const result=await invoke("take_screenshot",{pageId:id,format:"jpeg",quality:70},60_000);
    const imgs=(result.content||[]).filter(x=>x.type==="image" &&
      /^image\/(jpeg|png|webp)$/.test(x.mimeType||"") &&
      typeof x.data==="string" && x.data.length<5_000_000);
    if(imgs.length!==1) throw fail("CHROME_SCREENSHOT_NOT_RETURNED");
    return {pageId:id,image:imgs[0]};
  }
  async function focusForLogin(owner) {
    const id=active(owner);
    await invoke("select_page",{pageId:id,bringToFront:true},30_000);
    return {pageId:id,waitingForHumanLogin:true,
      instruction:"Complete sign-in, CAPTCHA or 2FA in this Chrome tab, then tell OWL to continue."};
  }
  async function closeTab(owner,pageId) {
    requireOwned(owner,pageId);
    await invoke("close_page",{pageId},30_000);
    owned.delete(pageId);
    if(selected.get(owner)===pageId)selected.delete(owner);
    lastSnapshot.delete(owner);
    return {pageId,closed:true};
  }
  async function status() {return {connected:!!client,mode:"chrome-native-autoconnect",
    ownedTabs:owned.size,needsUserChromeApproval:!client};}
  async function close() {
    const closing=client;
    client=null;connecting=null;owned.clear();selected.clear();lastSnapshot.clear();
    await closing?.close?.().catch(()=>{});
  }
  return {open,tabs,use,snapshot,fill,click,screenshot,focusForLogin,closeTab,status,close};
}

async function defaultConnect() {
  const client=new Client({name:"owl-user-chrome",version:"1.0.0"});
  const cli=process.env.OWL_CHROME_DEVTOOLS_MCP_CLI?.trim();
  const transport=new StdioClientTransport({
    command:cli?process.execPath:"npx",
    args:cli
      ? [cli,"--autoConnect","--no-usage-statistics","--no-performance-crux"]
      : ["-y","chrome-devtools-mcp@1.11.0","--autoConnect",
         "--no-usage-statistics","--no-performance-crux"],
    env:process.env,
    stderr:"pipe",
  });
  await client.connect(transport);
  return client;
}
