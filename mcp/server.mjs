#!/usr/bin/env node
import { startOwlMcpHttpServer } from "./http-server.mjs";

const runtimeBaseUrl =
  process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:8788";
const runtimeToken = process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined;
const mcpToken = process.env.OWL_MCP_API_TOKEN?.trim() || undefined;
const port = Number(process.env.OWL_MCP_PORT ?? process.env.PORT ?? 8790);

const server = await startOwlMcpHttpServer({
  port,
  runtimeBaseUrl,
  runtimeToken,
  mcpToken,
  onEvent(level, message, meta = {}) {
    const suffix = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    const line = `[owl-mcp] ${message}${suffix}`;
    if (level === "error") console.error(line);
    else console.log(line);
  },
});

console.log(
  `OWL MCP 0.1.0 listening on ${server.url} → ${runtimeBaseUrl}`,
);

async function shutdown(signal) {
  console.log(`OWL MCP received ${signal}; closing.`);
  await server.close().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
