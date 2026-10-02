#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : "\n" + JSON.stringify(details, null, 2);
    throw new Error(message + suffix);
  }
}

const runtimeBaseUrl =
  process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:18788";
const runtimeToken = process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined;
const repo = process.env.OWL_E2E_REPO?.trim() || process.cwd();
const owner = "owl-desktop:gate3:consequential-replay";
const target = path.join(repo, ".tmp-owl-gate3-replay.txt");

fs.rmSync(target, { force: true });

const mcp = await startOwlMcpHttpServer({
  port: 0,
  runtimeBaseUrl,
  runtimeToken,
});

const captured = {
  dropped: false,
  requestBody: null,
  requestHeaders: null,
  firstResponseBody: null,
  firstResponseStatus: null,
  firstResponseContentType: null,
};

function isReplayFixture(bodyText) {
  try {
    const body = JSON.parse(bodyText);
    return (
      body?.method === "tools/call" &&
      body?.params?.name === "primitive_call" &&
      body?.params?.arguments?.primitive === "fs.write" &&
      body?.params?.arguments?.op === "append" &&
      body?.params?.arguments?.args?.path === target
    );
  } catch {
    return false;
  }
}

function forwardingHeaders(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (
      value !== undefined &&
      !["host", "content-length", "connection"].includes(key.toLowerCase())
    ) {
      headers[key] = value;
    }
  }
  return headers;
}

function retryHeaders(req) {
  const selected = {};
  for (const key of [
    "content-type",
    "accept",
    "mcp-session-id",
    "mcp-protocol-version",
    "x-owl-owner-id",
    "authorization",
  ]) {
    const value = req.headers[key];
    if (typeof value === "string") selected[key] = value;
  }
  return selected;
}

const proxy = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");

    const upstream = await fetch(mcp.url, {
      method: req.method,
      headers: forwardingHeaders(req),
      ...(req.method === "GET" || req.method === "HEAD" ? {} : { body }),
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    const targetRequest = isReplayFixture(body);

    if (targetRequest && !captured.dropped) {
      captured.dropped = true;
      captured.requestBody = body;
      captured.requestHeaders = retryHeaders(req);
      captured.firstResponseBody = responseBody.toString("utf8");
      captured.firstResponseStatus = upstream.status;
      captured.firstResponseContentType = upstream.headers.get("content-type");
      res.destroy(new Error("Injected downstream response loss after upstream completion."));
      return;
    }

    res.statusCode = upstream.status;
    for (const name of [
      "content-type",
      "mcp-session-id",
      "mcp-protocol-version",
      "cache-control",
    ]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.end(responseBody);
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    } else {
      res.destroy();
    }
  }
});

await new Promise((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(0, "127.0.0.1", resolve);
});
const proxyAddress = proxy.address();
assert(proxyAddress && typeof proxyAddress === "object", "Replay proxy has no TCP address.");
const proxyUrl = new URL(`http://127.0.0.1:${proxyAddress.port}/mcp`);

const client = new Client({
  name: "owl-gate3-replay-fixture",
  version: "0.1.0",
});
const transport = new StreamableHTTPClientTransport(proxyUrl, {
  requestInit: {
    headers: {
      "x-owl-owner-id": owner,
    },
  },
});

try {
  await client.connect(transport);
  assert(transport.sessionId, "MCP initialization returned no transport session.");

  let lostResponseObserved = false;
  try {
    await client.callTool({
      name: "primitive_call",
      arguments: {
        primitive: "fs.write",
        op: "append",
        args: {
          path: target,
          content: "once\n",
        },
      },
    });
  } catch {
    lostResponseObserved = true;
  }

  assert(lostResponseObserved, "Fault injector did not hide the first MCP response.");
  assert(captured.dropped, "Target consequential response was not intercepted.");
  assert(
    captured.firstResponseStatus === 200,
    "Upstream MCP/Runtime call did not finish successfully before response loss.",
    captured,
  );
  assert(captured.requestBody, "Fault injector did not retain the exact MCP request body.");
  assert(captured.requestHeaders?.["mcp-session-id"], "Replay request lost MCP session identity.");

  const firstFile = fs.readFileSync(target, "utf8");
  assert(
    firstFile === "once\n",
    "First consequential execution did not append exactly once before response loss.",
    { firstFile },
  );

  const retry = await fetch(proxyUrl, {
    method: "POST",
    headers: captured.requestHeaders,
    body: captured.requestBody,
  });
  const retryBody = await retry.text();

  assert(retry.ok, "Exact MCP request replay failed.", {
    status: retry.status,
    retryBody,
  });
  assert(
    retryBody === captured.firstResponseBody,
    "Retry did not replay the canonical first MCP response.",
    {
      firstResponse: captured.firstResponseBody,
      retryResponse: retryBody,
    },
  );

  const finalFile = fs.readFileSync(target, "utf8");
  assert(
    finalFile === "once\n",
    "Consequential retry duplicated the append side effect.",
    { finalFile },
  );

  console.log("PASS first consequential Runtime execution completed before injected response loss");
  console.log("PASS exact MCP JSON-RPC request replay returned the canonical prior response");
  console.log("PASS MCP transport-scoped replay identity mapped to Runtime idempotency authority");
  console.log("PASS non-idempotent append executed exactly once");
  console.log(JSON.stringify({
    ok: true,
    gate: "Local E2E Gate 3 consequential replay",
    runtimeBaseUrl,
    firstResponseLostToCaller: true,
    upstreamCompletedBeforeLoss: true,
    exactRequestReplayed: true,
    canonicalResponseReplayed: true,
    sideEffectCount: 1,
  }, null, 2));
} finally {
  await transport.close().catch(() => undefined);
  await mcp.close().catch(() => undefined);
  await new Promise((resolve) => proxy.close(resolve));
  fs.rmSync(target, { force: true });
}
