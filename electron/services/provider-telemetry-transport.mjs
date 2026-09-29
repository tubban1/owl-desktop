import fs from "node:fs/promises";
import path from "node:path";

const MAX_BATCH = 100;
const DEFAULT_MAX_PENDING = 1_000;
const SENSITIVE_KEY =
  /(password|passwd|token|secret|api.?key|authorization|cookie|clipboard|prompt|content|body|message|screen|screenshot)/i;

export class ProviderTelemetryTransport {
  constructor({
    runtimeClient,
    cloudBaseUrl,
    deviceCredential,
    stateFile,
    fetchImpl = fetch,
    maxPending = DEFAULT_MAX_PENDING,
    onEvent = () => undefined,
  }) {
    if (!runtimeClient?.telemetry) {
      throw new Error("runtimeClient.telemetry is required");
    }
    if (!cloudBaseUrl?.trim()) throw new Error("cloudBaseUrl is required");
    if (!deviceCredential?.trim()) {
      throw new Error("deviceCredential is required");
    }
    if (!stateFile?.trim()) throw new Error("stateFile is required");

    this.runtimeClient = runtimeClient;
    this.cloudBaseUrl = cloudBaseUrl.replace(/\/+$/, "");
    this.deviceCredential = deviceCredential;
    this.stateFile = stateFile;
    this.fetchImpl = fetchImpl;
    this.maxPending = Math.max(100, Math.min(Number(maxPending) || DEFAULT_MAX_PENDING, 10_000));
    this.onEvent = onEvent;
  }

  async syncOnce() {
    const ingested = await this.ingestRuntimeOnce();
    const flushed = await this.flushCloudOnce();
    return {
      ingested: ingested.ingested,
      uploaded: flushed.uploaded,
      duplicates: flushed.duplicates,
      pending: flushed.pending,
      runtimeCursor: flushed.runtimeCursor,
    };
  }

  async ingestRuntimeOnce() {
    const state = await this.readState();
    const page = await this.runtimeClient.telemetry({
      after: state.runtimeCursor,
      limit: MAX_BATCH,
    });
    const rows = Array.isArray(page?.events) ? page.events : [];
    if (rows.length === 0) {
      return { ingested: 0, ...state };
    }

    const pendingIds = new Set(state.pending.map((event) => event.eventId));
    let highestCursor = state.runtimeCursor;
    let ingested = 0;

    for (const row of rows) {
      const cursor = Number(row?.cursor);
      const event = row?.event;
      if (!Number.isSafeInteger(cursor) || cursor < 1) {
        throw new Error("RUNTIME_TELEMETRY_CURSOR_INVALID");
      }
      validateRuntimeTelemetryEvent(event);
      highestCursor = Math.max(highestCursor, cursor);
      if (!pendingIds.has(event.eventId)) {
        state.pending.push(event);
        pendingIds.add(event.eventId);
        ingested += 1;
      }
    }

    state.runtimeCursor = highestCursor;
    state.pending = boundedPending(state.pending, this.maxPending);
    await this.writeState(state);

    this.onEvent("info", "provider-telemetry", "Runtime telemetry queued", {
      ingested,
      pending: state.pending.length,
      runtimeCursor: state.runtimeCursor,
    });

    return { ingested, ...state };
  }

  async flushCloudOnce() {
    const state = await this.readState();
    if (state.pending.length === 0) {
      return {
        uploaded: 0,
        duplicates: 0,
        pending: 0,
        runtimeCursor: state.runtimeCursor,
      };
    }

    const batch = state.pending.slice(0, MAX_BATCH);
    const response = await this.fetchImpl(
      `${this.cloudBaseUrl}/device/v1/telemetry`,
      {
        method: "POST",
        headers: {
          authorization: `Device ${this.deviceCredential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ events: batch }),
      },
    );

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // Error path below provides a stable transport error.
    }

    if (!response.ok) {
      const error = new Error(
        payload?.message ?? `OWL Cloud telemetry HTTP ${response.status}`,
      );
      error.code = payload?.error ?? `HTTP_${response.status}`;
      this.onEvent("warn", "provider-telemetry", "Cloud telemetry upload failed", {
        status: response.status,
        code: error.code,
        pending: state.pending.length,
      });
      throw error;
    }

    const uploaded = Number(payload?.accepted ?? 0);
    const duplicates = Number(payload?.duplicates ?? 0);
    if (uploaded + duplicates !== batch.length) {
      throw new Error("CLOUD_TELEMETRY_ACK_INVALID");
    }

    state.pending.splice(0, batch.length);
    await this.writeState(state);

    this.onEvent("info", "provider-telemetry", "Cloud telemetry uploaded", {
      uploaded,
      duplicates,
      pending: state.pending.length,
    });

    return {
      uploaded,
      duplicates,
      pending: state.pending.length,
      runtimeCursor: state.runtimeCursor,
    };
  }

  async status() {
    const state = await this.readState();
    return {
      runtimeCursor: state.runtimeCursor,
      pending: state.pending.length,
      maxPending: this.maxPending,
    };
  }

  async readState() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.stateFile, "utf8"));
      return {
        version: 1,
        runtimeCursor:
          Number.isSafeInteger(parsed?.runtimeCursor) && parsed.runtimeCursor >= 0
            ? parsed.runtimeCursor
            : 0,
        pending: Array.isArray(parsed?.pending)
          ? parsed.pending.filter((event) => {
              try {
                validateRuntimeTelemetryEvent(event);
                return true;
              } catch {
                return false;
              }
            })
          : [],
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { version: 1, runtimeCursor: 0, pending: [] };
      }
      throw error;
    }
  }

  async writeState(state) {
    const directory = path.dirname(this.stateFile);
    await fs.mkdir(directory, { recursive: true });
    const tempFile = `${this.stateFile}.tmp`;
    await fs.writeFile(
      tempFile,
      JSON.stringify({
        version: 1,
        runtimeCursor: state.runtimeCursor,
        pending: state.pending,
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    await fs.rename(tempFile, this.stateFile);
  }
}

function validateRuntimeTelemetryEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("RUNTIME_TELEMETRY_EVENT_INVALID");
  }
  for (const key of [
    "eventId",
    "eventType",
    "occurredAt",
    "producer",
    "severity",
    "component",
    "componentVersion",
  ]) {
    if (typeof event[key] !== "string" || !event[key]) {
      throw new Error(`RUNTIME_TELEMETRY_${key.toUpperCase()}_INVALID`);
    }
  }
  if (event.producer !== "owl-runtime") {
    throw new Error("RUNTIME_TELEMETRY_PRODUCER_INVALID");
  }
  if (!["info", "warn", "error", "critical"].includes(event.severity)) {
    throw new Error("RUNTIME_TELEMETRY_SEVERITY_INVALID");
  }
  if (event.eventVersion !== 1) {
    throw new Error("RUNTIME_TELEMETRY_VERSION_INVALID");
  }

  const attributes = event.attributes ?? {};
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    throw new Error("RUNTIME_TELEMETRY_ATTRIBUTES_INVALID");
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`RUNTIME_TELEMETRY_SENSITIVE_ATTRIBUTE:${key}`);
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new Error(`RUNTIME_TELEMETRY_ATTRIBUTE_INVALID:${key}`);
    }
  }
  return event;
}

function boundedPending(events, maxPending) {
  if (events.length <= maxPending) return events;

  const priority = { critical: 0, error: 1, warn: 2, info: 3 };
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (left, right) =>
        (priority[left.event.severity] ?? 4) -
          (priority[right.event.severity] ?? 4) ||
        left.index - right.index,
    )
    .slice(0, maxPending)
    .sort((left, right) => left.index - right.index)
    .map(({ event }) => event);
}
