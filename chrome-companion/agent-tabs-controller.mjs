import { AGENT_SITE_GRANT_MS, MAX_AGENT_TABS, permittedOrigin, originPattern,
  validSiteGrant, isAgentTab } from "./agent-tab-policy.mjs";

// Scoped to the paired local Companion session, not to every Chrome window.
// Only the popup's deliberate permission request may enable site autonomy.
export function createAgentTabController(chrome, { get, put, clear }) {
  const SITE = "owlAgentSiteGrant", TABS = "owlAgentTabs", ACTIVE = "owlAgentActiveTab", MODE = "owlAgentMode";
  const list = async () => (await get(TABS)) || [];
  const grant = async () => await get(SITE);
  async function requireGrant(url) {
    const item = await grant();
    if (!validSiteGrant(item, url)) throw new Error("AGENT_SITE_AUTHORIZATION_REQUIRED");
    const allowed = await chrome.permissions.contains({ origins: [originPattern(url)] });
    if (!allowed) {
      await clear(SITE);
      throw new Error("AGENT_SITE_CHROME_PERMISSION_REVOKED");
    }
    return item;
  }
  async function authorize(origin) {
    const normalized = permittedOrigin(origin);
    if (!normalized) throw new Error("INVALID_AGENT_SITE_ORIGIN");
    // No permission request here. Only the popup may call
    // permissions.request directly from an actual human click.
    await requireHostPermission(normalized);
    const previous=await grant();
    await put(SITE, {origin: normalized, expiresAt: Date.now() + AGENT_SITE_GRANT_MS});
    if(previous?.origin!==normalized){
      // Changing sites drops the prior Agent workspace; renewing the same
      // site must not silently fall back to the user's foreground tab.
      await clear(TABS);
      await clear(ACTIVE);
      await clear(MODE);
    }
    return {authorized: true, origin: normalized, expiresAt: Date.now() + AGENT_SITE_GRANT_MS};
  }
  async function requireHostPermission(origin) {
    if (!await chrome.permissions.contains({origins:[originPattern(origin)]})) {
      throw new Error("AGENT_SITE_CHROME_PERMISSION_REQUIRED");
    }
  }
  async function open(url) {
    const targetOrigin = permittedOrigin(url);
    if (!targetOrigin) throw new Error("AGENT_URL_NOT_ALLOWED");
    await requireGrant(url);
    const current = await list();
    if (current.length >= MAX_AGENT_TABS) throw new Error("AGENT_TAB_LIMIT_REACHED");
    const tab = await chrome.tabs.create({url,active:false});
    if (!Number.isInteger(tab?.id)) throw new Error("AGENT_TAB_CREATION_FAILED");
    const record = {tabId:tab.id, origin:targetOrigin,createdAt:Date.now()};
    await put(TABS, [...current,record]);
    await put(ACTIVE,record.tabId);
    await put(MODE,true);
    return {tabId:tab.id,url,origin:targetOrigin,background:true,
      guidance:"Tab opened in background. Use snapshot; request user login only if authorization is needed."};
  }
  async function active() {
    const selected = await get(ACTIVE);
    if (!Number.isInteger(selected)) {
      if(await get(MODE))throw new Error("AGENT_TAB_NOT_SELECTED");
      return null;
    }
    const record = (await list()).find(x=>x.tabId===selected);
    if (!record) { await clear(ACTIVE);return null; }
    let tab;
    try { tab = await chrome.tabs.get(record.tabId); }
    catch { await remove(record.tabId);return null; }
    const item = await grant();
    if (!isAgentTab(record,tab,item)) {
      // The website may have redirected to SSO/2FA. NEVER inject scripts
      // into a different origin without an explicit new permission grant.
      if (!validSiteGrant(item,record.origin)) throw new Error("AGENT_SITE_AUTHORIZATION_REQUIRED");
      return {tab,record,loginRequired:true,
        message:"Agent tab left its approved website. The user may need to sign in or approve access."};
    }
    await requireGrant(tab.url);
    return {tab,record,loginRequired:false};
  }
  async function tabs() {
    const results=[];
    for (const entry of await list()) {
      try {
        const tab=await chrome.tabs.get(entry.tabId);
        const allowed=permittedOrigin(tab.url)===entry.origin;
        results.push({tabId:entry.tabId,origin:entry.origin,
          currentOrigin:permittedOrigin(tab.url),loginRequired:!allowed,
          active:entry.tabId===(await get(ACTIVE))});
      } catch { /* a closed tab may be pruned on next selection */ }
    }
    return results;
  }
  async function select(tabId) {
    const entry=(await list()).find(x=>x.tabId===tabId);
    if(!entry) throw new Error("AGENT_TAB_NOT_OWNED");
    await put(ACTIVE,tabId);
    const state=await active();
    return {tabId,origin:entry.origin,loginRequired:Boolean(state?.loginRequired),
      background:true};
  }
  async function focusForLogin() {
    const state=await active();
    if(!state) throw new Error("AGENT_TAB_NOT_SELECTED");
    // Only exposed to a human clicking in the Companion popup.
    await chrome.tabs.update(state.tab.id,{active:true});
    return {tabId:state.tab.id,userActionRequired:true};
  }
  async function close(tabId) {
    const entry=(await list()).find(x=>x.tabId===tabId);
    if(!entry)throw new Error("AGENT_TAB_NOT_OWNED");
    await requireGrant(entry.origin);
    await chrome.tabs.remove(tabId);
    await remove(tabId);
    return {closed:true,tabId,foregroundUnchanged:true};
  }
  async function remove(tabId) {
    const original=await list();
    if (!original.some(x=>x.tabId===tabId)) return;
    const remaining=original.filter(x=>x.tabId!==tabId);
    await put(TABS,remaining);
    if(await get(ACTIVE)===tabId)await clear(ACTIVE);
  }
  async function revoke() {
    await clear(SITE);
    await clear(ACTIVE);
    await clear(MODE);
    // Leave the user's Chrome tabs open; this only removes agent authority.
    await clear(TABS);
  }
  async function status() {
    const item=await grant();
    if(!item||item.expiresAt<=Date.now()) return {enabled:false,tabs:0};
    return {enabled:true,origin:item.origin,expiresAt:item.expiresAt,
      tabs:(await list()).length};
  }
  return {authorize,open,active,tabs,select,focusForLogin,close,remove,revoke,status,requireGrant};
}
