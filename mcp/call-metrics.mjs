// Independent transport and tool outcome accounting: successful HTTP /mcp
// responses can contain a tool-level isError, and normal SSE GET close is not
// a failed tools/call. All fields are payload-free.
export function summarizeMcpCallMetrics(rows = []) {
  const completed = rows.filter(row => !(row.method === "GET" && row.status === 0));
  const tools = rows.filter(row => Boolean(row.tool));
  const toolFailures = tools.filter(row => row.toolOutcome === "error" ||
    row.status === 0 || row.status >= 400);
  const successfulTools = tools.filter(row =>
    row.toolOutcome === "success" && row.status >= 200 && row.status < 400);
  const ms = items => items.map(x => x.totalMs)
    .filter(x => Number.isFinite(x) && x >= 0).sort((a,b)=>a-b);
  const percentile = (values, p) => values.length ?
    values[Math.min(values.length-1,Math.ceil(values.length*p)-1)] : null;
  const responseMs = ms(completed);
  const toolMs = ms(tools);
  const toolServiceMs = tools.map(row =>
    Math.max(0,row.totalMs-Math.min(row.totalMs,Number(row.waitingMs)||0)))
      .filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);
  const getCloseCount = rows.filter(row => row.method === "GET" &&
    row.status === 0).length;
  return {
    sampleCount: completed.length,
    p50Ms: percentile(responseMs,.5),
    p95Ms: percentile(responseMs,.95),
    maxMs: responseMs.at(-1) ?? null,
    failedCount: completed.filter(row => row.status === 0 || row.status >= 400).length,
    slowCallCount: completed.filter(row => row.totalMs >= 2_000).length,
    transportStreamCloseCount: getCloseCount,
    toolSampleCount: tools.length,
    toolSucceededCount: successfulTools.length,
    toolFailedCount: toolFailures.length,
    toolUnknownOutcomeCount: tools.length - successfulTools.length - toolFailures.length,
    toolSuccessRate: successfulTools.length + toolFailures.length ?
      successfulTools.length/(successfulTools.length+toolFailures.length) : null,
    toolP50Ms: percentile(toolMs,.5),
    toolP95Ms: percentile(toolMs,.95),
    toolP99Ms: percentile(toolMs,.99),
    toolServiceP50Ms: percentile(toolServiceMs,.5),
    toolServiceP95Ms: percentile(toolServiceMs,.95),
    toolServiceP99Ms: percentile(toolServiceMs,.99),
  };
}
