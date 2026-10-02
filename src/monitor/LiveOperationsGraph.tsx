import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cloud,
  Cpu,
  GitBranch,
  LockKeyhole,
  MessageSquare,
  MonitorCog,
  Network,
  Radio,
  ShieldCheck,
  SquareTerminal,
  UserCheck,
  Workflow,
  Wrench,
} from "lucide-react";
import type { ActivityEntry, RuntimeSnapshot } from "../types";
import type { WorkstreamBoard } from "./workstreamModel";
import {
  buildOperationsGraphModel,
  type OperationsAssurance,
  type OperationsGraphEdge,
  type OperationsGraphGroup,
  type OperationsGraphNode,
  type OperationsNodeKind,
  type OperationsState,
  type OperationsWorkstreamSummary,
} from "./operationsGraphModel";

const clock = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

const duration = (value?: number | null) => {
  if (typeof value !== "number") return "";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
};

function NodeIcon({
  kind,
  meta,
}: {
  kind: OperationsNodeKind;
  meta?: Record<string, unknown>;
}) {
  const sourceKind =
    typeof meta?.sourceKind === "string"
      ? meta.sourceKind
      : typeof meta?.clientKind === "string"
        ? meta.clientKind
        : null;

  if (kind === "source") {
    if (sourceKind === "worker" || sourceKind === "agent") return <Bot size={16} />;
    if (sourceKind === "cloud") return <Cloud size={16} />;
    if (sourceKind === "desktop") return <MonitorCog size={16} />;
    return <MessageSquare size={16} />;
  }
  if (kind === "transport") return <Radio size={17} />;
  if (kind === "cloud" || kind === "command") return <Cloud size={17} />;
  if (kind === "authorization") return <ShieldCheck size={17} />;
  if (kind === "runtime") return <Cpu size={18} />;
  if (kind === "tool") return <Wrench size={16} />;
  if (kind === "task") return <Workflow size={16} />;
  if (kind === "process") return <SquareTerminal size={16} />;
  if (kind === "approval") return <UserCheck size={16} />;
  if (kind === "request") return <GitBranch size={16} />;
  if (kind === "target") return <Network size={16} />;
  if (kind === "result") return <CheckCircle2 size={16} />;
  return <Activity size={16} />;
}

function assuranceIcon(assurance: OperationsAssurance) {
  if (assurance.id === "persistent") return <Workflow size={15} />;
  if (assurance.id === "observable") return <Activity size={15} />;
  return assurance.state === "locked" ? (
    <LockKeyhole size={15} />
  ) : (
    <ShieldCheck size={15} />
  );
}

const STATE_WEIGHT: Record<OperationsState, number> = {
  offline: 7,
  locked: 6,
  attention: 5,
  active: 4,
  waiting: 3,
  healthy: 2,
  idle: 1,
};

function transitionState(
  left: OperationsGraphGroup,
  right: OperationsGraphGroup,
  edges: OperationsGraphEdge[],
  groupIndex: Map<string, number>,
): OperationsState {
  const leftIndex = groupIndex.get(left.id) ?? 0;
  const rightIndex = groupIndex.get(right.id) ?? leftIndex + 1;
  const crossing = edges.filter((edge) => {
    const fromGroup = groupIndex.get(
      edge.from.split(":").slice(0, 1).join(":"),
    );
    const toGroup = groupIndex.get(
      edge.to.split(":").slice(0, 1).join(":"),
    );
    return fromGroup !== undefined && toGroup !== undefined &&
      fromGroup <= leftIndex && toGroup >= rightIndex;
  });

  if (crossing.length === 0) return "idle";
  return crossing
    .map((edge) => edge.state)
    .sort((a, b) => STATE_WEIGHT[b] - STATE_WEIGHT[a])[0] ?? "idle";
}

function nodeMap(model: ReturnType<typeof buildOperationsGraphModel>) {
  return new Map(model.nodes.map((node) => [node.id, node]));
}

function edgeMapByGroup(
  model: ReturnType<typeof buildOperationsGraphModel>,
) {
  const nodeById = nodeMap(model);
  const groupOrder = new Map(
    model.groups.map((group, index) => [group.id, index]),
  );
  const crossings = new Map<
    string,
    { state: OperationsState; label: string | null }
  >();

  for (let index = 0; index < model.groups.length - 1; index += 1) {
    const left = model.groups[index]!;
    const right = model.groups[index + 1]!;
    const crossingEdges: OperationsGraphEdge[] = [];
    for (const edge of model.edges) {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) continue;
      const fromIndex = groupOrder.get(from.groupId) ?? -1;
      const toIndex = groupOrder.get(to.groupId) ?? -1;
      if (fromIndex <= index && toIndex >= index + 1) {
        crossingEdges.push(edge);
      }
    }
    const strongest =
      crossingEdges.sort(
        (a, b) => STATE_WEIGHT[b.state] - STATE_WEIGHT[a.state],
      )[0] ?? null;
    crossings.set(left.id + "->" + right.id, {
      state: strongest?.state ?? "idle",
      label:
        strongest?.label ??
        (strongest?.relation === "authorize"
          ? "authorize"
          : strongest?.relation === "execute"
            ? "execute"
            : strongest?.relation === "result"
              ? "result"
              : null),
    });
  }
  return crossings;
}

function GraphNodeCard({
  node,
  selected,
  onSelect,
}: {
  node: OperationsGraphNode;
  selected: boolean;
  onSelect(workstreamId: string | null): void;
}) {
  return (
    <button
      type="button"
      className={
        "dynamic-flow-node " +
        node.state +
        (node.current ? " current" : "") +
        (selected ? " selected" : "")
      }
      title={node.evidence.join("\n")}
      onClick={() => onSelect(node.workstreamId)}
    >
      <NodeIcon kind={node.kind} meta={node.meta} />
      <div>
        <strong>{node.label}</strong>
        {node.detail && <small>{node.detail}</small>}
      </div>
      {node.current && <span className="node-current-dot" />}
    </button>
  );
}

function TaskSummaryCard({
  summary,
}: {
  summary: OperationsWorkstreamSummary;
}) {
  return (
    <article className={"ops-task-summary " + summary.status}>
      <div className="ops-task-summary-head">
        <div>
          <span className="eyebrow">
            {summary.status === "completed" ? "TASK COMPLETE" : "WORKSTREAM"}
          </span>
          <strong>{summary.goal}</strong>
          <small>{summary.sourceLabel}</small>
        </div>
        <span className={"ops-summary-status " + summary.status}>
          {summary.outcome}
        </span>
      </div>

      <p>{summary.summaryText}</p>

      <div className="ops-summary-metrics">
        <div>
          <span>Tool calls</span>
          <strong>{summary.toolCallCount}</strong>
        </div>
        <div>
          <span>Tasks</span>
          <strong>
            {summary.completedTaskCount}/{summary.taskCount}
          </strong>
        </div>
        <div>
          <span>Errors</span>
          <strong>{summary.errorCount + summary.failedTaskCount}</strong>
        </div>
        <div>
          <span>Warnings</span>
          <strong>{summary.warningCount}</strong>
        </div>
        <div>
          <span>Reconnects</span>
          <strong>{summary.reconnectCount}</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{duration(summary.durationMs) || "—"}</strong>
        </div>
      </div>

      {summary.toolBreakdown.length > 0 && (
        <div className="ops-tool-breakdown">
          {summary.toolBreakdown.slice(0, 8).map((item) => (
            <span
              className={item.errors > 0 ? "attention" : ""}
              key={item.tool}
            >
              <code>{item.tool}</code>
              <b>×{item.count}</b>
              {item.errors > 0 && <small>{item.errors} error</small>}
            </span>
          ))}
        </div>
      )}

      <div className="ops-summary-time">
        <span>Started {clock(summary.startedAt)}</span>
        <ArrowRight size={11} />
        <span>
          {summary.completedAt
            ? "Finished " + clock(summary.completedAt)
            : "Still active"}
        </span>
      </div>
    </article>
  );
}

export function LiveOperationsGraph({
  snapshot,
  activity,
  board,
}: {
  snapshot: RuntimeSnapshot | null;
  activity: ActivityEntry[];
  board: WorkstreamBoard;
}) {
  const model = useMemo(
    () =>
      buildOperationsGraphModel({
        snapshot,
        activity,
        board,
      }),
    [snapshot, activity, board],
  );

  const nodeById = useMemo(() => nodeMap(model), [model]);
  const crossings = useMemo(() => edgeMapByGroup(model), [model]);
  const [selectedWorkstreamId, setSelectedWorkstreamId] = useState<string | null>(
    null,
  );
  const selectedStillExists =
    selectedWorkstreamId !== null &&
    (model.summaries.some((item) => item.id === selectedWorkstreamId) ||
      model.loopPaths.some(
        (item) => item.workstreamId === selectedWorkstreamId,
      ));
  const focusedWorkstreamId = selectedStillExists
    ? selectedWorkstreamId
    : (model.loopPaths[0]?.workstreamId ?? model.summaries[0]?.id ?? null);
  const focusedSummary =
    model.summaries.find((item) => item.id === focusedWorkstreamId) ??
    model.summaries[0] ??
    null;
  const visibleInteractions = focusedWorkstreamId
    ? model.interactions.filter(
        (item) =>
          item.workstreamId === focusedWorkstreamId ||
          item.runtimeSessionId === focusedWorkstreamId,
      )
    : model.interactions;
  const latest = focusedWorkstreamId
    ? visibleInteractions[0] ?? null
    : model.latestInteraction;
  const running = model.runningInteractions.length > 0;

  return (
    <section className="panel live-ops-panel">
      <div className="panel-heading live-ops-heading">
        <div>
          <span className="eyebrow">LIVE AGENT FLOW</span>
          <h3>Current observed path · rendered from live nodes and edges</h3>
        </div>
        <div className="live-ops-now">
          <span className={running ? "pulse-dot live" : "pulse-dot"} />
          <strong>{running ? "Traffic running" : "Live"}</strong>
          <span>{model.interactions.length} interactions</span>
        </div>
      </div>

      <div className="live-assurance-bar">
        {model.assurances.map((assurance) => (
          <div
            className={"live-assurance " + assurance.state}
            key={assurance.id}
          >
            {assuranceIcon(assurance)}
            <div>
              <span>{assurance.label}</span>
              <strong>{assurance.value}</strong>
            </div>
            <small>{assurance.detail}</small>
          </div>
        ))}
      </div>

      <div
        className="dynamic-flow-canvas"
        style={{
          gridTemplateColumns: model.groups
            .map((_, index) =>
              index === model.groups.length - 1
                ? "minmax(150px, 1fr)"
                : "minmax(150px, 1fr) 34px",
            )
            .join(" "),
        }}
      >
        {model.groups.map((group, index) => {
          const nodes = group.nodeIds
            .map((id) => nodeById.get(id))
            .filter((node): node is OperationsGraphNode => Boolean(node));
          const nextGroup = model.groups[index + 1];
          const transition = nextGroup
            ? crossings.get(group.id + "->" + nextGroup.id) ?? {
                state: "idle" as OperationsState,
                label: null,
              }
            : null;

          return (
            <div className="dynamic-flow-fragment" key={group.id}>
              <div className="dynamic-flow-stage">
                <span className="flow-stage-label">{group.label}</span>
                <div className="dynamic-flow-stack">
                  {nodes.map((node) => (
                    <GraphNodeCard
                      node={node}
                      key={node.id}
                      selected={
                        Boolean(focusedWorkstreamId) &&
                        node.workstreamId === focusedWorkstreamId
                      }
                      onSelect={(workstreamId) => {
                        if (workstreamId) setSelectedWorkstreamId(workstreamId);
                      }}
                    />
                  ))}
                </div>
              </div>
              {nextGroup && transition && (
                <div className={"dynamic-flow-edge " + transition.state}>
                  <span />
                  {transition.label && <small>{transition.label}</small>}
                  <ArrowRight size={17} />
                  <i className="flow-packet-dot" />
                </div>
              )}
            </div>
          );
        })}

        {model.groups.length === 0 && (
          <div className="live-empty">
            Waiting for the first observable agent path.
          </div>
        )}
      </div>

      {model.loopPaths.length > 0 && (
        <div className="flow-return-zone">
          <div className="flow-return-zone-head">
            <span className="eyebrow">RETURN PATH</span>
            <strong>Result → source · closed-loop delivery</strong>
          </div>
          <div className="flow-return-lanes">
            {model.loopPaths.slice(0, 6).map((loop) => {
              const selected =
                Boolean(focusedWorkstreamId) &&
                loop.workstreamId === focusedWorkstreamId;
              return (
                <button
                  type="button"
                  className={
                    "flow-return-lane " +
                    loop.state +
                    (loop.running ? " pending-return" : "") +
                    (selected ? " selected" : "")
                  }
                  key={loop.id}
                  onClick={() => {
                    if (loop.workstreamId) {
                      setSelectedWorkstreamId(loop.workstreamId);
                    }
                  }}
                >
                  <div className="flow-return-source">
                    <MessageSquare size={13} />
                    <span>
                      <strong>{loop.sourceLabel}</strong>
                      <small>source</small>
                    </span>
                  </div>
                  <div className="flow-return-track">
                    <ArrowLeft size={14} />
                    <span className="flow-return-line" />
                    <i className="flow-return-packet" />
                    <em>{loop.responseLabel}</em>
                  </div>
                  <div className="flow-return-result">
                    <span>
                      <strong>{loop.running ? "Executing" : "Returned"}</strong>
                      <small>{loop.requestLabel}</small>
                    </span>
                    <CheckCircle2 size={13} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="live-flow-legend">
        <span><i className="legend-dot active" /> executing / traffic</span>
        <span><i className="legend-dot healthy" /> healthy / verified</span>
        <span><i className="legend-dot waiting" /> waiting</span>
        <span><i className="legend-dot attention" /> attention / error</span>
        <span><i className="legend-dot locked" /> blocked by authorization</span>
      </div>

      <div className="live-ops-detail-grid">
        <div className="live-traffic-block">
          <div className="live-block-head">
            <div>
              <span className="eyebrow">REAL TRAFFIC</span>
              <strong>Actual MCP request / response payloads</strong>
            </div>
            <span>{clock(latest?.completedAt ?? latest?.startedAt)}</span>
          </div>

          {latest && (
            <div className={"live-current-packet " + latest.status}>
              <div className="live-current-packet-head">
                <div>
                  <strong>
                    {latest.clientLabel} → OWL LAB → {latest.clientLabel}
                  </strong>
                  <code>{latest.tool}</code>
                </div>
                <span>
                  {latest.status.toUpperCase()} ·{" "}
                  {duration(latest.durationMs) || "running"}
                </span>
              </div>
              <div className="traffic-payload-pair always-open">
                <div>
                  <span>REQUEST · {latest.clientLabel} → OWL LAB</span>
                  <pre>
                    {latest.requestPreview ?? "No request payload captured."}
                  </pre>
                </div>
                <div>
                  <span>RESPONSE · OWL LAB → {latest.clientLabel}</span>
                  <pre>
                    {latest.status === "running"
                      ? "Waiting for completion…"
                      : latest.responsePreview ??
                        "No response payload captured."}
                  </pre>
                </div>
              </div>
            </div>
          )}

          <div className="live-traffic-list">
            {visibleInteractions
              .slice(latest ? 1 : 0, 8)
              .map((item) => (
                <details
                  className={"live-traffic-row " + item.status}
                  key={item.id}
                >
                  <summary>
                    <time>{clock(item.completedAt ?? item.startedAt)}</time>
                    <strong>{item.clientLabel}</strong>
                    <ArrowRight size={12} />
                    <code>{item.tool}</code>
                    <span className="traffic-spacer" />
                    <b>{item.status}</b>
                    <small>{duration(item.durationMs)}</small>
                  </summary>
                  <div className="traffic-payload-pair">
                    <div>
                      <span>REQUEST · {item.clientLabel} → OWL LAB</span>
                      <pre>
                        {item.requestPreview ??
                          "No request payload captured."}
                      </pre>
                    </div>
                    <div>
                      <span>RESPONSE · OWL LAB → {item.clientLabel}</span>
                      <pre>
                        {item.status === "running"
                          ? "Waiting for completion…"
                          : item.responsePreview ??
                            "No response payload captured."}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}

            {visibleInteractions.length === 0 && (
              <div className="live-empty">
                Waiting for the next real MCP call.
              </div>
            )}
          </div>
        </div>

        <div className="live-context-block">
          <div className="live-block-head">
            <div>
              <span className="eyebrow">TASK SUMMARY</span>
              <strong>What happened in this workstream</strong>
            </div>
            <span>{model.summaries.length} tracked</span>
          </div>

          <div className="ops-summary-list">
            {focusedSummary && <TaskSummaryCard summary={focusedSummary} />}

            {model.summaries
              .filter((summary) => summary.id !== focusedSummary?.id)
              .slice(0, 4)
              .map((summary) => (
                <button
                  type="button"
                  className={"ops-summary-picker " + summary.status}
                  key={summary.id}
                  onClick={() => setSelectedWorkstreamId(summary.id)}
                >
                  <span>
                    <strong>{summary.sourceLabel}</strong>
                    <small>{summary.goal}</small>
                  </span>
                  <b>{summary.outcome}</b>
                </button>
              ))}

            {model.summaries.length === 0 && (
              <div className="live-empty">
                No recent workstream summary yet.
              </div>
            )}
          </div>

          <div className="live-next">
            <span className="eyebrow">NEXT</span>
            {model.nextActions.length > 0 ? (
              <ol>
                {model.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
            ) : (
              <p>No queued next action.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
