// Evidence-based, privacy-preserving local connectivity state machine.
// An official incident overlapping in time is NOT proof it caused a Tunnel error.
export function classifyConnectivity({enabled,tunnel,network=null,official=null}={}){
 const row=(phase,layer,title,detail)=>({phase,layer,severity:phase==="healthy"||phase==="disabled"?"info":"warning",title,detail});
 if(!enabled)return row("disabled","unknown","Remote connection disabled","Remote access is not selected.");
 if(network?.link==="missing")
  return row("degraded","device_network","Device network link unavailable","No non-loopback IP network interface detected. Check Wi-Fi, Ethernet or local network. This does not establish an OpenAI outage.");
 if(!tunnel||tunnel.state==="unavailable")
  return row("unknown","tunnel_local","Unable to check remote connection","The Connection Host did not return verified Tunnel status. Check local Host diagnostics.");
 if(tunnel.state==="stopped"&&tunnel.desiredRunning!==true)
  return row("disabled","unknown","Remote connection stopped","Tunnel is intentionally stopped; no automatic reconnect is expected.");
 const reach=tunnel.reachability?.state;
 if(reach==="ready")return row("healthy","healthy","Remote connection restored","The Tunnel currently reports verified reachability.");
 if(network?.dns==="failed")
  return row("degraded","dns","Independent DNS lookup failed","The device could not resolve the independent probe hostname. Check DNS and local network; the cause is not confirmed.");
 if(network?.internet==="unreachable")
  return row("degraded","internet_path","Independent internet check failed","Public HTTPS connectivity could not be independently verified. Local router, network policy or ISP may be involved; cause is unconfirmed.");
 const plane=tunnel.reachability?.controlPlane;
 if(tunnel.reachability?.localReady===true&&plane?.status==="degraded"){
  const suffix=official?.state==="checked"&&official.overlap?
   " An OpenAI incident also overlaps this period, but causation is not established.":"";
  return row("degraded","control_plane","Remote control-plane connection degraded","Local Tunnel readiness succeeded, but remote control-plane status is degraded. An upstream or network fault is possible; provider responsibility is not confirmed."+suffix);
 }
 if(tunnel.state==="restarting"||["starting","recovering"].includes(reach))
  return row("recovering","unknown","Remote connection is reconnecting","OWL LAB is attempting recovery. Local Runtime tasks are not automatically cancelled; check their final state after reconnection.");
 if(tunnel.reachability?.localReady===false&&["degraded","stale","unreachable"].includes(reach))
  return row("degraded","tunnel_local","Local Tunnel readiness unavailable","The local Tunnel readiness probe failed. An upstream outage is not established; inspect Connection Host and device network.");
 if(["degraded","stale","unreachable"].includes(reach)||tunnel.state==="stopped")
  return row("degraded","unknown","Remote connection is unstable","Tunnel reachability is not verified. This may be an external service, network or local connection issue; source not confirmed. Check task status after recovery.");
 return row("unknown","unknown","Remote connection state unverified","The Tunnel process does not currently provide a verified ready signal; the cause is unknown.");
}
export function createConnectivityIncidentTracker({faultSamples=3,recoverySamples=2}={}){
 let failures=0,successes=0,active=false,everObserved=false,incidentSince=null,lastRecoveredAt=null,
 last={phase:"disabled",layer:"unknown",severity:"info",title:"",detail:"",network:null,official:null};
 return {
  sample(input,now=Date.now()){
   const next=classifyConnectivity(input);
   last={...next,network:input?.network??null,official:input?.official??null};
   let event=null;
   if(next.phase==="disabled"){
    failures=0;successes=0;active=false;incidentSince=null;lastRecoveredAt=null;
   }else if(next.phase==="healthy"){
    everObserved=true;failures=0;successes++;
    if(active&&successes>=recoverySamples){
     event="recovered";active=false;incidentSince=null;lastRecoveredAt=new Date(now).toISOString();
    }
   }else{
    successes=0;failures++;
    if(!active&&failures>=faultSamples){
     event="degraded";active=true;incidentSince=new Date(now).toISOString();
    }
   }
   return this.snapshot(event,now);
  },
  snapshot(event=null,now=Date.now()){
   const recentlyRecovered=!active&&last.phase==="healthy"&&lastRecoveredAt&&
    now-Date.parse(lastRecoveredAt)<15_000;
   return {...last,active,incidentSince,lastRecoveredAt,
    visible:active||Boolean(recentlyRecovered),event,everObserved};
  }
 };
}
