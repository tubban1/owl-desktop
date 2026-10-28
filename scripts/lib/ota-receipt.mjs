// Windows PowerShell 5.1 emits UTF-8 BOM in Set-Content -Encoding UTF8.
export function parseOtaReceipt(input){
 const text=typeof input==="string"?input:String(input);
 return JSON.parse(text.charCodeAt(0)===0xFEFF?text.slice(1):text);
}
