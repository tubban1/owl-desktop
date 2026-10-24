let stream=null;
let video=null;
function stop(){
  if(stream)for(const track of stream.getTracks())track.stop();
  stream=null;
  if(video){video.srcObject=null;video.remove();video=null;}
}
async function start(streamId){
  stop();
  stream=await navigator.mediaDevices.getUserMedia({
    audio:false,
    video:{mandatory:{chromeMediaSource:"tab",chromeMediaSourceId:streamId}}
  });
  video=document.createElement("video");
  video.muted=true;video.playsInline=true;
  video.srcObject=stream;
  await video.play();
  return {capturing:true};
}
async function frame(){
  if(!stream||!video||video.videoWidth<1||video.videoHeight<1)
    throw new Error("No active authorized tab video capture.");
  const ratio=Math.min(1,1024/video.videoWidth);
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(video.videoWidth*ratio));
  canvas.height=Math.max(1,Math.round(video.videoHeight*ratio));
  const context=canvas.getContext("2d",{alpha:false});
  context.drawImage(video,0,0,canvas.width,canvas.height);
  const url=canvas.toDataURL("image/jpeg",0.78);
  return {base64:url.split(",")[1],mimeType:"image/jpeg",
    width:canvas.width,height:canvas.height};
}
chrome.runtime.onMessage.addListener((message,sender,send)=>{
  if(message?.channel!=="owl-offscreen")return false;
  Promise.resolve().then(async()=>{
    if(message.type==="start")return await start(message.streamId);
    if(message.type==="frame")return await frame();
    if(message.type==="stop"){stop();return {capturing:false};}
    throw new Error("Unsupported capture operation");
  }).then(data=>send({ok:true,data}))
    .catch(e=>send({ok:false,error:String(e?.message||e)}));
  return true;
});
