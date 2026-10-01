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
  fallbackOwnerId,
  agentInbox,
  onEvent = () => {},
  sessionIdleTtlMs = 30 * 60_000,
  maxSessions = 128,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid OWL MCP port: ${port}`);
  }

  const app = express();
  const sessions = new Map();
  const boundedSessionIdleTtlMs = Math.max(Number(sessionIdleTtlMs) || 0, 1_000);
  const boundedMaxSessions = Math.max(Number(maxSessions) || 0, 8);
  app.use(express.json({ limit: "4mb" }));

  function pruneTransportSessions(now = Date.now()) {
    const staleBefore = now - boundedSessionIdleTtlMs;
    for (const [transportSessionId, session] of sessions) {
      const lastSeenMs =
        session.lastSeenAtMs ??
        Date.parse(session.lastSeenAt ?? session.createdAt ?? "") ??
        0;
      if (lastSeenMs <= staleBefore) {
        sessions.delete(transportSessionId);
        void session.transport.close().catch(() => undefined);
        onEvent("info", "MCP transport session reclaimed", {
          transportSessionId,
          reason: "idle_ttl",
        });
      }
    }

    if (sessions.size <= boundedMaxSessions) return;
    const oldest = [...sessions.entries()]
      .sort(([, left], [, right]) =>
        (left.lastSeenAtMs ?? 0) - (right.lastSeenAtMs ?? 0),
      )
      .slice(0, sessions.size - boundedMaxSessions);

    for (const [transportSessionId, session] of oldest) {
      sessions.delete(transportSessionId);
      void session.transport.close().catch(() => undefined);
      onEvent("warn", "MCP transport session reclaimed", {
        transportSessionId,
        reason: "session_cap",
      });
    }
  }

  function authorized(req) {
    if (!mcpToken) return true;
    return req.headers.authorization === `Bearer ${mcpToken}`;
  }

  function requireAuth(req, res, next) {
    if (authorized(req)) return next();
    res.status(401).json({ error: "Unauthorized" });
  }

  function removeTransportSession(transportSessionId, reason) {
    if (!transportSessionId || !sessions.has(transportSessionId)) return false;
    sessions.delete(transportSessionId);
    onEvent("info", "MCP transport session closed", {
      transportSessionId,
      reason,
    });
    return true;
  }

  function createTransportSession() {
    const server = createOwlMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        const now = Date.now();
        sessions.set(id, {
          server,
          transport,
          createdAt: new Date(now).toISOString(),
          lastSeenAt: new Date(now).toISOString(),
          lastSeenAtMs: now,
        });
        pruneTransportSessions(now);
        onEvent("info", "MCP transport session opened", { transportSessionId: id });
      },
    });

    transport.onclose = () => {
      removeTransportSession(transport.sessionId, "transport_close");
    };

    return { server, transport };
  }

  app.all("/mcp", requireAuth, async (req, res) => {
    const suppliedSessionId =
      typeof req.headers["mcp-session-id"] === "string"
        ? req.headers["mcp-session-id"]
        : undefined;

    // An incoming request is activity. Touch a known supplied session before
    // idle pruning so a slow client/host cannot lose a valid session between
    // initialize and its next MCP notification.
    if (suppliedSessionId) {
      const supplied = sessions.get(suppliedSessionId);
      if (supplied) {
        const seenAt = Date.now();
        supplied.lastSeenAt = new Date(seenAt).toISOString();
        supplied.lastSeenAtMs = seenAt;
      }
    }
    pruneTransportSessions();

    let active = suppliedSessionId
      ? sessions.get(suppliedSessionId)
      : undefined;

    try {
      if (!active) {
        if (suppliedSessionId) {
          res.status(404).json({ error: "MCP session not found." });
          return;
        }
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
        fallbackOwnerId,
      );
      active.runtimeSessionId = identity.runtimeSessionId;
      active.ownerStable = identity.stable;
      active.ownerSource = identity.source;
      // Once a tool request has been accepted by OWL MCP, do not bind Runtime
      // execution lifetime to the upstream HTTP connection. ChatGPT/tunnel
      // reconnects must not cancel an already-dispatched Runtime operation.
      // Runtime timeouts, policy, approval and durable-task semantics remain
      // the execution authority.
      const requestAbort = new AbortController();

      const body = req.body ?? {};
      const suppliedIdempotencyKey =
        typeof req.headers["x-owl-idempotency-key"] === "string"
          ? req.headers["x-owl-idempotency-key"].trim().slice(0, 256)
          : undefined;
      const runtimeRequestId =
        body?.id !== undefined
          ? `owl-mcp:${transportSessionId}:${String(body.id)}`
          : `owl-mcp:${randomUUID()}`;

      const seenAt = Date.now();
      active.lastSeenAt = new Date(seenAt).toISOString();
      active.lastSeenAtMs = seenAt;

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
          clientIdempotencyKey: suppliedIdempotencyKey || undefined,
          signal: requestAbort.signal,
          agentInbox,
          onEvent,
        },
        () => active.transport.handleRequest(req, res, req.body),
      );

      if (req.method === "DELETE" && suppliedSessionId) {
        removeTransportSession(suppliedSessionId, "client_delete");
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
    pruneTransportSessions();
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
    sessionCount: () => {
      pruneTransportSessions();
      return sessions.size;
    },
    snapshot,
    close,
  };
}
