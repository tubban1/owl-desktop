import {describe,it,expect} from "vitest";
import {summarizeMcpCallMetrics} from "../mcp/call-metrics.mjs";
describe("MCP transport vs true tool success metrics",()=>{
 it("excludes ordinary GET SSE closes from HTTP failure stats",()=>{
  const s=summarizeMcpCallMetrics([
   {method:"GET",status:0,totalMs:8},
   {method:"notifications/initialized",status:202,totalMs:1},
   {method:"initialize",status:200,totalMs:5},
  ]);
  expect(s.transportStreamCloseCount).toBe(1);
  expect(s.sampleCount).toBe(2);
  expect(s.failedCount).toBe(0);
  expect(s.toolSampleCount).toBe(0);
 });
 it("counts HTTP 200 isError tool failures as errors",()=>{
  const s=summarizeMcpCallMetrics([
   {method:"tools/call",tool:"edit_file",status:200,toolOutcome:"error",totalMs:10010},
   {method:"tools/call",tool:"read_file",status:200,toolOutcome:"success",totalMs:30},
   {method:"tools/call",tool:"process",status:0,totalMs:300},
   {method:"tools/call",tool:"old-tool",status:200,totalMs:50},
  ]);
  expect(s.toolSampleCount).toBe(4);
  expect(s.toolFailedCount).toBe(2);
  expect(s.toolSucceededCount).toBe(1);
  expect(s.toolUnknownOutcomeCount).toBe(1);
  expect(s.toolSuccessRate).toBeCloseTo(1/3);
  expect(s.toolP95Ms).toBe(10010);
  const waiting=summarizeMcpCallMetrics([
    {method:"tools/call",tool:"get_process_output",status:200,
     toolOutcome:"success",totalMs:5400,waitingMs:5200},
    {method:"tools/call",tool:"read_file",status:200,toolOutcome:"success",totalMs:30},
  ]);
  expect(waiting.toolP95Ms).toBe(5400);
  expect(waiting.toolServiceP95Ms).toBe(200);
 });
});
