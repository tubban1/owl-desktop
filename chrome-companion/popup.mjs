const $=id=>document.getElementById(id);
const buttons=[...document.querySelectorAll("button")];
function busy(on){buttons.forEach(b=>b.disabled=on);}
async function ask(op,extra={}){
  busy(true);
  try{
    const answer=await chrome.runtime.sendMessage({op,...extra});
    if(!answer?.ok)throw new Error(answer?.error||"请求失败");
    const data=answer.data||{};
    $("status").textContent=JSON.stringify({paired:data.paired,authorized:data.authorized,
      origin:data.origin,editing:data.canFill,expiresAt:data.expiresAt},null,2);
    if(op==="snapshot"){$("preview").hidden=false;$("preview").textContent=JSON.stringify(data,null,2);}
    if(op==="status"){
      $("approval").hidden=!data.pending;
      $("request").textContent=data.pending?
        "网站："+data.pending.origin+"；目标："+data.pending.selector:"";
    } else {
      await updateStatus();
    }
  }catch(e){$("status").textContent="失败："+String(e?.message||e);}
  finally{busy(false);}
}
async function updateStatus(){
  const r=await chrome.runtime.sendMessage({op:"status"});
  if(!r?.ok)return;
  const s=r.data;
  $("status").textContent=(s.paired?"已连接 OWL；":"未连接 OWL；")+
    (s.authorized?" 已授权 "+s.origin:" 未授权网站")+
    (s.canFill?"；允许填写":"；只读")+(s.capturing?"；后台截图已开启":"");
  $("approval").hidden=!s.pending;
  $("request").textContent=s.pending?
    "网站："+s.pending.origin+"；按钮："+(s.pending.label||"未命名")+"；选择器："+s.pending.selector:"";
}
$("pair").onclick=()=>ask("pair",{code:$("code").value});
$("attach").onclick=()=>ask("attach");
$("edit").onclick=()=>ask("enableEditing");
$("detach").onclick=()=>ask("detach");
$("disconnect").onclick=()=>ask("disconnect");
$("inspect").onclick=()=>ask("snapshot");
$("startCapture").onclick=()=>ask("startCapture");
$("stopCapture").onclick=()=>ask("stopCapture");
$("approve").onclick=()=>ask("approveClick");
$("reject").onclick=()=>ask("rejectClick");
void updateStatus();