import {describe,it,expect} from "vitest";
import {classifyConnectivity,createConnectivityIncidentTracker} from "../electron/services/connectivity-incident.mjs";
const ready={enabled:true,tunnel:{state:"running",desiredRunning:true,reachability:{state:"ready"}}};
const bad={enabled:true,tunnel:{state:"running",desiredRunning:true,reachability:{state:"unreachable"}}};
const recovering={enabled:true,tunnel:{state:"restarting",desiredRunning:true,reachability:{state:"recovering"}}};
describe("Safe connectivity incident UX",()=>{
 it("does not label an unknown outage as OpenAI or erase local task state",()=>{
  const row=classifyConnectivity(bad);
  expect(row.phase).toBe("degraded");
  expect(row.detail).toContain("source not confirmed");
  expect(row.detail).not.toContain("OpenAI");
  expect(classifyConnectivity(recovering).detail).toContain("not automatically cancelled");
 });
 it("only alarms for persistent failure, once, and confirms recovery",()=>{
  const t=createConnectivityIncidentTracker();
  expect(t.sample(ready,1000).visible).toBe(false);
  expect(t.sample(bad,2000).event).toBeNull();
  expect(t.sample(recovering,3000).event).toBeNull();
  const alert=t.sample(bad,4000);
  expect(alert.event).toBe("degraded");
  expect(alert.visible).toBe(true);
  expect(t.sample(bad,5000).event).toBeNull();
  expect(t.sample(ready,6000).active).toBe(true);
  expect(t.sample(recovering,7000).active).toBe(true);
  expect(t.sample(ready,8000).event).toBeNull();
  const recovered=t.sample(ready,9000);
  expect(recovered.event).toBe("recovered");
  expect(recovered.active).toBe(false);
  expect(recovered.visible).toBe(true);
  expect(t.sample(ready,26000).visible).toBe(false);
 });
 it("separates local readiness from remote control-plane problems",()=>{
   const upstream=classifyConnectivity({enabled:true,tunnel:{state:"running",reachability:{state:"degraded",localReady:true,controlPlane:{status:"degraded"}}}});
   expect(upstream.title).toContain("control-plane");
   expect(upstream.detail).toContain("provider responsibility is not confirmed");
   const local=classifyConnectivity({enabled:true,tunnel:{state:"running",reachability:{state:"unreachable",localReady:false}}});
   expect(local.title).toContain("Local Tunnel");
 });
 it("does not alert on deliberate stop or disabled mode",()=>{
  const t=createConnectivityIncidentTracker();
  for(let n=0;n<8;n++)
   expect(t.sample({enabled:false},1000+n).event).toBeNull();
  for(let n=0;n<8;n++)
   expect(t.sample({enabled:true,tunnel:{state:"stopped",desiredRunning:false}},2000+n).event).toBeNull();
  expect(t.snapshot().visible).toBe(false);
 });
 it("treats missing Host proof as unknown, not healthy",()=>{
  const t=createConnectivityIncidentTracker();
  const missing={enabled:true,tunnel:{state:"unavailable"}};
  t.sample(missing,1000);t.sample(missing,2000);
  expect(t.sample(missing,3000).phase).toBe("unknown");
  expect(t.snapshot().active).toBe(true);
 });
});
