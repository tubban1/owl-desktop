export const OWL_COMPATIBILITY_V1 = Object.freeze({
  contractVersion: 1,
  runtime: Object.freeze({
    minimumApiVersion: "0.1",
    maximumTestedApiVersion: "0.1",
    preferredApiVersion: "0.1",
  }),
  remoteCommands: Object.freeze({
    "runtime.task.create": Object.freeze([1]),
    "runtime.task.create-and-start": Object.freeze([1]),
  }),
  tunnel: Object.freeze({
    protocolVersion: "owl-tunnel-consumer-v1",
    vendorVersion: "0.0.15",
  }),
  helper: Object.freeze({
    bundleIdentifier: "fan.fde.owl.helper",
    version: "1.0.0",
  }),
  runtimeHost: Object.freeze({
    bundleIdentifier: "fan.fde.owl.runtime",
    version: "1.0.0",
  }),
});

function compatibilityError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

export function assertRuntimeCompatibility(info) {
  const actual = info?.apiVersion ?? null;
  const expected = OWL_COMPATIBILITY_V1.runtime.preferredApiVersion;
  if (actual !== expected) {
    throw compatibilityError(
      "RUNTIME_API_INCOMPATIBLE",
      `OWL Desktop requires Runtime API ${expected}; received ${actual ?? "unknown"}.`,
      {
        expected,
        minimum: OWL_COMPATIBILITY_V1.runtime.minimumApiVersion,
        maximumTested: OWL_COMPATIBILITY_V1.runtime.maximumTestedApiVersion,
        actual,
      },
    );
  }
  return {
    compatible: true,
    runtimeApiVersion: actual,
  };
}

export function supportsRemoteCommand(kind, version) {
  return (
    typeof kind === "string" &&
    Number.isInteger(version) &&
    (OWL_COMPATIBILITY_V1.remoteCommands[kind]?.includes(version) ?? false)
  );
}
