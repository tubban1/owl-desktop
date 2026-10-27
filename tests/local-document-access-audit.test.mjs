import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditDocumentAccess,defaultDocumentRoots} from '../scripts/audit-local-document-access.mjs';

describe('cross-platform local document access diagnostics',()=>{
 it('defaults to read-only and never writes to disk',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'owl-file-audit-'));
  try{
   const result=auditDocumentAccess({roots:[root]});
   expect(result.mode).toBe('read_only');
   expect(result.directories[0]).toMatchObject({list:true,canary:'not_tested'});
   expect(fs.readdirSync(root)).toEqual([]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it('creates and completely cleans up only its own canary',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'owl-file-audit-'));
  try{
   fs.writeFileSync(path.join(root,'keep.txt'),'original');
   const result=auditDocumentAccess({roots:[root],verifyWrites:true});
   expect(result.directories[0].canary).toBe('passed');
   expect(fs.readdirSync(root)).toEqual(['keep.txt']);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it('honors roots and avoids secret, hidden and symlink files',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'owl-file-audit-'));
  try{
   const docs=path.join(root,'Documents');fs.mkdirSync(docs);
   const pdf=path.join(docs,'test.pdf'),outside=path.join(root,'outside.pdf'),link=path.join(docs,'link.pdf'),hidden=path.join(docs,'.secret.pdf');
   fs.writeFileSync(pdf,'%PDF-1.4');fs.writeFileSync(outside,'%PDF-1.4');
   fs.writeFileSync(hidden,'redacted');fs.symlinkSync(pdf,link);
   const r=auditDocumentAccess({roots:[docs],samples:[pdf,outside,link,hidden]});
   expect(r.samples.map(x=>x.reason)).toEqual(['candidate_only','outside_roots','symlink','protected_path']);
   expect(r.samples[0].attachmentCandidate).toBe(true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it('does not authorize the home directory wholesale',()=>{
  expect(defaultDocumentRoots('/Users/example')).toEqual(['/Users/example/Downloads','/Users/example/Documents','/Users/example/Desktop']);
 });
});
