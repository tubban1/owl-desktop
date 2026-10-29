// Native HTML <select> support for an observed Agent-owned control.
// Only an exact, unambiguous option label/value may be selected. Never sends
// credentials, submits forms, or claims site persistence.
export function selectTrustedAgentOption(uid, expected, expectedOrigin) {
  if (typeof location === "undefined" || location.origin !== expectedOrigin)
    return {error: "SELECT_ORIGIN_MISMATCH"};
  if (!/^owl-agent-\d{1,3}$/.test(uid) ||
      typeof expected !== "string" || !expected.trim() || expected.length > 240)
    return {error: "SELECT_ARGUMENT_INVALID"};
  const selector = '[data-owl-agent-control="' + uid + '"]';
  const find = (root,depth=0) => {
    if (depth > 8) return null;
    const hit = root.querySelector(selector);
    if (hit) return hit;
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) {
        const nested = find(host.shadowRoot,depth+1);
        if (nested) return nested;
      }
    }
    return null;
  };
  const el = find(document);
  if (!el || el.tagName?.toLowerCase() !== "select")
    return {error: "SELECT_TARGET_INVALID"};
  const label = (el.getAttribute("aria-label") ||
    el.getAttribute("name") || el.labels?.[0]?.textContent ||
    el.textContent || "").trim();
  const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
  if (el.disabled || el.multiple || el.closest("[inert],[aria-disabled=true]") ||
      /password|cc-|otp|secret|token|passkey|payment|checkout|delete account|remove account|security settings/i.test(label + " " + auto))
    return {error: "SELECT_SENSITIVE_OR_DISABLED"};
  const options = Array.from(el.options || []);
  const matches = options.filter(x => !x.disabled &&
    (x.value === expected || x.textContent.trim() === expected));
  if (matches.length !== 1 || !matches[0].value)
    return {error: "SELECT_OPTION_NOT_UNIQUE_OR_AVAILABLE"};
  const choice = matches[0];
  const index = options.indexOf(choice);
  // The native setter is observable to React/Vue; dispatch both change
  // events but do not simulate a submit, click, or navigation.
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value")?.set;
  if (!setter) return {error:"SELECT_NATIVE_SETTER_UNAVAILABLE"};
  setter.call(el,choice.value);
  if (el.selectedIndex !== index || el.value !== choice.value)
    return {error:"SELECT_DOM_UPDATE_NOT_CONFIRMED"};
  el.dispatchEvent(new Event("input",{bubbles:true}));
  el.dispatchEvent(new Event("change",{bubbles:true}));
  return {selected:true,domVerified:true,websitePersisted:false,uid,
    label:choice.textContent.trim().slice(0,125)};
}
