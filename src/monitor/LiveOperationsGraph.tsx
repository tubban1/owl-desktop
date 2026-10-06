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
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  if (value < 3_600_000) {
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.floor((value % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
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

type NetworkPoint = {
  node: OperationsGraphNode;
  x: number;
  y: number;
};

type NetworkEdgePath = {
  edge: OperationsGraphEdge;
  path: string;
  labelX: number;
  labelY: number;
};

function compactNetworkText(value: string | null | undefined, length = 28) {
  if (!value) return "";
  return value.length <= length ? value : value.slice(0, length - 1) + "…";
}

function buildNetworkLayout(
  model: ReturnType<typeof buildOperationsGraphModel>,
) {
  const groups = model.groups;
  const maxNodes = Math.max(
    1,
    ...groups.map((group) => group.nodeIds.length),
  );
  const width = Math.max(880, groups.length * 150);
  const height = Math.max(330, Math.min(610, 150 + maxNodes * 72));
  const left = 64;
  const right = 84;
  const top = 78;
  const bottom = 72;
  const xStep =
    groups.length > 1
      ? (width - left - right) / (groups.length - 1)
      : 0;
  const points = new Map<string, NetworkPoint>();
  const groupLabels: Array<{ id: string; label: string; x: number }> = [];

  groups.forEach((group, groupIndex) => {
    const x = left + groupIndex * xStep;
    groupLabels.push({ id: group.id, label: group.label, x });
    const nodeIds = group.nodeIds.filter((id) =>
      model.nodes.some((node) => node.id === id),
    );
    nodeIds.forEach((id, nodeIndex) => {
      const node = model.nodes.find((candidate) => candidate.id === id);
      if (!node) return;
      const y =
        nodeIds.length === 1
          ? (top + height - bottom) / 2
          : top +
            (nodeIndex * (height - top - bottom)) /
              Math.max(1, nodeIds.length - 1);
      points.set(id, { node, x, y });
    });
  });

  const edges: NetworkEdgePath[] = [];
  model.edges.forEach((edge, index) => {
    const from = points.get(edge.from);
    const to = points.get(edge.to);
    if (!from || !to) return;

    const backwards = to.x <= from.x || edge.relation === "return";
    let path: string;
    let labelX: number;
    let labelY: number;

    if (backwards) {
      const laneY = Math.min(
        height - 28,
        Math.max(from.y, to.y) + 78 + (index % 3) * 14,
      );
      path =
        "M " + from.x + " " + from.y +
        " C " + (from.x + 72) + " " + laneY +
        ", " + (to.x - 72) + " " + laneY +
        ", " + to.x + " " + to.y;
      labelX = (from.x + to.x) / 2;
      labelY = laneY - 7;
    } else {
      const dx = to.x - from.x;
      const bend = Math.max(48, dx * 0.42);
      path =
        "M " + from.x + " " + from.y +
        " C " + (from.x + bend) + " " + from.y +
        ", " + (to.x - bend) + " " + to.y +
        ", " + to.x + " " + to.y;
      labelX = (from.x + to.x) / 2;
      labelY = (from.y + to.y) / 2 - 8;
    }

    edges.push({ edge, path, labelX, labelY });
  });

  return {
    width,
    height,
    points: [...points.values()],
    edges,
    groupLabels,
  };
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
          <span>MCP calls</span>
          <strong>{summary.toolCallCount}</strong>
        </div>
        <div>
          <span>Runtime actions</span>
          <strong>{summary.runtimeActionCount}</strong>
        </div>
        <div>
          <span>Tasks</span>
          <strong>
            {summary.completedTaskCount}/{summary.taskCount}
          </strong>
        </div>
        <div>
          <span>Errors</span>
          <strong>
            {summary.errorCount +
              Math.max(summary.runtimeActionFailed, summary.taskErrorCount)}
          </strong>
        </div>
        <div>
          <span>Needs review</span>
          <strong>
            {Math.max(
              summary.runtimeActionNeedsReview,
              summary.taskNeedsReviewCount,
            )}
          </strong>
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
        <>
          <span className="ops-breakdown-label">MCP</span>
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
        </>
      )}

      {summary.runtimeActionBreakdown.length > 0 && (
        <>
          <span className="ops-breakdown-label">RUNTIME</span>
          <div className="ops-tool-breakdown">
            {summary.runtimeActionBreakdown.slice(0, 8).map((item) => (
              <span
                className={item.errors > 0 ? "attention" : ""}
                key={"runtime:" + item.tool}
              >
                <code>{item.tool}</code>
                <b>×{item.count}</b>
                {item.errors > 0 && <small>{item.errors} error</small>}
              </span>
            ))}
          </div>
        </>
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

  const network = useMemo(() => buildNetworkLayout(model), [model]);
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
    <section
      className={
        "panel live-ops-panel " + (running ? "traffic-running" : "traffic-idle")
      }
    >
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

      <div className="operations-network-shell">
        <div className="operations-network-head">
          <div>
            <span className="eyebrow">REAL TOPOLOGY</span>
            <strong>Observed traffic + explicit contract hops</strong>
            <small className="network-legend">solid = observed · dotted = contract-inferred</small>
          </div>
          <span>
            {model.nodes.length} nodes · {model.edges.length} links
          </span>
        </div>

        {model.groups.length === 0 ? (
          <div className="live-empty">
            Waiting for the first observable agent path.
          </div>
        ) : (
          <div className="operations-network-scroll">
            <svg
              className="operations-network"
              viewBox={"0 0 " + network.width + " " + network.height}
              role="img"
              aria-label="Live OWL agent communication topology"
            >
              <defs>
                <marker
                  id="owl-network-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
                </marker>
              </defs>

              {network.groupLabels.map((group) => (
                <g className="network-group-guide" key={group.id}>
                  <line
                    x1={group.x}
                    x2={group.x}
                    y1={42}
                    y2={network.height - 34}
                  />
                  <text x={group.x} y={24} textAnchor="middle">
                    {group.label.toUpperCase()}
                  </text>
                </g>
              ))}

              {network.edges.map((edgePath) => {
                const edge = edgePath.edge;
                const dimmed = Boolean(
                  focusedWorkstreamId &&
                    edge.workstreamId &&
                    edge.workstreamId !== focusedWorkstreamId,
                );
                const edgeLabel = compactNetworkText(
                  edge.label ?? edge.relation,
                  24,
                );
                return (
                  <g
                    className={
                      "network-edge-group " +
                      edge.state +
                      " " +
                      edge.relation +
                      (edge.observed ? "" : " inferred") +
                      (dimmed ? " dimmed" : "")
                    }
                    key={edge.id}
                  >
                    <path
                      className="network-edge-path"
                      d={edgePath.path}
                      markerEnd="url(#owl-network-arrow)"
                    />
                    {edgeLabel && (
                      <text
                        className="network-edge-label"
                        x={edgePath.labelX}
                        y={edgePath.labelY}
                        textAnchor="middle"
                      >
                        {edgeLabel}
                      </text>
                    )}
                    {running && edge.state === "active" && !dimmed && (
                      <circle className="network-moving-packet" r="3">
                        <animateMotion
                          dur={edge.relation === "return" ? "1.6s" : "1.25s"}
                          repeatCount="indefinite"
                          path={edgePath.path}
                        />
                      </circle>
                    )}
                  </g>
                );
              })}

              {network.points.map(({ node, x, y }) => {
                const selected =
                  Boolean(focusedWorkstreamId) &&
                  node.workstreamId === focusedWorkstreamId;
                const dimmed = Boolean(
                  focusedWorkstreamId &&
                    node.workstreamId &&
                    node.workstreamId !== focusedWorkstreamId,
                );
                return (
                  <g
                    className={
                      "network-node " +
                      node.state +
                      (node.current ? " current" : "") +
                      (selected ? " selected" : "") +
                      (dimmed ? " dimmed" : "")
                    }
                    key={node.id}
                    transform={"translate(" + x + " " + y + ")"}
                    onClick={() => {
                      if (node.workstreamId) {
                        setSelectedWorkstreamId(node.workstreamId);
                      }
                    }}
                  >
                    {(node.current || selected) && (
                      <circle className="network-node-halo" r="13" />
                    )}
                    <circle className="network-node-dot" r="6" />
                    <text className="network-node-label" x={13} y={-3}>
                      {compactNetworkText(node.label, 22)}
                    </text>
                    {node.detail && (
                      <text className="network-node-detail" x={13} y={10}>
                        {compactNetworkText(node.detail, 28)}
                      </text>
                    )}
                    <title>{node.evidence.join("\n")}</title>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>

      <div className="live-flow-legend">
        <span><i className="legend-dot active" /> executing / traffic</span>
        <span><i className="legend-dot healthy" /> healthy / verified</span>
        <span><i className="legend-dot waiting" /> waiting / progress</span>
        <span><i className="legend-dot attention" /> attention / error</span>
        <span><i className="legend-dot locked" /> blocked by authorization</span>
        <span><i className="legend-edge observed" /> observed event</span>
        <span><i className="legend-edge inferred" /> enforced / inferred path</span>
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
                    <span className="traffic-row-spacer" />
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