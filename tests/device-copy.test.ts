import { describe, expect, it } from "vitest";
import { deviceCopy } from "../src/deviceCopy";
describe("current device UI labels", () => {
  it("identifies Windows as Windows, not Mac", () => {
    expect(deviceCopy("win32")).toEqual({ label: "This Windows PC", location: "this Windows PC" });
  });
  it("retains existing Mac wording", () => {
    expect(deviceCopy("darwin")).toEqual({ label: "This Mac", location: "this Mac" });
  });
  it("uses neutral wording for other platforms", () => {
    expect(deviceCopy("linux")).toEqual({ label: "This device", location: "this device" });
  });
});
