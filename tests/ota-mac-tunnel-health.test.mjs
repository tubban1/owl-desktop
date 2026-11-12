import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe,it,expect,afterEach} from "vitest";
import {macOwnedTunnelHealthUrl} from "../scripts/lib/ota-mac-tunnel-health.mjs";

const dirs=[];
afterEach(()=>{for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"owl-ota-tunnel-"));
  dirs.push(root);
  const tempDir=path.join(root,"owl-desktop-tunnel");
  fs.mkdirSync(tempDir,{mode:0o700});
  const releaseRoot=path.join(root,"_releases","owl-desktop-1234567");
  const sharedBinary=path.join(root,"owl-desktop","vendor","owl-tunnel","arm64","tunnel-client-runtime");
  const file=path.join(tempDir,"health-url-22757-12345678-1234-1234-1234-123456789abc.txt");
  fs.writeFileSync(file,"http://127.0.0.1:49289\n",{mode:0o600});
  const host="22757 21899 /usr/local/bin/node "+releaseRoot+"/connection-host/server.mjs";
  const client="29017 22757 "+sharedBinary+
    " run --control-plane.api-key file:/not/a/secret --control-plane.tunnel-id tunnel_test"+
    " --mcp.server-url url=http://127.0.0.1:8790/mcp"+
    " --health.listen-addr 127.0.0.1:0 --health.url-file "+file;
  return {root,tempDir,releaseRoot,host,client,file,
    probe:(rows=host+"\n"+client,extra={})=>macOwnedTunnelHealthUrl({
      releaseRoot,tempDir,uid:process.getuid(),processTable:rows,...extra,
    })};
}
describe("Mac OTA Tunnel identity vs source path",()=>{
  it("recognizes a healthy owned child even when its executable is from a shared source checkout",()=>{
    const f=fixture();
    expect(f.probe()).toBe("http://127.0.0.1:49289/health?details=true");
    expect(f.probe(f.client+"\n"+f.host)).toBe("http://127.0.0.1:49289/health?details=true");
  });
  it("rejects other releases, unowned child processes and spoofed Host names",()=>{
    const f=fixture();
    expect(f.probe(undefined,{releaseRoot:path.join(f.root,"_releases/owl-desktop-different")})).toBe(null);
    expect(f.probe(f.host+"\n"+f.client.replace("29017 22757","29017 77777"))).toBe(null);
    expect(f.probe(f.host.replace("/connection-host/server.mjs","/connection-host/server.mjs-bad")+
      "\n"+f.client)).toBe(null);
    expect(f.probe(f.host.replace("node ","python ")+"\n"+f.client)).toBe(null);
    expect(f.probe(f.host+"\n"+f.host+"\n"+f.client)).toBe(null);
    expect(f.probe(f.host+"\n"+f.client+"\n"+f.client.replace("29017","29018"))).toBe(null);
  });
  it("does not accept unrelated MCP endpoints or missing tunnel identity",()=>{
    const f=fixture();
    expect(f.probe(f.host+"\n"+f.client.replace(":8790/mcp",":8791/mcp"))).toBe(null);
    expect(f.probe(f.host+"\n"+f.client.replace("--control-plane.tunnel-id","--wrong-flag"))).toBe(null);
    expect(f.probe(f.host+"\n"+f.client.replace("--health.url-file","--wrong-health-flag"))).toBe(null);
  });
  it("fails closed for missing, symlinked, insecure, wrong-owner and external health files",()=>{
    const f=fixture();
    fs.chmodSync(f.file,0o644);
    expect(f.probe()).toBe(null);
    fs.chmodSync(f.file,0o600);
    expect(f.probe(undefined,{uid:process.getuid()+1})).toBe(null);
    const external=path.join(f.root,"external-health.txt");
    fs.writeFileSync(external,"http://127.0.0.1:49289",{mode:0o600});
    fs.unlinkSync(f.file);
    fs.symlinkSync(external,f.file);
    expect(f.probe()).toBe(null);
    fs.unlinkSync(f.file);
    expect(f.probe()).toBe(null);
  });
  it("never follows a health URL outside loopback or an invalid port",()=>{
    const f=fixture();
    for(const text of [
      "https://127.0.0.1:49289",
      "http://evil.example:49289",
      "http://localhost:49289",
      "http://0.0.0.0:49289",
      "http://127.0.0.1:0",
      "http://127.0.0.1:65536",
      "http://127.0.0.1:49289/evil",
    ]){
      fs.writeFileSync(f.file,text,{mode:0o600});
      expect(f.probe(),text).toBe(null);
    }
  });
  it("integrates with the independent OTA runner before health is published",()=>{
    const code=fs.readFileSync(new URL("../scripts/auto-version-updater.mjs",import.meta.url),"utf8");
    const installer=fs.readFileSync(new URL("../scripts/install-auto-ota.mjs",import.meta.url),"utf8");
    expect(code).toContain("macOwnedTunnelHealthUrl({releaseRoot:root,processTable})");
    expect(code).not.toContain("line.includes(path.join(root,\"vendor\",\"owl-tunnel\"))");
    expect(installer).toContain('["scripts/lib/ota-mac-tunnel-health.mjs","lib/ota-mac-tunnel-health.mjs"]');
  });
});
