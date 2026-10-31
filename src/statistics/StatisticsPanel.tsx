import { useMemo, useState } from "react";
import { Activity, CheckCircle2, Clock3, GitBranch } from "lucide-react";
import {
  dailyAvgDurationMs, summarizeUsage, type StatisticsRange, type UsageStatisticsSnapshot,
} from "./statisticsModel";
import { describeTool } from "../../shared/tool-taxonomy.mjs";

const fmt = (n: number) => new Intl.NumberFormat().format(n);
const duration = (ms: number | null) => ms === null ? "—" :
  ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(1) + " s";

export function StatisticsPanel({
  stats, deviceLocation,
}: { stats: UsageStatisticsSnapshot | null; deviceLocation: string }) {
  const [range, setRange] = useState<StatisticsRange>(7);
  const [selectedDay, setSelectedDay] = useState("");
  const model = useMemo(() => summarizeUsage(stats, range), [stats, range]);
  const selected = model.rows.find((row) => row.day === selectedDay);
  const tools = (selected
    ? [...(selected.tools ?? [])].sort((a, b) => b.calls - a.calls)
    : model.tools).slice(0, 5);
  const highestToolCount = Math.max(1, ...tools.map((tool) => tool.calls));
  const maxDailyDuration = Math.max(1, ...model.rows.map((row) => dailyAvgDurationMs(row) ?? 0));

  return <section className="usage-statistics panel" aria-label="OWL usage statistics">
    <div className="panel-heading stats-heading">
      <div>
        <span className="eyebrow">USAGE STATISTICS</span>
        <h3>Tool performance</h3>
        <p>Activity recorded on {deviceLocation}{stats?.since ? " since " + new Date(stats.since).toLocaleDateString() : ""}. Figures reflect the selected period; older calls remain in the average until they leave the range.</p>
      </div>
      <div className="stats-range" role="group" aria-label="Statistics time range">
        {([7, 30, 90, "all"] as StatisticsRange[]).map((value) =>
          <button key={value} className={range === value ? "active" : ""}
            onClick={() => { setRange(value); setSelectedDay(""); }}
            aria-pressed={range === value}>
            {value === "all" ? "All recorded" : value + " days"}
          </button>)}
      </div>
    </div>

    <div className="stats-metrics stats-key-metrics">
      <div>
        <Clock3 size={19} aria-hidden="true"/>
        <small>Avg. tool response</small>
        <strong>{duration(model.avgDurationMs)}</strong>
        <span>MCP tool processing; excludes ChatGPT transport</span>
      </div>
      <div>
        <CheckCircle2 size={19} aria-hidden="true"/>
        <small>Tool success</small>
        <strong>{model.successRate === null ? "—" : model.successRate + "%"}</strong>
        <span>Responses with a known outcome</span>
      </div>
      <div>
        <Activity size={19} aria-hidden="true"/>
        <small>Tool calls</small>
        <strong>{fmt(model.total.calls)}</strong>
        <span>Recorded tool requests</span>
      </div>
      <div>
        <GitBranch size={19} aria-hidden="true"/>
        <small>Completed workstreams</small>
        <strong>{fmt(model.total.completedWorkstreams)}</strong>
        <span>Successful workstream completions</span>
      </div>
    </div>

    <div className="stats-charts stats-key-charts">
      <div className="stats-chart">
        <h4>Daily average response time</h4>
        <p className="stats-chart-hint">Compare days with recorded responses. Select a day to inspect its tools.</p>
        <div className="stats-bars stats-latency-bars" aria-label="Daily tool response durations">
          {model.rows.map((row) => {
            const average = dailyAvgDurationMs(row);
            const active = row.day === selectedDay;
            return <button key={row.day} type="button" className={active ? "selected" : ""}
              aria-pressed={active}
              aria-label={row.day + ": " + (average === null ? "No timed responses" : duration(average) + " average, " + row.timedCalls + " timed responses")}
              title={row.day + " · " + duration(average) + " · " + fmt(row.calls) + " calls"}
              onClick={() => setSelectedDay(active ? "" : row.day)}>
              <b>{duration(average)}</b>
              <i style={{ height: average === null ? "0" : Math.max(3, average / maxDailyDuration * 100) + "%" }}/>
              <small>{row.day.slice(5)}</small>
            </button>;
          })}
        </div>
        {model.rows.length === 0 && <p className="stats-empty">No response data in this period.</p>}
      </div>

      <div className="stats-chart stats-top-tools">
        <div className="stats-tool-head">
          <h4>{selected ? "Top tools · " + selected.day : "Most used tools"}</h4>
          {selected && <button type="button" onClick={() => setSelectedDay("")}>All days</button>}
        </div>
        {tools.map((tool) =>
          <div className="stats-tool-row" key={tool.tool}
            title={tool.tool + " · " + tool.calls + " calls · " + tool.errors + " errors"}>
            <span>{describeTool(tool.tool).title}</span>
            <div className="stats-tool-track"><i style={{ width: tool.calls / highestToolCount * 100 + "%" }}/></div>
            <strong>{fmt(tool.calls)}</strong>
          </div>)}
        {tools.length === 0 && <p className="stats-empty">No tools recorded in this period.</p>}
      </div>
    </div>
    <p className="stats-footnote">Detailed traces, queue waits, retries, session cleanup and error codes remain in Monitor and diagnostic logs. These averages are not full ChatGPT round-trip times.</p>
  </section>;
}
