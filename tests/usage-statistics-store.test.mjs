import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageStatisticsStore } from "../electron/services/usage-statistics-store.mjs";
import { summarizeUsage } from "../src/statistics/statisticsModel";

const folders = [];
afterEach(() => { while (folders.length) fs.rmSync(folders.pop(), { recursive: true, force: true }); });
const make = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-usage-"));
  folders.push(dir);
  const file = path.join(dir, "stats.json");
  const store = new UsageStatisticsStore({file, schedule: () => 1});
  return { store, file };
};
const event = (id, phase, status = "running", day = "2026-10-08", tool = "execute_command") => ({
  id: day+":"+id+":"+phase, at: day+"T12:00:00.000Z", source: "mcp",
  message: "MCP interaction "+phase,
  meta: {eventKind:"mcp_interaction", interactionId:id, phase, tool, status, durationMs: 420,
    payload:"secret=NEVER STORE"}
});

describe("Durable usage statistics", () => {
  it("counts one call for each request, deduplicates replay and tracks outcomes", () => {
    const {store} = make();
    expect(store.ingest(event("a","request"))).toBe(true);
    expect(store.ingest(event("a","request"))).toBe(false);
    expect(store.ingest(event("a","response","success"))).toBe(true);
    expect(store.ingest(event("a","response","success"))).toBe(false);
    store.ingest(event("b","request","running","2026-10-08","edit_file"));
    store.ingest(event("b","response","error","2026-10-08","edit_file"));
    const row = store.snapshot().days[0];
    expect(row).toMatchObject({calls:2, successes:1, errors:1, timedCalls:2, durationMs:840});
    expect(row.tools).toEqual([{tool:"edit_file",calls:1,errors:1},{tool:"execute_command",calls:1,errors:0}]);
    expect(JSON.stringify(store.snapshot())).not.toContain("NEVER STORE");
  });
  it("persists daily history across restart and does not double-count fetched old events", () => {
    const {store,file} = make();
    store.ingest(event("old","request","running","2026-10-07","workstream_open"));
    store.ingest(event("new","request","running","2026-10-08","workstream_complete"));
    store.ingest(event("new","response","success","2026-10-08","workstream_complete"));
    store.ingest({ id:"r1", at:"2026-10-08T12:00:00Z",source:"mcp",message:"MCP transport session reclaimed" });
    store.flush();
    const restored = new UsageStatisticsStore({file,schedule:()=>1});
    restored.ingest(event("old","request","running","2026-10-07","workstream_open"));
    restored.ingest({ id:"r1", at:"2026-10-08T12:00:00Z",source:"mcp",message:"MCP transport session reclaimed" });
    expect(restored.snapshot().days).toMatchObject([
      {day:"2026-10-07",calls:1,workstreamOpens:1},
      {day:"2026-10-08",calls:1,completedWorkstreams:1,reconnects:0,unknownReclaimed:1}
    ]);
    const week = summarizeUsage(restored.snapshot(),7,new Date("2026-10-08T12:00:00Z"));
    expect(week.total.calls).toBe(2);
    expect(week.total.completedWorkstreams).toBe(1);
  });
  it("separates opens, idle and capacity reclaims without inventing reconnects", () => {
    const {store}=make();
    const evt=(id,message,reason)=>({id,at:"2026-10-08T12:00:00Z",source:"mcp",message,meta:{reason}});
    const open=evt("open1","MCP transport session opened");
    store.ingest(open);store.ingest(open);
    store.ingest(evt("cap1","MCP transport session reclaimed","session_cap"));
    store.ingest(evt("idle1","MCP transport session reclaimed","idle_ttl"));
    store.ingest(evt("other","MCP transport session reclaimed","future_reason"));
    expect(store.snapshot().days[0]).toMatchObject({reconnects:0,sessionOpens:1,capEvictions:1,idleReclaimed:1,unknownReclaimed:1});
  });
  it("preserves historical unclassified reclamations during migration", () => {
    const {file}=make();
    fs.writeFileSync(file,JSON.stringify({version:1,startedAt:"2026-10-08T00:00:00Z",days:{
      "2026-10-08":{calls:3,successes:2,errors:1,workstreamOpens:1,completedWorkstreams:1,reconnects:943,durationMs:100,timedCalls:2,tools:{}}
    },seen:[]}));
    const store=new UsageStatisticsStore({file,schedule:()=>1});
    store.ingest({id:"cap2",at:"2026-10-08T12:00:00Z",source:"mcp",message:"MCP transport session reclaimed",meta:{reason:"session_cap"}});
    const day=store.snapshot().days[0];
    expect(day.reconnects).toBe(943);
    expect(day.capEvictions).toBe(1);
    expect(summarizeUsage(store.snapshot(),"all",new Date("2026-10-08T12:00:00Z")).total.capEvictions).toBe(1);
  });
  it("does not count unrelated logs or a response-only event as a tool call", () => {
    const {store} = make();
    expect(store.ingest({id:"log",at:"2026-10-08T12:00:00Z",source:"desktop",message:"Hello"})).toBe(false);
    store.ingest(event("orphan","response","error"));
    expect(store.snapshot().days[0]).toMatchObject({calls:0,errors:1});
  });
  it("time window filtering uses recorded daily counters", () => {
    const {store} = make();
    store.ingest(event("older","request","running","2026-09-01"));
    store.ingest(event("today","request","running","2026-10-08"));
    expect(summarizeUsage(store.snapshot(),7,new Date("2026-10-08T12:00:00Z")).total.calls).toBe(1);
    expect(summarizeUsage(store.snapshot(),"all",new Date("2026-10-08T12:00:00Z")).total.calls).toBe(2);
  });
});
