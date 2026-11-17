import {describe,it,expect} from "vitest";
import {macReleaseNameMatchesSha} from "../scripts/lib/mac-release-name.mjs";
import fs from "node:fs";
const sha="1b216725d38279f7aa209679fe324d09ad2a64e2";
describe("Native-host-compatible immutable Mac release roots",()=>{
 it("permits only matching seven-hex SHA release names",()=>{
  expect(macReleaseNameMatchesSha("/safe/_releases/owl-desktop-1b21672",sha)).toBe(true);
  for(const bad of [
   "/safe/_releases/owl-desktop-gate-candidate-20261117",
   "/safe/_releases/owl-desktop-31f4901",
   "/safe/_releases/owl-desktop-1b216725",
   "/safe/_releases/owl-desktop-1b2167",
   "/safe/_releases/owl-desktop-1b2167z",
   "owl-desktop-1b21672",
  ]) expect(macReleaseNameMatchesSha(bad,sha),bad).toBe(false);
 });
 it("guards both check/apply before stopping the previous live supervisor",()=>{
  const src=fs.readFileSync(new URL("../scripts/mac-safe-cutover.mjs",import.meta.url),"utf8");
  expect(src).toContain('if(!macReleaseNameMatchesSha(canonical,shaExpected))throw Error("RELEASE_ROOT_NAME_SHA_MISMATCH")');
  expect(src.indexOf('if(!macReleaseNameMatchesSha(canonical,shaExpected))')).toBeLessThan(src.indexOf('original.pid,"SIGTERM"'));
  expect(src).toContain('if(nativePin.configured&&!nativePin.trusted)throw Error("CUTOVER_NATIVE_HOST_CURRENT_UNTRUSTED")');
  expect(src).toContain("nativeHostSafeToRebind");
 });
});
