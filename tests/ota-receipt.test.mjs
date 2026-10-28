import {describe,it,expect} from "vitest";
import {parseOtaReceipt} from "../scripts/lib/ota-receipt.mjs";
describe("Windows cutover receipts",()=>{
 it("accepts PowerShell UTF-8 BOM without weakening schema checks",()=>{
  const body='{"phase":"activated","toSha":"'+("a".repeat(40))+'"}';
  expect(parseOtaReceipt(body).phase).toBe("activated");
  expect(parseOtaReceipt("\uFEFF"+body)).toEqual(parseOtaReceipt(body));
  expect(()=>parseOtaReceipt("\uFEFF{broken")).toThrow();
 });
});
