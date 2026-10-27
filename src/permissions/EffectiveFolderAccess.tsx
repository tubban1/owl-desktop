import {useEffect,useState} from "react";

type EffectiveRoots={state:"loading"|"verified"|"unavailable";roots:string[];write:boolean;delete:boolean;reason?:string};
const normal=(value:string)=>value.replace(/[\\/]+/g,"\\").replace(/\\+$/,"").toLowerCase();
export function EffectiveFolderAccess({saved}:{saved:string[]}){
 const [data,setData]=useState<EffectiveRoots>({state:"loading",roots:[],write:false,delete:false});
 const [revision,setRevision]=useState(0);
 const fingerprint=saved.join("|");
 useEffect(()=>{
  let alive=true;
  setData({state:"loading",roots:[],write:false,delete:false});
  void window.owlDesktop.skillSnapshot().then(snapshot=>{
   const provider=snapshot.providers.find(p=>p.id==="filesystem");
   const details=provider?.details as Record<string,unknown>|undefined;
   const roots=details?.allowedDirectories;
   if(!alive)return;
   if(provider?.available===true&&provider.enabled===true&&Array.isArray(roots)){
    setData({state:"verified",roots:roots.filter((x):x is string=>typeof x==="string"),
      write:details?.write===true,delete:details?.delete===true});
   }else setData({state:"unavailable",roots:[],write:false,delete:false,reason:"No verifiable Runtime filesystem provider"});
  }).catch(()=>{if(alive)setData({state:"unavailable",roots:[],write:false,delete:false,reason:"Runtime query failed"});});
  return ()=>{alive=false};
 },[fingerprint,revision]);
 return <div className="panel-help">
  <div className="setting-row">
   <strong>Connected Runtime permissions</strong>
   <button className="secondary" onClick={()=>setRevision(x=>x+1)}>Verify now</button>
  </div>
  {data.state!=="verified"?
   <p role="status">{data.state==="loading"?"Checking running Runtime…":
    "UNVERIFIED: "+data.reason+". Saved folders are not proof of access."}</p>:
   <>
    <p role="status">Live Runtime filesystem: {data.roots.length} roots · Write {data.write?"ON":"OFF"} · Delete {data.delete?"ON":"OFF"}. These are the live provider flags, not merely saved switches.</p>
    <div className="allowed-folder-list">
     {saved.map(folder=>{
      const allowed=data.roots.some(root=>normal(root)===normal(folder)||
        normal(folder).startsWith(normal(root)+"\\"));
      // Active status is determined only from the connected Runtime.
      return <div key={folder} className="allowed-folder-row">
       <code>{folder}</code>
       <strong>{allowed?"ACTIVE · Runtime root authorized":"NOT ACTIVE · Runtime has no matching grant"}</strong>
      </div>;
     })}
    </div>
    <p>Other effective roots: {data.roots.filter(root=>!saved.some(folder=>normal(root)===normal(folder))).join(", ")||"none"}</p>
   </>}
 </div>;
}
