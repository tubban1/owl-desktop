import {describe,it,expect} from "vitest";
import {safeMcpErrorCode} from "../mcp/tool-error-code.mjs";
describe("privacy-safe meaningful tool error code",()=>{
 it("extracts namespaced browser errors without recording details",()=>{
   expect(safeMcpErrorCode(new Error("UPLOAD_PAGE_NOT_SELECTED"),"browser_agent_upload_file"))
    .toBe("UPLOAD_PAGE_NOT_SELECTED");
   expect(safeMcpErrorCode(new Error("FORM_LEGAL_CONSENT_REQUIRES_USER_GRANT"),"browser_agent_form_set"))
    .toBe("FORM_LEGAL_CONSENT_REQUIRES_USER_GRANT");
 });
 it("normalizes generic browser failures and preserves explicit codes",()=>{
   expect(safeMcpErrorCode({code:"SHELL_CAPACITY_BUSY",message:"x"}))
    .toBe("SHELL_CAPACITY_BUSY");
   expect(safeMcpErrorCode(new Error("Element not found on page"),"browser_agent_click"))
    .toBe("BROWSER_AGENT_TARGET_NOT_FOUND");
   expect(safeMcpErrorCode(new Error("Connect timeout"),"browser_agent_click"))
    .toBe("BROWSER_AGENT_TIMEOUT");
   expect(safeMcpErrorCode(new Error("/Users/private/my-password"),"browser_agent_click"))
    .toBe("BROWSER_AGENT_UNCLASSIFIED");
   expect(safeMcpErrorCode(new Error("Runtime request timed out after 20000ms"),"execute_command"))
    .toBe("RUNTIME_TIMEOUT");
   expect(safeMcpErrorCode(new Error("process timed out"),"primitive_call"))
    .toBe("RUNTIME_TIMEOUT");
   expect(safeMcpErrorCode(new Error("oops"),"execute_command"))
    .toBe("UNCLASSIFIED");
 });
});
