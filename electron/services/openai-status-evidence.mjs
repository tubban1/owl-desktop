// Public, unauthenticated OpenAI status incident feed. Only sanitized
// categorical evidence is returned; status overlap != provider causality.
export async function probeOpenAiIncidents({
  at=Date.now(),since=at,fetchImpl=fetch,timeoutMs=2500
}={}){
  const out={checkedAt:new Date(at).toISOString(),state:"unknown",overlap:false,
    incidentId:null,incidentStatus:null,impact:null,startedAt:null,resolvedAt:null};
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),timeoutMs);timer.unref?.();
  try{
    const res=await fetchImpl("https://status.openai.com/api/v2/incidents.json",{
      method:"GET",redirect:"error",headers:{accept:"application/json"},
      signal:c.signal
    });
    if(!res.ok)return out;
    const json=await res.json();
    if(!Array.isArray(json?.incidents))return out;
    out.state="checked";
    const applicable=json.incidents.filter(i=>{
      if(!i||typeof i!=="object"||!["major","critical","minor"].includes(i.impact))return false;
      const start=Date.parse(i.created_at),end=i.resolved_at?Date.parse(i.resolved_at):at;
      return Number.isFinite(start)&&Number.isFinite(end)&&start<=at&&end>=since;
    }).sort((a,b)=>Number(["minor","major","critical"].indexOf(b.impact))-
      Number(["minor","major","critical"].indexOf(a.impact)));
    const hit=applicable[0];
    if(hit){
      out.overlap=true;
      out.incidentId=/^[A-Z0-9]{10,36}$/.test(hit.id)?hit.id:null;
      out.incidentStatus=["investigating","identified","monitoring","resolved"].includes(hit.status)?hit.status:"unknown";
      out.impact=hit.impact;
      out.startedAt=new Date(hit.created_at).toISOString();
      out.resolvedAt=hit.resolved_at?new Date(hit.resolved_at).toISOString():null;
    }
    return out;
  }catch{return out;}
  finally{clearTimeout(timer);}
}
