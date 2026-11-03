/* Shared, environment-agnostic guard. Synthetic data ONLY. */
(function (root) {
  "use strict";
  const idPattern = /^DEMO-(?:PAT|VIS|CLN)-[A-Z0-9-]{1,24}$/;
  const normalize = (value) => typeof value === "string" ? value.trim() : "";

  function capture(fields) {
    const patientId = normalize(fields?.patientId);
    const visitId = normalize(fields?.visitId);
    const clinicianId = normalize(fields?.clinicianId);
    if (!idPattern.test(patientId) || !patientId.startsWith("DEMO-PAT-")) {
      return { ok: false, reason: "INVALID_DEMO_PATIENT" };
    }
    if (!idPattern.test(visitId) || !visitId.startsWith("DEMO-VIS-")) {
      return { ok: false, reason: "INVALID_DEMO_VISIT" };
    }
    if (!idPattern.test(clinicianId) || !clinicianId.startsWith("DEMO-CLN-")) {
      return { ok: false, reason: "INVALID_DEMO_CLINICIAN" };
    }
    return { ok: true, context: Object.freeze({ patientId, visitId, clinicianId }) };
  }

  function authorizeDraft(snapshot, now, note, existingText, fieldEnabled) {
    if (!snapshot || !snapshot.ok) return { ok: false, reason: "NO_CAPTURED_CONTEXT" };
    const current = capture(now);
    if (!current.ok) return { ok: false, reason: "CONTEXT_INVALID" };
    if (Object.keys(snapshot.context).some((key) => snapshot.context[key] !== current.context[key])) {
      return { ok: false, reason: "CONTEXT_CHANGED" };
    }
    if (fieldEnabled !== true) return { ok: false, reason: "NOTE_FIELD_UNAVAILABLE" };
    if (typeof existingText !== "string" || existingText.trim() !== "") {
      return { ok: false, reason: "REFUSE_OVERWRITE" };
    }
    if (typeof note !== "string" || note.length < 10 || note.length > 1500 ||
        !note.startsWith("[SYNTHETIC DEMO]")) {
      return { ok: false, reason: "DRAFT_NOT_SYNTHETIC" };
    }
    return { ok: true, reason: "REVIEW_BEFORE_SAVE" };
  }

  const api = Object.freeze({ capture, authorizeDraft });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.OwlDemoGuard = api;
})(globalThis);
