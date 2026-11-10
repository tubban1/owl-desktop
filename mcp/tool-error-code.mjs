// Normalize typed error identifiers without persisting raw messages or PII.
const CODE=/^[A-Z][A-Z0-9_]{2,63}$/;
export function safeMcpErrorCode(error,toolName=""){
 const explicit=typeof error?.code==="string"?error.code:"";
 if(CODE.test(explicit))return explicit;
 const message=typeof error?.message==="string"?error.message:String(error??"");
 const prefix=/^([A-Z][A-Z0-9_]{2,63})(?::|$)/.exec(message)?.[1];
 if(prefix&&CODE.test(prefix))return prefix;
 if(["execute_command","execute_command_transactional","primitive_call","skill_run"].includes(toolName)
    && /(?:runtime request timed out|timed out after [0-9]+ms|command timed out|deadline exceeded|process timed out)/i.test(message))
   return "RUNTIME_TIMEOUT";
 if(/^browser_agent_/.test(toolName)){
   if(/timeout|timed out|deadline/i.test(message))return "BROWSER_AGENT_TIMEOUT";
   if(/connection|disconnected|receiving end|extension context/i.test(message))
     return "BROWSER_AGENT_CONNECTION_FAILED";
   if(/not found|not present|stale|no such|not visible/i.test(message))
     return "BROWSER_AGENT_TARGET_NOT_FOUND";
   return "BROWSER_AGENT_UNCLASSIFIED";
 }
 return "UNCLASSIFIED";
}
