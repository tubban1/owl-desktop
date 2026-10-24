import {grantFor, grantIsCurrent, sanitizeSnapshot} from "./permission-policy.mjs";

const KEY = "owlAttachedTab";
async function readGrant() {
  const record = await chrome.storage.session.get(KEY);
  return record[KEY] ?? null;
}
async function revoke() { await chrome.storage.session.remove(KEY); }

async function authorizedTab() {
  const grant = await readGrant();
  if (!grant) throw new Error("No tab authorized. Click Attach on the page first.");
  let tab;
  try { tab = await chrome.tabs.get(grant.tabId); }
  catch { await revoke(); throw new Error("Authorized tab has closed."); }
  if (!grantIsCurrent(grant, tab)) {
    await revoke();
    throw new Error("Authorization expired or the tab changed website.");
  }
  return tab;
}

// Static injection: no eval, no injected remote scripts or arbitrary JS.
function readVisiblePage() {
  const visible = el => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      rect.width > 0 && rect.height > 0;
  };
  const controls = [...document.querySelectorAll("button,input,textarea,select")]
    .filter(visible).slice(0, 50).map(el => ({
      tag: el.tagName.toLowerCase(), type: el.getAttribute("type"),
      label: el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
        el.getAttribute("name") || (el.textContent || "").trim()
    }));
  return {url: location.href, title: document.title,
    text: (document.body?.innerText || "").slice(0, 5000), controls};
}

async function execute(command) {
  switch (command.op) {
    case "status": {
      const grant = await readGrant();
      if (!grant) return {authorized: false};
      try {
        const tab = await authorizedTab();
        return {authorized: true, tabId: tab.id,
          origin: grant.origin, expiresAt: grant.expiresAt};
      } catch { return {authorized: false}; }
    }
    case "attach": {
      // The popup (triggered by a user clicking the extension action)
      // supplies the actively selected tab. Never take an arbitrary ID.
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      const grant = grantFor(tab);
      await chrome.storage.session.set({[KEY]: grant});
      return {authorized: true, tabId: grant.tabId,
        origin: grant.origin, expiresAt: grant.expiresAt};
    }
    case "snapshot": {
      const tab = await authorizedTab();
      const results = await chrome.scripting.executeScript({
        target: {tabId: tab.id}, func: readVisiblePage
      });
      const payload = results?.[0]?.result;
      if (!payload || new URL(payload.url).origin !== new URL(tab.url).origin) {
        await revoke();
        throw new Error("Tab changed origin while being inspected.");
      }
      return {tabId: tab.id, ...sanitizeSnapshot(payload)};
    }
    case "detach": {
      await revoke();
      return {authorized: false};
    }
    default: throw new Error("Unsupported companion command.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only trusted extension pages may send commands. No content-script
  // or externally_connectable bridge is registered in this pilot.
  if (sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL("popup.html"))) {
    respond({ok: false, error: "UNTRUSTED_SENDER"});
    return false;
  }
  Promise.resolve().then(() => execute(message || {}))
    .then(data => respond({ok: true, data}))
    .catch(error => respond({ok: false, error: String(error?.message || error)}));
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const grant = await readGrant();
  if (grant?.tabId === tabId) await revoke();
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const grant = await readGrant();
  if (grant?.tabId === tabId &&
      changeInfo.url && !grantIsCurrent(grant, tab)) await revoke();
});
