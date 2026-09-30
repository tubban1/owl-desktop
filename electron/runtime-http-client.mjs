const API_VERSION = "0.1";

export class RuntimeHttpClient {
  constructor({ baseUrl, sessionId, token }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.sessionId = sessionId;
    this.token = token;
  }

  async invoke(method, params, options = {}) {
    const normalized =
      typeof options === "number" ? { timeoutMs: options } : options;
    const timeoutMs = normalized.timeoutMs ?? 3500;
    const controller = new AbortController();
    const onAbort = () => controller.abort(normalized.signal?.reason);
    normalized.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error(`Runtime request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    const requestId =
      normalized.requestId ??
      `desktop:${Date.now().toString(36)}:${crypto.randomUUID()}`;
    try {
      const response = await fetch(`${this.baseUrl}/runtime/v${API_VERSION}/rpc`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-owl-session-id": this.sessionId,
          "x-owl-request-id": requestId,
          ...(normalized.idempotencyKey
            ? { "x-owl-idempotency-key": normalized.idempotencyKey }
            : {}),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          id: requestId,
          method,
          ...(params === undefined ? {} : { params }),
        }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        const error = new Error(payload?.error?.message ?? `OWL Runtime HTTP ${response.status}`);
        error.code = payload?.error?.code ?? `HTTP_${response.status}`;
        error.runtimeResponded = true;
        error.httpStatus = response.status;
        error.requestId = requestId;
        throw error;
      }
      return payload.result;
    } finally {
      clearTimeout(timeout);
      normalized.signal?.removeEventListener("abort", onAbort);
    }
  }

  async info() {
    const info = await this.invoke("info");
    return { ...info, transport: "http" };
  }
  health() { return this.invoke("health", { op: "status" }); }
  listEvents(request = {}) {
    return this.invoke("events.list", request, {
      timeoutMs: 10_000,
    });
  }
  tasks() { return this.invoke("tasks.list"); }
  approvals() { return this.invoke("approvals.list", {}); }
  processes() { return this.invoke("process", { op: "list" }); }
  diagnostics(auditLimit = 40) { return this.invoke("diagnostics.get", { auditLimit }, 5000); }
  capabilities(goal = "") { return this.invoke("capabilities.get", { goal }, 5000); }
  primitiveCatalog() { return this.invoke("primitives.catalog", undefined, 5000); }
  skillCatalog() { return this.invoke("skills.catalog", undefined, 5000); }
  runSkill(request, options = {}) {
    return this.invoke("skill.run", request, {
      timeoutMs: options.timeoutMs ?? 30_000,
      signal: options.signal,
      requestId: options.requestId,
    });
  }
  createTask(request, options = {}) {
    return this.invoke("tasks.create", request, {
      timeoutMs: options.timeoutMs ?? 15_000,
      signal: options.signal,
      requestId: options.requestId,
    });
  }

  discoverWorkflowSkillCandidates(request = {}) {
    return this.invoke("skill-candidates.discover-workflows", request, {
      timeoutMs: 15_000,
    });
  }

  submitSkillCandidate(manifest) {
    return this.invoke("skill-candidates.submit", { manifest }, {
      timeoutMs: 15_000,
    });
  }

  listSkillCandidates() {
    return this.invoke("skill-candidates.list", undefined, {
      timeoutMs: 10_000,
    });
  }

  getSkillCandidate(candidateId) {
    return this.invoke("skill-candidates.get", { candidateId }, {
      timeoutMs: 10_000,
    });
  }

  reviseSkillCandidate(candidateId, expectedDigest, manifest) {
    return this.invoke("skill-candidates.revise", {
      candidateId,
      expectedDigest,
      manifest,
    }, {
      timeoutMs: 15_000,
    });
  }

  validateSkillCandidate(candidateId, expectedDigest) {
    return this.invoke("skill-candidates.validate", {
      candidateId,
      ...(expectedDigest ? { expectedDigest } : {}),
    }, {
      timeoutMs: 15_000,
    });
  }

  dismissSkillCandidate(candidateId, expectedDigest) {
    return this.invoke("skill-candidates.dismiss", {
      candidateId,
      ...(expectedDigest ? { expectedDigest } : {}),
    }, {
      timeoutMs: 10_000,
    });
  }

  compileSkillCandidateTest(candidateId, expectedDigest, inputs = {}) {
    return this.invoke("skill-candidates.compile-test", {
      candidateId,
      expectedDigest,
      inputs,
    }, {
      timeoutMs: 20_000,
    });
  }

  inspectSkillCandidate(candidateId, testTaskId) {
    return this.invoke("skill-candidates.inspect", {
      candidateId,
      ...(testTaskId ? { testTaskId } : {}),
    }, {
      timeoutMs: 15_000,
    });
  }

  promoteSkillCandidate(candidateId, expectedDigest, testTaskId, confirm) {
    return this.invoke("skill-candidates.promote", {
      candidateId,
      expectedDigest,
      testTaskId,
      confirm,
    }, {
      timeoutMs: 30_000,
    });
  }

  listUserSkills() {
    return this.invoke("user-skills.list", undefined, {
      timeoutMs: 10_000,
    });
  }

  getUserSkill(skillId) {
    return this.invoke("user-skills.get", { skillId }, {
      timeoutMs: 10_000,
    });
  }

  setUserSkillEnabled(skillId, enabled) {
    return this.invoke(enabled ? "user-skills.enable" : "user-skills.disable", {
      skillId,
    }, {
      timeoutMs: 10_000,
    });
  }

  activateUserSkillVersion(skillId, version) {
    return this.invoke("user-skills.activate-version", {
      skillId,
      version,
    }, {
      timeoutMs: 10_000,
    });
  }

  rollbackUserSkill(skillId, version) {
    return this.invoke("user-skills.rollback", {
      skillId,
      ...(version ? { version } : {}),
    }, {
      timeoutMs: 10_000,
    });
  }

  uninstallUserSkill(skillId, version) {
    return this.invoke("user-skills.uninstall", {
      skillId,
      ...(version ? { version } : {}),
    }, {
      timeoutMs: 15_000,
    });
  }

  startTask(taskId, options = {}) {
    const { timeoutMs, requestId, idempotencyKey, ...request } = options;
    return this.invoke("tasks.start", { taskId, ...request }, {
      timeoutMs: timeoutMs ?? 15_000,
      requestId,
      idempotencyKey,
    });
  }

  runTask(taskId, options = {}) {
    const { timeoutMs, requestId, idempotencyKey, ...request } = options;
    return this.invoke("tasks.run", { taskId, ...request }, {
      timeoutMs: timeoutMs ?? 120_000,
      requestId,
      idempotencyKey,
    });
  }

  getTask(taskId, includeResults = false) {
    return this.invoke("tasks.get", { taskId, includeResults }, {
      timeoutMs: 10_000,
    });
  }
}
