import {randomUUID} from 'node:crypto';
import {ApiError} from './network.mjs';

export const defaultCollections = () => ['want-to-read','reading','completed'].map(status => ({id:`status-${status}`,name:status,kind:'status',status,parentId:null,paperIds:[],createdAt:new Date().toISOString()}));
export function collectionList(data) {
  const live = new Set(data.papers.map(p=>p.id));
  return data.collections.map(folder=>({...folder,paperIds:folder.paperIds.filter(id=>live.has(id))}));
}
function body(value, keys) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k))) throw new ApiError('Invalid folder fields.');
  return value;
}
const key = name => name.normalize('NFKC').toLowerCase();
function name(value) {
  if(typeof value!=='string'||!value.trim()||value.length>100||/[\u0000-\u001f\u007f]/.test(value))throw new ApiError('Folder names must be single-line text, 1–100 characters.');
  return value.trim();
}
function get(folders,id) {const folder=folders.find(f=>f.id===id);if(!folder)throw new ApiError('Folder not found.',404);return folder;}
function parent(folders,id,ownId) {
  if(id===null)return null;
  if(typeof id!=='string')throw new ApiError('Invalid parent folder.');
  let item=get(folders,id),depth=0;const visited=new Set(ownId?[ownId]:[]);
  if(item.kind==='status')throw new ApiError('Reading-status folders cannot contain subfolders.');
  while(item){if(visited.has(item.id))throw new ApiError('A folder cannot be placed inside itself or its descendants.');visited.add(item.id);if(++depth>=8)throw new ApiError('Folders support up to eight levels.');item=item.parentId?get(folders,item.parentId):null;}
  return id;
}
function unique(folders,item) {if(folders.some(f=>f.id!==item.id&&f.parentId===item.parentId&&key(f.name)===key(item.name)))throw new ApiError('A folder with this name already exists here.',409);}
export function createCollection(folders,input) {
  body(input,['name','parentId']);const item={id:randomUUID(),name:name(input.name),kind:'custom',parentId:parent(folders,input.parentId??null),paperIds:[],createdAt:new Date().toISOString()};unique(folders,item);return [...folders,item];
}
export function editCollection(folders,id,input) {
  body(input,['name','parentId']);if(!Object.keys(input).length)throw new ApiError('Provide a name or parent folder.');
  const old=get(folders,id);if(old.kind!=='custom')throw new ApiError('Default reading-status folders cannot be edited.');
  const item={...old,...('name'in input?{name:name(input.name)}:{}),...('parentId'in input?{parentId:parent(folders,input.parentId,id)}:{}),updatedAt:new Date().toISOString()};unique(folders,item);
  const next=folders.map(f=>f.id===id?item:f);
  // Moving a whole subtree must also respect the depth limit for its leaves.
  for(const f of next)if(f.parentId)parent(next,f.parentId,f.id);
  return next;
}
export function removeCollection(folders,id) {
  const folder=get(folders,id);if(folder.kind!=='custom')throw new ApiError('Default reading-status folders cannot be deleted.');
  if(folders.some(f=>f.parentId===id))throw new ApiError('Move or remove subfolders before deleting this folder.',409);
  return folders.filter(f=>f.id!==id);
}
export function changeMemberships(data,input) {
  body(input,['paperIds','addTo','removeFrom']);
  if(!Array.isArray(input.paperIds)||!input.paperIds.length||input.paperIds.length>500||input.paperIds.some(id=>typeof id!=='string'||!data.papers.some(p=>p.id===id)))throw new ApiError('Select 1–500 existing papers.');
  const add=input.addTo??[],remove=input.removeFrom??[];
  for(const ids of [add,remove]){if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'))throw new ApiError('Invalid destination folders.');for(const id of ids)get(data.collections,id);}
  if(!add.length&&!remove.length)throw new ApiError('Select a destination or source folder.');
  if(add.some(id=>remove.includes(id)))throw new ApiError('A folder cannot be both source and destination.');
  // A move is explicitly add + remove in one snapshot, even if already in target.
  return data.collections.map(folder=>({...folder,paperIds:[...new Set([...(remove.includes(folder.id)?folder.paperIds.filter(id=>!input.paperIds.includes(id)):folder.paperIds),...(add.includes(folder.id)?input.paperIds:[])])]}));
}
export function registerCollections(app,store,wrap) {
  app.get('/api/collections',wrap(async(_req,res)=>res.json({collections:collectionList(store.data)})));
  const save=async(next,res)=>{const previous=store.data.collections;store.data.collections=next;try{await store.save();}catch(error){if(store.data.collections===next)store.data.collections=previous;throw error;}res.json({collections:collectionList(store.data)});};
  app.post('/api/collections',wrap(async(req,res)=>save(createCollection(store.data.collections,req.body),res)));
  app.patch('/api/collections/:id',wrap(async(req,res)=>save(editCollection(store.data.collections,req.params.id,req.body),res)));
  app.delete('/api/collections/:id',wrap(async(req,res)=>save(removeCollection(store.data.collections,req.params.id),res)));
  app.post('/api/collection-memberships',wrap(async(req,res)=>save(changeMemberships(store.data,req.body),res)));
}
