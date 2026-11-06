import net from "node:net";

// Check the exact socket OWL Vite binds (IPv4 127.0.0.1), rather than
// treating a different service's IPv6 wildcard listener as an OWL port
// collision. A short-lived bind is more authoritative than a TCP connect:
// IPv6-only listeners can accept connections but coexist with IPv4 listeners.
export function canBindLoopbackIpv4(port,{timeoutMs=1500}={}){
  if(!Number.isSafeInteger(port)||port<1||port>65535)
    throw Error("OWL_PORT_INVALID");
  return new Promise(resolve=>{
    const server=net.createServer();
    let settled=false;
    const finish=ok=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      server.removeAllListeners("error");
      if(server.listening)server.close(()=>resolve(ok));
      else resolve(ok);
    };
    const timer=setTimeout(()=>finish(false),timeoutMs);
    timer.unref?.();
    server.once("error",()=>finish(false));
    try{server.listen({port,host:"127.0.0.1",exclusive:true},()=>finish(true));}
    catch{finish(false);}
  });
}
