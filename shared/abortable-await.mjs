export function awaitAbortable(value, signal) {
  if (!signal) return Promise.resolve(value);
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Operation aborted."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const finish = (handler, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(result);
    };
    const onAbort = () =>
      finish(reject, signal.reason ?? new Error("Operation aborted."));

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}
