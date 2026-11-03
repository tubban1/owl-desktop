/* Local-only DOM adapter. Never submits or sends data anywhere. */
(() => {
  "use strict";
  if (location.origin !== "http://127.0.0.1:8765") return;
  const guard = globalThis.OwlDemoGuard;
  if (!guard) return;
  const select = (name) => document.querySelector('[data-demo-field="' + name + '"]');
  const contextFromPage = () => ({
    patientId: select("patientId")?.value ?? "",
    visitId: select("visitId")?.value ?? "",
    clinicianId: select("clinicianId")?.value ?? ""
  });

  const host = document.createElement("div");
  host.id = "owl-demo-adapter-panel";
  const shadow = host.attachShadow({mode: "closed"});
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel { position:fixed; right:18px; bottom:18px; z-index:2147483600;
        width:300px; padding:16px; border-radius:12px; color:#f8fafc;
        background:#152238; box-shadow:0 10px 28px #0004; font:14px/1.5 system-ui; }
      strong { font-size:15px; } small { color:#aebccd; }
      button { margin-top:9px; width:100%; padding:9px; border:0; border-radius:8px;
        background:#dbeafe; color:#14243f; font-weight:650; cursor:pointer; }
      button:focus-visible { outline:3px solid #fbbf24; }
      #status { margin-top:9px; min-height:30px; color:#e2e8f0; }
    </style>
    <div class="panel" role="region" aria-label="OWL LAB local demo adapter">
      <strong>OWL LAB | SaaS Bridge Demo</strong>
      <p><small>Synthetic local-only reference. No AI, network transfer or automatic saving.</small></p>
      <button id="capture" type="button">1. Capture demo context</button>
      <button id="insert" type="button">2. Insert synthetic draft</button>
      <div id="status" role="status" aria-live="polite">Ready. All data stays on this computer.</div>
    </div>`;
  document.documentElement.appendChild(host);
  const status = (message) => { shadow.getElementById("status").textContent = message; };
  let captured = null;
  shadow.getElementById("capture").addEventListener("click", () => {
    captured = guard.capture(contextFromPage());
    status(captured.ok ? "Demo context captured. Review the target record before inserting."
      : "Blocked: " + captured.reason);
  });
  shadow.getElementById("insert").addEventListener("click", () => {
    const target = select("note");
    const note = "[SYNTHETIC DEMO] Example draft for workflow illustration only. Not medical advice. Review and edit before saving.";
    const result = guard.authorizeDraft(
      captured, contextFromPage(), note, target?.value,
      Boolean(target instanceof HTMLTextAreaElement && !target.disabled && !target.readOnly)
    );
    if (!result.ok) return status("Blocked: " + result.reason);
    // Native input setter triggers controlled React-style host listeners.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) return status("Blocked: native input setter unavailable");
    setter.call(target, note);
    target.dispatchEvent(new Event("input", {bubbles:true}));
    target.dispatchEvent(new Event("change", {bubbles:true}));
    if (target.value !== note) return status("Blocked: target field was not updated");
    status("Draft inserted into the demo form. Operator review and Save required.");
  });
})();
