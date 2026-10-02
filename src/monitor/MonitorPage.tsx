import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cloud,
  Copy,
  Cpu,
  GitBranch,
  Inbox,
  Network,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type {
  ActivityEntry,
  AgentRequest,
  RuntimeSnapshot,
  SkillManagerSnapshot,
} from "../types";
import { buildMonitorModel } from "./monitorModel";
import { buildMcpInteractionFeed } from "./interactionModel";
import { LiveOperationsGraph } from "./LiveOperationsGraph";
import { ApprovalAttention } from "../approvals/ApprovalAttention";
import {
  buildWorkstreamBoard,
  type WorkstreamBoard,
} from "./workstreamModel";
import {
  buildOrchestrationModel,
  type OrchestrationGraphNode,
  type OrchestrationModel,
} from "./orchestrationModel";

type MonitorTab = "live" | "timeline" | "graph" | "system";

const formatClock = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

const formatDuration = (value?: number | null) => {
  if (typeof value !== "number" || value < 0) return "—";
  if (value < 1000) return String(Math.round(value)) + " ms";
  if (value < 60_000) return (value / 1000).toFixed(1) + " s";
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return String(minutes) + "m " + String(seconds) + "s";
};

const formatCompactNumber = (value: number) => {
  const bounded = Math.max(0, value);
  if (bounded >= 1_000_000) {
    const scaled = bounded / 1_000_000;
    return scaled.toFixed(scaled < 10 ? 1 : 0).replace(/\.0$/, "") + "M";
  }
  if (bounded >= 1_000) {
    const scaled = bounded / 1_000;
    return scaled.toFixed(scaled < 10 ? 1 : 0).replace(/\.0$/, "") + "K";
  }
  return String(Math.round(bounded));
};

function ConversationContinuityCard({
  board,
  continuation,
}: {
  board: WorkstreamBoard;
  continuation: RuntimeSnapshot["mcp"]["continuation"];
}) {
  const [copied, setCopied] = useState(false);
  const candidates = board.streams
    .filter((stream) => Boolean(stream.continuity))
    .sort((left, right) => {
      const leftPriority =
        (left.sourceKind === "ChatGPT" ? 10_000 : 0) +
        (left.isCurrent ? 1_000 : 0) +
        Number(left.continuity?.score ?? 0);
      const rightPriority =
        (right.sourceKind === "ChatGPT" ? 10_000 : 0) +
        (right.isCurrent ? 1_000 : 0) +
        Number(right.continuity?.score ?? 0);
      return rightPriority - leftPriority;
    });
  const stream = candidates[0];
  const continuity = stream?.continuity ?? null;
  if (!stream || !continuity) return null;

  const latestHandoff =
    continuation?.latestReadyHandoff?.sourceWorkstreamId === stream.ownerId
      ? continuation.latestReadyHandoff
      : null;
  const risk = continuity.risk.toUpperCase();
  const duplicatePercent = Math.round(continuity.duplicateRatio * 100);
  const resumePrompt = latestHandoff
    ? [
        "Continue OWL LAB using Planner Handoff " + latestHandoff.id + ".",
        "Resume workstream " + latestHandoff.sourceWorkstreamId + ".",
        "Inspect existing Runtime Task state before doing replacement work.",
        "Do not create replacement tasks merely because the ChatGPT conversation changed.",
      ].join(" ")
    : "";

  const copyResumePrompt = async () => {
    if (!resumePrompt) return;
    try {
      await navigator.clipboard.writeText(resumePrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={"panel continuity-card risk-" + continuity.risk}>
      <div className="continuity-head">
        <div>
          <span className="eyebrow">CONVERSATION CONTINUITY</span>
          <div className="continuity-title-row">
            <h3>{stream.sourceLabel}</h3>
            <span className={"continuity-risk risk-" + continuity.risk}>
              {risk}
            </span>
          </div>
          <p>
            OWL-observed MCP traffic only — not OpenAI&apos;s actual context
            window.
          </p>
        </div>
        <div className={"continuity-state " + continuity.state}>
          <ShieldCheck size={16} />
          <span>{continuity.state.replaceAll("_", " ")}</span>
        </div>
      </div>

      <div className="continuity-metrics">
        <div>
          <span>Observed context</span>
          <strong>~{formatCompactNumber(continuity.observedTokenEquivalent)}</strong>
          <small>token-equivalent heuristic</small>
        </div>
        <div>
          <span>Growth</span>
          <strong>
            +{formatCompactNumber(continuity.recentGrowthTokenEquivalent)}
          </strong>
          <small>last {continuity.windowMinutes} min</small>
        </div>
        <div>
          <span>Repeated payload</span>
          <strong>{duplicatePercent}%</strong>
          <small>exact sanitized payload hashes</small>
        </div>
        <div>
          <span>OWL calls</span>
          <strong>{continuity.toolCallCount}</strong>
          <small>{formatDuration(continuity.sessionAgeMs)} workstream age</small>
        </div>
      </div>

      <div className="continuity-foot">
        <div className="continuity-handoff-copy">
          <strong>
            {continuity.handoffReady
              ? "Handoff snapshot ready"
              : continuity.risk === "high" || continuity.risk === "critical"
                ? "Handoff recommended"
                : "Continuity protected"}
          </strong>
          <span>
            {latestHandoff
              ? latestHandoff.id
              : continuity.risk === "high" || continuity.risk === "critical"
                ? continuity.reasons[0]?.detail ??
                  "A durable Planner Handoff is being prepared."
                : continuity.risk === "medium"
                  ? "Growing, but no handoff is required yet. OWL will prepare one automatically at HIGH."
                  : "No handoff needed. OWL will snapshot automatically before recommending a new Chat."}
          </span>
        </div>
        {latestHandoff && (
          <button
            className="secondary continuity-copy-button"
            onClick={() => void copyResumePrompt()}
          >
            <Copy size={14} />
            {copied ? "Copied" : "Copy Resume Prompt"}
          </button>
        )}
      </div>
    </section>
  );
}

function StatusBadge({
  status,
  tone,
}: {
  status: string;
  tone?: string;
}) {
  return (
    <span className={"orch-status " + (tone ?? "neutral")}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  progress,
}: {
  label: string;
  value: string | number;
  detail: string;
  progress?: number | null;
}) {
  return (
    <div className="orch-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {typeof progress === "number" && (
        <div className="orch-progress-track">
          <i style={{ width: String(Math.max(0, Math.min(100, progress))) + "%" }} />
        </div>
      )}
      <small>{detail}</small>
    </div>
  );
}

function TaskInspector({ model }: { model: OrchestrationModel }) {
  const task = model.inspector;
  if (!task) {
    return (
      <section className="panel orch-inspector">
        <div className="empty">No durable Task is available to inspect.</div>
      </section>
    );
  }

  return (
    <section className="panel orch-inspector">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SELECTED TASK</span>
          <h3>{task.label}</h3>
        </div>
        <StatusBadge
          status={task.status}
          tone={
            task.status === "completed"
              ? "healthy"
              : task.status === "running"
                ? "active"
                : ["blocked", "needs_review", "failed"].includes(task.status)
                  ? "attention"
                  : "waiting"
          }
        />
      </div>

      <div className="orch-inspector-grid">
        <div>
          <span>Current action</span>
          <strong>{task.currentAction}</strong>
          <small>{task.currentDetail || "No active step."}</small>
        </div>
        <div>
          <span>Owner</span>
          <strong title={task.owner}>{task.owner}</strong>
          <small>Stable Runtime owner identity</small>
        </div>
        <div>
          <span>Progress</span>
          <strong>
            {task.progressPercent === null ? "—" : String(task.progressPercent) + "%"}
          </strong>
          <small>
            {task.stepCounts.succeeded}/{task.stepCounts.total} steps succeeded
          </small>
        </div>
        <div>
          <span>Verification</span>
          <strong>
            {task.verification.verified}/{task.verification.required}
          </strong>
          <small>
            {task.verification.uncertain} uncertain · {task.verification.missing} missing
          </small>
        </div>
        <div>
          <span>Evidence memory</span>
          <strong>{task.memory.eventCount} events</strong>
          <small>
            {task.memory.stagedArtifacts} staged artifacts · {task.memory.workingOutputs} outputs
          </small>
        </div>
        <div>
          <span>Next step</span>
          <strong>{task.nextStep ?? "—"}</strong>
          <small>
            Updated {formatClock(task.updatedAt)}
          </small>
        </div>
      </div>
    </section>
  );
}

function WorksetView({ model }: { model: OrchestrationModel }) {
  if (!model.workset || model.workset.taskCount <= 1) return null;
  return (
    <section className="panel orch-workset-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">GOAL WORKSET</span>
          <h3>{model.workset.label}</h3>
        </div>
        <span className="neutral-pill">
          {model.workset.taskCount} durable tasks
        </span>
      </div>
      <div className="orch-workset-list">
        {model.workset.tasks.map((task, index) => (
          <article
            key={task.id}
            className={task.id === model.focusTaskId ? "selected" : ""}
          >
            <div className="orch-workset-index">{index + 1}</div>
            <div className="orch-workset-copy">
              <strong>{task.label}</strong>
              <span>
                {task.parentTaskId
                  ? "child of " + task.parentTaskId
                  : "root / sibling task"}
              </span>
              {typeof task.progressPercent === "number" && (
                <div className="orch-progress-track compact">
                  <i style={{ width: String(task.progressPercent) + "%" }} />
                </div>
              )}
            </div>
            <StatusBadge
              status={task.status}
              tone={
                task.status === "completed"
                  ? "healthy"
                  : task.status === "running"
                    ? "active"
                    : ["failed", "blocked", "needs_review"].includes(task.status)
                      ? "attention"
                      : "waiting"
              }
            />
          </article>
        ))}
      </div>
      <div className="orch-workset-foot">
        <code>{model.workset.orchestrationId}</code>
        <span>
          Membership comes from Runtime orchestration metadata, not session inference.
        </span>
      </div>
    </section>
  );
}

function LiveView({ model }: { model: OrchestrationModel }) {
  return (
    <>
      <section className="orch-summary-grid">
        <SummaryMetric
          label="Overall"
          value={String(model.headline.overallPercent) + "%"}
          detail={model.headline.label}
          progress={model.headline.overallPercent}
        />
        <SummaryMetric
          label="Running"
          value={model.headline.running}
          detail="Executable steps"
        />
        <SummaryMetric
          label="Waiting"
          value={model.headline.waiting}
          detail="Approval / review"
        />
        <SummaryMetric
          label="Completed"
          value={
            String(model.headline.completedSteps) +
            "/" +
            String(model.headline.totalSteps)
          }
          detail="Current work scope"
        />
      </section>

      <WorksetView model={model} />

      <section className="panel orch-actors-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LIVE ORCHESTRATION</span>
            <h3>Who is doing what</h3>
          </div>
          <span className="neutral-pill">Updated live</span>
        </div>
        <div className="orch-actor-list">
          {model.actors.map((actor) => (
            <article key={actor.id}>
              <div className="orch-actor-identity">
                <strong>{actor.label}</strong>
                <span>{actor.role}</span>
              </div>
              <div className="orch-actor-work">
                <strong>{actor.action}</strong>
                <span>{actor.detail}</span>
                {typeof actor.progressPercent === "number" && (
                  <div className="orch-progress-track compact">
                    <i style={{ width: String(actor.progressPercent) + "%" }} />
                  </div>
                )}
              </div>
              <StatusBadge status={actor.status} tone={actor.tone} />
            </article>
          ))}
        </div>
      </section>

      <section className="orch-compression panel">
        <div>
          <span className="eyebrow">ORCHESTRATION COMPRESSION</span>
          <h3>Many execution facts → one live state model</h3>
          <p>
            Runtime Task state, VerificationReceipts, AgentRequests, Cloud commands
            and Desktop RuntimeEvent projection are compressed into this view.
            Chat UI scraping is not used.
          </p>
        </div>
        <div className="orch-compression-flow">
          <span>RuntimeEvent</span>
          <ChevronRight size={15} />
          <span>AgentRequest</span>
          <ChevronRight size={15} />
          <span>MonitorViewModel</span>
        </div>
      </section>

      <TaskInspector model={model} />
    </>
  );
}

function OperationsAssurance({
  snapshot,
  board,
}: {
  snapshot: RuntimeSnapshot | null;
  board: WorkstreamBoard;
}) {
  const access = snapshot?.runtimeAccess ?? null;
  const signedLease =
    access?.mode === "enforced" &&
    access.state === "READY" &&
    access.grant?.signatureVerified === true;
  const locked =
    access?.state === "LOCKED" || access?.state === "REVOKED";
  const eventState = snapshot?.runtimeEvents?.status ?? "stopped";
  const observableHealthy =
    snapshot?.mode === "live" &&
    eventState === "healthy";
  const progressTimes = board.streams
    .map((stream) => stream.progressPolicy.lastProgressAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  const latestProgressAt =
    progressTimes.length > 0 ? new Date(Math.max(...progressTimes)).toISOString() : null;
  const persistentHealthy = snapshot?.mode === "live";
  const leaseExpiry = access?.grant?.expiresAt ?? null;

  const cards = [
    {
      key: "persistent",
      title: "PERSISTENT",
      status: persistentHealthy ? "HEALTHY" : "ATTENTION",
      tone: persistentHealthy ? "healthy" : "attention",
      icon: <Clock3 size={18} />,
      primary:
        board.activeCount > 0
          ? `${board.activeCount} recoverable workstream${board.activeCount === 1 ? "" : "s"}`
          : "Ready for durable work",
      detail: latestProgressAt
        ? `Last progress ${formatClock(latestProgressAt)} · chat may disconnect`
        : "Runtime-owned work survives chat disconnects",
    },
    {
      key: "observable",
      title: "OBSERVABLE",
      status: observableHealthy ? "LIVE" : eventState.replaceAll("_", " ").toUpperCase(),
      tone: observableHealthy ? "active" : "attention",
      icon: <Activity size={18} />,
      primary: `${board.connectedSources} source${board.connectedSources === 1 ? "" : "s"} · ${board.workingCount} executing`,
      detail:
        eventState === "healthy"
          ? "Runtime events current · semantic handoffs visible"
          : "Runtime event stream needs attention",
    },
    {
      key: "authorized",
      title: "AUTHORIZED",
      status: signedLease ? "VERIFIED" : locked ? "LOCKED" : "CHECK",
      tone: signedLease ? "healthy" : locked ? "attention" : "waiting",
      icon: <ShieldCheck size={18} />,
      primary: signedLease
        ? "Cloud-signed Runtime access"
        : locked
          ? "Local computer access denied"
          : access?.mode === "compat"
            ? "Compatibility access"
            : "Authorization state pending",
      detail: signedLease
        ? `Signature verified · lease until ${formatClock(leaseExpiry)}`
        : locked
          ? `Reason: ${access?.reasonCode ?? "AUTHORIZATION_REQUIRED"}`
          : `Mode: ${access?.mode ?? "unknown"}`,
    },
  ];

  return (
    <section className="operations-assurance" aria-label="OWL LAB guarantees">
      {cards.map((card) => (
        <article className={"assurance-card " + card.tone} key={card.key}>
          <div className="assurance-head">
            <span className="assurance-icon">{card.icon}</span>
            <div>
              <span>{card.title}</span>
              <strong>{card.status}</strong>
            </div>
          </div>
          <b>{card.primary}</b>
          <small>{card.detail}</small>
        </article>
      ))}
    </section>
  );
}

function LiveInteractionFeed({
  activity,
}: {
  activity: ActivityEntry[];
}) {
  const interactions = useMemo(
    () => buildMcpInteractionFeed(activity, 24),
    [activity],
  );

  return (
    <section className="panel live-interaction-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">REAL MCP INTERACTIONS</span>
          <h3>ChatGPT / agent ↔ OWL LAB · actual request and response payloads</h3>
        </div>
        <span className="neutral-pill">Live · 750 ms · {interactions.length} recent</span>
      </div>

      <p className="interaction-help">
        This stream comes directly from the MCP tool wrapper. Payload previews are real and bounded;
        credential-like fields are redacted automatically.
      </p>

      <div className="interaction-list">
        {interactions.map((interaction) => (
          <article
            className={"interaction-card " + interaction.status}
            key={interaction.id}
          >
            <div className="interaction-head">
              <div className="interaction-route">
                <strong>{interaction.clientLabel}</strong>
                <ChevronRight size={13} />
                <strong>OWL LAB</strong>
                <code>{interaction.tool}</code>
              </div>
              <div className="interaction-state">
                <StatusBadge
                  status={interaction.status}
                  tone={
                    interaction.status === "success"
                      ? "healthy"
                      : interaction.status === "error"
                        ? "attention"
                        : "active"
                  }
                />
                <time>{formatClock(interaction.completedAt ?? interaction.startedAt)}</time>
                {interaction.durationMs !== null && (
                  <span>{formatDuration(interaction.durationMs)}</span>
                )}
              </div>
            </div>

            <div className="interaction-pair">
              <div className="interaction-direction request">
                <div className="interaction-direction-head">
                  <strong>{interaction.clientLabel} → OWL LAB</strong>
                  <span>REQUEST</span>
                </div>
                <pre>{interaction.requestPreview ?? "No request payload captured."}</pre>
              </div>

              <div className="interaction-direction response">
                <div className="interaction-direction-head">
                  <strong>OWL LAB → {interaction.clientLabel}</strong>
                  <span>{interaction.status === "running" ? "RUNNING" : "RESPONSE"}</span>
                </div>
                <pre>
                  {interaction.status === "running"
                    ? "Waiting for OWL Runtime / tool completion…"
                    : interaction.responsePreview ?? "No response payload captured."}
                </pre>
              </div>
            </div>

            <div className="interaction-foot">
              {interaction.workstreamId && (
                <span title={interaction.workstreamId}>
                  workstream {interaction.workstreamId.slice(-10)}
                </span>
              )}
              {interaction.runtimeSessionId && (
                <span title={interaction.runtimeSessionId}>
                  runtime {interaction.runtimeSessionId.slice(-10)}
                </span>
              )}
              {interaction.transportSessionId && (
                <span title={interaction.transportSessionId}>
                  transport {interaction.transportSessionId.slice(-8)}
                </span>
              )}
              {interaction.errorCode && <span>error {interaction.errorCode}</span>}
            </div>
          </article>
        ))}

        {interactions.length === 0 && (
          <div className="monitor-clear interaction-empty">
            <Activity size={20} />
            <div>
              <strong>Waiting for the next real MCP interaction</strong>
              <span>
                The next ChatGPT/Worker tool call will appear here immediately as request → response.
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function WorkstreamsView({
  board,
  model,
}: {
  board: WorkstreamBoard;
  model: OrchestrationModel;
}) {
  const statusTone = (status: string) =>
    status === "attention"
      ? "attention"
      : status === "working"
        ? "active"
        : status === "waiting"
          ? "waiting"
          : status === "idle"
            ? "healthy"
            : "neutral";

  return (
    <>
      <section className="workstream-summary">
        <SummaryMetric label="Workstreams" value={board.activeCount} detail={board.activeCount === 1 ? "active source" : "active sources"} />
        <SummaryMetric label="Executing" value={board.workingCount} detail="doing work now" />
        <SummaryMetric label="Waiting" value={board.waitingCount} detail="user / runtime / external" />
        <SummaryMetric label="Attention" value={board.attentionCount} detail="needs intervention" />
      </section>

      <section className="panel workstream-board">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LIVE WORKSTREAMS</span>
            <h3>Who asked → who is handling → what happens next</h3>
          </div>
          <span className="neutral-pill">
            {board.connectedSources} source{board.connectedSources === 1 ? "" : "s"} connected
          </span>
        </div>

        <div className="workstream-list">
          {board.streams.map((stream) => (
            <article className={"workstream-card " + stream.status} key={stream.id}>
              <div className="workstream-head">
                <div className="workstream-source">
                  <span className="workstream-source-icon">
                    {stream.sourceKind === "Cloud" ? <Cloud size={16} /> : <Workflow size={16} />}
                  </span>
                  <div>
                    <strong>{stream.sourceLabel}</strong>
                    <span>{stream.sourceKind} · {stream.transportCount} transport{stream.transportCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <StatusBadge status={stream.status} tone={statusTone(stream.status)} />
              </div>

              <div className="workstream-goal">
                <span>Goal</span>
                <strong>{stream.goal}</strong>
                {stream.phase && <small>{stream.phase}</small>}
              </div>

              <div className="workstream-route" aria-label="Current work route">
                <span>User / caller</span>
                <ChevronRight size={14} />
                <span>{stream.sourceLabel}</span>
                <ChevronRight size={14} />
                <span className={stream.currentExecutor === "OWL Runtime" ? "active" : ""}>OWL Runtime</span>
              </div>

              <div className="workstream-current">
                <div><span>Executing now</span><strong>{stream.currentExecutor}</strong></div>
                <div><span>Current action</span><strong>{stream.currentAction}</strong></div>
                <div><span>Tasks</span><strong>{stream.tasks.filter((task) => task.status === "running").length} running · {stream.tasks.length} linked</strong></div>
                <div>
                  <span>Progress cadence</span>
                  <strong className={stream.progressPolicy.updateRecommended ? "workstream-due" : ""}>
                    {stream.progressPolicy.updateRecommended
                      ? `Update due · ${stream.progressPolicy.toolStepsSinceProgress} steps since report`
                      : `${stream.progressPolicy.toolStepsSinceProgress} / ${stream.progressPolicy.maxToolSteps} steps · ${Math.round(stream.progressPolicy.intervalMs / 1000)}s policy`}
                  </strong>
                </div>
              </div>

              {stream.messages.length > 0 && (
                <div className="workstream-messages">
                  <span className="workstream-subhead">Recent handoffs</span>
                  {stream.messages.slice(0, 4).map((message) => (
                    <div className="workstream-message" key={message.id}>
                      <div className="workstream-message-route">
                        <strong>{message.from}</strong>
                        <ChevronRight size={12} />
                        <strong>{message.to}</strong>
                      </div>
                      <span>{message.summary}</span>
                      <time>{formatClock(message.at)}</time>
                    </div>
                  ))}
                </div>
              )}

              <div className="workstream-next">
                <span className="workstream-subhead">Next</span>
                {stream.nextActions.length > 0 ? (
                  <ol>
                    {stream.nextActions.slice(0, 4).map((action) => <li key={action}>{action}</li>)}
                  </ol>
                ) : (
                  <span className="workstream-empty-next">
                    {stream.status === "idle" || stream.status === "disconnected"
                      ? "No queued next action."
                      : "Waiting for the current execution state to advance."}
                  </span>
                )}
              </div>
            </article>
          ))}

          {board.streams.length === 0 && (
            <div className="monitor-clear">
              <CheckCircle2 size={20} />
              <div>
                <strong>No active workstreams</strong>
                <span>New ChatGPT, Worker or Cloud work will appear here independently.</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <details className="panel workstream-details">
        <summary>
          <div>
            <span className="eyebrow">DETAILED EXECUTION</span>
            <strong>Task actors, verification and evidence</strong>
          </div>
          <ChevronRight size={16} />
        </summary>
        <div className="workstream-details-body">
          <LiveView model={model} />
        </div>
      </details>
    </>
  );
}

function TimelineView({ model }: { model: OrchestrationModel }) {
  return (
    <>
      <section className="panel orch-timeline-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SEMANTIC TIMELINE</span>
            <h3>Meaningful state transitions</h3>
          </div>
          <span className="neutral-pill">{model.milestones.length} milestones</span>
        </div>
        <div className="orch-timeline">
          {model.milestones.map((item) => (
            <article key={item.id}>
              <time>{formatClock(item.at)}</time>
              <i className={"orch-timeline-dot " + item.tone} />
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <small>{item.source}</small>
              </div>
              <StatusBadge status={item.status} tone={item.tone} />
            </article>
          ))}
          {model.milestones.length === 0 && (
            <div className="empty">
              Select a Task with Runtime events to build its semantic timeline.
            </div>
          )}
        </div>
      </section>
      <TaskInspector model={model} />
    </>
  );
}

function graphDimensions(nodes: OrchestrationGraphNode[]) {
  const levels = Math.max(0, ...nodes.map((node) => node.level));
  const rowsByLevel = new Map<number, number>();
  for (const node of nodes) {
    rowsByLevel.set(
      node.level,
      Math.max(rowsByLevel.get(node.level) ?? 0, node.order + 1),
    );
  }
  const rows = Math.max(1, ...rowsByLevel.values());
  return {
    width: Math.max(720, 170 + levels * 210),
    height: Math.max(260, 90 + rows * 120),
  };
}

function GraphView({ model }: { model: OrchestrationModel }) {
  const { nodes, edges, criticalPathNodeIds } = model.graph;
  const dimensions = graphDimensions(nodes);
  const nodeWidth = 155;
  const nodeHeight = 64;
  const point = (node: OrchestrationGraphNode) => ({
    x: 34 + node.level * 210,
    y: 38 + node.order * 120,
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return (
    <>
      <WorksetView model={model} />
      <section className="panel orch-graph-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">TASK DEPENDENCY GRAPH</span>
            <h3>Canonical Runtime DAG</h3>
          </div>
          <span className="neutral-pill">
            {nodes.length} steps · longest dependency chain {criticalPathNodeIds.length}
          </span>
        </div>
        <div className="orch-graph-scroll">
          {nodes.length > 0 ? (
            <svg
              viewBox={"0 0 " + String(dimensions.width) + " " + String(dimensions.height)}
              role="img"
              aria-label="Selected Runtime Task dependency graph"
            >
              <defs>
                <marker
                  id="orch-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className="orch-arrow-head" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const from = byId.get(edge.from);
                const to = byId.get(edge.to);
                if (!from || !to) return null;
                const a = point(from);
                const b = point(to);
                const critical =
                  criticalPathNodeIds.includes(from.id) &&
                  criticalPathNodeIds.includes(to.id) &&
                  criticalPathNodeIds.indexOf(to.id) ===
                    criticalPathNodeIds.indexOf(from.id) + 1;
                const startX = a.x + nodeWidth;
                const startY = a.y + nodeHeight / 2;
                const endX = b.x;
                const endY = b.y + nodeHeight / 2;
                const midX = (startX + endX) / 2;
                return (
                  <path
                    key={edge.from + ":" + edge.to}
                    d={
                      "M " +
                      String(startX) +
                      " " +
                      String(startY) +
                      " C " +
                      String(midX) +
                      " " +
                      String(startY) +
                      ", " +
                      String(midX) +
                      " " +
                      String(endY) +
                      ", " +
                      String(endX) +
                      " " +
                      String(endY)
                    }
                    className={"orch-edge " + (critical ? "critical" : "")}
                    markerEnd="url(#orch-arrow)"
                  />
                );
              })}
              {nodes.map((node) => {
                const p = point(node);
                const critical = criticalPathNodeIds.includes(node.id);
                const label =
                  node.label.length > 22
                    ? node.label.slice(0, 20) + "…"
                    : node.label;
                return (
                  <g
                    key={node.id}
                    className={
                      "orch-graph-node " +
                      node.tone +
                      (critical ? " critical" : "")
                    }
                  >
                    <rect
                      x={p.x}
                      y={p.y}
                      width={nodeWidth}
                      height={nodeHeight}
                      rx="9"
                    />
                    <text x={p.x + 12} y={p.y + 22} className="node-title">
                      {label}
                    </text>
                    <text x={p.x + 12} y={p.y + 39} className="node-detail">
                      {node.detail + " · " + node.status.replaceAll("_", " ")}
                    </text>
                    <text x={p.x + 12} y={p.y + 54} className="node-meta">
                      {node.verificationStatus
                        ? "verify " + node.verificationStatus
                        : formatDuration(node.durationMs)}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="empty">
              Select a Task and load its public Runtime detail to render the DAG.
            </div>
          )}
        </div>
        <div className="orch-graph-note">
          <GitBranch size={14} />
          <span>
            Highlighted route is the structural longest dependency chain. It is
            not presented as a time estimate until Runtime exposes duration-aware
            critical-path semantics.
          </span>
        </div>
      </section>
      <TaskInspector model={model} />
    </>
  );
}

function SystemView({ model }: { model: OrchestrationModel }) {
  const system = model.system;
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EXECUTION TOPOLOGY</span>
            <h3>Worker fabric</h3>
          </div>
          <Network size={18} />
        </div>
        <div className="monitor-topology">
          {system.connectivity.map((node, index) => (
            <div className="monitor-topology-item" key={node.id}>
              <div className={"monitor-node " + node.state}>
                <span className="monitor-node-state" />
                <strong>{node.label}</strong>
                <small>{node.detail}</small>
              </div>
              {index < system.connectivity.length - 1 && (
                <span className="monitor-link">→</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="orch-system-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">VERIFICATION</span>
              <h3>Canonical receipts</h3>
            </div>
            <ShieldCheck size={18} />
          </div>
          <div className="orch-mini-metrics">
            <SummaryMetric
              label="Required"
              value={system.verification.required}
              detail="Steps"
            />
            <SummaryMetric
              label="Verified"
              value={system.verification.verified}
              detail="Confirmed"
            />
            <SummaryMetric
              label="Uncertain"
              value={system.verification.uncertain}
              detail="Review"
            />
            <SummaryMetric
              label="Missing"
              value={system.verification.missing}
              detail="Pending"
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">COORDINATION</span>
              <h3>Requests, skills and cloud</h3>
            </div>
            <Workflow size={18} />
          </div>
          <div className="orch-system-facts">
            <div><Inbox size={15} /><span>Open AgentRequests</span><strong>{system.requests.pending + system.requests.claimed}</strong></div>
            <div><Puzzle size={15} /><span>Ready Skills</span><strong>{system.skills.ready}</strong></div>
            <div><Cloud size={15} /><span>Cloud uncertain</span><strong>{system.cloud.uncertain}</strong></div>
            <div><Cpu size={15} /><span>Running processes</span><strong>{system.processes.running}</strong></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ATTENTION QUEUE</span>
            <h3>Signals that may block autonomy</h3>
          </div>
          <AlertTriangle size={18} />
        </div>
        <div className="monitor-attention-list">
          {system.attention.map((item) => (
            <article className={"monitor-attention-item " + item.severity} key={item.id}>
              <AlertTriangle size={16} />
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            </article>
          ))}
          {system.attention.length === 0 && (
            <div className="monitor-clear">
              <CheckCircle2 size={20} />
              <div>
                <strong>No blocking signals</strong>
                <span>Current canonical projections do not require intervention.</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <TaskInspector model={model} />
    </>
  );
}

export function MonitorPage({
  snapshot,
  agentRequests,
  activity,
  onRefresh,
  onApproveApproval,
  onDenyApproval,
}: {
  snapshot: RuntimeSnapshot | null;
  agentRequests: AgentRequest[];
  activity: ActivityEntry[];
  onRefresh(): Promise<void>;
  onApproveApproval(approvalId: string): Promise<void>;
  onDenyApproval(approvalId: string): Promise<void>;
}) {
  const workstreamBoard = useMemo(
    () =>
      buildWorkstreamBoard({
        snapshot,
        agentRequests,
        now: Date.now(),
      }),
    [snapshot, agentRequests, activity],
  );

  return (
    <>
      <div className="section-header orch-header single-monitor-header">
        <div>
          <div className="orch-live-title">
            <span className="orch-live-dot" />
            <h1>Agent Operations</h1>
          </div>
          <p>
            One live view of real agent traffic, authorization, durable execution
            and current work.
          </p>
        </div>
        <div className="orch-header-actions">
          <button
            className="secondary"
            onClick={() => void onRefresh()}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>

      <ApprovalAttention
        approvals={snapshot?.approvals}
        onApprove={onApproveApproval}
        onDeny={onDenyApproval}
        compact
      />

      <ConversationContinuityCard
        board={workstreamBoard}
        continuation={snapshot?.mcp.continuation}
      />

      <LiveOperationsGraph
        snapshot={snapshot}
        activity={activity}
        board={workstreamBoard}
      />

      <div className="contract-note orch-contract-note single-monitor-note">
        <Activity size={17} />
        <div>
          <strong>Live means current.</strong>
          <p>
            Historical Runtime Tasks, old AgentRequests and diagnostic projections
            no longer occupy this screen. This view follows actual MCP traffic and
            current durable work only.
          </p>
        </div>
      </div>
    </>
  );
}
