#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentInboxStore } from "../electron/services/agent-inbox-store.mjs";
import { RuntimeAgentRequestEventConsumer } from "../electron/services/runtime-agent-request-consumer.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fixturePath = new URL(
  "../tests/fixtures/runtime-agent-request-events-v1.json",
  import.meta.url,
);
const events = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "owl-runtime-agent-request-conformance-"),
);

try {
  const inbox = new AgentInboxStore({
    file: path.join(scratch, "agent-inbox.json"),
  });
  const stateFile = path.join(
    scratch,
    "runtime-agent-request-consumer.json",
  );
  const consumer = new RuntimeAgentRequestEventConsumer({
    inbox,
    stateFile,
  });

  const [proposal, withdrawal, revisionThree] = events;

  const materialized = consumer.consume(proposal);
  assert(
    materialized.outcome === "materialized",
    "proposal did not materialize",
  );
  assert(
    inbox.summary().pending === 1,
    "proposal did not create exactly one pending AgentRequest",
  );

  const duplicate = consumer.consume(proposal);
  assert(
    duplicate.status === "duplicate",
    "same event replay was not idempotent",
  );
  assert(
    inbox.summary().pending === 1,
    "same event replay duplicated AgentRequest",
  );

  const withdrawn = consumer.consume(withdrawal);
  assert(
    withdrawn.outcome === "pending_cancelled",
    "withdrawal did not cancel pending matching AgentRequest",
  );
  assert(
    inbox.summary().pending === 0,
    "withdrawal left pending AgentRequest behind",
  );

  const nextRevision = consumer.consume(revisionThree);
  assert(
    nextRevision.outcome === "materialized",
    "new candidate revision did not materialize independently",
  );
  assert(
    nextRevision.request.subject.revision === "3",
    "new candidate revision identity was lost",
  );

  const restarted = new RuntimeAgentRequestEventConsumer({
    inbox,
    stateFile,
  });
  const restartReplay = restarted.consume(revisionThree);
  assert(
    restartReplay.status === "duplicate",
    "consumer restart lost event replay state",
  );

  const journal = restarted.readState();
  assert(
    journal.lastSequence === 102,
    "consumer journal did not retain last sequence",
  );
  assert(
    journal.lastCursor === "runtime-events:102",
    "consumer journal did not retain last cursor",
  );

  console.log("PASS Runtime AgentRequest proposal materialization");
  console.log("PASS at-least-once event replay dedupe");
  console.log("PASS pending-only Runtime withdrawal");
  console.log("PASS candidate revision isolation");
  console.log("PASS consumer restart journal");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
