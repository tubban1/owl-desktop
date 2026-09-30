import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";
import { createOwlMcpServer } from "./create-server.mjs";
import { resolveOwnerIdentity } from "./owner-identity.mjs";
import { withMcpRequestContext } from "./request-context.mjs";

export async function startOwlMcpHttpServer({
  port = 8790,
  runtimeBaseUrl = "http://127.0.0.1:8788",
  runtimeToken,
  mcpToken,
  agentInbox,
  onEvent = () => {},
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid OWL MCP port: ${port}`);
  }

  const app = express();
  const sessions = new Map();
  app.use(express.json({ limit: "4mb" }));

  function authorized(req) {
    if (!mcpToken) return true;
    return req.headers.authorization === `Bearer ${mcpToken}`;
  }

  function requireAuth(req, res, next) {
    if (authorized(req)) return next();
    res.status(401).json({ error: "Unauthorized" });
  }

  function createTransportSession() {
    const server = createOwlMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, {
          server,
          transport,
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        });
        onEvent("info", "MCP transport session opened", { transportSessionId: id });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        onEvent("info", "MCP transport session closed", {
          transportSessionId: transport.sessionId,
        });
      }
    };

    return { server, transport };
  }

  app.all("/mcp", requireAuth, async (req, res) => {
    const suppliedSessionId =
      typeof req.headers["mcp-session-id"] === "string"
        ? req.headers["mcp-session-id"]
        : undefined;

    let active = suppliedSessionId
      ? sessions.get(suppliedSessionId)
      : undefined;

    try {
      if (!active) {
        if (req.method !== "POST") {
          res.status(400).json({ error: "No valid MCP session." });
          return;
        }
        active = createTransportSession();
        await active.server.connect(active.transport);
      }

      const transportSessionId =
        suppliedSessionId ??
        active.transport.sessionId ??
        `bootstrap:${randomUUID()}`;

      const identity = resolveOwnerIdentity(
        req.headers,
        transportSessionId,
      );
      active.runtimeSessionId = identity.runtimeSessionId;
      active.ownerStable = identity.stable;
      active.ownerSource = identity.source;
      const requestAbort = new AbortController();

      const abort = (reason) => {
        if (!requestAbort.signal.aborted) {
          requestAbort.abort(new Error(reason));
        }
      };
      const onAborted = () => abort("MCP request aborted by client.");
      const onClosed = () => {
        if (!res.writableEnded) abort("MCP response closed before completion.");
      };

      req.once("aborted", onAborted);
      res.once("close", onClosed);

      const body = req.body ?? {};
      const runtimeRequestId =
        body?.id !== undefined
          ? `owl-mcp:${transportSessionId}:${String(body.id)}`
          : `owl-mcp:${randomUUID()}`;

      active.lastSeenAt = new Date().toISOString();

      try {
        await withMcpRequestContext(
          {
            runtimeBaseUrl,
            runtimeToken,
            runtimeSessionId: identity.runtimeSessionId,
            ownerStable: identity.stable,
            ownerSource: identity.source,
            transportSessionId,
            runtimeRequestId,
            logicalRequestId:
              body?.id !== undefined ? String(body.id) : runtimeRequestId,
            signal: requestAbort.signal,
            agentInbox,
            onEvent,
          },
          () => active.transport.handleRequest(req, res, req.body),
        );
      } finally {
        req.off("aborted", onAborted);
        res.off("close", onClosed);
      }
    } catch (error) {
      onEvent("error", "MCP request failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  app.get("/health", requireAuth, async (_req, res) => {
    const client = new RuntimeHttpClient({
      baseUrl: runtimeBaseUrl,
      sessionId: "owl-mcp:health",
      token: runtimeToken,
    });

    try {
      const info = await client.info();
      res.json({
        ok: true,
        service: "owl-mcp",
        version: "0.1.0",
        runtime: info,
        runtimeUrl: runtimeBaseUrl,
        transportSessions: sessions.size,
        ownerHeader: "x-owl-owner-id",
        agentRequests: agentInbox?.summary() ?? {
          pending: 0,
          claimed: 0,
          highestPriority: null,
          byType: {},
        },
      });
    } catch (error) {
      res.status(503).json({
        ok: false,
        service: "owl-mcp",
        version: "0.1.0",
        runtimeUrl: runtimeBaseUrl,
        transportSessions: sessions.size,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const listener = await new Promise((resolve, reject) => {
    const candidate = app.listen(port, "127.0.0.1", () => resolve(candidate));
    candidate.once("error", reject);
  });

  const address = listener.address();
  const actualPort =
    address && typeof address === "object" ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}/mcp`;

  onEvent("info", "OWL MCP started", {
    url,
    runtimeBaseUrl,
  });

  function snapshot() {
    return {
      sessionCount: sessions.size,
      sessions: [...sessions.entries()].map(([transportSessionId, session]) => ({
        transportSessionId,
        runtimeSessionId: session.runtimeSessionId ?? null,
        ownerStable: session.ownerStable ?? false,
        ownerSource: session.ownerSource ?? "transport-session",
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
      })),
    };
  }

  async function close() {
    for (const session of sessions.values()) {
      await session.transport.close().catch(() => undefined);
    }
    sessions.clear();
    await new Promise((resolve) => listener.close(resolve));
    onEvent("info", "OWL MCP stopped");
  }

  return {
    app,
    listener,
    port: actualPort,
    url,
    runtimeBaseUrl,
    sessionCount: () => sessions.size,
    snapshot,
    close,
  };
}
