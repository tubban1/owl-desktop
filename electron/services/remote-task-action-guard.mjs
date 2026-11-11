// Scope-limited compatibility guard based on actions rejected by the deployed
// OWL Runtime's task router. It is deliberately NOT an allowlist: dynamic
// providers and the internal action router are not public stable contracts.
// Unknown actions still receive authoritative validation from Runtime.
const KNOWN_UNSUPPORTED_REMOTE_ACTIONS = new Set([
  "fs.read.one",
  "fs.stat",
  "primitive.call",
  "file.read",
  "sys.exec",
  "runtime.task.create-and-start@1",
]);

export function isKnownUnsupportedRemoteTaskAction(action) {
  return typeof action === "string" &&
    KNOWN_UNSUPPORTED_REMOTE_ACTIONS.has(action);
}
