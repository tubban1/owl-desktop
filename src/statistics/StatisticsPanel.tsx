import { useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, GitBranch, Network, RefreshCw } from "lucide-react";
import { summarizeUsage, type StatisticsRange, type UsageStatisticsSnapshot } from "./statisticsModel";
import {describeTool,summarizeToolDomains} from "../../shared/tool-taxonomy.mjs";

const fmt = (n: number) => new Intl.NumberFormat().format(n);
const duration = (ms: number | null) => ms === null ? "—" : ms < 1000 ? Math.round(ms) + " ms" : (ms/1000).toFixed(1) + " s";
const friendlyTool = (tool: string) => describeTool(tool).title;

export function StatisticsPanel({ stats, deviceLocation }: { stats: UsageStatisticsSnapshot | null; deviceLocation: string }) {
  const [range, setRange] = useState<StatisticsRange>(7);
  const [day, setDay] = useState("");
  const model = useMemo(() => summarizeUsage(stats, range), [stats, range]);
  const selected = model.rows.find((row) => row.day === day);
  const displayedTools = selected?.tools ? [...selected.tools].sort((a,b) => b.calls-a.calls) : model.tools;
  const maxCalls = Math.max(1, ...model.rows.map((row) => row.calls));
  const maxTasks = Math.max(1, ...model.rows.map((row) => row.workstreamOpens));
  const maxTools = Math.max(1, ...displayedTools.map((tool) => tool.calls));
  const byCategory=summarizeToolDomains(displayedTools);
  const maxCategory=Math.max(1,...byCategory.map(x=>x.calls));
  const busiest = model.rows.reduce<(typeof model.rows)[number] | null>((best, row) => !best || row.calls > best.calls ? row : best, null);
  const frequentErrors = model.tools.filter((tool) => tool.errors > 0).sort((a,b) => b.errors-a.errors)[0];
  return <section className="usage-statistics panel" aria-label="OWL usage statistics">
    <div className="panel-heading stats-heading">
      <div><span className="eyebrow">USAGE STATISTICS</span><h3>How you use OWL LAB</h3>
        <p>Daily activity and tool usage recorded on {deviceLocation} {stats?.since ? "since " + new Date(stats.since).toLocaleDateString() : ""}. Historical activity before tracking began is not included.</p>
      </div>
      <div className="stats-range" role="group" aria-label="Statistics time range">
        {([7,30,90,"all"] as StatisticsRange[]).map((value) => <button key={value} className={range === value ? "active" : ""} onClick={() => {setRange(value);setDay("");}} aria-pressed={range === value}>{value === "all" ? "All recorded" : value + " days"}</button>)}
      </div>
    </div>
    <div className="stats-metrics">
      <div><GitBranch size={19}/><small>Workstream opens</small><strong>{fmt(model.total.workstreamOpens)}</strong><span>New work requests, not Runtime task completions</span></div>
      <div><CheckCircle2 size={19}/><small>Completed workstreams</small><strong>{fmt(model.total.completedWorkstreams)}</strong><span>Successful workstream_complete calls</span></div>
      <div><Activity size={19}/><small>MCP tool calls</small><strong>{fmt(model.total.calls)}</strong><span>Request events seen</span></div>
      <div><CheckCircle2 size={19}/><small>Tool response success</small><strong>{model.successRate === null ? "—" : model.successRate + "%"}</strong><span>Responses with a known outcome</span></div>
      <div><Clock3 size={19}/><small>Avg. tool response</small><strong>{duration(model.avgDurationMs)}</strong><span>Recorded response durations</span></div>
      <div><AlertTriangle size={19}/><small>External tool fallbacks</small><strong>{fmt(model.total.externalFallbacks)}</strong><span>Only agent-reported departures from OWL, not all external plugin activity</span></div>
      <div><Network size={19}/><small>Session opens</small><strong>{fmt(model.total.sessionOpens)}</strong><span>New MCP transport sessions observed</span></div>
      <div><Network size={19}/><small>Session-cap evictions</small><strong>{fmt(model.total.capEvictions)}</strong><span>Inactive transports reclaimed at capacity</span></div>
      <div><Network size={19}/><small>Idle reclamations</small><strong>{fmt(model.total.idleReclaimed)}</strong><span>Idle transports reclaimed by TTL</span></div>
      <div><Network size={19}/><small>Owner rebind cleanups</small><strong>{fmt(model.total.ownerSuperseded)}</strong><span>Inactive, superseded MCP transports safely released</span></div>
      {model.total.reconnects > 0 && <div><Network size={19}/><small>Legacy reclamations</small><strong>{fmt(model.total.reconnects)}</strong><span>Historical events previously labeled reconnections; causes unavailable</span></div>}
    </div>
    {model.fallbackReasons.length > 0 && <div className="stats-insights">
      <AlertTriangle size={16}/><span>
        <strong>Recorded OWL fallback reasons: </strong>
        {model.fallbackReasons.map(item=>item.reason+" ("+item.count+")").join(" · ")}
        . External tools used without reporting cannot be counted.
      </span>
    </div>}
    <div className="stats-charts">
      <div className="stats-chart">
        <h4>Tool calls by day</h4>
        <div className="stats-bars">{model.rows.map((row) => <button key={row.day} title={row.day+": "+row.calls+" calls"} onClick={() => setDay(day === row.day ? "" : row.day)} className={day === row.day ? "selected" : ""}><b>{row.calls}</b><i style={{height:Math.max(3,row.calls/maxCalls*100)+"%"}}/><small>{row.day.slice(5)}</small></button>)}</div>
      </div>
      <div className="stats-chart task-chart">
        <h4>Workstream opens by day</h4>
        <div className="stats-bars">{model.rows.map((row) => <button key={row.day} title={row.day+": "+row.workstreamOpens+" opens"} onClick={() => setDay(day === row.day ? "" : row.day)} className={day === row.day ? "selected" : ""}><b>{row.workstreamOpens}</b><i style={{height:Math.max(3,row.workstreamOpens/maxTasks*100)+"%"}}/><small>{row.day.slice(5)}</small></button>)}</div>
      </div>
      <div className="stats-chart stats-top-tools">
        <div className="stats-tool-head"><h4>{selected ? "Tools · "+selected.day : "Most used tools"}</h4>{selected && <button onClick={() => setDay("")}>Clear date</button>}</div>
        {displayedTools.map((tool) => <div className="stats-tool-row" key={tool.tool} title={[tool.tool,describeTool(tool.tool).category,describeTool(tool.tool).primitive ? describeTool(tool.tool).primitive+"("+describeTool(tool.tool).op+") → "+describeTool(tool.tool).action:"adapter/control plane",tool.errors+" errors"].join(" · ")}><span>{friendlyTool(tool.tool)}</span><div className="stats-tool-track"><i style={{width:tool.calls/maxTools*100+"%"}}/></div><strong>{tool.calls}</strong></div>)}
        {displayedTools.length === 0 && <p className="stats-empty">No tool calls recorded in this period.</p>}
      </div>
      <div className="stats-chart stats-top-tools" aria-label="Tool calls by capability category"><h4>Capability categories</h4>{byCategory.map(category=><div className="stats-tool-row" key={category.category}><span>{category.category}</span><div className="stats-tool-track"><i style={{width:category.calls/maxCategory*100+"%"}}/></div><strong>{fmt(category.calls)}</strong></div>)}</div>
    </div>
    <div className="stats-insights"><AlertTriangle size={16}/><span><strong>Usage insight: </strong>{frequentErrors ? friendlyTool(frequentErrors.tool)+" had "+frequentErrors.errors+" error response(s). Review related events in Monitor." : busiest ? "Most active recorded day: "+busiest.day+" ("+busiest.calls+" calls). No tool errors recorded in this range." : "Waiting for the first recorded MCP interaction. Open Monitor to see live activity."}</span></div>
    {model.rows.length === 0 && <p className="stats-empty">No recorded data for this period. Charts will populate as OWL runs.</p>}
    <p className="stats-footnote"><RefreshCw size={12}/> Session reclamation is not an unexpected disconnect or a successful reconnect. Historical reasons are unknown. Counts are local, durable and based on observed events; a response without a request may affect success rate but not call count.</p>
  </section>;
}
