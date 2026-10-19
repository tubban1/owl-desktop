// A DEV supervisor can outlive the terminal/MCP client that supplied its
// inherited stdout/stderr. Broken pipes must not crash the Electron main
// process, Connection Host, or supervisor. This does not hide other errors.
export function installStdioEpipeGuard({
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const guards = [];
  for (const stream of new Set([stdout, stderr])) {
    if (!stream || typeof stream.on !== "function") continue;
    function onError(error) {
      if (error?.code === "EPIPE") return;
      // Preserve the usual fatal behavior for unexpected stream failures.
      throw error;
    }
    stream.on("error", onError);
    guards.push([stream, onError]);
  }
  return () => {
    for (const [stream, listener] of guards) stream.off("error", listener);
  };
}
