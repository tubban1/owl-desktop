// Exact GitHub main push CI check. Never trust a PR workflow for OTA release activation.
export async function githubMainCi(sha,{fetchImpl=fetch}={}){
 if(!/^[0-9a-f]{40}$/.test(String(sha)))return {status:"invalid-sha"};
 try{
  const query=new URLSearchParams({head_sha:sha,branch:"main",event:"push",per_page:"10"});
  const res=await fetchImpl("https://api.github.com/repos/tubban1/owl-desktop/actions/runs?"+query,
   {headers:{accept:"application/vnd.github+json","user-agent":"owl-ota-updater"},signal:AbortSignal.timeout(10000)});
  if(!res.ok)return {status:"unavailable",http:res.status};
  const runs=(await res.json()).workflow_runs??[];
  const run=runs.find(r=>r.head_sha===sha&&r.name==="OWL Desktop Main CI"&&r.head_branch==="main"&&r.event==="push");
  return run?.status==="completed"&&run?.conclusion==="success"?
   {status:"success",runId:run.id,headSha:sha}:
   {status:run?.status==="completed"?"failed":"pending"};
 }catch{return {status:"unavailable"};}
}
