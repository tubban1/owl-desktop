import {describe,it,expect} from "vitest";
import net from "node:net";
import {canBindLoopbackIpv4} from "../scripts/lib/mac-port-availability.mjs";

function bind(options){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once("error",reject);
    server.listen(options,()=>resolve(server));
  });
}
function stop(server){
  return new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
}
describe("macOS OTA port availability",()=>{
  it("refuses an IPv4 loopback listener and permits the same port after it exits",async()=>{
    const owner=await bind({host:"127.0.0.1",port:0,exclusive:true});
    const port=owner.address().port;
    try{expect(await canBindLoopbackIpv4(port)).toBe(false);}
    finally{await stop(owner);}
    expect(await canBindLoopbackIpv4(port)).toBe(true);
  });
  it("permits IPv4 when a separate IPv6-only wildcard listener occupies the same numeric port",async()=>{
    let ipv6;
    try{ipv6=await bind({host:"::",port:0,ipv6Only:true,exclusive:true});}
    catch(e){if(["EAFNOSUPPORT","EADDRNOTAVAIL"].includes(e.code))return;throw e;}
    try{expect(await canBindLoopbackIpv4(ipv6.address().port)).toBe(true);}
    finally{await stop(ipv6);}
  });
  it("rejects invalid ports",async()=>{
    expect(()=>canBindLoopbackIpv4(0)).toThrow("OWL_PORT_INVALID");
  });
});
