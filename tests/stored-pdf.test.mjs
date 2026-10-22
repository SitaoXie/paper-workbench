import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readStoredPdf} from '../server/stored-pdf.mjs';
import {outlinePdf} from './fixtures/outline-pdf.mjs';

test('stored PDF reads exact source bytes without changing the source file',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pw-pdf-source-'));t.after(()=>rm(root,{recursive:true,force:true}));const bytes=outlinePdf();await writeFile(join(root,'paper.pdf'),bytes);assert.deepEqual(await readStoredPdf({filePath:'paper.pdf'},root),bytes);
});
test('stored PDF rejects outside symlinks, missing, oversized and non-PDF sources',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pw-pdf-source-')),outside=await mkdtemp(join(tmpdir(),'pw-pdf-outside-'));t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});await writeFile(join(outside,'source.pdf'),outlinePdf());await symlink(join(outside,'source.pdf'),join(root,'escape.pdf'));await assert.rejects(readStoredPdf({filePath:'escape.pdf'},root));await assert.rejects(readStoredPdf({filePath:join(outside,'source.pdf')},root));await assert.rejects(readStoredPdf({filePath:'missing.pdf'},root));await assert.rejects(readStoredPdf({},root));await writeFile(join(root,'large.pdf'),'%PDF-1.7');await truncate(join(root,'large.pdf'),25*1024*1024+1);await assert.rejects(readStoredPdf({filePath:'large.pdf'},root));await writeFile(join(root,'plain.pdf'),'not a PDF');await assert.rejects(readStoredPdf({filePath:'plain.pdf'},root));
});
