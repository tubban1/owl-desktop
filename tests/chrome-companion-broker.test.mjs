import {describe,it,expect} from "vitest";
import {startChromeCompanionBroker} from "../connection-host/chrome-companion-broker.mjs";

const ORIGIN="chrome-extension://"+"a".repeat(32);
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
      const one=bridge.pair();
      expect(one.code).toMatch(/^[A-F0-9]{16}$/);
      expect((await send("/v1/pair",{code:one.code},"","https://evil.example")).status).toBe(403);
      expect((await send("/v1/pair",{code:"0".repeat(16)})).status).toBe(400);
      const success=await send("/v1/pair",{code:one.code});
      expect(success.status).toBe(200);
      const token=success.payload.data.token;
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect((await send("/v1/pair",{code:one.code})).status).toBe(400);
      expect((await send("/v1/poll",{},"0".repeat(64))).status).toBe(401);
      const request=bridge.command("snapshot");
      const pending=await send("/v1/poll",{},token);
      expect(pending.payload.data.requests).toHaveLength(1);
      const actionId=pending.payload.data.requests[0].id;
      expect(pending.payload.data.requests[0].op).toBe("snapshot");
      expect((await send("/v1/result",{id:actionId,ok:true,result:{title:"Reddit"}},token)).status).toBe(200);
      expect(await request).toEqual({title:"Reddit"});
      expect((await send("/v1/result",{id:actionId,ok:true,result:{}},token)).status).toBe(400);
      expect(bridge.status().connected).toBe(true);
      expect((await send("/v1/revoke",{},token)).status).toBe(200);
      expect(bridge.status().connected).toBe(false);
    }finally{await bridge.close();}
  });
  it("rejects unpaired actions and arbitrary script operations",async()=>{
    const bridge=await startChromeCompanionBroker({port:0});
    try{
      await expect(bridge.command("click",{selector:"#save"})).rejects.toThrow("COMPANION_NOT_PAIRED");
      await expect(bridge.command("javascript",{script:"alert(1)"})).rejects.toThrow("OP_NOT_ALLOWED");
    }finally{await bridge.close();}
  });
});
