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
  remoteDeviceControl,
  plannerContinuation,
  onEvent = () => {},
  sessionIdleTtlMs = 30 * 60_000,
  ownerSupersedeGraceMs = 60_000,
  maxSessions = 128,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid OWL MCP port: ${port}`);
  }

  const app = express();
  const sessions = new Map();
  plannerContinuation?.recoverConnectedTransports?.("mcp_restart");
  const boundedSessionIdleTtlMs = Math.max(Number(sessionIdleTtlMs) || 0, 1_000);
  const boundedOwnerSupersedeGraceMs = Math.max(
    Number(ownerSupersedeGraceMs) || 0,
    1_000,
  );
  const boundedMaxSessions = Math.max(Number(maxSessions) || 0, 8);
  app.use(express.json({ limit: "4mb" }));

  function touchTransportSession(session, now = Date.now()) {
    if (!session) return;
    session.lastSeenAt = new Date(now).toISOString();
    session.lastSeenAtMs = now;
  }

  function transportSessionBusy(session) {
    return Number(session?.activeRequestCount ?? 0) > 0;
  }

  function reclaimSupersededOwnerSessions(
    runtimeSessionId,
    currentTransportSessionId,
    now = Date.now(),
  ) {
    if (!runtimeSessionId || !currentTransportSessionId) return 0;
    const staleBefore = now - boundedOwnerSupersedeGraceMs;
    const reclaimed = [];

    for (const [transportSessionId, session] of sessions) {
      if (transportSessionId === currentTransportSessionId) continue;
      if (session?.ownerStable !== true) continue;
      if (session?.runtimeSessionId !== runtimeSessionId) continue;
      if (transportSessionBusy(session)) continue;

      const lastSeenMs =
        session.lastSeenAtMs ??
        Date.parse(session.lastSeenAt ?? session.createdAt ?? "") ??
        0;
      if (lastSeenMs > staleBefore) continue;

      sessions.delete(transportSessionId);
      plannerContinuation?.noteTransportDisconnected?.(
        runtimeSessionId,
        transportSessionId,
        "owner_superseded",
      );
      void session.transport.close().catch(() => undefined);
      reclaimed.push(transportSessionId);
    }

    if (reclaimed.length > 0) {
      onEvent("info", "MCP stale owner transports superseded", {
        runtimeSessionId,
        replacementTransportSessionId: currentTransportSessionId,
        reclaimedCount: reclaimed.length,
        reclaimedTransportSessionIds: reclaimed.slice(0, 8),
        reason: "owner_superseded",
      });
    }

    return reclaimed.length;
  }

  function pruneTransportSessions(now = Date.now()) {
    const staleBefore = now - boundedSessionIdleTtlMs;
    for (const [transportSessionId, session] of sessions) {
      // Streamable HTTP may keep a GET event stream or a tools/call POST open
      // for a long time. Never classify an in-flight transport as idle.
      if (transportSessionBusy(session)) continue;

      const lastSeenMs =
        session.lastSeenAtMs ??
        Date.parse(session.lastSeenAt ?? session.createdAt ?? "") ??
        0;
      if (lastSeenMs <= staleBefore) {
        sessions.delete(transportSessionId);
        if (session.ownerStable === true) {
          plannerContinuation?.noteTransportDisconnected?.(
            session.runtimeSessionId,
            transportSessionId,
            "idle_ttl",
          );
        }
        void session.transport.close().catch(() => undefined);
        onEvent("info", "MCP transport session reclaimed", {
          transportSessionId,
          reason: "idle_ttl",
        });
      }
    }

    if (sessions.size <= boundedMaxSessions) return;

    // The cap is a memory-safety backstop, not permission to sever a live
    // ChatGPT stream. Evict only inactive sessions and temporarily exceed the
    // soft cap if every over-cap session is still carrying an active request.
    let excess = sessions.size - boundedMaxSessions;
    const oldestInactive = [...sessions.entries()]
      .filter(([, session]) => !transportSessionBusy(session))
      .sort(([, left], [, right]) =>
        (left.lastSeenAtMs ?? 0) - (right.lastSeenAtMs ?? 0),
      );

    for (const [transportSessionId, session] of oldestInactive) {
      if (excess <= 0) break;
      excess -= 1;
      sessions.delete(transportSessionId);
      if (session.ownerStable === true) {
        plannerContinuation?.noteTransportDisconnected?.(
          session.runtimeSessionId,
          transportSessionId,
          "session_cap",
        );
      }
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
    const session = sessions.get(transportSessionId);
    sessions.delete(transportSessionId);
    if (session?.ownerStable === true) {
      plannerContinuation?.noteTransportDisconnected?.(
        session.runtimeSessionId,
        transportSessionId,
        reason,
      );
    }
    onEvent("info", "MCP transport session closed", {
      transportSessionId,
      reason,
    });
    return true;
  }

  function createTransportSession() {
    const server = createOwlMcpServer();
    const session = {
      server,
      transport: null,
      createdAt: null,
      lastSeenAt: null,
      lastSeenAtMs: 0,
      activeRequestCount: 0,
    };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        const now = Date.now();
        session.createdAt ??= new Date(now).toISOString();
        session.lastSeenAt = new Date(now).toISOString();
        session.lastSeenAtMs = now;
        sessions.set(id, session);
        pruneTransportSessions(now);
        onEvent("info", "MCP transport session opened", { transportSessionId: id });
      },
    });
    session.transport = transport;

    transport.onclose = () => {
      removeTransportSession(transport.sessionId, "transport_close");
    };

    return session;
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

      const baseIdentity = resolveOwnerIdentity(
        req.headers,
        transportSessionId,
        fallbackOwnerId,
      );
      const hasExplicitOwner =
        typeof req.headers["x-owl-owner-id"] === "string" ||
        typeof req.headers["x-computer-mcp-owner-id"] === "string";
      const boundOwner =
        !hasExplicitOwner && active.boundWorkstreamId
          ? plannerContinuation?.get?.(active.boundWorkstreamId)
          : null;
      const identity = boundOwner?.workstream
        ? {
            runtimeSessionId: boundOwner.ownerId,
            stable: true,
            source: "workstream-binding",
            clientKind:
              boundOwner.workstream.clientKind ??
              boundOwner.clientKind ??
              "chatgpt",
            clientLabel:
              boundOwner.workstream.clientLabel ??
              boundOwner.clientLabel ??
              null,
          }
        : baseIdentity;
      active.runtimeSessionId = identity.runtimeSessionId;
      active.ownerStable = identity.stable;
      active.ownerSource = identity.source;
      active.clientKind = identity.clientKind ?? null;
      active.clientLabel = identity.clientLabel ?? null;
      if (
        identity.stable &&
        typeof transportSessionId === "string" &&
        !transportSessionId.startsWith("bootstrap:")
      ) {
        reclaimSupersededOwnerSessions(
          identity.runtimeSessionId,
          transportSessionId,
        );
        plannerContinuation?.noteTransportActivity?.(
          identity.runtimeSessionId,
          transportSessionId,
          undefined,
          {
            clientKind: identity.clientKind ?? null,
            clientLabel: identity.clientLabel ?? null,
            ownerSource: identity.source,
          },
        );
      }
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

      touchTransportSession(active);
      active.activeRequestCount =
        Number(active.activeRequestCount ?? 0) + 1;

      try {
        await withMcpRequestContext(
          {
            runtimeBaseUrl,
            runtimeToken,
            runtimeSessionId: identity.runtimeSessionId,
            ownerStable: identity.stable,
            ownerSource: identity.source,
            clientKind: identity.clientKind ?? null,
            clientLabel: identity.clientLabel ?? null,
            transportSessionId,
            runtimeRequestId,
            logicalRequestId:
              body?.id !== undefined ? String(body.id) : runtimeRequestId,
            clientIdempotencyKey: suppliedIdempotencyKey || undefined,
            signal: requestAbort.signal,
            agentInbox,
            remoteDeviceControl,
            plannerContinuation,
            bindWorkstream: (workstreamId, metadata = {}) => {
              const workstream = plannerContinuation?.get?.(workstreamId);
              if (!workstream?.workstream) {
                const error = new Error("Unknown OWL workstream.");
                error.code = "WORKSTREAM_NOT_FOUND";
                throw error;
              }
              active.boundWorkstreamId = workstreamId;
              active.runtimeSessionId = workstreamId;
              active.ownerStable = true;
              active.ownerSource = "workstream-binding";
              active.clientKind =
                metadata.clientKind ??
                workstream.workstream.clientKind ??
                workstream.clientKind ??
                "chatgpt";
              active.clientLabel =
                metadata.clientLabel ??
                workstream.workstream.clientLabel ??
                workstream.clientLabel ??
                null;
              plannerContinuation?.noteTransportActivity?.(
                workstreamId,
                transportSessionId,
                undefined,
                {
                  clientKind: active.clientKind,
                  clientLabel: active.clientLabel,
                  ownerSource: "workstream-binding",
                },
              );
            },
            unbindWorkstream: (workstreamId) => {
              if (
                workstreamId &&
                active.boundWorkstreamId &&
                active.boundWorkstreamId !== workstreamId
              ) {
                return false;
              }
              active.boundWorkstreamId = null;
              return true;
            },
            onEvent,
          },
          () => active.transport.handleRequest(req, res, req.body),
        );
      } finally {
        active.activeRequestCount = Math.max(
          0,
          Number(active.activeRequestCount ?? 1) - 1,
        );
        // A long request is activity for its entire lifetime. Refresh the idle
        // clock on completion so it cannot be reclaimed immediately afterward.
        touchTransportSession(active);

        // The initialize request begins before Streamable HTTP has assigned a
        // real session id. Once handleRequest completes, finish the owner
        // binding and takeover bookkeeping using the canonical id.
        const initializedTransportSessionId = active.transport?.sessionId;
        if (
          identity.stable &&
          typeof initializedTransportSessionId === "string" &&
          initializedTransportSessionId &&
          initializedTransportSessionId !== suppliedSessionId
        ) {
          reclaimSupersededOwnerSessions(
            active.runtimeSessionId ?? identity.runtimeSessionId,
            initializedTransportSessionId,
          );
          plannerContinuation?.noteTransportActivity?.(
            active.runtimeSessionId ?? identity.runtimeSessionId,
            initializedTransportSessionId,
            undefined,
            {
              clientKind: active.clientKind ?? identity.clientKind ?? null,
              clientLabel: active.clientLabel ?? identity.clientLabel ?? null,
              ownerSource: active.ownerSource ?? identity.source,
            },
          );
        }
      }

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
        sessionPolicy: {
          idleTtlMs: boundedSessionIdleTtlMs,
          ownerSupersedeGraceMs: boundedOwnerSupersedeGraceMs,
          maxSessions: boundedMaxSessions,
        },
        plannerContinuation: plannerContinuation?.summary?.() ?? {
          activeCheckpointCount: 0,
          connectedOwnerCount: 0,
          latestActive: null,
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
      sessionPolicy: {
        idleTtlMs: boundedSessionIdleTtlMs,
        ownerSupersedeGraceMs: boundedOwnerSupersedeGraceMs,
        maxSessions: boundedMaxSessions,
      },
      continuation: plannerContinuation?.summary?.() ?? {
        activeCheckpointCount: 0,
        connectedOwnerCount: 0,
        latestActive: null,
      },
      sessions: [...sessions.entries()].map(([transportSessionId, session]) => ({
        transportSessionId,
        runtimeSessionId: session.runtimeSessionId ?? null,
        ownerStable: session.ownerStable ?? false,
        ownerSource: session.ownerSource ?? "transport-session",
        clientKind: session.clientKind ?? null,
        clientLabel: session.clientLabel ?? null,
        workstreamId: session.boundWorkstreamId ?? null,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        activeRequestCount: Number(session.activeRequestCount ?? 0),
      })),
      continuation:
        plannerContinuation?.summary?.() ?? {
          activeCheckpointCount: 0,
          connectedOwnerCount: 0,
          latestActive: null,
        },
    };
  }

  async function close() {
    for (const [transportSessionId, session] of sessions.entries()) {
      if (session.ownerStable === true) {
        plannerContinuation?.noteTransportDisconnected?.(
          session.runtimeSessionId,
          transportSessionId,
          "mcp_stop",
        );
      }
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
