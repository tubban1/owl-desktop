import express from "express";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";
import { createOwlMcpServer } from "./create-server.mjs";
import { resolveOwnerIdentity } from "./owner-identity.mjs";
import { withMcpRequestContext } from "./request-context.mjs";
import { createCallTimingJournal, safeTraceId } from "./call-timing-journal.mjs";

export async function startOwlMcpHttpServer({
  port = 8790,
  runtimeBaseUrl = "http://127.0.0.1:8788",
  runtimeToken,
  mcpToken,
  fallbackOwnerId,
  agentInbox,
  remoteDeviceControl,
  mailService = null,
  providerOperations = null,
  peerRecovery = null,
  plannerContinuation,
  fileDelivery = null,
  browserCompanion = null,
  userChromeBridge = null,
  onEvent = () => {},
  sessionIdleTtlMs = 30 * 60_000,
  ownerSupersedeGraceMs = 60_000,
  maxSessions = 128,
  monotonicNow = () => performance.now(),
  timingJournal = null,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid OWL MCP port: ${port}`);
  }

  const app = express();
  const sessions = new Map();
  // Bounded, payload-free local telemetry. Upstream ChatGPT/Tunnel timing is
  // intentionally NOT inferred from this server-side measurement.
  const recentMcpCalls = [];
  const callTimings = timingJournal ?? createCallTimingJournal({
    root: process.env.OWL_MCP_TIMINGS_ROOT ||
      path.join(process.env.OWL_DESKTOP_USER_DATA_DIR ||
        path.join(os.homedir(), ".owl-lab"), "connectivity"),
  });
  const LATENCY_SAMPLE_LIMIT = 128;
  function latencySummary() {
    const values = recentMcpCalls.map((row) => row.totalMs).sort((a, b) => a - b);
    const percentile = (p) => values.length
      ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]
      : null;
    return {
      sampleCount: values.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: values.at(-1) ?? null,
      failedCount: recentMcpCalls.filter((row) => row.status >= 400 || row.status === 0).length,
      slowCallCount: recentMcpCalls.filter((row) => row.totalMs >= 2000).length,
    };
  }
  plannerContinuation?.recoverConnectedTransports?.("mcp_restart");
  const boundedSessionIdleTtlMs = Math.max(Number(sessionIdleTtlMs) || 0, 1_000);
  const boundedOwnerSupersedeGraceMs = Math.max(
    Number(ownerSupersedeGraceMs) || 0,
    1_000,
  );
  const boundedMaxSessions = Math.max(Number(maxSessions) || 0, 8);
  app.use(express.json({ limit: "4mb" }));

  function touchTransportSession(
    session,
    wallNow = Date.now(),
    monotonicAtMs = monotonicNow(),
  ) {
    if (!session) return;
    session.lastSeenAt = new Date(wallNow).toISOString();
    session.lastSeenAtMs = wallNow;
    session.lastSeenMonotonicMs = monotonicAtMs;
  }

  function transportSessionBusy(session) {
    return Number(session?.activeRequestCount ?? 0) > 0;
  }

  function reclaimSupersededOwnerSessions(
    runtimeSessionId,
    currentTransportSessionId,
    nowMonotonic = monotonicNow(),
  ) {
    if (!runtimeSessionId || !currentTransportSessionId) return 0;
    const staleBefore = nowMonotonic - boundedOwnerSupersedeGraceMs;
    const reclaimed = [];

    for (const [transportSessionId, session] of sessions) {
      if (transportSessionId === currentTransportSessionId) continue;
      if (session?.ownerStable !== true) continue;
      if (session?.runtimeSessionId !== runtimeSessionId) continue;
      if (transportSessionBusy(session)) continue;

      const lastSeenMonotonicMs =
        Number(session.lastSeenMonotonicMs) || 0;
      if (lastSeenMonotonicMs > staleBefore) continue;

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

  function pruneTransportSessions(nowMonotonic = monotonicNow()) {
    const staleBefore = nowMonotonic - boundedSessionIdleTtlMs;
    for (const [transportSessionId, session] of sessions) {
      // Streamable HTTP may keep a GET event stream or a tools/call POST open
      // for a long time. Never classify an in-flight transport as idle.
      if (transportSessionBusy(session)) continue;

      const lastSeenMonotonicMs =
        Number(session.lastSeenMonotonicMs) || 0;
      if (lastSeenMonotonicMs <= staleBefore) {
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
        (left.lastSeenMonotonicMs ?? 0) -
        (right.lastSeenMonotonicMs ?? 0),
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
    const server = createOwlMcpServer({ fileDelivery, browserCompanion, userChromeBridge, mailService, providerOperations, peerRecovery });
    // Tool definitions are immutable for the lifetime of a Connection Host.
    // tools/list is available immediately after initialize. Announcing
    // tools/list_changed on EVERY fresh session used to generate one extra
    // server-to-client notification and telemetry event per MCP transport
    // (tens of thousands per week on ephemeral ChatGPT connections), even
    // though no tool changed. Reserve list_changed for genuine live catalog
    // mutations; an actual host update uses the regular client reconnect.
    const session = {
      server,
      transport: null,
      createdAt: null,
      lastSeenAt: null,
      lastSeenAtMs: 0,
      lastSeenMonotonicMs: 0,
      activeRequestCount: 0,
    };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        const wallNow = Date.now();
        const monotonicAtMs = monotonicNow();
        session.createdAt ??= new Date(wallNow).toISOString();
        touchTransportSession(session, wallNow, monotonicAtMs);
        sessions.set(id, session);
        pruneTransportSessions(monotonicAtMs);
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
    const requestStarted = performance.now();
    let preflightCompleted = requestStarted;
    let recorded = false;
    const traceId = safeTraceId(req.headers["x-owl-trace-id"]) ?? randomUUID();
    const receivedAt = new Date().toISOString();
    res.setHeader("x-owl-trace-id", traceId);
    const requestedMethod = typeof req.body?.method === "string"
      ? req.body.method.slice(0, 80) : req.method;
    const toolName = requestedMethod === "tools/call"
      && typeof req.body?.params?.name === "string"
      ? req.body.params.name.slice(0, 100) : null;
    function recordLatency() {
      if (recorded) return;
      recorded = true;
      const totalMs = Math.round(performance.now() - requestStarted);
      callTimings.record({
        traceId, phase: "mcp_response", method: requestedMethod,
        ...(toolName ? { tool: toolName } : {}),
        status: res.writableFinished ? res.statusCode : 0,
        totalMs, preflightMs: Math.round(preflightCompleted - requestStarted),
      });
      recentMcpCalls.push({
        traceId, receivedAt,
        method: requestedMethod,
        ...(toolName ? { tool: toolName } : {}),
        status: res.writableFinished ? res.statusCode : 0,
        totalMs,
        preflightMs: Math.round(preflightCompleted - requestStarted),
      });
      if (recentMcpCalls.length > LATENCY_SAMPLE_LIMIT) recentMcpCalls.shift();
    }
    res.once("finish", recordLatency);
    res.once("close", recordLatency);
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
        touchTransportSession(supplied);
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

      preflightCompleted = performance.now();
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
            traceId,
            logicalRequestId:
              body?.id !== undefined ? String(body.id) : runtimeRequestId,
            clientIdempotencyKey: suppliedIdempotencyKey || undefined,
            signal: requestAbort.signal,
            agentInbox,
            remoteDeviceControl,
            mailService,
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
              // A freshly initialized ChatGPT transport can be ephemeral until
              // workstream_open / the first tool binds it to a durable owner.
              // Reconcile old transports here too: without this, callers that
              // re-initialize on every tool leave owner-bound sessions behind
              // until session_cap or idle_ttl is reached.
              // Supersession respects the grace period and NEVER closes a live
              // GET event stream or in-flight tools/call.
              reclaimSupersededOwnerSessions(workstreamId, transportSessionId);
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
      let agentRequests = {
        available: Boolean(agentInbox),
        pending: 0,
        claimed: 0,
        highestPriority: null,
        byType: {},
      };
      if (agentInbox?.summary) {
        try {
          agentRequests = {
            available: true,
            ...(await agentInbox.summary()),
          };
        } catch {
          agentRequests.available = false;
        }
      }
      res.json({
        ok: true,
        service: "owl-mcp",
        version: "0.1.0",
        runtime: info,
        runtimeUrl: runtimeBaseUrl,
        transportSessions: sessions.size,
        ownerHeader: "x-owl-owner-id",
        agentRequests,
        sessionPolicy: {
          idleTtlMs: boundedSessionIdleTtlMs,
          ownerSupersedeGraceMs: boundedOwnerSupersedeGraceMs,
          maxSessions: boundedMaxSessions,
        },
        // /health is called frequently by readiness monitoring and must
        // never serialize historical owner/checkpoint payloads.
        plannerContinuation: plannerContinuation?.healthSummary?.() ?? {
          ownerCount: 0,
          activeCheckpointCount: 0,
          connectedOwnerCount: 0,
          readyHandoffCount: 0,
        },
        mcpLatency: latencySummary(),
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

  // Detailed owner history is available only on the explicit diagnostics
  // endpoint. Do not include it in the hot /health readiness path.
  app.get("/diagnostics", requireAuth, (_req, res) => {
    res.json({
      ok: true,
      service: "owl-mcp",
      mcpLatency: latencySummary(),
      recentMcpCalls: recentMcpCalls.slice(-32),
      transportSessions: sessions.size,
      plannerContinuation: plannerContinuation?.summary?.() ?? null,
    });
  });

  function healthSummary() {
    pruneTransportSessions();
    const rows = [...sessions.values()];
    return {
      sessionCount: sessions.size,
      activeRequestCount: rows.reduce(
        (sum, session) => sum + Number(session.activeRequestCount ?? 0),
        0,
      ),
      sessionPolicy: {
        idleTtlMs: boundedSessionIdleTtlMs,
        ownerSupersedeGraceMs: boundedOwnerSupersedeGraceMs,
        maxSessions: boundedMaxSessions,
      },
      mcpLatency: latencySummary(),
      continuation:
        plannerContinuation?.healthSummary?.() ?? {
          ownerCount: 0,
          connectedOwnerCount: 0,
          activeCheckpointCount: 0,
          readyHandoffCount: 0,
          implicitActiveCount: 0,
        },
    };
  }

  function snapshot() {
    pruneTransportSessions();
    return {
      sessionCount: sessions.size,
      sessionPolicy: {
        idleTtlMs: boundedSessionIdleTtlMs,
        ownerSupersedeGraceMs: boundedOwnerSupersedeGraceMs,
        maxSessions: boundedMaxSessions,
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
      mcpLatency: latencySummary(),
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
    healthSummary,
    snapshot,
    close,
  };
}
