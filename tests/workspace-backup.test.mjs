import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Store} from '../server/storage.mjs';
import {createWorkspaceBackup,parseWorkspaceBackup,restoreWorkspaceBackup,registerWorkspaceBackup} from '../server/workspace-backup.mjs';
import {readStoredPdf} from '../server/stored-pdf.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wGQAAAAASUVORK5CYII=','base64');
const pdf=Buffer.from('%PDF-1.7\n% backup test fixture\n%%EOF');
const encode=b=>gzipSync(JSON.stringify(b));
async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'workbench-backup-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=await new Store(dir).init();
 await writeFile(path.join(dir,'paper.pdf'),pdf);await mkdir(path.join(dir,'chat-images'));await writeFile(path.join(dir,'chat-images',digest(png)+'.png'),png);
 store.data.settings={apiKey:'fixture-private-key',baseUrl:'https://private.invalid/v1',disabledProfiles:[{apiKey:'fixture-archived-secret'}]};
 store.data.papers=[{id:'paper-1',title:'Portable research',authors:['Example Author'],institutions:['Example Lab'],abstract:'Original abstract.',text:'Source text.',tags:['topic'],favorite:true,createdAt:'2026-01-01',filePath:'paper.pdf',url:'https://example.org/paper',pdfUrl:'https://example.org/paper.pdf?token=private',pageCount:1,pages:[{number:1,text:'Source text.'}],figures:[{id:'figure-1',page:1,caption:'Example figure',crop:{x:0,y:0,width:.5,height:.5}}],readingVersions:[{id:'reading-1',style:'deep',markdown:'Deep reading [paper](?paper=paper-1).',language:'en',createdAt:'2026-01-01',source:{kind:'api',profileId:'private-profile',baseUrl:'https://private.invalid/v1'},translations:{'zh-CN':{markdown:'中文解读',language:'zh-CN'}}}],activeReadingId:'reading-1'}];
 store.data.annotations=[{id:'note-1',paperId:'paper-1',kind:'note',page:1,body:'Private note',color:'yellow',createdAt:'2026-01-01'}];
 store.data.activities=[{id:'activity-1',paperId:'paper-1',kind:'translation',page:1,text:'Source text.',result:{text:'原文'},readingId:'reading-1'}];
 store.data.conversations=[{id:'conversation-1',paperId:'paper-1',title:'Read the evidence'}];
 store.data.chats=[{id:'message-1',paperId:'paper-1',conversationId:'conversation-1',role:'user',content:'Explain this image and ?paper=bad% escape.',images:[{id:digest(png),mimeType:'image/png',name:'figure.png',width:1,height:1,url:'/api/chat-images/'+digest(png)}]}];
 store.data.collections.push({id:'folder-1',name:'Research',kind:'custom',parentId:null,paperIds:['paper-1']},{id:'folder-2',name:'Methods',kind:'custom',parentId:'folder-1',paperIds:['paper-1']});store.data.collections.find(f=>f.id==='status-reading').paperIds=['paper-1'];await store.save();return store;
}
test('portable backup round-trips library assets and references without credentials or overwrites',async t=>{
 const source=await fixture(t),backup=await createWorkspaceBackup(source),json=gunzipSync(backup.buffer).toString();
 for(const secret of ['fixture-private-key','fixture-archived-secret','private.invalid','private-profile','paper.pdf?token','"filePath"'])assert.ok(!json.includes(secret),secret);
 const parsed=await parseWorkspaceBackup(backup.buffer);assert.equal(parsed.summary.papers,1);assert.equal(parsed.summary.pdfs,1);assert.equal(parsed.summary.notes,1);assert.equal(parsed.summary.images,1);
 const targetDir=await mkdtemp(path.join(os.tmpdir(),'workbench-restore-'));t.after(()=>rm(targetDir,{recursive:true,force:true}));const target=await new Store(targetDir).init();const settings=target.data.settings;target.data.papers.push({id:'existing',title:'Keep me',authors:[],tags:[],text:''});
 const result=await restoreWorkspaceBackup(target,parsed),paper=target.data.papers.at(-1);assert.notEqual(paper.id,'paper-1');assert.equal(result.papers,1);assert.equal(target.data.settings,settings);assert.equal(target.data.papers[0].id,'existing');assert.deepEqual(await readStoredPdf(paper,targetDir),pdf);
 assert.equal(paper.activeReadingId,paper.readingVersions[0].id);assert.equal(paper.readingVersions[0].translations['zh-CN'].markdown,'中文解读');assert.ok(paper.readingVersions[0].markdown.includes(paper.id));assert.equal(paper.url,'https://example.org/paper');assert.equal(paper.pdfUrl,undefined);
 assert.equal(target.data.annotations[0].paperId,paper.id);assert.equal(target.data.activities[0].readingId,paper.activeReadingId);assert.equal(target.data.chats[0].conversationId,target.data.conversations[0].id);assert.equal(target.data.chats[0].images[0].url,'/api/chat-images/'+digest(png));
 const root=target.data.collections.find(f=>f.name.startsWith('Research')),child=target.data.collections.find(f=>f.name==='Methods');assert.equal(child.parentId,root.id);assert.deepEqual(root.paperIds,[paper.id]);assert.deepEqual(target.data.collections.find(f=>f.id==='status-reading').paperIds,[paper.id]);
 await restoreWorkspaceBackup(target,parsed);assert.equal(target.data.papers.length,3);assert.notEqual(target.data.papers[1].id,target.data.papers[2].id);
 const reopened=await new Store(targetDir).init();assert.equal(reopened.data.chats.length,2);assert.equal(reopened.data.annotations.length,2);
});
test('archive validation rejects damaged assets, references, schemas, and unsafe keys',async t=>{
 const source=await fixture(t),backup=await createWorkspaceBackup(source),original=JSON.parse(gunzipSync(backup.buffer));
 for(const mutate of [b=>b.version=999,b=>b.files[0].sha256='0'.repeat(64),b=>b.files[0].data=Buffer.from('bad').toString('base64'),b=>b.data.chats[0].conversationId='missing',b=>b.data.collections[3].parentId='folder-2',b=>b.data.papers[0].summary=42,b=>b.data.papers[0].figures[0].crop.width=5,b=>b.data.papers.push(b.data.papers[0]),b=>b.data.annotations[0].paperId='gone',b=>b.data.papers[0].readingVersions[0].translations=[]]){const b=structuredClone(original);mutate(b);await assert.rejects(parseWorkspaceBackup(encode(b)));}
 await assert.rejects(parseWorkspaceBackup(Buffer.from('not a backup')));await assert.rejects(parseWorkspaceBackup(gzipSync('{"format":1,"format":2}')));await assert.rejects(parseWorkspaceBackup(gzipSync(JSON.stringify(original).replace('"authors":[','"__proto__":{"polluted":true},"authors":['))));
 // Tampered paths/config are discarded; they can never select an output path.
 const modified=structuredClone(original);modified.data.papers[0].filePath='../../escape.pdf';modified.data.papers[0].apiKey='bad-key';const parsed=await parseWorkspaceBackup(encode(modified));assert.equal(parsed.bundle.data.papers[0].filePath,undefined);assert.equal(parsed.bundle.data.papers[0].apiKey,undefined);assert.equal({}.polluted,undefined);
});
test('restore refuses destination symlinks and export refuses escaped source files',async t=>{
 const source=await fixture(t),parsed=await parseWorkspaceBackup((await createWorkspaceBackup(source)).buffer),outside=await mkdtemp(path.join(os.tmpdir(),'outside-backup-'));t.after(()=>rm(outside,{recursive:true,force:true}));await symlink(outside,path.join(source.directory,'restored'));await assert.rejects(restoreWorkspaceBackup(source,parsed),/Unsafe restore/);assert.deepEqual(await readdir(outside),[]);
 await writeFile(path.join(outside,'outside.pdf'),pdf);await symlink(path.join(outside,'outside.pdf'),path.join(source.directory,'escape.pdf'));source.data.papers[0].filePath='escape.pdf';await assert.rejects(createWorkspaceBackup(source));
});
test('failed persistence removes only imported records and retains concurrent edits',async t=>{
 const source=await fixture(t),parsed=await parseWorkspaceBackup((await createWorkspaceBackup(source)).buffer);const originalIds=source.data.papers.map(p=>p.id);let calls=0;const realSave=source.save.bind(source);
 source.save=async()=>{if(++calls===1){source.data.papers.push({id:'concurrent',title:'Concurrent paper',authors:[],tags:[],text:''});source.data.settings.model='new-model';throw new Error('disk full');}return realSave();};
 await assert.rejects(restoreWorkspaceBackup(source,parsed),/Restore failed/);assert.deepEqual(source.data.papers.map(p=>p.id),[...originalIds,'concurrent']);assert.equal(source.data.settings.model,'new-model');assert.deepEqual(source.data.collections.find(f=>f.id==='status-reading').paperIds,['paper-1']);assert.equal(source.data.annotations.length,1);assert.deepEqual(await readdir(path.join(source.directory,'restored')),[]);
 const saved=JSON.parse(await readFile(source.file));assert.equal(saved.papers.length,2);assert.equal(saved.settings.model,'new-model');
});
test('HTTP preview is non-mutating and restore requires explicit confirmation; retries are idempotent',async t=>{
 const store=await fixture(t),app=express();app.use(express.json());registerWorkspaceBackup(app,store,fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next));app.use((e,_req,res,_next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});const base=`http://127.0.0.1:${server.address().port}/api/workspace`;
 const backup=await fetch(base+'/backup');assert.equal(backup.status,200);assert.match(backup.headers.get('content-disposition'),/\.paperwork/);const form=new FormData();form.append('file',new Blob([await backup.arrayBuffer()]),'library.paperwork');const previewResponse=await fetch(base+'/restore/preview',{method:'POST',body:form});assert.equal(previewResponse.status,200);const preview=await previewResponse.json();assert.equal(store.data.papers.length,1);
 const restore=body=>fetch(base+'/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await restore({token:preview.token})).status,400);assert.equal((await restore({token:'expired',confirm:true})).status,410);const first=await restore({token:preview.token,confirm:true});assert.equal(first.status,200);const result=await first.json();assert.equal(store.data.papers.length,2);assert.deepEqual(await (await restore({token:preview.token,confirm:true})).json(),result);assert.equal(store.data.papers.length,2);
});
test('multi-megabyte PDFs use bounded decoding and restore readable bytes',async t=>{
 const store=await fixture(t),large=Buffer.alloc(2*1024*1024,32);pdf.copy(large);await writeFile(path.join(store.directory,'paper.pdf'),large);const parsed=await parseWorkspaceBackup((await createWorkspaceBackup(store)).buffer);assert.equal(parsed.files.get(parsed.bundle.data.papers[0].pdfAsset).buffer.length,large.length);await restoreWorkspaceBackup(store,parsed);assert.deepEqual(await readStoredPdf(store.data.papers.at(-1),store.directory),large);
});
test('a failed compensating save retains staged PDFs needed by a possibly durable snapshot',async t=>{
 const store=await fixture(t),parsed=await parseWorkspaceBackup((await createWorkspaceBackup(store)).buffer),realSave=store.save.bind(store);let calls=0;
 store.save=async()=>{if(++calls===1)await realSave();throw new Error('Storage connection lost after write');};await assert.rejects(restoreWorkspaceBackup(store,parsed));assert.equal(store.data.papers.length,1);
 const disk=JSON.parse(await readFile(store.file));assert.equal(disk.papers.length,2);assert.deepEqual(await readStoredPdf(disk.papers[1],store.directory),pdf);
});
test('integrated routes retain local-only guards and expose restored library records',async t=>{
 const store=await fixture(t),{createApp}=await import('../server/index.mjs'),app=await createApp({dataDir:store.directory});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/workspace/backup',{headers:{Origin:'https://unrelated.example'}})).status,403);
 const backup=await fetch(base+'/api/workspace/backup');assert.equal(backup.status,200);const form=new FormData();form.append('file',new Blob([await backup.arrayBuffer()]),'copy.paperwork');const response=await fetch(base+'/api/workspace/restore/preview',{method:'POST',body:form});assert.equal(response.status,200);const preview=await response.json();const restored=await fetch(base+'/api/workspace/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:preview.token,confirm:true})});assert.equal(restored.status,200);const {restoredPaperIds:[paperId]}=await restored.json();const paperResponse=await fetch(base+'/api/papers/'+paperId);assert.equal(paperResponse.status,200);const {paper}=await paperResponse.json();assert.equal(paper.title,'Portable research');assert.equal(paper.readingVersions.length,1);assert.equal(paper.authors[0],'Example Author');
});
test('legacy messages without IDs and metadata-only papers export without mutating the current store',async t=>{
 const store=await fixture(t);delete store.data.chats[0].id;delete store.data.papers[0].text;delete store.data.papers[0].tags;const before=JSON.stringify(store.data);const parsed=await parseWorkspaceBackup((await createWorkspaceBackup(store)).buffer);assert.equal(JSON.stringify(store.data),before);assert.equal(typeof parsed.bundle.data.chats[0].id,'string');assert.equal(parsed.bundle.data.papers[0].text,'Source text.');assert.deepEqual(parsed.bundle.data.papers[0].tags,[]);await restoreWorkspaceBackup(store,parsed);assert.equal(store.data.chats.length,2);
});
