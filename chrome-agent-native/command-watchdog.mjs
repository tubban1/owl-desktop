// Every Native Messaging command must settle before the native host's 22s
// response deadline. A stalled Chromium API must never block the serial queue.
export async function withNativeCommandDeadline(run,timeoutMs=16_000){
  if(typeof run!=="function"||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)
    throw Error("NATIVE_COMMAND_WATCHDOG_ARGUMENT_INVALID");
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      const error=new Error("AGENT_NATIVE_COMMAND_STALLED");
      error.code="AGENT_NATIVE_COMMAND_STALLED";
      reject(error);
    },timeoutMs);
  });
  try{return await Promise.race([Promise.resolve().then(run),deadline]);}
  finally{clearTimeout(timer);}
}
