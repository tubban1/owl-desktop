import { describe, expect, it } from "vitest";
import {
  cloudAccessAllows,
  normalizeEffectiveAccess,
} from "../electron/services/cloud-effective-access.mjs";

describe("Cloud effective access consumer", () => {
  it("consumes explicit effective access booleans", () => {
    expect(normalizeEffectiveAccess({
      effectiveAccess: {
        canView: true,
        canRun: false,
        canSchedule: true,
        canApprove: false,
      },
    })).toEqual({
      canView: true,
      canRun: false,
      canSchedule: true,
      canApprove: false,
    });
  });

  it("never derives device execution access from a Cloud role", () => {
    const payload = {
      role: "owner",
      organizationRole: "admin",
    };
    expect(normalizeEffectiveAccess(payload)).toEqual({
      canView: false,
      canRun: false,
      canSchedule: false,
      canApprove: false,
    });
    expect(cloudAccessAllows(payload, "canRun")).toBe(false);
    expect(cloudAccessAllows(payload, "canApprove")).toBe(false);
  });

  it("fails closed for unknown access names", () => {
    expect(cloudAccessAllows({ canRun: true }, "canDeleteEverything")).toBe(false);
  });
});
