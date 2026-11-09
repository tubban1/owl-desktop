import {describe,it,expect} from "vitest";
import {activationWindow,activationPermit,localUserIdleSeconds,MIN_IDLE_SECONDS} from "../scripts/lib/ota-activation-policy.mjs";

describe("unattended OTA activation safety",()=>{
  it("uses Swiss local time, including CET and CEST",()=>{
    expect(activationWindow(new Date("2026-11-09T01:30:00Z"))).toBe(true); // 02:30 CET
    expect(activationWindow(new Date("2026-07-09T00:30:00Z"))).toBe(true); // 02:30 CEST
    expect(activationWindow(new Date("2026-11-09T09:30:00Z"))).toBe(false);
    expect(activationWindow(new Date("2026-11-09T04:00:00Z"))).toBe(false);
  });
  it("denies foreground activity, missing telemetry, and invalid dates",()=>{
    const now=new Date("2026-11-09T02:30:00Z");
    expect(MIN_IDLE_SECONDS).toBe(900);
    expect(activationPermit({now,idleSeconds:899}).allowed).toBe(false);
    expect(activationPermit({now,idleSeconds:null}).allowed).toBe(false);
    expect(activationPermit({now,idleSeconds:NaN}).allowed).toBe(false);
    expect(activationPermit({now,idleSeconds:900}).allowed).toBe(true);
    expect(activationPermit({now:new Date("bad"),idleSeconds:99999}).allowed).toBe(false);
  });
  it("fails closed when local idle probe fails",()=>{
    expect(localUserIdleSeconds("mac",()=>({status:1,stdout:""}))).toBe(null);
    expect(localUserIdleSeconds("windows",()=>({status:1,stdout:""}))).toBe(null);
    expect(localUserIdleSeconds("other")).toBe(null);
  });
  it("parses macOS ioreg HID idle nanoseconds safely",()=>{
    expect(localUserIdleSeconds("mac",()=>({status:0,stdout:'"HIDIdleTime" = 1500000000000'}))).toBe(1500);
    expect(localUserIdleSeconds("mac",()=>({status:0,stdout:"no idle data"}))).toBe(null);
  });
});
