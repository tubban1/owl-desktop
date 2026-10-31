// Infrastructure interruptions are not bad releases. Never freeze verified
// updates for six hours because GitHub DNS temporarily fails or a remote
// coordinator is unavailable. Real failed cutovers remain backed off.
const transient=/^(?:ROLL_PEER_NOT_READY_AFTER_BUILD|ROLL_PEER_CHANGED_AFTER_INTENT|ROLL_PEER_OR_LOCAL_CHANGED|ROLL_LOCAL_TEMPORARY_UNHEALTHY_AFTER_BUILD|OTA_COORDINATOR_(?:peer-unhealthy-or-stale|rollout-in-progress|local-not-ready|.*(?:timeout|unavailable)))/;
const connectivityFailure=/(?:Could not resolve host|Temporary failure in name resolution|Name or service not known|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|Failed to connect|Network is unreachable)/i;
export function isRetryablePeerFailure(message){
 const detail=String(message);
 return transient.test(detail)||
   (/^ROLL_COMMAND_FAILED:(?:git|node|npm|npm.cmd):/.test(detail)&&connectivityFailure.test(detail));
}
export function shouldBackoffFailedRelease(last,target,now=Date.now()){
 return last?.status==="failed"&&last.target===target&&!isRetryablePeerFailure(last.error)&&
 Number.isFinite(last.at)&&now>=last.at&&now-last.at<6*3600e3;
}
