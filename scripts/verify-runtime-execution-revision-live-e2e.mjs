import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";

const baseUrl = process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:8788";
const fixtureRepo = process.env.OWL_RUNTIME_FIXTURE_REPO?.trim();
if (!fixtureRepo) throw new Error("OWL_RUNTIME_FIXTURE_REPO is required.");

const outputPath = path.join(fixtureRepo, ".owl-r2-live-proof.txt");
await fs.rm(outputPath, { force: true });

const client = new RuntimeHttpClient({
  baseUrl,
  sessionId: "owl-desktop:integration:execution-revision",
});

const createdIds = new Set();
async function cleanup() {
  await fs.rm(outputPath, { force: true }).catch(() => undefined);
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
  const capabilities = await client.capabilities("execution revision");
  assert.equal(capabilities?.extensions?.executionRevision?.version, 1);

  const created = await client.createTask(
    {
      label: "desktop-runtime-r2-live-revision",
      steps: [
        {
          id: "write",
          action: "fs.write",
          args: {
            path: outputPath,
            content: "r2-bound-execution",
          },
        },
      ],
    },
    {
      requestId: "r2:create:first",
      idempotencyKey: "r2:create:logical",
    },
  );
  const taskId = created?.id ?? created?.taskId;
  assert.equal(typeof taskId, "string");
  createdIds.add(taskId);
  const digest = created?.executionRevision?.digest;
  assert.match(digest, /^[a-f0-9]{64}$/);

  await assert.rejects(
    () =>
      client.runTask(taskId, {
        expectedRevisionDigest: "0".repeat(64),
        requestId: "r2:run:mismatch",
        idempotencyKey: "r2:run:mismatch",
      }),
    (error) => error?.code === "EXECUTION_REVISION_DIGEST_MISMATCH",
  );
  await assert.rejects(() => fs.access(outputPath));

  const afterMismatch = await client.getTask(taskId);
  assert.equal(afterMismatch.runCount, 0);
  assert.equal(afterMismatch.status, "pending");

  const completed = await client.runTask(taskId, {
    expectedRevisionDigest: digest,
    requestId: "r2:run:correct",
    idempotencyKey: "r2:run:correct",
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.executionRevision.digest, digest);
  assert.equal(await fs.readFile(outputPath, "utf8"), "r2-bound-execution");

  console.log(JSON.stringify({
    ok: true,
    executionRevisionVersion: 1,
    taskId,
    digest,
    mismatchProducedNoSideEffect: true,
    correctRevisionExecuted: true,
  }, null, 2));
} finally {
  await cleanup();
}
