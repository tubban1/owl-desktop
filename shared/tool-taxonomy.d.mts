export const TOOL_TAXONOMY_VERSION: number;
export type ToolInfo={id:string;title:string;category:string;profile:string;visibility:string;primitive:string|null;op:string|null;action:string|null;executionPath:string;riskTier:string;supportedPlatforms:string[];availability:string;deprecated:boolean;replacement:string|null};
export function describeTool(id:string,source?:{description?:string;annotations?:{destructiveHint?:boolean}}):ToolInfo;
export function summarizeToolDomains(rows:Array<{tool:string;calls:number;errors:number}>):Array<{category:string;calls:number;errors:number}>;
export function suggestToolProfiles(goal?:string):string[];
