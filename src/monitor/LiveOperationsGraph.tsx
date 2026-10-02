import { useMemo } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cloud,
  Cpu,
  LockKeyhole,
  MessageSquare,
  Radio,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { ActivityEntry, RuntimeSnapshot } from "../types";
import { buildMcpInteractionFeed } from "./interactionModel";
import type { WorkstreamBoard } from "./workstreamModel";

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

function stateClass(ok: boolean, attention = false) {
  if (attention) return "attention";
  return ok ? "healthy" : "idle";
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
  const interactions = useMemo(
    () => buildMcpInteractionFeed(activity, 18),
    [activity],
  );
  const latest = interactions[0] ?? null;
  const runningInteraction =
    interactions.find((item) => item.status === "running") ?? null;

  const visibleStreams = useMemo(
    () => board.streams.filter((stream) => stream.id !== "agent-inbox"),
    [board.streams],
  );

  const sourceLabels = useMemo(() => {
    const labels: string[] = [];
    for (const item of interactions) {
      if (!labels.includes(item.clientLabel)) labels.push(item.clientLabel);
    }
    for (const stream of visibleStreams) {
      if (!labels.includes(stream.sourceLabel)) labels.push(stream.sourceLabel);
    }
    return labels.slice(0, 4);
  }, [interactions, visibleStreams]);

  const access = snapshot?.runtimeAccess ?? null;
  const authorized =
    access?.mode === "enforced" &&
    access.state === "READY" &&
    access.grant?.signatureVerified === true;
  const locked = access?.state === "LOCKED" || access?.state === "REVOKED";
  const observable =
    snapshot?.mode === "live" &&
    snapshot?.runtimeEvents?.status === "healthy";
  const persistent =
    snapshot?.mode === "live" &&
    (visibleStreams.some((stream) => stream.isCurrent) ||
      Number(snapshot?.metrics?.tasks ?? 0) > 0);

  const activeStream =
    visibleStreams.find((stream) => stream.status === "working") ??
    visibleStreams.find((stream) => stream.status === "waiting") ??
    visibleStreams[0] ??
    null;

  const currentTool = runningInteraction?.tool ?? latest?.tool ?? null;
  const currentAction =
    runningInteraction
      ? `Running ${runningInteraction.tool}`
      : activeStream?.currentAction ??
        (latest ? `${latest.tool} · ${latest.status}` : "Waiting for MCP traffic");

  const nextActions = visibleStreams
    .filter((stream) => stream.isCurrent)
    .flatMap((stream) => stream.nextActions)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 4);

  return (
    <section className="panel live-ops-panel">
      <div className="panel-heading live-ops-heading">
        <div>
          <span className="eyebrow">LIVE AGENT FLOW</span>
          <h3>Actual data path · source → authorization → execution → result</h3>
        </div>
        <div className="live-ops-now">
          <span className={runningInteraction ? "pulse-dot live" : "pulse-dot"} />
          <strong>{runningInteraction ? "Traffic running" : "Live"}</strong>
          <span>{interactions.length} interactions</span>
        </div>
      </div>

      <div className="live-assurance-bar">
        <div className={"live-assurance " + stateClass(persistent)}>
          <Workflow size={15} />
          <div>
            <span>PERSISTENT</span>
            <strong>{persistent ? "Durable" : "Unavailable"}</strong>
          </div>
          <small>
            {visibleStreams.filter((stream) => stream.isCurrent).length} current workstream
            {visibleStreams.filter((stream) => stream.isCurrent).length === 1 ? "" : "s"}
          </small>
        </div>
        <div className={"live-assurance " + stateClass(observable)}>
          <Activity size={15} />
          <div>
            <span>OBSERVABLE</span>
            <strong>{observable ? "Live" : "Degraded"}</strong>
          </div>
          <small>
            {snapshot?.runtimeEvents?.status ?? "no event stream"} · 750 ms UI refresh
          </small>
        </div>
        <div
          className={
            "live-assurance " +
            stateClass(authorized, locked || (!authorized && access?.mode === "enforced"))
          }
        >
          {authorized ? <ShieldCheck size={15} /> : <LockKeyhole size={15} />}
          <div>
            <span>AUTHORIZED</span>
            <strong>{authorized ? "Verified" : locked ? "Locked" : "Check"}</strong>
          </div>
          <small>
            {authorized
              ? "Cloud-signed lease"
              : locked
                ? access?.reasonCode ?? "Access denied"
                : access?.mode ?? "Unknown"}
          </small>
        </div>
      </div>

      <div className={"live-flow-canvas " + (authorized ? "authorized" : locked ? "locked" : "")}>
        <div className="flow-stage flow-sources">
          <span className="flow-stage-label">SOURCES</span>
          <div className="flow-source-stack">
            {sourceLabels.map((label, index) => (
              <div
                className={
                  "flow-node compact " +
                  (latest?.clientLabel === label || runningInteraction?.clientLabel === label
                    ? "active"
                    : "")
                }
                key={label}
              >
                {label.toLowerCase().includes("worker") ? (
                  <Bot size={15} />
                ) : label.toLowerCase().includes("cloud") ? (
                  <Cloud size={15} />
                ) : (
                  <MessageSquare size={15} />
                )}
                <div>
                  <strong>{label}</strong>
                  <small>{index === 0 ? "current / recent" : "recent source"}</small>
                </div>
              </div>
            ))}
            {sourceLabels.length === 0 && (
              <div className="flow-node compact idle">
                <MessageSquare size={15} />
                <div><strong>ChatGPT / Agent</strong><small>waiting</small></div>
              </div>
            )}
          </div>
        </div>

        <div className={"flow-edge " + (latest ? "active" : "")}>
          <span />
          <ArrowRight size={17} />
        </div>

        <div className="flow-stage">
          <span className="flow-stage-label">TRANSPORT</span>
          <div className={"flow-node " + (snapshot?.mcp.status === "running" ? "healthy" : "attention")}>
            <Radio size={18} />
            <div>
              <strong>OWL MCP</strong>
              <small>
                {snapshot?.mcp.sessionCount ?? 0} session
                {(snapshot?.mcp.sessionCount ?? 0) === 1 ? "" : "s"}
              </small>
            </div>
          </div>
          <div className="flow-node secondary">
            <Cloud size={17} />
            <div>
              <strong>Tunnel</strong>
              <small>{snapshot?.tunnel.state ?? "stopped"}</small>
            </div>
          </div>
        </div>

        <div className={"flow-edge " + (latest ? "active" : "")}>
          <span />
          <ArrowRight size={17} />
        </div>

        <div className="flow-stage">
          <span className="flow-stage-label">AUTHORIZATION</span>
          <div className={"flow-node auth " + (authorized ? "healthy" : locked ? "attention" : "idle")}>
            {authorized ? <ShieldCheck size={19} /> : <LockKeyhole size={19} />}
            <div>
              <strong>{authorized ? "Cloud-signed lease" : locked ? "Runtime locked" : "Access gate"}</strong>
              <small>
                {authorized
                  ? `verified · expires ${clock(access?.grant?.expiresAt)}`
                  : access?.reasonCode ?? access?.state ?? "unknown"}
              </small>
            </div>
          </div>
        </div>

        <div className={"flow-edge " + (authorized && latest ? "active" : locked ? "blocked" : "")}>
          <span />
          <ArrowRight size={17} />
        </div>

        <div className="flow-stage">
          <span className="flow-stage-label">RUNTIME</span>
          <div className={"flow-node " + (snapshot?.mode === "live" ? "healthy" : "attention")}>
            <Cpu size={19} />
            <div>
              <strong>OWL Runtime</strong>
              <small>{snapshot?.info?.runtimeVersion ?? "offline"}</small>
            </div>
          </div>
          <div className={"flow-node secondary " + (runningInteraction ? "active" : "")}>
            <Activity size={17} />
            <div>
              <strong>{currentTool ?? "Execution"}</strong>
              <small>{currentAction}</small>
            </div>
          </div>
        </div>

        <div className={"flow-edge return " + (latest?.status === "success" ? "active" : latest?.status === "error" ? "attention" : "")}>
          <span />
          <ArrowRight size={17} />
        </div>

        <div className="flow-stage">
          <span className="flow-stage-label">RESULT</span>
          <div
            className={
              "flow-node " +
              (latest?.status === "success"
                ? "healthy"
                : latest?.status === "error"
                  ? "attention"
                  : runningInteraction
                    ? "active"
                    : "idle")
            }
          >
            {latest?.status === "success" ? (
              <CheckCircle2 size={18} />
            ) : (
              <MessageSquare size={18} />
            )}
            <div>
              <strong>
                {runningInteraction
                  ? "Running"
                  : latest
                    ? latest.status.toUpperCase()
                    : "Waiting"}
              </strong>
              <small>
                {latest
                  ? `${latest.tool}${latest.durationMs !== null ? ` · ${duration(latest.durationMs)}` : ""}`
                  : "No interaction yet"}
              </small>
            </div>
          </div>
        </div>
      </div>

      <div className="live-ops-detail-grid">
        <div className="live-traffic-block">
          <div className="live-block-head">
            <div><span className="eyebrow">REAL TRAFFIC</span><strong>Latest MCP interactions</strong></div>
            <span>{clock(latest?.completedAt ?? latest?.startedAt)}</span>
          </div>
          {latest && (
            <div className={"live-current-packet " + latest.status}>
              <div className="live-current-packet-head">
                <div>
                  <strong>{latest.clientLabel} → OWL LAB → {latest.clientLabel}</strong>
                  <code>{latest.tool}</code>
                </div>
                <span>{latest.status.toUpperCase()} · {duration(latest.durationMs) || "running"}</span>
              </div>
              <div className="traffic-payload-pair always-open">
                <div>
                  <span>REQUEST · {latest.clientLabel} → OWL LAB</span>
                  <pre>{latest.requestPreview ?? "No request payload captured."}</pre>
                </div>
                <div>
                  <span>RESPONSE · OWL LAB → {latest.clientLabel}</span>
                  <pre>
                    {latest.status === "running"
                      ? "Waiting for completion…"
                      : latest.responsePreview ?? "No response payload captured."}
                  </pre>
                </div>
              </div>
            </div>
          )}

          <div className="live-traffic-list">
            {interactions.slice(latest ? 1 : 0, latest ? 8 : 8).map((item) => (
              <details className={"live-traffic-row " + item.status} key={item.id}>
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
                    <pre>{item.requestPreview ?? "No request payload captured."}</pre>
                  </div>
                  <div>
                    <span>RESPONSE · OWL LAB → {item.clientLabel}</span>
                    <pre>
                      {item.status === "running"
                        ? "Waiting for completion…"
                        : item.responsePreview ?? "No response payload captured."}
                    </pre>
                  </div>
                </div>
              </details>
            ))}
            {interactions.length === 0 && (
              <div className="live-empty">Waiting for the next real MCP call.</div>
            )}
          </div>
        </div>

        <div className="live-context-block">
          <div className="live-block-head">
            <div><span className="eyebrow">CURRENT WORK</span><strong>Workstreams & next actions</strong></div>
            <span>{board.activeCount} active</span>
          </div>
          <div className="current-work-list">
            {visibleStreams
              .filter((stream) => stream.isCurrent)
              .slice(0, 5)
              .map((stream) => (
                <div className={"current-work-row " + stream.status} key={stream.id}>
                  <div>
                    <strong>{stream.sourceLabel}</strong>
                    <span>{stream.goal}</span>
                  </div>
                  <small>{stream.currentExecutor}</small>
                  <p>{stream.currentAction}</p>
                </div>
              ))}
            {visibleStreams.filter((stream) => stream.isCurrent).length === 0 && (
              <div className="live-empty">No durable workstream is active.</div>
            )}
          </div>

          <div className="live-next">
            <span className="eyebrow">NEXT</span>
            {nextActions.length > 0 ? (
              <ol>
                {nextActions.map((action) => <li key={action}>{action}</li>)}
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
