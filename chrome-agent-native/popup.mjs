async function update(action="status"){
 const s=await chrome.runtime.sendMessage({type:action}).catch(e=>({connected:false,lastError:e.message}));
 document.querySelector("#state").textContent=s?.connected?"Connected to OWL Desktop":"Not connected: "+(s?.lastError||"Install native host with OWL Desktop");
}
document.querySelector("#connect").onclick=()=>update("connect");
update();
