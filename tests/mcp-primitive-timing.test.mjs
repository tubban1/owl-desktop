import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,it,expect} from "vitest";
import {createCallTimingJournal} from "../mcp/call-timing-journal.mjs";
const dirs=[];
afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});});
describe("payload-free per-primitive latency attribution",()=>{
 it("records allowed low-cardinality primitive labels without commands, target IDs or secrets",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-primitive-timing-"));dirs.push(root);
  const journal=createCallTimingJournal({root});
  journal.record({traceId:"trace_12345678",phase:"mcp_response",method:"tools/call",tool:"primitive_call",
   primitive:"sys.exec",primitiveOp:"run",targetKind:"remote",targetId:"secret-target",
   command:"password=abc",args:{password:"secret"},status:0,totalMs:119500});
  await journal.flush();
  const x=JSON.parse(fs.readFileSync(journal.file,"utf8").trim());
  expect(x).toMatchObject({primitive:"sys.exec",primitiveOp:"run",targetKind:"remote",
   totalMs:119500,status:0});
  const serialized=JSON.stringify(x);
  expect(serialized).not.toContain("secret");
  expect(serialized).not.toContain("password");
  expect(serialized).not.toContain("targetId");
 });
 it("drops untrusted primitive identifiers",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-primitive-timing-"));dirs.push(root);
  const journal=createCallTimingJournal({root});
  journal.record({traceId:"trace_12345678",phase:"mcp_response",tool:"primitive_call",
   primitive:"secret.password",primitiveOp:"run",status:200,totalMs:12});
  await journal.flush();
  const x=JSON.parse(fs.readFileSync(journal.file,"utf8").trim());
  expect(x).not.toHaveProperty("primitive");
  expect(x.primitiveOp).toBe("run");
 });
});
