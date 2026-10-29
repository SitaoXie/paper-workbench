import {randomUUID,createHash} from 'node:crypto';
import {validateSettings} from './models.mjs';
import {extractPaperMetadata} from './metadata-extraction.mjs';
import {ApiError} from './network.mjs';
import {publicPaper} from './storage.mjs';
import {pdfRevision} from './figures.mjs';
const metadataOf=paper=>({authors:paper.authors||[],institutions:paper.institutions||[],abstract:paper.abstract||'',abstractIsExcerpt:!!paper.abstractIsExcerpt,metadataExtraction:paper.metadataExtraction||null});
const abstractTranslations=paper=>structuredClone(Object.fromEntries(Object.entries(paper.translations||{}).filter(([,value])=>value.abstract).map(([language,value])=>[language,value.abstract])));
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revision=paper=>createHash('sha256').update(JSON.stringify([metadataOf(paper),paper.pdfRevision])).digest('hex');
export function registerMetadataRoutes(app,{store,wrap,paperById,fetchImpl,extract=extractPaperMetadata}){
 const proposals=new Map(),jobs=new Set();
 const fieldsOfMetadata=['authors','institutions','abstract','abstractIsExcerpt','metadataExtraction','metadataHistory','translations'];
 const snapshot=paper=>structuredClone(Object.fromEntries(fieldsOfMetadata.filter(key=>key in paper).map(key=>[key,paper[key]])));
 const restore=(paper,state)=>{for(const key of fieldsOfMetadata){if(key in state)paper[key]=state[key];else delete paper[key];}};
 const exclusive=action=>wrap(async(request,response)=>{const paper=paperById(request.params.id);if(jobs.has(paper.id))throw new ApiError('Another metadata operation is running for this paper.',409);jobs.add(paper.id);try{await action(request,response,paper);}finally{jobs.delete(paper.id);}});
 app.post('/api/papers/:id/metadata/extract',wrap(async(request,response)=>{
  const paper=paperById(request.params.id),body=request.body||{};
  if(jobs.has(paper.id))throw new ApiError('Metadata extraction is already running for this paper.',409);
  const settings=validateSettings({...(body.profileId!==undefined?{activeProfileId:body.profileId}:{}),...(body.model!==undefined?{model:body.model}:{}),...(body.modelReasoning!==undefined?{modelReasoning:body.modelReasoning}:{})},structuredClone(store.data.settings));
  const baseRevision=revision(paper),source=structuredClone(paper),controller=new AbortController();
  const abort=()=>{if(!response.writableEnded)controller.abort();};response.on('close',abort);jobs.add(paper.id);
  try{
   const result=await extract(source,settings,{dataDir:store.directory,fetchImpl,signal:controller.signal});
   controller.signal.throwIfAborted();
   if(!store.paper(paper.id)||revision(paper)!==baseRevision)throw new ApiError('Paper metadata changed during extraction. Please retry.',409);
   for(const [id,entry] of proposals)if(Date.now()-entry.createdAt>1800000)proposals.delete(id);
   if(proposals.size>=100)proposals.delete(proposals.keys().next().value);
   const id=randomUUID();proposals.set(id,{paperId:paper.id,baseRevision,result,createdAt:Date.now(),pdfRevision:result.evidence.sourcePdfRevision||await pdfRevision(paper,store.directory)});
   response.json({proposalId:id,paperId:paper.id,before:metadataOf(paper),...result});
  }finally{jobs.delete(paper.id);response.off('close',abort);}
 }));
 app.post('/api/papers/:id/metadata/apply',exclusive(async(request,response,paper)=>{
  const body=request.body||{},proposal=proposals.get(body.proposalId);
  if(!proposal||proposal.paperId!==paper.id||Date.now()-proposal.createdAt>1800000)throw new ApiError('Metadata proposal expired or belongs to another paper. Extract it again.',409);
  if(revision(paper)!==proposal.baseRevision||await pdfRevision(paper,store.directory)!==proposal.pdfRevision)throw new ApiError('Paper or metadata changed since this proposal. Extract it again.',409);
  const fields=body.fields;
  if(!Array.isArray(fields)||!fields.length||fields.some(field=>!['authors','institutions','abstract'].includes(field))||new Set(fields).size!==fields.length)throw new ApiError('Choose authors, institutions and/or abstract to apply.');
  if(fields.some(field=>field==='abstract'?!proposal.result.metadata.abstract:!proposal.result.metadata[field]?.length))throw new ApiError('The proposal does not contain a source-supported value for a selected field.');
  const original=snapshot(paper),before=metadataOf(paper),translationsBefore=abstractTranslations(paper),history=paper.metadataHistory||[];
  for(const field of fields)paper[field]=structuredClone(proposal.result.metadata[field]);
  if(fields.includes('abstract')){paper.abstractIsExcerpt=false;for(const value of Object.values(paper.translations||{}))if(value.abstract)value.abstract={...value.abstract,stale:true};}
  paper.metadataExtraction={...proposal.result.evidence,fields,appliedAt:new Date().toISOString()};
  const change={id:randomUUID(),before,abstractTranslationsBefore:translationsBefore,afterAbstractTranslations:fingerprint(abstractTranslations(paper)),afterRevision:revision(paper),createdAt:new Date().toISOString()};paper.metadataHistory=[...history,change].slice(-10);
  try{await store.save();}catch(error){restore(paper,original);throw error;}
  proposals.delete(body.proposalId);response.json({paper:publicPaper(paper),changeId:change.id});
 }));
 app.post('/api/papers/:id/metadata/undo',exclusive(async(request,response,paper)=>{
  const history=paper.metadataHistory||[],last=history.at(-1);
  if(!last||last.id!==request.body?.changeId||last.afterRevision!==revision(paper)||(last.afterAbstractTranslations&&last.afterAbstractTranslations!==fingerprint(abstractTranslations(paper))))throw new ApiError('Metadata has changed; this repair cannot be undone automatically.',409);
  const original=snapshot(paper);Object.assign(paper,last.before);paper.metadataHistory=history.slice(0,-1);
  if(last.abstractTranslationsBefore){for(const value of Object.values(paper.translations||{}))delete value.abstract;for(const [language,value] of Object.entries(last.abstractTranslationsBefore)){paper.translations||={};paper.translations[language]||={};paper.translations[language].abstract=structuredClone(value);}}
  try{await store.save();}catch(error){restore(paper,original);throw error;}
  response.json({paper:publicPaper(paper)});
 }));
}
