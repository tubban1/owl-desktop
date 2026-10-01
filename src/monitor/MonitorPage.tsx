import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cloud,
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
}: {
  snapshot: RuntimeSnapshot | null;
  agentRequests: AgentRequest[];
  activity: ActivityEntry[];
  onRefresh(): Promise<void>;
}) {
  const [tab, setTab] = useState<MonitorTab>("live");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<Record<string, unknown> | null>(null);
  const [taskDetailError, setTaskDetailError] = useState<string | null>(null);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [skillSnapshot, setSkillSnapshot] =
    useState<SkillManagerSnapshot | null>(null);
  const [skillLoading, setSkillLoading] = useState(false);

  const loadSkills = async () => {
    setSkillLoading(true);
    try {
      setSkillSnapshot(await window.owlDesktop.skillSnapshot());
    } finally {
      setSkillLoading(false);
    }
  };

  useEffect(() => {
    void loadSkills();
    const timer = window.setInterval(() => void loadSkills(), 6000);
    return () => window.clearInterval(timer);
  }, []);

  const system = useMemo(
    () =>
      buildMonitorModel({
        snapshot,
        agentRequests,
        skillSnapshot,
        activity,
        now: Date.now(),
      }),
    [snapshot, agentRequests, skillSnapshot, activity],
  );

  const baseOrchestration = useMemo(
    () =>
      buildOrchestrationModel({
        snapshot,
        agentRequests,
        skillSnapshot,
        activity,
        system,
        selectedTaskId,
        taskDetail: null,
      }),
    [snapshot, agentRequests, skillSnapshot, activity, system, selectedTaskId],
  );

  const focusTaskId = baseOrchestration.focusTaskId;

  useEffect(() => {
    let cancelled = false;
    if (!focusTaskId) {
      setTaskDetail(null);
      setTaskDetailError(null);
      return;
    }
    setTaskDetailLoading(true);
    void window.owlDesktop
      .monitorTaskDetail(focusTaskId, false)
      .then((detail) => {
        if (cancelled) return;
        setTaskDetail(detail);
        setTaskDetailError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setTaskDetail(null);
        setTaskDetailError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setTaskDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focusTaskId, snapshot?.checkedAt]);

  const model = useMemo(
    () =>
      buildOrchestrationModel({
        snapshot,
        agentRequests,
        skillSnapshot,
        activity,
        system,
        selectedTaskId,
        taskDetail,
      }),
    [
      snapshot,
      agentRequests,
      skillSnapshot,
      activity,
      system,
      selectedTaskId,
      taskDetail,
    ],
  );

  return (
    <>
      <div className="section-header orch-header">
        <div>
          <div className="orch-live-title">
            <span className="orch-live-dot" />
            <h1>Live orchestration</h1>
          </div>
          <p>
            {model.headline.label} · Runtime-owned Task state, dependencies,
            verification and coordination.
          </p>
        </div>
        <div className="orch-header-actions">
          <select
            aria-label="Selected durable task"
            value={selectedTaskId ?? model.focusTaskId ?? ""}
            onChange={(event) => setSelectedTaskId(event.target.value || null)}
          >
            {model.taskChoices.map((task) => (
              <option value={task.id} key={task.id}>
                {task.label} · {task.status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <button
            className="secondary"
            onClick={async () => {
              await Promise.all([onRefresh(), loadSkills()]);
            }}
          >
            <RefreshCw size={15} className={skillLoading || taskDetailLoading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <nav className="orch-tabs" aria-label="Monitor view">
        {(["live", "timeline", "graph", "system"] as MonitorTab[]).map((item) => (
          <button
            type="button"
            key={item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item === "live"
              ? "Live"
              : item === "timeline"
                ? "Timeline"
                : item === "graph"
                  ? "Graph"
                  : "System"}
          </button>
        ))}
      </nav>

      {taskDetailError && (
        <div className="callout warning orch-detail-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>Task detail unavailable</strong>
            <p>{taskDetailError}</p>
          </div>
        </div>
      )}

      {tab === "live" && <LiveView model={model} />}
      {tab === "timeline" && <TimelineView model={model} />}
      {tab === "graph" && <GraphView model={model} />}
      {tab === "system" && <SystemView model={model} />}

      <div className="contract-note orch-contract-note">
        <Activity size={17} />
        <div>
          <strong>One projection, multiple views.</strong>
          <p>
            Live, Timeline and Graph are different readings of the same public
            Runtime Task detail. Desktop does not create a second execution state
            machine and does not scrape ChatGPT output.
          </p>
        </div>
      </div>
    </>
  );
}
