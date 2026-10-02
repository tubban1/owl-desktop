import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
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
  const crossings = new Map<string, OperationsState>();

  for (let index = 0; index < model.groups.length - 1; index += 1) {
    const left = model.groups[index]!;
    const right = model.groups[index + 1]!;
    const states: OperationsState[] = [];
    for (const edge of model.edges) {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) continue;
      const fromIndex = groupOrder.get(from.groupId) ?? -1;
      const toIndex = groupOrder.get(to.groupId) ?? -1;
      if (fromIndex <= index && toIndex >= index + 1) {
        states.push(edge.state);
      }
    }
    const state =
      states.sort((a, b) => STATE_WEIGHT[b] - STATE_WEIGHT[a])[0] ?? "idle";
    crossings.set(`${left.id}->${right.id}`, state);
  }
  return crossings;
}

function GraphNodeCard({ node }: { node: OperationsGraphNode }) {
  return (
    <div
      className={
        "dynamic-flow-node " +
        node.state +
        (node.current ? " current" : "")
      }
      title={node.evidence.join("\n")}
    >
      <NodeIcon kind={node.kind} meta={node.meta} />
      <div>
        <strong>{node.label}</strong>
        {node.detail && <small>{node.detail}</small>}
      </div>
      {node.current && <span className="node-current-dot" />}
    </div>
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
  const latest = model.latestInteraction;
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
            ? crossings.get(`${group.id}->${nextGroup.id}`) ?? "idle"
            : null;

          return (
            <div className="dynamic-flow-fragment" key={group.id}>
              <div className="dynamic-flow-stage">
                <span className="flow-stage-label">{group.label}</span>
                <div className="dynamic-flow-stack">
                  {nodes.map((node) => (
                    <GraphNodeCard node={node} key={node.id} />
                  ))}
                </div>
              </div>
              {nextGroup && (
                <div className={"dynamic-flow-edge " + transition}>
                  <span />
                  <ArrowRight size={17} />
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
            {model.interactions
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

            {model.interactions.length === 0 && (
              <div className="live-empty">
                Waiting for the next real MCP call.
              </div>
            )}
          </div>
        </div>

        <div className="live-context-block">
          <div className="live-block-head">
            <div>
              <span className="eyebrow">CURRENT WORK</span>
              <strong>Durable work & next actions</strong>
            </div>
            <span>{model.currentWorkstreams.length} current</span>
          </div>

          <div className="current-work-list">
            {model.currentWorkstreams.map((stream) => (
              <div
                className={"current-work-row " + stream.status}
                key={stream.id}
              >
                <div>
                  <strong>{stream.sourceLabel}</strong>
                  <span>{stream.goal}</span>
                </div>
                <small>{stream.currentExecutor}</small>
                <p>{stream.currentAction}</p>
              </div>
            ))}

            {model.currentWorkstreams.length === 0 && (
              <div className="live-empty">
                No current durable workstream.
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
