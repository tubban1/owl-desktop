import { describe, expect, it } from "vitest";
import {
  OWL_COMPATIBILITY_V1,
  assertRuntimeCompatibility,
  supportsRemoteCommand,
} from "../electron/services/compatibility-v1.mjs";

describe("OWL compatibility v1", () => {
  it("accepts the exact tested Runtime API", () => {
    expect(assertRuntimeCompatibility({ apiVersion: "0.1" })).toEqual({
      compatible: true,
      runtimeApiVersion: "0.1",
    });
  });

  it("rejects an untested Runtime API before consequential Cloud work", () => {
    expect(() =>
      assertRuntimeCompatibility({ apiVersion: "0.2" }),
    ).toThrow("requires Runtime API 0.1");
    try {
      assertRuntimeCompatibility({ apiVersion: "0.2" });
    } catch (error) {
      expect(error.code).toBe("RUNTIME_API_INCOMPATIBLE");
    }
  });

  it("freezes supported RemoteCommand kind/version pairs", () => {
    expect(supportsRemoteCommand("runtime.task.create", 1)).toBe(true);
    expect(supportsRemoteCommand("runtime.task.create-and-start", 1)).toBe(true);
    expect(supportsRemoteCommand("runtime.task.create-and-start", 2)).toBe(false);
    expect(supportsRemoteCommand("runtime.rpc.escape", 1)).toBe(false);
  });

  it("publishes native component identities", () => {
    expect(OWL_COMPATIBILITY_V1.helper).toEqual({
      bundleIdentifier: "fan.fde.owl.helper",
      version: "1.0.0",
    });
    expect(OWL_COMPATIBILITY_V1.runtimeHost).toEqual({
      bundleIdentifier: "fan.fde.owl.runtime",
      version: "1.0.0",
    });
  });
});
