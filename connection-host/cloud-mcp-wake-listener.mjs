// Passive AWS WebSocket notification channel. All executable work still goes
// through the authenticated Cloud pull + claim + local Runtime authorization.
// No command payload, bearer/device credentials, or tool results are sent here.
export class CloudMcpWakeListener {
  constructor({
    cloudClient,
    onWake,
    onDisconnected = () => {},
    WebSocketImpl = globalThis.WebSocket,
    onEvent = () => {},
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  }) {
    this.cloudClient = cloudClient;
    this.onWake = onWake;
    this.onDisconnected = onDisconnected;
    this.WebSocketImpl = WebSocketImpl;
    this.onEvent = onEvent;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.running = false;
    this.connected = false;
    this.socket = null;
    this.timer = null;
    this.failures = 0;
    this.hintsReceived = 0;
    this.lastWakeAt = null;
    this.lastConnectedAt = null;
  }

  start() {
    if (this.running || !this.WebSocketImpl ||
        typeof this.cloudClient.getMcpWakeTicket !== "function") return false;
    this.running = true;
    void this.connect();
    return true;
  }

  async connect() {
    if (!this.running) return;
    try {
      const ticket = await this.cloudClient.getMcpWakeTicket();
      if (!this.running) return;
      const url = new URL(ticket?.url ?? "");
      if (url.protocol !== "wss:" ||
          !/^[A-Za-z0-9_-]{32,100}$/.test(ticket?.ticket ?? "")) {
        throw new Error("Invalid wake channel configuration");
      }
      url.searchParams.set("ticket", ticket.ticket);
      const socket = new this.WebSocketImpl(url.toString());
      this.socket = socket;
      socket.addEventListener("open", () => {
        if (!this.running || this.socket !== socket) return;
        this.connected = true;
        this.failures = 0;
        this.lastConnectedAt = new Date().toISOString();
        this.onEvent("info", "Cloud MCP wake channel connected", {});
      });
      socket.addEventListener("message", (event) => {
        if (!this.running || this.socket !== socket) return;
        try {
          const value = JSON.parse(String(event.data ?? ""));
          if (value.type !== "mcp_wake" ||
              typeof value.callId !== "string" ||
              !/^mcp_[A-Za-z0-9_-]{6,120}$/.test(value.callId)) return;
          this.lastWakeAt = new Date().toISOString();
          this.hintsReceived += 1;
          this.onWake();
        } catch {
          // Invalid or partial hints are ignored. Polling is authoritative.
        }
      });
      socket.addEventListener("close", () => this.disconnected(socket));
      socket.addEventListener("error", () => {
        // WebSocket close owns retry; never log the URL (includes a ticket).
        this.onEvent("warn", "Cloud MCP wake channel transport error", {
          code: "WAKE_TRANSPORT_ERROR",
        });
      });
    } catch (error) {
      this.onEvent("warn", "Cloud MCP wake channel unavailable; polling remains active", {
        code: String(error?.code ?? "WAKE_CONNECT_FAILED"),
      });
      this.scheduleRetry();
    }
  }

  disconnected(socket) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.connected = false;
    this.onDisconnected();
    this.scheduleRetry();
  }

  scheduleRetry() {
    if (!this.running || this.timer) return;
    const delay = Math.min(60_000, 2_000 * (2 ** Math.min(this.failures++, 5)));
    this.timer = this.setTimeoutImpl(() => {
      this.timer = null;
      void this.connect();
    }, delay);
    this.timer.unref?.();
  }

  stop() {
    this.running = false;
    this.connected = false;
    if (this.timer) this.clearTimeoutImpl(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(); } catch {}
  }

  snapshot() {
    return {
      supported: Boolean(this.WebSocketImpl &&
        typeof this.cloudClient.getMcpWakeTicket === "function"),
      running: this.running,
      connected: this.connected,
      failures: this.failures,
      hintsReceived: this.hintsReceived,
      lastWakeAt: this.lastWakeAt,
      lastConnectedAt: this.lastConnectedAt,
    };
  }
}
