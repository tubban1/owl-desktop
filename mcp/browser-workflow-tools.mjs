// Register P1 browser workflow tools with the same session owner checks as
// existing OWL browser_agent_* tools. Do not expose the private download path.
export function registerBrowserWorkflowTools({tool,server,z,trustedUserChrome}) {
  tool(server,"browser_agent_p2_capabilities",
    "Read P2 DOM capability counts only in this Agent-owned tab; cross-origin frames and OS rights are not granted.",
    {},{title:"Inspect Agent Page Capabilities",readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    async()=>{const{bridge,owner}=trustedUserChrome();return bridge.p2Capabilities(owner);});
  tool(server,"browser_agent_edit_text",
    "Replace plain contenteditable text in a previously observed Agent-owned control, without submission; framework-managed editors require an adapter. DOM verification does not prove website persistence.",
    {uid:z.string().min(1).max(100),value:z.string().max(4000)},
    {title:"Edit Agent Page Plain Text",readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},
    async({uid,value})=>{const{bridge,owner}=trustedUserChrome();return bridge.editText(owner,uid,value);});
  tool(server,"browser_agent_paste_text",
    "Paste supplied plain text into a non-sensitive Agent-owned input or plain editor. Does NOT access the OS clipboard; reports DOM verification only, not persistence.",
    {uid:z.string().min(1).max(100),text:z.string().max(4000)},
    {title:"Paste Text in Agent Browser",readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},
    async({uid,text})=>{const{bridge,owner}=trustedUserChrome();return bridge.pasteText(owner,uid,text);});
  tool(server,"browser_agent_drag_drop",
    "Dispatch a text-only drag from a previously observed draggable element to a dropzone inside the same Agent-owned tab, requiring observed DOM change. Does NOT move the OS pointer or transfer files.",
    {source_uid:z.string().min(1).max(100),target_uid:z.string().min(1).max(100)},
    {title:"Drag Within Agent Browser",readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},
    async({source_uid,target_uid})=>{const{bridge,owner}=trustedUserChrome();return bridge.dragDrop(owner,source_uid,target_uid);});
  tool(server,"browser_agent_rich_editor_insert",
    "Enter plain text in a previously observed framework-managed rich editor on an Agent-owned background tab using Chromium's trusted input pipeline. Does not submit or prove website persistence.",
    {uid:z.string().min(1).max(100),value:z.string().max(4000)},
    {title:"Edit Rich Text in Agent Browser",readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},
    async({uid,value})=>{const{bridge,owner}=trustedUserChrome();return bridge.richEditorInsert(owner,uid,value);});
  tool(server,"browser_agent_drop_files",
    "Drop local files prepared by the OWL Native Host as owner/origin-bound tickets into a previously observed Agent-owned dropzone. Files stay on device until the approved website receives them; event dispatch does not prove upload completion.",
    {page_id:z.number().int().nonnegative(),target_uid:z.string().min(1).max(100),
      file_tickets:z.array(z.string().length(48)).min(1).max(5)},
    {title:"Drop Approved Files in Agent Browser",readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},
    async({page_id,target_uid,file_tickets})=>{
      const{bridge,owner}=trustedUserChrome();
      return bridge.dropFiles(owner,{pageId:page_id,targetUid:target_uid,fileTickets:file_tickets});
    });
  tool(server,"browser_agent_download_file",
    "Download a file only from a link UID observed on an Agent-owned signed-in Chrome tab. Same-origin safe file links only; request_id provides retry idempotency.",
    {link_uid:z.string().min(1).max(120),request_id:z.string().uuid()},
    {title:"Download in Agent Browser",readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true},
    async({link_uid,request_id})=>{const{bridge,owner}=trustedUserChrome();return bridge.downloadStart(owner,link_uid,request_id);});
  tool(server,"browser_agent_download_status",
    "Read only this Agent's Chrome download state, bytes and basename; absolute local path is not returned.",
    {download_id:z.number().int().nonnegative()},
    {title:"Check Agent Download",readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    async({download_id})=>{const{bridge,owner}=trustedUserChrome();return bridge.downloadStatus(owner,download_id);});
  tool(server,"browser_agent_download_list",
    "List only downloads started by this Agent Session, never the user's unrelated Chrome downloads.",
    {},{title:"Agent Download List",readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    async()=>{const{bridge,owner}=trustedUserChrome();return bridge.downloadList(owner);});
  tool(server,"browser_agent_download_cancel",
    "Cancel a download created by this Agent; does not delete existing personal files.",
    {download_id:z.number().int().nonnegative()},
    {title:"Cancel Agent Download",readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    async({download_id})=>{const{bridge,owner}=trustedUserChrome();return bridge.downloadCancel(owner,download_id);});
  tool(server,"browser_agent_prepare_download",
    "Prepare a completed Agent-owned download for upload to the current Agent tab. Source directory and destination site must be on the Host's approved allowlists. Returns short-lived file ticket, not raw file path.",
    {download_id:z.number().int().nonnegative()},
    {title:"Prepare Download for Upload",readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},
    async({download_id})=>{const{bridge,owner}=trustedUserChrome();return bridge.prepareDownload(owner,download_id);});
  tool(server,"browser_agent_verify_receipt",
    "Check whether a specified phrase is currently visible on this Agent-owned webpage. state=ui_observed is UI evidence, NOT independent website server/database verification.",
    {expected_text:z.string().min(3).max(160)},
    {title:"Check Website UI Receipt",readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true},
    async({expected_text})=>{const{bridge,owner}=trustedUserChrome();return bridge.receiptCheck(owner,expected_text);});
}
