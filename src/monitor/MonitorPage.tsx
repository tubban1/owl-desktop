import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cloud,
  Cpu,
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
import { buildMonitorModel, type MonitorModel } from "./monitorModel";

type HistoryPoint = {
  at: number;
  openRequests: number;
  activeTasks: number;
  runningProcesses: number;
  attention: number;
};

const formatClock = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

const humanSource = (value: string) =>
  ({
    desktop: "Desktop",
    runtime: "Runtime",
    "runtime-events": "Runtime events",
    mcp: "MCP",
    cloud: "Cloud",
    tunnel: "Tunnel",
    "agent-inbox": "Agent Inbox",
  })[value] ??
  value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

function SegmentedBar({
  items,
}: {
  items: Array<{ label: string; value: number; kind: string }>;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="monitor-segmented">
      <div className="monitor-segment-track" aria-label="Lifecycle distribution">
        {items.map((item) =>
          item.value > 0 ? (
            <span
              key={item.label}
              className={"monitor-segment " + item.kind}
              style={{ width: `${(item.value / Math.max(total, 1)) * 100}%` }}
              title={`${item.label}: ${item.value}`}
            />
          ) : null,
        )}
      </div>
      <div className="monitor-segment-legend">
        {items.map((item) => (
          <span key={item.label}>
            <i className={"monitor-dot " + item.kind} />
            {item.label}
            <strong>{item.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: HistoryPoint[] }) {
  const width = 720;
  const height = 190;
  const padX = 16;
  const padY = 18;
  const series = [
    { key: "openRequests" as const, label: "Open requests", kind: "requests" },
    { key: "activeTasks" as const, label: "Active tasks", kind: "tasks" },
    {
      key: "runningProcesses" as const,
      label: "Running processes",
      kind: "processes",
    },
    { key: "attention" as const, label: "Attention", kind: "attention" },
  ];
  const max = Math.max(
    1,
    ...points.flatMap((point) =>
      series.map((item) => Number(point[item.key] ?? 0)),
    ),
  );
  const x = (index: number) =>
    points.length <= 1
      ? width / 2
      : padX + (index / (points.length - 1)) * (width - padX * 2);
  const y = (value: number) =>
    height - padY - (value / max) * (height - padY * 2);
  const pathFor = (key: (typeof series)[number]["key"]) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(
            point[key],
          ).toFixed(1)}`,
      )
      .join(" ");

  return (
    <div className="monitor-trend">
      <div className="monitor-chart-legend">
        {series.map((item) => (
          <span key={item.key}>
            <i className={"monitor-dot " + item.kind} />
            {item.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Recent OWL workload trend"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = padY + ratio * (height - padY * 2);
          return (
            <line
              key={ratio}
              className="monitor-grid-line"
              x1={padX}
              x2={width - padX}
              y1={lineY}
              y2={lineY}
            />
          );
        })}
        {points.length > 0 &&
          series.map((item) => (
            <path
              key={item.key}
              className={"monitor-trend-line " + item.kind}
              d={pathFor(item.key)}
              fill="none"
            />
          ))}
      </svg>
      <div className="monitor-chart-foot">
        <span>
          {points.length > 1
            ? `${Math.round(
                (points[points.length - 1].at - points[0].at) / 1000,
              )}s live window`
            : "Collecting live samples…"}
        </span>
        <span>Auto-updates with Desktop quiet polling</span>
      </div>
    </div>
  );
}

function Topology({ model }: { model: MonitorModel }) {
  return (
    <div className="monitor-topology">
      {model.connectivity.map((node, index) => (
        <div className="monitor-topology-item" key={node.id}>
          <div className={"monitor-node " + node.state}>
            <span className="monitor-node-state" />
            <strong>{node.label}</strong>
            <small>{node.detail}</small>
          </div>
          {index < model.connectivity.length - 1 && (
            <span className="monitor-link" aria-hidden="true">
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function SmallStat({
  label,
  value,
  caption,
}: {
  label: string;
  value: number | string;
  caption: string;
}) {
  return (
    <div className="monitor-small-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </div>
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
  const [skillSnapshot, setSkillSnapshot] =
    useState<SkillManagerSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillLoading, setSkillLoading] = useState(false);

  const loadSkills = async () => {
    setSkillLoading(true);
    try {
      setSkillSnapshot(await window.owlDesktop.skillSnapshot());
      setSkillError(null);
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillLoading(false);
    }
  };

  useEffect(() => {
    void loadSkills();
    const timer = window.setInterval(() => void loadSkills(), 6000);
    return () => window.clearInterval(timer);
  }, []);

  const model = useMemo(
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

  useEffect(() => {
    if (!snapshot?.checkedAt) return;
    const point: HistoryPoint = {
      at: Date.parse(snapshot.checkedAt) || Date.now(),
      openRequests: model.requests.pending + model.requests.claimed,
      activeTasks: model.tasks.active,
      runningProcesses: model.processes.running,
      attention: model.attention.length,
    };
    setHistory((previous) => {
      const last = previous[previous.length - 1];
      if (last?.at === point.at) return previous;
      return [...previous, point].slice(-80);
    });
  }, [
    snapshot?.checkedAt,
    model.requests.pending,
    model.requests.claimed,
    model.tasks.active,
    model.processes.running,
    model.attention.length,
  ]);

  const healthyNodes = model.connectivity.filter(
    (node) => node.state === "healthy",
  ).length;
  const activeWork =
    model.requests.pending +
    model.requests.claimed +
    model.tasks.active +
    model.processes.running;

  return (
    <>
      <div className="section-header monitor-header">
        <div>
          <h1>Monitor</h1>
          <p>
            Live execution, coordination and governance signals across your OWL
            worker.
          </p>
        </div>
        <div className="monitor-header-actions">
          <span className="neutral-pill">
            {healthyNodes}/{model.connectivity.length} systems healthy
          </span>
          <button
            className="secondary"
            onClick={async () => {
              await Promise.all([onRefresh(), loadSkills()]);
            }}
          >
            <RefreshCw size={15} className={skillLoading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <section
        className={
          "monitor-command-strip " +
          (model.attention.length > 0 ? "attention" : "healthy")
        }
      >
        <div className="monitor-command-icon">
          {model.attention.length > 0 ? (
            <AlertTriangle size={23} />
          ) : activeWork > 0 ? (
            <Activity size={23} />
          ) : (
            <CheckCircle2 size={23} />
          )}
        </div>
        <div>
          <span className="eyebrow">WORKER STATE</span>
          <h2>
            {model.attention.length > 0
              ? `${model.attention.length} signal${model.attention.length === 1 ? "" : "s"} need attention`
              : activeWork > 0
                ? `${activeWork} active work item${activeWork === 1 ? "" : "s"}`
                : "System is ready and idle"}
          </h2>
          <p>
            {model.attention.length > 0
              ? model.attention[0].detail
              : activeWork > 0
                ? "OWL is actively coordinating requests, durable tasks or managed processes."
                : "No active request, task or process is waiting on execution."}
          </p>
        </div>
        <div className="monitor-command-meta">
          <strong>{formatClock(model.generatedAt)}</strong>
          <span>Last projection</span>
        </div>
      </section>

      <section className="panel monitor-topology-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EXECUTION TOPOLOGY</span>
            <h3>End-to-end worker fabric</h3>
          </div>
          <Network size={18} />
        </div>
        <Topology model={model} />
      </section>

      <div className="monitor-overview-grid">
        <section className="panel monitor-trend-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">LIVE WORKLOAD</span>
              <h3>Execution pressure</h3>
            </div>
            <span className="neutral-pill">{history.length} samples</span>
          </div>
          <TrendChart points={history} />
        </section>

        <section className="panel monitor-attention-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ATTENTION QUEUE</span>
              <h3>What may block autonomy</h3>
            </div>
            <span
              className={
                "neutral-pill " +
                (model.attention.length > 0 ? "warning-pill" : "")
              }
            >
              {model.attention.length}
            </span>
          </div>
          <div className="monitor-attention-list">
            {model.attention.map((item) => (
              <article
                className={"monitor-attention-item " + item.severity}
                key={item.id}
              >
                <AlertTriangle size={16} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </article>
            ))}
            {model.attention.length === 0 && (
              <div className="monitor-clear">
                <CheckCircle2 size={20} />
                <div>
                  <strong>No blocking signals</strong>
                  <span>
                    Current public Runtime projections do not require
                    intervention.
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="monitor-lifecycle-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">AGENTREQUEST</span>
              <h3>Coordination lifecycle</h3>
            </div>
            <Inbox size={18} />
          </div>
          <SegmentedBar
            items={[
              {
                label: "Pending",
                value: model.requests.pending,
                kind: "pending",
              },
              {
                label: "Claimed",
                value: model.requests.claimed,
                kind: "claimed",
              },
              {
                label: "Completed",
                value: model.requests.completed,
                kind: "completed",
              },
              {
                label: "Cancelled",
                value: model.requests.cancelled,
                kind: "cancelled",
              },
            ]}
          />
          <div className="monitor-stat-row">
            <SmallStat
              label="Open"
              value={model.requests.pending + model.requests.claimed}
              caption="Pending + claimed"
            />
            <SmallStat
              label="Confirmation"
              value={model.requests.needsConfirmation}
              caption="Human boundary"
            />
            <SmallStat
              label="High priority"
              value={model.requests.highPriorityOpen}
              caption="Open high / urgent"
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DURABLE TASKS</span>
              <h3>Execution lifecycle</h3>
            </div>
            <Workflow size={18} />
          </div>
          <SegmentedBar
            items={[
              {
                label: "Active",
                value: model.tasks.active,
                kind: "tasks",
              },
              {
                label: "Completed",
                value: model.tasks.completed,
                kind: "completed",
              },
              {
                label: "Needs review",
                value: model.tasks.needsReview,
                kind: "claimed",
              },
              {
                label: "Failed",
                value: model.tasks.failed,
                kind: "attention",
              },
            ]}
          />
          <div className="monitor-stat-row">
            <SmallStat
              label="Steps"
              value={model.tasks.totalSteps}
              caption="Across retained tasks"
            />
            <SmallStat
              label="Succeeded"
              value={model.tasks.succeededSteps}
              caption="Durable step results"
            />
            <SmallStat
              label="Waiting approval"
              value={model.tasks.waitingApproval}
              caption="Paused at policy gate"
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SKILLS</span>
              <h3>Governed lifecycle</h3>
            </div>
            <Puzzle size={18} />
          </div>
          <SegmentedBar
            items={[
              { label: "Ready", value: model.skills.ready, kind: "completed" },
              {
                label: "Disabled",
                value: model.skills.disabled,
                kind: "cancelled",
              },
              {
                label: "Attention",
                value: model.skills.needsAttention,
                kind: "attention",
              },
              {
                label: "Candidates",
                value: model.skills.activeCandidates,
                kind: "pending",
              },
            ]}
          />
          <div className="monitor-stat-row">
            <SmallStat
              label="Installed"
              value={model.skills.installed}
              caption="Runtime catalog"
            />
            <SmallStat
              label="User skills"
              value={model.skills.installedUserSkills}
              caption="Active registry versions"
            />
            <SmallStat
              label="Invalid candidates"
              value={model.skills.invalidCandidates}
              caption="Repair before promote"
            />
          </div>
          {skillError && (
            <div className="monitor-inline-warning">
              <AlertTriangle size={14} />
              {skillError}
            </div>
          )}
        </section>
      </div>

      <div className="monitor-overview-grid lower">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">VERIFICATION & POLICY</span>
              <h3>Safety gates</h3>
            </div>
            <ShieldCheck size={18} />
          </div>
          <div className="monitor-gate-grid">
            <div>
              <span>Task review</span>
              <strong>{model.tasks.needsReview}</strong>
              <small>Verification / side-effect evidence unresolved</small>
            </div>
            <div>
              <span>Approvals</span>
              <strong>{model.tasks.waitingApproval}</strong>
              <small>Durable tasks waiting at policy boundary</small>
            </div>
            <div>
              <span>Cloud uncertain</span>
              <strong>{model.cloud.uncertain}</strong>
              <small>Never replay until reconciled</small>
            </div>
            <div>
              <span>Skill validation</span>
              <strong>{model.skills.invalidCandidates}</strong>
              <small>Active candidates with deterministic validation failure</small>
            </div>
          </div>
          <p className="monitor-footnote">
            The lightweight Task list does not expose per-step VerificationReceipt
            totals. Monitor shows only canonical review/failure gates rather than
            inventing a “verified” success rate.
          </p>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ACTIVITY SOURCES</span>
              <h3>Where signals originate</h3>
            </div>
            <Activity size={18} />
          </div>
          <div className="monitor-source-list">
            {model.activity.bySource.slice(0, 7).map((item) => {
              const width =
                (item.count /
                  Math.max(
                    1,
                    ...model.activity.bySource.map((source) => source.count),
                  )) *
                100;
              return (
                <div key={item.source}>
                  <span>{humanSource(item.source)}</span>
                  <div>
                    <i style={{ width: `${width}%` }} />
                  </div>
                  <strong>{item.count}</strong>
                </div>
              );
            })}
            {model.activity.bySource.length === 0 && (
              <div className="empty">No activity signals yet.</div>
            )}
          </div>
          <div className="monitor-activity-summary">
            <span>
              <i className="monitor-dot completed" />
              Info <strong>{model.activity.info}</strong>
            </span>
            <span>
              <i className="monitor-dot claimed" />
              Warning <strong>{model.activity.warn}</strong>
            </span>
            <span>
              <i className="monitor-dot attention" />
              Error <strong>{model.activity.error}</strong>
            </span>
          </div>
        </section>
      </div>

      <section className="panel monitor-task-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">RECENT DURABLE WORK</span>
            <h3>Task timeline</h3>
          </div>
          <span className="neutral-pill">{model.tasks.total} retained</span>
        </div>
        <div className="monitor-task-list">
          {model.recentTasks.map((task) => (
            <article key={task.id}>
              <span
                className={
                  "monitor-task-status " +
                  (task.status === "completed"
                    ? "healthy"
                    : task.status === "failed" ||
                        task.status === "needs_review"
                      ? "attention"
                      : "active")
                }
              />
              <div className="monitor-task-copy">
                <strong>{task.label}</strong>
                <span>{task.message ?? task.id}</span>
                {task.progressPercent !== null && (
                  <div className="monitor-mini-progress">
                    <i style={{ width: `${task.progressPercent}%` }} />
                  </div>
                )}
              </div>
              <div className="monitor-task-meta">
                <span>{task.status.replaceAll("_", " ")}</span>
                <time>{formatClock(task.updatedAt)}</time>
              </div>
            </article>
          ))}
          {model.recentTasks.length === 0 && (
            <div className="empty">No durable Task history yet.</div>
          )}
        </div>
      </section>

      <div className="contract-note">
        <Cloud size={17} />
        <div>
          <strong>Monitor is a projection, not another source of truth.</strong>
          <p>
            Runtime owns Tasks, Processes, verification and Skill governance.
            Desktop owns presentation. Cloud owns delivery/account coordination.
            This page combines those projections without duplicating authority.
          </p>
        </div>
      </div>
    </>
  );
}
