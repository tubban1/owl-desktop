import { expect, it } from "vitest";
import { activeManagedProcessCount } from "../electron/services/usage-process-count.mjs";
it("excludes exited and stopped process records from activeProcesses", () => {
  const old = Array.from({length: 40}, () => ({status:"exited",running:false}));
  expect(activeManagedProcessCount({ processes: old })).toBe(0);
  expect(activeManagedProcessCount({ result: { items: [
    ...old, {status:"running",running:true}, {status:"starting"},
    {status:"running",running:false},
  ] } })).toBe(2);
  expect(activeManagedProcessCount(null)).toBe(0);
});
