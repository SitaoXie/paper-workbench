import {createHash,randomUUID} from 'node:crypto';
import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile,rm,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import {ApiError,isPublicAddress} from './network.mjs';
import net from 'node:net';
import {readStoredPdf} from './stored-pdf.mjs';
import {chatImagePath} from './chat-images.mjs';
import {validateRasterImage} from './vision.mjs';
import {validateAnnotation} from './annotations.mjs';
import {validateInteractive} from './interactive.mjs';
import {assertUniqueJsonKeys} from './json.mjs';

const zip=promisify(gzip),unzip=promisify(gunzip);
export const BACKUP_FORMAT='paper-workbench-library';
export const BACKUP_MAX_BYTES=200*1024*1024;
const MAX_UPLOAD=100*1024*1024,MAX_FILES=75*1024*1024;
const categories=['papers','annotations','activities','conversations','chats','collections'];
const blocked=new Set(['__proto__','prototype','constructor']);
const omitted=new Set(['settings','profiles','disabledProfiles','apiKey','api_key','authorization','Authorization','baseUrl','endpoint','extraBody','filePath','localPath','localPdfUrl','recommendationCache','profileId','profileName']);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>{throw new ApiError(message,status);};
const error=(zh,en)=>`${zh} / ${en}`;
function sourceUrl(value){
 if(typeof value!=='string')return undefined;
 try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)return undefined;
  if(['localhost','[::1]'].includes(u.hostname)||/\.(?:local|internal|localhost)$/.test(u.hostname)||(net.isIP(u.hostname)&&!isPublicAddress(u.hostname)))return undefined;
  return u.href;
 }catch{return undefined;}
}
// Credentials and machine paths are never part of a portable library. User prose is
// preserved verbatim: a private notebook backup is not an anonymized publication.
function portable(value,depth=0){
 if(depth>70)fail(error('备份嵌套层数过多','Backup nesting is too deep.'));
 if(Array.isArray(value))return value.map(item=>portable(item,depth+1));
 if(object(value)){
  const result={};
  for(const [key,item]of Object.entries(value)){
   if(item===undefined)continue;
   if(blocked.has(key))fail(error('备份包含不安全字段','Backup contains unsafe object fields.'));
   if(omitted.has(key)||/(?:password|secret|accessToken|refreshToken)/i.test(key))continue;
   if(['url','pdfUrl','sourceUrl'].includes(key)){const clean=sourceUrl(item);if(clean)result[key]=clean;continue;}
   result[key]=portable(item,depth+1);
  }
  return result;
 }
 if(value===null||['string','boolean'].includes(typeof value)||(typeof value==='number'&&Number.isFinite(value)))return value;
 fail(error('备份包含无效数据','Backup contains invalid data.'));
}
function records(value,name){
 if(!Array.isArray(value)||value.length>100000)fail(`Invalid ${name} records.`);
 const ids=new Set();for(const item of value){if(!object(item)||!id(item.id)||ids.has(item.id))fail(`Invalid or duplicate ${name} ID.`);ids.add(item.id);}
 return ids;
}
function validateReading(value,paper){
 if(!object(value)||typeof value.markdown!=='string')fail('Invalid reading content.');
 if(value.figures!==undefined)validateFigures(value.figures,paper);
 if(value.interactive!==undefined)validateInteractive(value.interactive,{pageCount:paper.pageCount,figures:value.figures||paper.figures||[]});
 if(value.stages!==undefined&&(!Array.isArray(value.stages)||value.stages.some(s=>!object(s)||typeof s.role!=='string'||typeof s.content!=='string')))fail('Invalid reading stages.');
 if(value.translations!==undefined){if(!object(value.translations))fail('Invalid reading translations.');for(const translation of Object.values(value.translations))validateReading(translation,paper);}
}
function validateFigures(figures,paper){
 if(!Array.isArray(figures))fail('Invalid paper figures.');
 for(const f of figures){
  if(!object(f)||!id(f.id)||!Number.isInteger(f.page)||f.page<1||typeof f.caption!=='string'||(paper.pages?.length&&!paper.pages.some(p=>p.number===f.page)))fail('Invalid paper figure.');
  if(f.crop!==undefined){const c=f.crop;if(!object(c)||!['x','y','width','height'].every(k=>typeof c[k]==='number'&&Number.isFinite(c[k]))||c.x<0||c.y<0||c.width<=0||c.height<=0||c.x+c.width>1.000001||c.y+c.height>1.000001)fail('Invalid figure crop.');}
 }
}
function validateData(data){
 if(!object(data)||Object.keys(data).some(key=>!categories.includes(key)))fail('Invalid library fields.');
 const sets=Object.fromEntries(categories.map(key=>[key,records(data[key],key)]));
 if(data.papers.length>10000)fail('A portable backup supports up to 10,000 papers.');
 const papers=new Map(data.papers.map(p=>[p.id,p]));
 const text=(value)=>typeof value==='string';
 for(const p of data.papers){
  if(!text(p.title)||(p.abstract!==undefined&&!text(p.abstract))||!text(p.text)||!Array.isArray(p.authors)||p.authors.some(v=>!text(v))||!Array.isArray(p.tags)||p.tags.some(v=>!text(v)))fail('Invalid paper metadata.');
  if(p.pages!==undefined&&(!Array.isArray(p.pages)||p.pages.some(v=>!object(v)||!Number.isInteger(v.number)||v.number<1||!text(v.text))||new Set(p.pages.map(v=>v.number)).size!==p.pages.length))fail('Invalid paper pages.');
  if(p.readingVersions!==undefined){records(p.readingVersions,'reading versions');for(const v of p.readingVersions){if(!text(v.markdown)||(v.language!==undefined&&!['zh-CN','zh','en'].includes(v.language)))fail('Invalid reading version.');}if(p.activeReadingId&&!p.readingVersions.some(v=>v.id===p.activeReadingId))fail('Unknown active reading version.');}
  if(p.figures!==undefined)validateFigures(p.figures,p);
  for(const key of ['summary','report'])if(p[key]!=null)validateReading(p[key],p);
  for(const key of ['readingVersions','summaryHistory','reportHistory'])if(p[key]!==undefined){if(!Array.isArray(p[key]))fail('Invalid reading history.');for(const v of p[key])validateReading(v,p);}
  if(p.translations!==undefined){if(!object(p.translations))fail('Invalid paper translations.');for(const targets of Object.values(p.translations)){if(!object(targets))fail('Invalid translation targets.');for(const v of Object.values(targets))validateReading(v,p);}}
 }
 for(const name of ['annotations','activities','conversations','chats'])for(const row of data[name]){
  if(row.paperId!=null&&!sets.papers.has(row.paperId))fail(`Unknown paper in ${name}.`);
  if(['annotations','activities'].includes(name)&&!sets.papers.has(row.paperId))fail(`Missing paper in ${name}.`);
 }
 const conversations=new Map(data.conversations.map(c=>[c.id,c]));
 for(const chat of data.chats){if(!sets.conversations.has(chat.conversationId)||!['user','assistant','system'].includes(chat.role)||!text(chat.content))fail('Invalid conversation message.');const c=conversations.get(chat.conversationId);if((c.paperId??null)!==(chat.paperId??null))fail('Conversation and message refer to different papers.');if(chat.images!==undefined&&(!Array.isArray(chat.images)||chat.images.length>4))fail('Invalid chat images.');}
 for(const c of data.conversations)if(!text(c.title))fail('Invalid conversation title.');
 for(const a of data.activities)if(!['translation','explanation'].includes(a.kind)||(a.result!==undefined&&(!object(a.result)||!text(a.result.text))))fail('Invalid reading activity.');
 for(const a of data.annotations){const paper=papers.get(a.paperId);const input=Object.fromEntries(['kind','page','rects','quote','body','color','tags','strokes','language','segments','markerHidden'].filter(k=>k in a).map(k=>[k,a[k]]));validateAnnotation(input,{...paper,...(paper.pdfAsset?{filePath:'validated.pdf'}:{})},a);}
 const folders=new Map(data.collections.map(f=>[f.id,f]));
 for(const f of data.collections){
  if(!['status','custom'].includes(f.kind)||!text(f.name)||!f.name.trim()||!Array.isArray(f.paperIds)||f.paperIds.some(p=>!sets.papers.has(p)))fail('Invalid folder.');
  if(f.kind==='status'&&!['status-want-to-read','status-reading','status-completed'].includes(f.id))fail('Invalid reading status folder.');
  const visited=new Set([f.id]);let parent=f.parentId,depth=0;
  while(parent){const next=folders.get(parent);if(!next||next.kind!=='custom'||visited.has(parent)||++depth>=8)fail('Invalid folder ancestry.');visited.add(parent);parent=next.parentId;}
 }
 return data;
}
function summary(bundle){return {createdAt:bundle.createdAt,papers:bundle.data.papers.length,pdfs:bundle.data.papers.filter(p=>p.pdfAsset).length,readings:bundle.data.papers.reduce((n,p)=>n+(p.readingVersions?.length||0),0),notes:bundle.data.annotations.length,conversations:bundle.data.conversations.length,messages:bundle.data.chats.length,folders:bundle.data.collections.filter(f=>f.kind==='custom').length,images:bundle.files.filter(f=>f.mimeType!=='application/pdf').length,bytes:bundle.files.reduce((n,f)=>n+f.bytes,0)};}
export async function createWorkspaceBackup(store){
 const snapshot=structuredClone(store.data);
 // Early stores allowed messages without IDs and metadata-only papers. Normalize
 // only this export snapshot; do not rewrite the user's running workspace.
 for(const message of snapshot.chats||[])if(message.id==null)message.id=randomUUID();
 for(const paper of snapshot.papers||[]){
  paper.abstract??='';paper.authors??=[];paper.tags??=[];
  paper.text??=Array.isArray(paper.pages)?paper.pages.map(p=>p.text||'').join('\n\n'):paper.abstract;
 }
 const data=Object.fromEntries(categories.map(k=>[k,portable(snapshot[k]||[])])),files=new Map();let total=0;
 function asset(buffer,mimeType){const digest=sha(buffer),key=digest+':'+mimeType;if(!files.has(key)){total+=buffer.length;if(total>MAX_FILES)fail(error('备份文件总量超过 75 MiB，请使用停机完整备份','Files exceed 75 MiB; use the documented offline full backup.'),413);files.set(key,{id:key,sha256:digest,mimeType,bytes:buffer.length,data:buffer.toString('base64')});}return key;}
 for(let i=0;i<snapshot.papers.length;i++)if(snapshot.papers[i].filePath){try{data.papers[i].pdfAsset=asset(await readStoredPdf(snapshot.papers[i],store.directory),'application/pdf');}catch(e){if(e instanceof ApiError)throw e;fail(error('某篇论文的 PDF 无法读取，未生成不完整备份','A paper PDF could not be read; no incomplete backup was created.'),409);}}
 for(let i=0;i<snapshot.chats.length;i++)for(let j=0;j<(snapshot.chats[i].images?.length||0);j++){
  const ref=snapshot.chats[i].images[j];let buffer;
  try{const target=chatImagePath(store.directory,ref),root=await realpath(store.directory),actual=await realpath(target);if(!actual.startsWith(root+path.sep))throw new Error();buffer=await readFile(actual);if(sha(buffer)!==ref.id)throw new Error();}catch{fail(error('聊天附件无法读取，未生成不完整备份','A chat attachment could not be read; no incomplete backup was created.'),409);}
  data.chats[i].images[j].asset=asset(buffer,ref.mimeType);
 }
 validateData(data);
 const bundle={format:BACKUP_FORMAT,version:1,createdAt:new Date().toISOString(),data,files:[...files.values()]};
 const text=JSON.stringify(bundle);if(Buffer.byteLength(text)>BACKUP_MAX_BYTES)fail(error('备份过大，请使用停机完整备份','Backup is too large; use the documented offline full backup.'),413);
 return {buffer:await zip(text),summary:summary(bundle)};
}
export async function parseWorkspaceBackup(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_UPLOAD)fail('Backup upload must be at most 100 MiB.',413);
 let raw;try{raw=await unzip(buffer,{maxOutputLength:BACKUP_MAX_BYTES});}catch{fail(error('无法读取备份，文件损坏、格式不符或解压后过大','Cannot read backup: damaged, unsupported, or too large after decompression.'));}
 const text=raw.toString('utf8');let bundle;try{assertUniqueJsonKeys(text);bundle=JSON.parse(text);}catch{fail('Invalid backup JSON.');}
 if(!object(bundle)||bundle.format!==BACKUP_FORMAT||bundle.version!==1||typeof bundle.createdAt!=='string'||!Number.isFinite(Date.parse(bundle.createdAt))||!Array.isArray(bundle.files)||bundle.files.length>20000)fail(error('不支持此备份版本或格式','Unsupported backup format or version.'));
 // Strip keys on import too; a tampered archive cannot reinstate credentials.
 bundle={format:bundle.format,version:1,createdAt:bundle.createdAt,data:portable(bundle.data),files:bundle.files};
 validateData(bundle.data);const files=new Map();let bytes=0;
 for(const f of bundle.files){
  if(!object(f)||!['application/pdf','image/png','image/jpeg'].includes(f.mimeType)||!/^[a-f0-9]{64}$/.test(f.sha256)||f.id!==f.sha256+':'+f.mimeType||files.has(f.id)||typeof f.data!=='string'||(f.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data)))fail('Invalid backup asset.');
  const content=Buffer.from(f.data,'base64');if(content.toString('base64')!==f.data||content.length!==f.bytes||sha(content)!==f.sha256||content.length===0||content.length>(f.mimeType==='application/pdf'?25:4)*1024*1024)fail(error('备份文件校验失败','Backup file integrity check failed.'));
  bytes+=content.length;if(bytes>MAX_FILES)fail('Backup assets exceed 75 MiB.',413);
  if(f.mimeType==='application/pdf'){if(!content.subarray(0,1024).includes(Buffer.from('%PDF-')))fail('Invalid PDF asset.');}else validateRasterImage({mimeType:f.mimeType,data:f.data});
  files.set(f.id,{...f,buffer:content});
 }
 const used=new Set();for(const p of bundle.data.papers)if(p.pdfAsset){if(files.get(p.pdfAsset)?.mimeType!=='application/pdf')fail('Missing PDF asset.');used.add(p.pdfAsset);}
 for(const m of bundle.data.chats)for(const image of m.images||[]){const f=files.get(image.asset);if(!f||f.mimeType!==image.mimeType||image.id!==f.sha256)fail('Missing chat image asset.');used.add(image.asset);}
 if(used.size!==files.size)fail('Unreferenced backup assets are not allowed.');
 return {bundle,files,summary:summary(bundle),digest:sha(buffer)};
}
function remapTree(value,map){
 if(Array.isArray(value))return value.map(v=>remapTree(v,map));
 if(object(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remapTree(v,map)]));
 if(typeof value==='string'){
  if(map.has(value))return map.get(value);
  return value.replace(/([?&]paper=)([^&#\s)"']+)|\/api\/papers\/([^/\s)"']+)/g,(match,prefix,query,paper)=>{let old;try{old=decodeURIComponent(query||paper);}catch{return match;}return map.has(old)?query?prefix+encodeURIComponent(map.get(old)):'/api/papers/'+encodeURIComponent(map.get(old)):match;});
 }
 return value;
}
export async function restoreWorkspaceBackup(store,parsed){
 let cleanupStaging=true;
 const batch=randomUUID(),parent=path.join(store.directory,'restored'),folder=path.join(parent,batch);
 const map=new Map();for(const key of categories)for(const row of parsed.bundle.data[key])if(!(key==='collections'&&row.kind==='status'))map.set(row.id,randomUUID());
 // Keep reading IDs internally consistent even when importing the same backup twice.
 for(const p of parsed.bundle.data.papers)for(const r of p.readingVersions||[])map.set(r.id,randomUUID());
 const data=remapTree(structuredClone(parsed.bundle.data),map);
 await mkdir(parent,{recursive:true,mode:0o700});
 if((await lstat(parent)).isSymbolicLink()||(await realpath(parent))!==path.join(await realpath(store.directory),'restored'))fail('Unsafe restore directory.');
 await mkdir(folder,{mode:0o700});
 try{
  for(const p of data.papers)if(p.pdfAsset){const f=parsed.files.get(p.pdfAsset);await writeFile(path.join(folder,f.sha256+'.pdf'),f.buffer,{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});p.filePath=path.relative(store.directory,path.join(folder,f.sha256+'.pdf'));delete p.pdfAsset;}
  for(const m of data.chats)for(const image of m.images||[]){const f=parsed.files.get(image.asset);const dir=path.join(store.directory,'chat-images');await mkdir(dir,{recursive:true,mode:0o700});if((await lstat(dir)).isSymbolicLink()||(await realpath(dir))!==path.join(await realpath(store.directory),'chat-images'))fail('Unsafe attachment directory.');const target=chatImagePath(store.directory,image);try{await writeFile(target,f.buffer,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;if((await lstat(target)).isSymbolicLink()||sha(await readFile(target))!==f.sha256)fail('Existing image file failed verification.');}image.url=`/api/chat-images/${image.id}`;delete image.asset;}
  // Stage all I/O before touching memory. Merge with the latest state, not the
  // state at preview time; existing papers/settings remain the same objects.
  const imported=new Map(categories.map(k=>[k,new Set(data[k].map(v=>v.id))]));
  const previousStatuses=new Map(),createdStatuses=new Set();
  for(const key of categories){
   if(key!=='collections'){store.data[key]=[...(store.data[key]||[]),...data[key]];continue;}
   const custom=data.collections.filter(f=>f.kind==='custom');
   for(const f of custom)if(!f.parentId){const suffix=` (restored ${batch.slice(0,6)})`;f.name=f.name.slice(0,100-suffix.length)+suffix;}
   store.data.collections=[...(store.data.collections||[]),...custom];
   for(const incoming of data.collections.filter(f=>f.kind==='status')){const current=store.data.collections.find(f=>f.id===incoming.id);if(current){previousStatuses.set(current.id,incoming.paperIds);current.paperIds=[...new Set([...current.paperIds,...incoming.paperIds])];}else {createdStatuses.add(incoming.id);store.data.collections.push(incoming);}}
  }
  try{await store.save();}catch(cause){
   for(const key of categories)store.data[key]=store.data[key].filter(row=>!(imported.get(key).has(row.id)&&!(key==='collections'&&row.kind==='status'&&!createdStatuses.has(row.id))));
   for(const [id,papers]of previousStatuses){const current=store.data.collections.find(f=>f.id===id);if(current)current.paperIds=current.paperIds.filter(p=>!papers.includes(p));}
   // A concurrent save could have captured the failed additions. Persist the
   // compensating state as well; preserve unrelated additions and preferences.
   await store.save().catch(()=>{cleanupStaging=false;});throw cause;
  }
  return {...parsed.summary,restoredPaperIds:data.papers.map(p=>p.id)};
 }catch(cause){if(cleanupStaging)await rm(folder,{recursive:true,force:true});/* Content-addressed images may have acquired concurrent references; retain harmless orphan files. */if(!cleanupStaging)fail(error('恢复保存失败，回滚也无法写入磁盘。请先恢复磁盘可写状态，重启检查文库后再操作','Restore could not save its rollback. Repair storage, restart and inspect the library before importing again.'),500);if(cause instanceof ApiError)throw cause;fail(error('恢复未完成，现有文库保持不变。请检查磁盘空间并重试','Restore failed; existing library is retained. Check disk space and retry.'),500);}
}
export function registerWorkspaceBackup(app,store,wrap){
 const pending=new Map(),used=new Map();let busy=false;
 const clean=()=>{const now=Date.now();for(const[id,p]of pending)if(now-p.at>15*60*1000)pending.delete(id);for(const[id,p]of used)if(now-p.at>15*60*1000)used.delete(id);};
 app.get('/api/workspace/backup',wrap(async(_req,res)=>{if(busy)fail('A workspace transfer is already running.',409);busy=true;try{const result=await createWorkspaceBackup(store);res.setHeader('Content-Type','application/gzip');res.setHeader('Content-Disposition',`attachment; filename="paper-workbench-${new Date().toISOString().slice(0,10)}.paperwork"`);res.send(result.buffer);}finally{busy=false;}}));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_UPLOAD,files:1,fields:0}}).single('file');
 app.post('/api/workspace/restore/preview',(req,res,next)=>{if(busy)return next(new ApiError('A workspace transfer is already running.',409));busy=true;upload(req,res,e=>{if(e){busy=false;return next(new ApiError(error('请选择一个不超过 100 MiB 的备份文件','Choose one backup file up to 100 MiB.'),e.code==='LIMIT_FILE_SIZE'?413:400));}next();});},wrap(async(req,res)=>{try{if(!req.file)fail('Choose a backup file.');const parsed=await parseWorkspaceBackup(req.file.buffer);clean();pending.clear();const token=randomUUID();pending.set(token,{...parsed,at:Date.now()});res.json({token,summary:parsed.summary,expiresInSeconds:900});}finally{busy=false;}}));
 app.post('/api/workspace/restore',wrap(async(req,res)=>{clean();if(!object(req.body)||Object.keys(req.body).some(k=>!['token','confirm'].includes(k))||req.body.confirm!==true||!id(req.body.token))fail(error('请先预览并确认恢复','Preview and confirm the restore first.'));if(used.has(req.body.token))return res.json(used.get(req.body.token).result);const parsed=pending.get(req.body.token);if(!parsed)fail(error('预览已失效，请重新选择备份文件','Preview expired. Select the backup again.'),410);if(busy)fail('A workspace transfer is already running.',409);busy=true;try{const result=await restoreWorkspaceBackup(store,parsed);pending.delete(req.body.token);used.set(req.body.token,{at:Date.now(),result});res.json(result);}finally{busy=false;}}));
}
