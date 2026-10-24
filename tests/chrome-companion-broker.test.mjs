import {describe,it,expect} from "vitest";
import {startChromeCompanionBroker} from "../connection-host/chrome-companion-broker.mjs";

const ORIGIN="chrome-extension://"+"a".repeat(32);
const OWNER="owl-workstream:test-owner";
const OTHER="owl-workstream:another-session";
describe("Chrome Companion localhost pairing and request relay",()=>{
  it("requires extension origin, an explicit one-use pairing code, and a scoped token",async()=>{
    const bridge=await startChromeCompanionBroker({port:0});
    const send=async(path,data={},token="",origin=ORIGIN)=>{
      const response=await fetch(bridge.url+path,{
        method:"POST",headers:{"origin":origin,"content-type":"application/json",
          ...(token?{authorization:"Bearer "+token}:{})},
        body:JSON.stringify(data)});
      return {status:response.status,payload:await response.json()};
    };
    try {
      const one=bridge.pair(OWNER);
      expect(one.code).toMatch(/^[A-F0-9]{16}$/);
      expect((await send("/v1/pair",{code:one.code},"","https://evil.example")).status).toBe(403);
      expect((await send("/v1/pair",{code:"0".repeat(16)})).status).toBe(400);
      const success=await send("/v1/pair",{code:one.code});
      expect(success.status).toBe(200);
      const token=success.payload.data.token;
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect((await send("/v1/pair",{code:one.code})).status).toBe(400);
      expect((await send("/v1/poll",{},"0".repeat(64))).status).toBe(401);
      expect(bridge.status(OTHER).connected).toBe(false);
      expect(()=>bridge.pair(OTHER)).toThrow("COMPANION_OWNED_BY_OTHER_SESSION");
      await expect(bridge.command("snapshot",{},OTHER)).rejects.toThrow("COMPANION_OWNED_BY_OTHER_SESSION");
      const request=bridge.command("snapshot",{},OWNER);
      const pending=await send("/v1/poll",{},token);
      expect(pending.payload.data.requests).toHaveLength(1);
      const actionId=pending.payload.data.requests[0].id;
      expect(pending.payload.data.requests[0].op).toBe("snapshot");
      expect((await send("/v1/result",{id:actionId,ok:true,result:{title:"Reddit"}},token)).status).toBe(200);
      expect(await request).toEqual({title:"Reddit"});
      expect((await send("/v1/result",{id:actionId,ok:true,result:{}},token)).status).toBe(400);
      const click = await bridge.command("click",{selector:"#save"},OWNER);
      expect(click).toMatchObject({pending:true,requiresUserConfirmation:true});
      expect(bridge.result(click.requestId,OWNER)).toMatchObject({pending:true});
      const clickPoll=await send("/v1/poll",{},token);
      expect(clickPoll.payload.data.requests).toHaveLength(1);
      expect(clickPoll.payload.data.requests[0].id).toBe(click.requestId);
      expect(clickPoll.payload.data.requests[0].op).toBe("click");
      await send("/v1/result",{id:click.requestId,ok:true,result:{clicked:true,explicitUserApproval:true}},token);
      await new Promise(resolve=>setImmediate(resolve));
      expect(bridge.result(click.requestId,OWNER)).toMatchObject({pending:false,done:true,ok:true,result:{clicked:true}});
      expect(bridge.status(OWNER).connected).toBe(true);
      expect((await send("/v1/revoke",{},token)).status).toBe(200);
      expect(bridge.status(OWNER).connected).toBe(false);
    }finally{await bridge.close();}
  });
  it("keeps one-use pairing code valid for 15 minutes, not just two",async()=>{
    const {vi}=await import("vitest");
    const clock=vi.spyOn(Date,"now");
    const baseline=new Date("2026-10-24T12:00:00Z").getTime();
    let now=baseline;
    clock.mockImplementation(()=>now);
    const bridge=await startChromeCompanionBroker({port:0});
    const send=async(code)=>{
      const response=await fetch(bridge.url+"/v1/pair",{
        method:"POST",
        headers:{origin:ORIGIN,"content-type":"application/json"},
        body:JSON.stringify({code})
      });
      return {status:response.status,data:await response.json()};
    };
    try{
      const first=bridge.pair(OWNER);
      expect(new Date(first.expiresAt).getTime()-baseline).toBe(15*60*1000);
      now=baseline+4*60*1000;
      const accepted=await send(first.code);
      expect(accepted.status).toBe(200);
      expect((await send(first.code)).status).toBe(400);
      const second=bridge.pair(OWNER);
      now=baseline+4*60*1000+15*60*1000+1;
      const expired=await send(second.code);
      expect(expired.data).toMatchObject({ok:false,error:"PAIRING_EXPIRED"});
    }finally{
      clock.mockRestore();
      await bridge.close();
    }
  });
  it("rejects unpaired actions and arbitrary script operations",async()=>{
    const bridge=await startChromeCompanionBroker({port:0});
    try{
      await expect(bridge.command("click",{selector:"#save"},OWNER)).rejects.toThrow("COMPANION_NOT_PAIRED");
      await expect(bridge.command("javascript",{script:"alert(1)"},OWNER)).rejects.toThrow("OP_NOT_ALLOWED");
    }finally{await bridge.close();}
  });
});
