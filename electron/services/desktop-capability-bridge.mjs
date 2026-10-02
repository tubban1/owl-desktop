import express from "express";

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function startDesktopCapabilityBridge({
  port = 8792,
  token,
  agentInbox,
  remoteDeviceControl,
  onEvent = () => {},
} = {}) {
  if (!token) {
    throw new Error("Desktop capability bridge token is required.");
  }
  if (!agentInbox) {
    throw new Error("Desktop capability bridge requires AgentInbox.");
  }
  if (typeof remoteDeviceControl !== "function") {
    throw new Error("Desktop capability bridge requires remoteDeviceControl factory.");
  }

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    if (req.headers.authorization === `Bearer ${token}`) return next();
    res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Unauthorized." },
    });
  });

  const agentMethods = new Set([
    "summary",
    "list",
    "claim",
    "release",
    "complete",
  ]);
  const remoteMethods = new Set([
    "listDevices",
    "listCommands",
    "submitTask",
    "status",
    "cancel",
  ]);

  app.post("/rpc", async (req, res) => {
    const { domain, method, args } = req.body ?? {};
    try {
      const parameters = Array.isArray(args) ? args : [];
      let target;
      if (domain === "agentInbox") {
        if (!agentMethods.has(method)) {
          throw codedError(
            "CAPABILITY_METHOD_UNSUPPORTED",
            "Unsupported AgentInbox method.",
          );
        }
        target = agentInbox;
      } else if (domain === "remoteDevice") {
        if (!remoteMethods.has(method)) {
          throw codedError(
            "CAPABILITY_METHOD_UNSUPPORTED",
            "Unsupported remote-device method.",
          );
        }
        target = remoteDeviceControl();
      } else {
        throw codedError(
          "CAPABILITY_DOMAIN_UNSUPPORTED",
          "Unsupported Desktop capability domain.",
        );
      }
      const fn = target?.[method];
      if (typeof fn !== "function") {
        throw codedError(
          "CAPABILITY_METHOD_UNAVAILABLE",
          "Desktop capability method is unavailable.",
        );
      }
      const result = await fn.apply(target, parameters);
      res.json({ ok: true, result });
    } catch (error) {
      const code = error?.code ?? "DESKTOP_CAPABILITY_FAILED";
      onEvent("warn", "Desktop capability bridge call failed", {
        domain,
        method,
        code,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(
        code === "ACCOUNT_LOGIN_REQUIRED" ? 401 : 400,
      ).json({
        ok: false,
        error: {
          code,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "owl-desktop-capability-bridge" });
  });

  const listener = await new Promise((resolve, reject) => {
    const candidate = app.listen(port, "127.0.0.1", () => resolve(candidate));
    candidate.once("error", reject);
  });

  onEvent("info", "Desktop capability bridge started", { port });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => listener.close(resolve));
      onEvent("info", "Desktop capability bridge stopped", { port });
    },
  };
}
