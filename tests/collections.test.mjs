import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index.mjs';
import {Store} from '../server/storage.mjs';
import {createCollection,editCollection,defaultCollections} from '../server/collections.mjs';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'paper-folders-'));const app=await createApp({dataDir:directory});
 app.locals.store.data.papers.push({id:'a',title:'Paper A',tags:['topic'],authors:[],createdAt:'2026-01-01',text:'source',pages:[]},{id:'b',title:'Paper B',tags:['topic'],authors:[],createdAt:'2026-01-02',text:'source',pages:[]});
 app.locals.store.data.annotations.push({id:'note',paperId:'a',text:'keep'});await app.locals.store.save();
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
 const api=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${route}`,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};};
 const folder=async(name,parentId=null)=>{const r=await api('/collections',{name,parentId});assert.equal(r.status,200);return r.data.collections.find(f=>f.name===name);};
 return{directory,app,api,folder};
}
test('folders persist independently of labels; a paper may belong to multiple folders and statuses',async t=>{
 const f=await fixture(t),a=await f.folder('Vision'),b=await f.folder('Course');
 const result=await f.api('/collection-memberships',{paperIds:['a','a'],addTo:[a.id,b.id,'status-reading']});assert.equal(result.status,200);
 for(const id of[a.id,b.id,'status-reading'])assert.deepEqual(result.data.collections.find(x=>x.id===id).paperIds,['a']);
 const reopened=await new Store(f.directory).init();assert.equal(reopened.data.collections.length,5);assert.deepEqual(reopened.paper('a').tags,['topic']);assert.equal(reopened.data.annotations[0].text,'keep');
});
test('folder hierarchy rejects cycles, status parents, duplicate sibling names and excessive subtree depth atomically',()=>{
 let folders=defaultCollections();folders=createCollection(folders,{name:'Root'});const root=folders.at(-1).id;folders=createCollection(folders,{name:'Child',parentId:root});const child=folders.at(-1).id;
 const before=JSON.stringify(folders);assert.throws(()=>editCollection(folders,root,{name:'Changed',parentId:child}),/descendants/);assert.equal(JSON.stringify(folders),before);
 assert.throws(()=>createCollection(folders,{name:' root '}),/already exists/);assert.throws(()=>createCollection(folders,{name:'x',parentId:'status-reading'}),/status/);
 folders=createCollection(folders,{name:'Child'});let parent=folders.at(-1).id;for(let i=0;i<6;i++){folders=createCollection(folders,{name:'Deep'+i,parentId:parent});parent=folders.at(-1).id;}
 assert.throws(()=>editCollection(folders,root,{parentId:parent}),/eight levels/);
 assert.throws(()=>editCollection(folders,'status-reading',{name:'Renamed'}),/cannot be edited/);
});
test('moving memberships is atomic, including papers already in the destination; unrelated folders survive',async t=>{
 const f=await fixture(t),a=await f.folder('A'),b=await f.folder('B'),c=await f.folder('C');
 await f.api('/collection-memberships',{paperIds:['a','b'],addTo:[a.id,c.id]});await f.api('/collection-memberships',{paperIds:['a'],addTo:[b.id]});
 const moved=await f.api('/collection-memberships',{paperIds:['a','b'],addTo:[b.id],removeFrom:[a.id]});assert.equal(moved.status,200);
 assert.deepEqual(moved.data.collections.find(x=>x.id===a.id).paperIds,[]);assert.deepEqual(moved.data.collections.find(x=>x.id===b.id).paperIds,['a','b']);assert.deepEqual(moved.data.collections.find(x=>x.id===c.id).paperIds,['a','b']);
 const before=JSON.stringify(f.app.locals.store.data.collections);
 for(const input of[{paperIds:['a','missing'],removeFrom:[b.id]},{paperIds:['a'],addTo:['unknown'],removeFrom:[b.id]},{paperIds:['a'],addTo:[b.id],removeFrom:[b.id]}])assert.ok((await f.api('/collection-memberships',input)).status>=400);
 assert.equal(JSON.stringify(f.app.locals.store.data.collections),before);
});
test('removing a folder never deletes papers or notes; child folders must be moved first',async t=>{
 const f=await fixture(t),a=await f.folder('Parent'),b=await f.folder('Child',a.id);
 await f.api('/collection-memberships',{paperIds:['a'],addTo:[a.id,b.id]});
 assert.equal((await f.api('/collections/'+a.id,undefined,'DELETE')).status,409);
 assert.equal((await f.api('/collections/'+b.id,{parentId:null},'PATCH')).status,200);
 assert.equal((await f.api('/collections/'+a.id,undefined,'DELETE')).status,200);
 assert.equal(f.app.locals.store.data.papers.length,2);assert.equal(f.app.locals.store.data.annotations.length,1);assert.deepEqual(f.app.locals.store.data.collections.find(x=>x.id===b.id).paperIds,['a']);
 assert.equal((await f.api('/collections/status-reading',undefined,'DELETE')).status,400);
 await f.api('/papers/a',undefined,'DELETE');assert.deepEqual(f.app.locals.store.data.collections.find(x=>x.id===b.id).paperIds,[]);
});
test('folder save errors roll back memberships and metadata without changing paper contents',async t=>{
 const f=await fixture(t),a=await f.folder('Safe');const before=JSON.stringify(f.app.locals.store.data.collections);const save=f.app.locals.store.save;f.app.locals.store.save=async()=>{throw new Error('disk unavailable');};
 assert.equal((await f.api('/collection-memberships',{paperIds:['a'],addTo:[a.id]})).status,500);assert.equal(JSON.stringify(f.app.locals.store.data.collections),before);
 f.app.locals.store.save=save;assert.equal(f.app.locals.store.paper('a').text,'source');
});
