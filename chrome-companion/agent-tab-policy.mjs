// A site grant authorizes agent-created background tabs at one precise origin.
// Chrome host permission is granted separately through a direct human gesture.
export const AGENT_SITE_GRANT_MS = 30 * 60 * 1000;
export const MAX_AGENT_TABS = 10;
export function permittedOrigin(input) {
  try {
    const value = new URL(input);
    if (!["https:", "http:"].includes(value.protocol) ||
      value.username || value.password) return null;
    return value.origin;
  } catch { return null; }
}
export function originPattern(input) {
  const origin = permittedOrigin(input);
  if (!origin) throw new Error("Invalid HTTP(S) website for agent authorization.");
  // Chrome match patterns cannot encode ports. Runtime grant checks still
  // compare the full origin (including port) before each action.
  const url=new URL(origin);
  return url.protocol+"//"+url.hostname+"/*";
}
export function validSiteGrant(grant, url, now = Date.now()) {
  return Boolean(grant && grant.origin === permittedOrigin(url) &&
    Number.isFinite(grant.expiresAt) && now < grant.expiresAt);
}
export function isAgentTab(record, tab, grant, now = Date.now()) {
  return Boolean(record && tab && tab.id === record.tabId &&
    validSiteGrant(grant, tab.url, now) &&
    record.origin === permittedOrigin(tab.url));
}
