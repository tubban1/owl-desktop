export function activeManagedProcessCount(value) {
  const source = value?.result ?? value;
  const rows = Array.isArray(source) ? source :
    Array.isArray(source?.processes) ? source.processes :
    Array.isArray(source?.items) ? source.items : [];
  return rows.filter((p) => typeof p?.running === "boolean"
    ? p.running
    : ["running", "starting"].includes(String(p?.status ?? ""))).length;
}
