export class CloudHttpError extends Error {
  constructor(message, { status = 0, code = "CLOUD_HTTP_ERROR" } = {}) {
    super(message);
    this.name = "CloudHttpError";
    this.status = status;
    this.code = code;
  }
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("OWL Cloud base URL is not configured.");
  const parsed = new URL(baseUrl);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("OWL Cloud base URL must use HTTP or HTTPS.");
  }
  return baseUrl;
}

export class CloudHttpClient {
  constructor({
    baseUrl,
    deviceCredential,
    fetchImpl = fetch,
    timeoutMs = 8_000,
  }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.deviceCredential = deviceCredential;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(path, {
    method = "GET",
    body,
    auth = "none",
    userJwt,
    timeoutMs = this.timeoutMs,
  } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`OWL Cloud request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    try {
      const headers = { accept: "application/json" };
      if (body !== undefined) headers["content-type"] = "application/json";

      if (auth === "device") {
        if (!this.deviceCredential) {
          throw new CloudHttpError("OWL Cloud device credential is not configured.", {
            code: "DEVICE_CREDENTIAL_MISSING",
          });
        }
        headers.authorization = `Device ${this.deviceCredential}`;
      } else if (auth === "user") {
        if (!userJwt) {
          throw new CloudHttpError("OWL Cloud user JWT is required.", {
            code: "USER_JWT_MISSING",
          });
        }
        headers.authorization = `Bearer ${userJwt}`;
      }

      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new CloudHttpError(`OWL Cloud returned non-JSON HTTP ${response.status}.`, {
            status: response.status,
            code: `HTTP_${response.status}`,
          });
        }
      }

      if (!response.ok) {
        throw new CloudHttpError(
          payload?.message ?? `OWL Cloud HTTP ${response.status}`,
          {
            status: response.status,
            code: payload?.error ?? `HTTP_${response.status}`,
          },
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof CloudHttpError) throw error;
      if (controller.signal.aborted || error?.name === "AbortError") {
        throw new CloudHttpError("OWL Cloud request timed out or was aborted.", {
          code: "CLOUD_TIMEOUT",
        });
      }
      throw new CloudHttpError(
        error instanceof Error ? error.message : String(error),
        { code: "CLOUD_NETWORK_ERROR" },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  health() {
    return this.request("/health");
  }

  authConfig() {
    return this.request("/auth/config");
  }

  bootstrap(userJwt) {
    return this.request("/v1/bootstrap", {
      method: "POST",
      auth: "user",
      userJwt,
    });
  }

  registerDevice(userJwt, input) {
    return this.request("/v1/devices", {
      method: "POST",
      auth: "user",
      userJwt,
      body: input,
    });
  }

  listDevices(userJwt) {
    return this.request("/v1/devices", {
      auth: "user",
      userJwt,
    });
  }

  listCommands(userJwt, deviceId, limit = 50) {
    const bounded = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.request(
      `/v1/devices/${encodeURIComponent(deviceId)}/commands?limit=${bounded}`,
      {
        auth: "user",
        userJwt,
      },
    );
  }

  listDeviceEvents(userJwt, deviceId, limit = 50) {
    const bounded = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.request(
      `/v1/devices/${encodeURIComponent(deviceId)}/events?limit=${bounded}`,
      {
        auth: "user",
        userJwt,
      },
    );
  }

  createCommand(userJwt, deviceId, input) {
    return this.request(
      `/v1/devices/${encodeURIComponent(deviceId)}/commands`,
      {
        method: "POST",
        auth: "user",
        userJwt,
        body: input,
      },
    );
  }

  cancelCommand(userJwt, commandId) {
    return this.request(
      `/v1/commands/${encodeURIComponent(commandId)}/cancel`,
      {
        method: "POST",
        auth: "user",
        userJwt,
      },
    );
  }

  getDeviceAccess(userJwt, deviceId) {
    return this.request(`/v1/devices/${encodeURIComponent(deviceId)}/access`, {
      auth: "user",
      userJwt,
    });
  }

  getEntitlement(userJwt) {
    return this.request("/v1/entitlement", {
      auth: "user",
      userJwt,
    });
  }

  getRuntimeLease(userJwt, deviceId) {
    return this.request(
      `/v1/devices/${encodeURIComponent(deviceId)}/runtime-lease`,
      {
        auth: "user",
        userJwt,
      },
    );
  }

  connectivityBootstrap() {
    return this.request("/device/v1/connectivity/bootstrap", {
      method: "POST",
      auth: "device",
    });
  }

  heartbeat(input = {}) {
    return this.request("/device/v1/presence", {
      method: "POST",
      auth: "device",
      body: input,
    });
  }

  createApprovalDecision(userJwt, deviceId, approvalId, decision, source = "control") {
    return this.request(
      `/v1/devices/${encodeURIComponent(deviceId)}/approvals/${encodeURIComponent(approvalId)}/decision`,
      {
        method: "POST",
        auth: "user",
        userJwt,
        body: { decision, source },
      },
    );
  }

  pullApprovalDecisions(limit = 25) {
    const bounded = Math.min(Math.max(Number(limit) || 25, 1), 100);
    return this.request(`/device/v1/approval-decisions?limit=${bounded}`, {
      auth: "device",
    });
  }

  acknowledgeApprovalDecision(approvalDecisionId, outcome) {
    return this.request(
      `/device/v1/approval-decisions/${encodeURIComponent(approvalDecisionId)}/ack`,
      {
        method: "POST",
        auth: "device",
        body: outcome,
      },
    );
  }

  pullMcpCalls(limit = 25) {
    const bounded = Math.min(Math.max(Number(limit) || 25, 1), 100);
    return this.request(`/device/v1/mcp-calls?limit=${bounded}`, {
      auth: "device",
    });
  }

  claimMcpCall(callId, input) {
    return this.request(
      `/device/v1/mcp-calls/${encodeURIComponent(callId)}/claim`,
      { method: "POST", auth: "device", body: input },
    );
  }

  completeMcpCall(callId, input) {
    return this.request(
      `/device/v1/mcp-calls/${encodeURIComponent(callId)}/complete`,
      { method: "POST", auth: "device", body: input },
    );
  }

  pullCommands(limit = 25) {
    const bounded = Math.min(Math.max(Number(limit) || 25, 1), 100);
    return this.request(`/device/v1/commands?limit=${bounded}`, {
      auth: "device",
    });
  }

  acceptCommand(commandId, mapping) {
    return this.request(
      `/device/v1/commands/${encodeURIComponent(commandId)}/accept`,
      {
        method: "POST",
        auth: "device",
        body: mapping,
      },
    );
  }

  rejectCommand(commandId, reason) {
    return this.request(
      `/device/v1/commands/${encodeURIComponent(commandId)}/reject`,
      {
        method: "POST",
        auth: "device",
        body: { reason },
      },
    );
  }

  postEvent(event) {
    return this.request("/device/v1/events", {
      method: "POST",
      auth: "device",
      body: event,
    });
  }

  postTelemetry(events) {
    return this.request("/device/v1/telemetry", {
      method: "POST",
      auth: "device",
      body: { events },
    });
  }
}
