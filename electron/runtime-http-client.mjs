const API_VERSION = "0.1";

export class RuntimeHttpClient {
  constructor({ baseUrl, sessionId, token }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.sessionId = sessionId;
    this.token = token;
  }

  async invoke(method, params, timeoutMs = 3500) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const requestId = `desktop:${Date.now().toString(36)}:${crypto.randomUUID()}`;
    try {
      const response = await fetch(`${this.baseUrl}/runtime/v${API_VERSION}/rpc`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-owl-session-id": this.sessionId,
          "x-owl-request-id": requestId,
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
        throw error;
      }
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async info() {
    const info = await this.invoke("info");
    return { ...info, transport: "http" };
  }
  health() { return this.invoke("health", { op: "status" }); }
  tasks() { return this.invoke("tasks.list"); }
  approvals() { return this.invoke("approvals.list", {}); }
  processes() { return this.invoke("process", { op: "list" }); }
  diagnostics(auditLimit = 40) { return this.invoke("diagnostics.get", { auditLimit }, 5000); }
}
