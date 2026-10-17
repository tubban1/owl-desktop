import {describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {probeLocalNetwork,readLocalNetworkLink} from "../electron/services/local-network-evidence.mjs";
import {probeOpenAiIncidents} from "../electron/services/openai-status-evidence.mjs";
import {createConnectivityIncidentJournal} from "../electron/services/connectivity-incident-journal.mjs";
import {classifyConnectivity,createConnectivityIncidentTracker} from "../electron/services/connectivity-incident.mjs";
const ifaces=()=>({en0:[{internal:false,family:"IPv4",address:"192.0.2.42"}]});
const bad={enabled:true,tunnel:{state:"running",reachability:{state:"degraded",localReady:true,controlPlane:{status:"degraded"}}}};
describe("Network fault injection (no real network disruption)",()=>{
 it("detects local link loss even while Tunnel still reports stale ready",()=>{
  const missing=()=>({lo:[{internal:true,family:"IPv4",address:"127.0.0.1"}]});
  expect(readLocalNetworkLink(missing)).toBe("missing");
  const ready={enabled:true,tunnel:{state:"running",reachability:{state:"ready"}}};
  expect(classifyConnectivity({...ready,network:{link:"missing"}}).layer).toBe("device_network");
  expect(readLocalNetworkLink(()=>({en0:[{internal:false,family:"IPv6",address:"2001:db8::1"}]}))).toBe("present");
 });
 it("detects missing link without DNS or HTTPS traffic",async()=>{
  const lookup=vi.fn(),fetchImpl=vi.fn();
  const n=await probeLocalNetwork({interfaces:()=>({lo:[{internal:true,family:"IPv4",address:"127.0.0.1"}]}),lookup,fetchImpl});
  expect(n).toMatchObject({link:"missing",dns:"skipped",internet:"skipped"});
  expect(lookup).not.toHaveBeenCalled();expect(fetchImpl).not.toHaveBeenCalled();
  expect(classifyConnectivity({...bad,network:n}).layer).toBe("device_network");
 });
 it("does not incorrectly declare an IPv6-only device offline",async()=>{
  const n=await probeLocalNetwork({interfaces:()=>({en0:[{internal:false,family:"IPv6",address:"2001:db8::1"}]}),
   lookup:async()=>({}),fetchImpl:async()=>({status:200,body:{cancel:async()=>{}}})});
  expect(n).toMatchObject({link:"present",dns:"ok",internet:"reachable"});
 });
 it("distinguishes local DNS failure",async()=>{
  const fetchImpl=vi.fn();
  const n=await probeLocalNetwork({interfaces:ifaces,lookup:async()=>{throw Error("ENOTFOUND");},fetchImpl});
  expect(n).toMatchObject({link:"present",dns:"failed",internet:"skipped"});
  expect(classifyConnectivity({...bad,network:n}).layer).toBe("dns");
  expect(fetchImpl).not.toHaveBeenCalled();
 });
 it("distinguishes internet access from Tunnel control plane",async()=>{
  const fetchImpl=vi.fn(async()=>({status:200,body:{cancel:async()=>{}}}));
  const n=await probeLocalNetwork({interfaces:ifaces,lookup:async()=>({address:"203.0.113.17"}),fetchImpl});
  expect(n).toMatchObject({link:"present",dns:"ok",internet:"reachable"});
  expect(JSON.stringify(n)).not.toMatch(/203\.0\.113\.17|192\.0\.2\.42/);
  expect(classifyConnectivity({...bad,network:n}).layer).toBe("control_plane");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it("recognizes independent HTTPS failure without blaming OpenAI",async()=>{
  const n=await probeLocalNetwork({interfaces:ifaces,lookup:async()=>({}),fetchImpl:async()=>{throw Error("offline")}});
  expect(classifyConnectivity({...bad,network:n}).layer).toBe("internet_path");
 });
 it("correlates official incident period without claiming cause",async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({incidents:[{id:"01M506BA4XRSWH7THR53HQGN3Z",impact:"major",status:"resolved",created_at:"2026-10-15T16:29:26Z",resolved_at:"2026-10-15T18:56:00Z",secret:"never persist"}]})});
  const n={link:"present",dns:"ok",internet:"reachable"};
  const overlap=await probeOpenAiIncidents({at:Date.parse("2026-10-15T17:00:00Z"),fetchImpl});
  expect(overlap).toMatchObject({state:"checked",overlap:true,impact:"major"});
  expect(JSON.stringify(overlap)).not.toContain("never persist");
  const row=classifyConnectivity({...bad,network:n,official:overlap});
  expect(row.layer).toBe("control_plane");
  expect(row.detail).toContain("causation is not established");
  expect((await probeOpenAiIncidents({at:Date.parse("2026-10-16T20:00:00Z"),fetchImpl})).overlap).toBe(false);
  expect((await probeOpenAiIncidents({since:Date.parse("2026-10-15T16:00:00Z"),
    at:Date.parse("2026-10-15T20:00:00Z"),fetchImpl})).overlap).toBe(true);
  expect((await probeOpenAiIncidents({fetchImpl:async()=>{throw Error("network error")}})).state).toBe("unknown");
 });
 it("does not alert on a single brief simulated network flap",()=>{
  const t=createConnectivityIncidentTracker();
  const ready={enabled:true,tunnel:{state:"running",reachability:{state:"ready"}}};
  t.sample(ready,1000);
  expect(t.sample({...bad,network:{link:"missing"}},2000).event).toBeNull();
  expect(t.sample(ready,3000).active).toBe(false);
 });
});
describe("Redacted private incident timeline",()=>{
 it("bounds entries and removes secrets/IP/SSID",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-net-"));
  try{
   const file=path.join(dir,"timeline.json");const j=createConnectivityIncidentJournal({file,maxEvents:2});
   j.record({kind:"degraded",layer:"dns",dns:"failed",token:"DO_NOT_STORE",ip:"192.168.1.1",ssid:"private-wifi"});
   j.record({kind:"evidence",layer:"control_plane"});
   j.record({kind:"recovered",layer:"healthy",durationMs:45000});
   expect(j.list()).toHaveLength(2);
   expect(j.list()[0]).toMatchObject({kind:"recovered",durationMs:45000});
   expect(fs.statSync(file).mode&0o077).toBe(0);
   expect(fs.readFileSync(file,"utf8")).not.toMatch(/DO_NOT_STORE|192\.168\.1\.1|private-wifi/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
 it("refuses to write a world-readable journal",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-net-"));
  try{
   const file=path.join(dir,"timeline.json");
   fs.writeFileSync(file,'{"token":"retain"}',{mode:0o644});
   expect(createConnectivityIncidentJournal({file}).record({kind:"degraded"})).toBeNull();
   expect(fs.readFileSync(file,"utf8")).toBe('{"token":"retain"}');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
});
