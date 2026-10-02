export class ConnectionHostClient {
  constructor({ baseUrl, token, fetchImpl = fetch } = {}) {
    if (!baseUrl) throw new Error("ConnectionHostClient requires baseUrl.");
    if (!token) throw new Error("ConnectionHostClient requires token.");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(path, { method = "GET", body } = {}) {
    const response = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      const error = new Error(
        payload?.error?.message ||
          `OWL Connection Host failed with HTTP ${response.status}.`,
      );
      error.code = payload?.error?.code || "CONNECTION_HOST_REQUEST_FAILED";
      throw error;
    }
    return payload?.result ?? payload;
  }

  health() {
    return this.request("/health");
  }

  startTunnel(config) {
    return this.request("/tunnel/start", { method: "POST", body: config });
  }

  restartTunnel(config) {
    return this.request("/tunnel/restart", { method: "POST", body: config });
  }

  stopTunnel() {
    return this.request("/tunnel/stop", { method: "POST" });
  }
}
