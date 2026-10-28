// Peer heartbeat drift must never put an otherwise healthy device into six-hour OTA backoff.
const transient=/^(?:ROLL_PEER_NOT_READY_AFTER_BUILD|ROLL_PEER_CHANGED_AFTER_INTENT|ROLL_PEER_OR_LOCAL_CHANGED|OTA_COORDINATOR_(?:peer-unhealthy-or-stale|rollout-in-progress|local-not-ready))/;
export function isRetryablePeerFailure(message){return transient.test(String(message));}
export function shouldBackoffFailedRelease(last,target,now=Date.now()){
 return last?.status==="failed"&&last.target===target&&!isRetryablePeerFailure(last.error)&&
 Number.isFinite(last.at)&&now>=last.at&&now-last.at<6*3600e3;
}
