import assert from "node:assert/strict";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";

const baseUrl =
  process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:8788";

const client = new RuntimeHttpClient({
  baseUrl,
  sessionId: "owl-desktop:integration:request-replay",
});

const request = {
  label: "desktop-runtime-r1-live-replay",
  steps: [
    {
      id: "status",
      action: "git.status",
      args: {
        cwd:
          process.env.OWL_RUNTIME_FIXTURE_REPO?.trim() ||
          process.cwd(),
      },
    },
  ],
};

const idempotencyKey = "integration:cloud:command:r1-live";
const createdIds = new Set();

async function cleanup() {
  for (const taskId of createdIds) {
    await client
      .invoke(
        "tasks.delete",
        { taskId },
        {
          requestId: "cleanup:" + taskId,
          idempotencyKey: "cleanup:" + taskId,
          timeoutMs: 10_000,
        },
      )
      .catch(() => undefined);
  }
}

try {
  const capabilities = await client.capabilities(
    "consequential request replay",
  );
  assert.equal(
    capabilities?.extensions?.consequentialRequestReplay?.version,
    1,
    "Runtime must advertise consequentialRequestReplay v1",
  );

  const first = await client.createTask(request, {
    requestId: "integration-attempt:first",
    idempotencyKey,
    timeoutMs: 15_000,
  });
  const firstId = first?.id ?? first?.taskId;
  assert.equal(typeof firstId, "string");
  createdIds.add(firstId);

  const second = await client.createTask(request, {
    requestId: "integration-attempt:retry",
    idempotencyKey,
    timeoutMs: 15_000,
  });
  const secondId = second?.id ?? second?.taskId;
  assert.equal(secondId, firstId);

  const tasks = await client.tasks();
  assert.ok(Array.isArray(tasks));
  const matching = tasks.filter(
    (task) => task?.label === request.label,
  );
  assert.equal(
    matching.length,
    1,
    "same logical mutation must materialize exactly one Runtime Task",
  );
  assert.equal(matching[0]?.id, firstId);

  await assert.rejects(
    () =>
      client.createTask(
        {
          ...request,
          label: "desktop-runtime-r1-conflicting-request",
        },
        {
          requestId: "integration-attempt:conflict",
          idempotencyKey,
          timeoutMs: 15_000,
        },
      ),
    (error) =>
      error?.code === "IDEMPOTENCY_KEY_CONFLICT" &&
      error?.runtimeResponded === true,
  );

  const otherSession = new RuntimeHttpClient({
    baseUrl,
    sessionId: "owl-desktop:integration:request-replay:other-session",
  });
  const third = await otherSession.createTask(request, {
    requestId: "integration-attempt:other-session",
    idempotencyKey,
    timeoutMs: 15_000,
  });
  const thirdId = third?.id ?? third?.taskId;
  assert.equal(typeof thirdId, "string");
  assert.notEqual(
    thirdId,
    firstId,
    "same key in another logical session must have an independent replay scope",
  );
  createdIds.add(thirdId);

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtimeReplayVersion: 1,
        sameLogicalRequestOneTask: true,
        retryReturnedCanonicalTask: true,
        requestDigestConflictFailClosed: true,
        logicalSessionScopedReplay: true,
        canonicalTaskId: firstId,
      },
      null,
      2,
    ),
  );
} finally {
  await cleanup();
}
