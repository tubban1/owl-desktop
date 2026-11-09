import {describe,it,expect} from "vitest";
import {evaluateOtaActivity} from "../mcp/ota-activity.mjs";
describe("OTA activity safety snapshot",()=>{
 it("allows a terminal-only system to activate",()=>{
   expect(evaluateOtaActivity({tasks:[{status:"completed"}],
     approvals:[],processes:[{status:"exited"}],inFlightTools:0})
     .ready).toBe(true);
 });
 it("defers for in-flight tools, pending tasks, live processes, approvals",()=>{
   const input={tasks:[],approvals:[],processes:[],inFlightTools:0};
   expect(evaluateOtaActivity({...input,inFlightTools:1}).ready).toBe(false);
   expect(evaluateOtaActivity({...input,tasks:[{status:"running"}]}).activeTasks).toBe(1);
   expect(evaluateOtaActivity({...input,tasks:[{status:"pending"}]}).ready).toBe(false);
   expect(evaluateOtaActivity({...input,processes:[{status:"terminating"}]}).ready).toBe(false);
   expect(evaluateOtaActivity({...input,approvals:[{state:"pending"}]}).ready).toBe(false);
 });
 it("fails closed for unknown task/process telemetry",()=>{
   expect(evaluateOtaActivity({tasks:[],approvals:[],inFlightTools:0}).reason)
    .toBe("activity-unknown");
   expect(evaluateOtaActivity({tasks:[],processes:[],inFlightTools:0}).ready)
    .toBe(false);
 });
});
