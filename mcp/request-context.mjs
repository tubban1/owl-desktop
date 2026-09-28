import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

export function withMcpRequestContext(context, fn) {
  return storage.run(context, fn);
}

export function currentMcpRequestContext() {
  const context = storage.getStore();
  if (!context) throw new Error("OWL MCP request context is unavailable.");
  return context;
}
