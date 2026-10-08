import { useId, useMemo, useState } from "react";
import type { McpInteraction } from "./interactionModel";
import type { OperationsGraphModel } from "./operationsGraphModel";
import { buildFocusedFlow } from "./focusedFlowModel";
import { buildFocusedLiveTrace } from "./focusedLiveGraphModel";

const NODE_GAP = 198;
const NODE_START = 19;
const NODE_WIDTH = 160;
const NODE_Y = 110;
const NODE_HEIGHT = 176;
const PORT_Y = 108;
const center = (index: number) => NODE_START + NODE_WIDTH / 2 + index * NODE_GAP;

const stateLabel = (state: string) => ({
  running: "Working", done: "Completed", waiting: "Waiting",
  attention: "Needs attention", neutral: "Not active",
}[state] ?? state);

const detailEvidence = (value: string) => ({
  observed: "Observed event", contract: "Contract-inferred",
  status: "Live status only", none: "No evidence",
}[value] ?? value);

const elapsed = (ms: number) => ms < 60_000 ?
  Math.floor(ms / 1000) + "s" :
  Math.floor(ms / 60_000) + "m " + Math.floor((ms % 60_000) / 1000) + "s";

export function FocusedLiveGraph({
  model, workstreamId, interaction, now,
}: {
  model: OperationsGraphModel;
  workstreamId: string | null;
  interaction: McpInteraction | null;
  now: number;
}) {
  const [inspectedStage, setInspectedStage] = useState("execution");
  const stages = useMemo(() => buildFocusedFlow(model, workstreamId, interaction), [model, workstreamId, interaction]);
  const trace = useMemo(() => buildFocusedLiveTrace(model, interaction, now), [model, interaction, now]);
  const inspected = stages.find((stage) => stage.id === inspectedStage) ?? stages[4]!;
  const markerId = useId().replaceAll(":", "");
  const running = interaction?.status === "running";
  const unconfirmed = interaction?.status === "interrupted";
  const started = Date.parse(interaction?.startedAt ?? "");
  const callAgeMs = (running || unconfirmed) && Number.isFinite(started) ? Math.max(0, now - started) : null;
  const longCall = callAgeMs !== null && callAgeMs >= 60_000;
  const involved = new Set(trace.traversed);

  return (
    <div className="live-graph-main" aria-label="Live OWL task communication graph">
      <div className="live-graph-head">
        <div>
          <span className="eyebrow">FOCUSED LIVE GRAPH</span>
          <h4>Follow the real request and response</h4>
          <p>Arrows show direction. Solid = observed, dashed = inferred. Only a recently observed packet animates; long-running work pulses at the execution node.</p>
        </div>
        <div className={"live-graph-running " + (running ? "running" : "idle")}>
          <span className={running ? "pulse-dot live" : "pulse-dot"} />
          {running ? "Tool call in progress" : interaction ? "Last completed or recorded call" : "Waiting for activity"}
        </div>
      </div>

      <div className="live-graph-scroll" role="region" aria-label="Scroll horizontally to explore the connected live graph" tabIndex={0}>
        <svg className="live-graph-svg" viewBox="0 0 1190 374" role="group" aria-label="Six stage graph with evidence-based directional links">
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 1 1 L 9 5 L 1 9 z" fill="context-stroke" />
            </marker>
          </defs>

          {trace.links.map((link) => {
            const fromX = center(link.from);
            const toX = center(link.to);
            const high = link.to - link.from > 1 ? 33 : 65;
            const path = `M ${fromX} ${PORT_Y} C ${fromX} ${high}, ${toX} ${high}, ${toX} ${PORT_Y}`;
            const animate = trace.requestRecent && link.observed &&
              link.from === 0 && link.to === 1;
            return (
              <g key={link.id} className={"live-graph-link " + (link.observed ? "observed" : "contract")}>
                <title>{(link.observed ? "Observed hop" : "Inferred contract hop") + " · " + link.relation + (link.via.length ? " · includes " + link.via.length + " additional intermediate nodes" : "")}</title>
                <path d={path} className="live-graph-link-path" markerEnd={`url(#${markerId})`} />
                {animate && <circle className="live-graph-packet" r="4">
                  <animateMotion dur="1.5s" repeatCount="3" path={path} />
                </circle>}
              </g>
            );
          })}

          {trace.returned && <g className="live-graph-link observed return">
            <title>Observed response returned to source</title>
            <path className="live-graph-return-path"
              d={`M ${center(5)} 290 C ${center(5)} 343, ${center(0)} 343, ${center(0)} 290`}
              markerEnd={`url(#${markerId})`}
            />
            <text className="live-graph-return-label" x="595" y="354" textAnchor="middle">OBSERVED RESPONSE BACK TO SOURCE</text>
            {trace.responseRecent && <circle className="live-graph-return-packet" r="4">
              <animateMotion dur="2.2s" repeatCount="2" path={`M ${center(5)} 290 C ${center(5)} 343, ${center(0)} 343, ${center(0)} 290`} />
            </circle>}
          </g>}

          {stages.map((stage, i) => {
            const isFocus = inspectedStage === stage.id;
            const active = stage.state === "running" && involved.has(i);
            return (
              <g key={stage.id} className={"live-graph-stage " + (involved.has(i) ? "on-route" : "not-on-route")}>
                <circle cx={center(i)} cy={PORT_Y} r={active ? "7" : "5"} className={"live-graph-port " + (active ? "active" : "")} />
                <foreignObject x={NODE_START + NODE_GAP * i} y={NODE_Y} width={NODE_WIDTH} height={NODE_HEIGHT}>
                  <button type="button" onClick={() => setInspectedStage(stage.id)}
                    className={"live-graph-node " + stage.state + " " + stage.evidence +
                      (isFocus ? " inspected" : "") + (involved.has(i) ? " on-route" : " bypassed") +
                      (active ? " active-node" : "")}
                    aria-label={stage.label + ": " + stage.title + ". " + detailEvidence(stage.evidence) + ". " + stateLabel(stage.state)}
                    aria-pressed={isFocus} title={stage.note ?? stage.detail}>
                    <span className="live-graph-node-top"><b>{String(i + 1).padStart(2, "0")} · {stage.label}</b></span>
                    <strong>{stage.title}</strong>
                    <span className="live-graph-node-detail">{stage.detail}</span>
                    <span className="live-graph-node-footer">
                      <span className={"live-graph-proof " + stage.evidence}>{detailEvidence(stage.evidence)}</span>
                      {active ? <span className="live-graph-node-state">{callAgeMs === null ? "Working" : elapsed(callAgeMs)}</span> :
                        <span className="live-graph-node-state">{unconfirmed && stage.id === "execution" && callAgeMs !== null ? "Unconfirmed " + elapsed(callAgeMs) : stateLabel(stage.state)}</span>}
                    </span>
                    {active && <span className="live-graph-active-glow" />}
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="live-graph-foot">
        <span><i className="live-graph-sample observed" /> Event observed</span>
        <span><i className="live-graph-sample contract" /> Contract only</span>
        <span><i className="live-graph-sample status" /> Service status</span>
        {trace.returned ? <span>↩ Response returned to source</span> :
          <span>{interaction?.status === "running" ? "Waiting for tool response; no return event yet" : "No observed return edge for this selection"}</span>}
      </div>
      <div className={"live-graph-inspector " + (longCall ? "long-call" : "")}>
        <div>
          <span className="eyebrow">NODE DETAILS · {inspected.label.toUpperCase()}</span>
          <strong>{inspected.title}</strong>
          <p>{inspected.detail}</p>
          {inspected.note && <p className="live-graph-note">{inspected.note}</p>}
        </div>
        <div className="live-graph-inspector-meta">
          <span>{detailEvidence(inspected.evidence)}</span>
          <span>{stateLabel(inspected.state)}</span>
          {callAgeMs !== null && inspected.id === "execution" && <span>{unconfirmed ? "No response observed for " : "Call in progress for "}{elapsed(callAgeMs)}{longCall ? " · inspect process status" : ""}</span>}
        </div>
      </div>
    </div>
  );
}
