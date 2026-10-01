import http from "node:http";

export const DEV_AUTH_CALLBACK_HOST = "127.0.0.1";
export const DEV_AUTH_CALLBACK_PORT = 18991;
export const DEV_AUTH_CALLBACK_PATH = "/auth/callback";
export const DEV_AUTH_CALLBACK_URI =
  "http://127.0.0.1:18991/auth/callback";

function html(title, detail) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:40px;background:#0b0d0f;color:#e8edf0"><h2>${title}</h2><p>${detail}</p><p>You can close this browser tab and return to OWL LAB Desktop.</p></body></html>`;
}

export class DevAuthCallbackServer {
  constructor({
    host = DEV_AUTH_CALLBACK_HOST,
    port = DEV_AUTH_CALLBACK_PORT,
    callbackPath = DEV_AUTH_CALLBACK_PATH,
    timeoutMs = 10 * 60_000,
    onCallback,
  } = {}) {
    if (typeof onCallback !== "function") {
      throw new Error("DevAuthCallbackServer requires onCallback.");
    }
    this.host = host;
    this.port = port;
    this.callbackPath = callbackPath;
    this.timeoutMs = timeoutMs;
    this.onCallback = onCallback;
    this.server = null;
    this.timer = null;
  }

  get redirectUri() {
    return `http://${this.host}:${this.port}${this.callbackPath}`;
  }

  async start() {
    if (this.server) return this.redirectUri;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${this.host}:${this.port}`);
      if (req.method !== "GET" || url.pathname !== this.callbackPath) {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Not found");
        return;
      }

      try {
        await this.onCallback(url.toString());
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(
          html(
            "OWL LAB login complete",
            "Your OWL LAB account is connected.",
          ),
        );
      } catch (error) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(
          html(
            "OWL LAB login failed",
            error instanceof Error ? error.message : String(error),
          ),
        );
      } finally {
        setImmediate(() => {
          void this.stop();
        });
      }
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.port, this.host);
    });

    this.server = server;
    this.timer = setTimeout(() => {
      void this.stop();
    }, this.timeoutMs);
    this.timer.unref?.();
    return this.redirectUri;
  }

  async stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}
