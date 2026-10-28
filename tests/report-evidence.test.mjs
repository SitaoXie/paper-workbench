import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReportEvidence} from '../server/report-evidence.mjs';
import {generateReport} from '../server/models.mjs';
import {defaultSettings} from '../server/storage.mjs';

const settings={...defaultSettings,apiKey:'fixture-key',baseUrl:'https://model.example/v1',model:'writer',modelCapabilities:{writer:'vision'}};
const paper={id:'source-paper',title:'Visual experiment',authors:['Author'],abstract:'A comparison.',filePath:'papers/source.pdf',pages:[{number:1,text:'FIRST_PAGE_BODY\nFigure 3. Source comparison.'},{number:2,text:'SECOND_PAGE_BODY\nTable 2. Source measurements.'}],figures:[{id:'original-chart',page:1,label:'Figure 3',caption:'Figure 3. Source comparison.',crop:{x:.1,y:.1,width:.8,height:.4}}]};
const pixels=page=>Buffer.from(`original-pixels-${page}`).toString('base64');
const render=(count=2,seen=[])=>async(_paper,_dir,target)=>{seen.push(target);return {pageCount:count,image:{mimeType:'image/jpeg',data:pixels(target.page)}};};
function mock(){const calls=[];return {calls,fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);return new Response(JSON.stringify(body.messages.some(m=>m.content?.some?.(p=>p.type==='image'))?{content:[{type:'text',text:'A grounded interpretation. [p.1]'}]}:{choices:[{message:{content:'A grounded interpretation. [p.1]'}}]}));}};}
const imageParts=content=>content.filter(part=>part.type==='image_url'||part.type==='image');

test('overview analyst, reviewer and editor receive the same labeled source images beside text',async()=>{
 const provider=mock();const seen=[];
 const result=await generateReport(paper,settings,{dataDir:'/fixture',renderImage:render(2,seen),fetchImpl:provider.fetchImpl});
 assert.equal(provider.calls.length,3);assert.equal(seen.length,2);
 for(const call of provider.calls){
  const content=call.messages[1].content;
  assert.equal(imageParts(content).length,2);
  assert.match(content[0].text,/FIRST_PAGE_BODY/);assert.match(content[0].text,/SECOND_PAGE_BODY/);
  const labels=content.slice(1).filter(p=>p.type==='text').map(p=>JSON.parse(p.text));
  assert.deepEqual(labels.map(p=>p.pdfPage),[1,2]);assert.equal(labels[0].originalNumber,'Figure 3');
  assert.equal(labels[0].figureId,'original-chart');assert.equal(labels[0].paperId,paper.id);
  assert.equal(labels[1].kind,'original-full-page');
  assert.deepEqual(imageParts(content),imageParts(provider.calls[0].messages[1].content));
 }
 assert.equal(result.source.visualInput.imageCount,2);assert.equal(result.source.pixelsProvided,true);
 assert.ok(!JSON.stringify(result).includes(pixels(1)));
});

test('screenshot mode uses actual PDF page count including pages absent from extracted text, in order',async()=>{
 const provider=mock(),seen=[];
 const result=await generateReport(paper,settings,{inputMode:'page-images',dataDir:'/fixture',renderImage:render(3,seen),fetchImpl:provider.fetchImpl,adversarial:false});
 assert.deepEqual(seen.map(p=>p.page),[1,2,3]);
 const content=provider.calls[0].messages[1].content;
 assert.deepEqual(content.slice(1).filter(p=>p.type==='text').map(p=>JSON.parse(p.text).pdfPage),[1,2,3]);
 assert.ok(!JSON.stringify(content).includes('FIRST_PAGE_BODY'));
 assert.equal(result.coverage,'full-page-images');assert.deepEqual(result.source.visualInput.pages,[1,2,3]);
});

test('text-only writer uses independent Anthropic visual reader and receives only unverified notes',async()=>{
 const reader={...settings,id:'reader-profile',provider:'anthropic',model:'reader',models:['reader'],modelCapabilities:{reader:'vision'}};
 const configured={...settings,modelCapabilities:{writer:'text'},profiles:[reader],vision:{enabled:true,profileId:reader.id,model:'reader'}};
 const provider=mock();
 const result=await generateReport(paper,configured,{dataDir:'/fixture',renderImage:render(),fetchImpl:provider.fetchImpl,adversarial:false,language:'en',focus:'Compare the error bars'});
 assert.equal(provider.calls.length,2);
 assert.equal(provider.calls[0].model,'reader');assert.equal(imageParts(provider.calls[0].messages[0].content).length,2);
 const request=JSON.parse(provider.calls[0].messages[0].content[0].text);
 assert.equal(request.language,'en');assert.equal(request.readingFocus,'Compare the error bars');
 const writer=provider.calls[1];assert.equal(writer.model,'writer');assert.equal(typeof writer.messages[1].content,'string');
 assert.match(writer.messages[1].content,/unverified_visual_model_notes/);
 assert.equal(result.source.pixelsProvided,false);assert.equal(result.source.visualInput.visionModel,'reader');
 assert.ok(!JSON.stringify(result).includes(pixels(1)));
});

test('no visual model falls back to source text even when screenshot mode is selected',async()=>{
 const provider=mock();
 const result=await generateReport(paper,{...settings,modelCapabilities:{writer:'text'}},{inputMode:'page-images',dataDir:'/fixture',renderImage:()=>{throw new Error('must not render');},fetchImpl:provider.fetchImpl,adversarial:false});
 assert.match(provider.calls[0].messages[1].content,/FIRST_PAGE_BODY/);
 assert.equal(result.source.visualInput.fallbackReason,'no-vision-model');assert.equal(result.source.visualInput.imageCount,0);
});

test('explicit user batch size reads long PDFs in bounded batches without dropping the tail or persisting pixels',async()=>{
 const calls=[],seen=[];const batchSize=12,count=batchSize*2+1;
 const result=await prepareReportEvidence(paper,settings,{inputMode:'page-images',imageBatchSize:batchSize,dataDir:'/fixture',renderImage:render(count,seen),configured:()=>true,call:async(model,messages,stage)=>{calls.push({model,messages,stage});return 'Unverified observation.';}});
 assert.equal(calls.length,3);assert.equal(seen.length,count);assert.equal(result.items.length,0);
 assert.equal(result.metadata.imageCount,count);assert.equal(result.metadata.pixelsProvided,false);
 assert.deepEqual(calls.flatMap(c=>c.messages[1].content.filter(p=>p.type==='text').slice(1).map(p=>JSON.parse(p.text).pdfPage)),Array.from({length:count},(_,i)=>i+1));
 assert.ok(calls.every(c=>imageParts(c.messages[1].content).length<=batchSize));
 assert.match(result.observations,/original PDF pages 25/);assert.ok(!JSON.stringify(result).includes(pixels(1)));
});

test('unavailable page images are disclosed and vision inference failure is not silently downgraded',async()=>{
 const result=await prepareReportEvidence(paper,settings,{dataDir:'/fixture',configured:()=>true,renderImage:async(...args)=>{if(args[2].page===2)throw new Error('raster failure');return render()(...args);}});
 assert.deepEqual(result.metadata.unavailable,[{page:2}]);assert.equal(result.metadata.imageCount,1);
 await assert.rejects(prepareReportEvidence(paper,settings,{inputMode:'page-images',imageBatchSize:12,dataDir:'/fixture',configured:()=>true,renderImage:render(13),call:async()=>{throw new Error('provider unavailable');}}),/provider unavailable/);
 await assert.rejects(generateReport(paper,settings,{inputMode:'invalid'}),/inputMode/);
});

test('default keeps all images together above the former count and byte budgets',async()=>{
 const large='a'.repeat(21*1024*1024);
 const result=await prepareReportEvidence(paper,settings,{inputMode:'page-images',dataDir:'/fixture',configured:()=>true,
  renderImage:async(_p,_d,{page})=>({pageCount:14,image:{mimeType:'image/jpeg',data:page===1?large:pixels(page)}}),
  call:async()=>{assert.fail('Default must not create preliminary visual notes');},
 });
 assert.equal(result.items.length,14);assert.equal(result.metadata.imageBatchSize,0);assert.equal(result.metadata.pixelsProvided,true);
 assert.equal(result.metadata.batches,0);assert.equal(result.observations,'');assert.equal(result.items[0].image.data,large);
 assert.deepEqual(result.items.map(item=>item.page),Array.from({length:14},(_,i)=>i+1));
});

test('default screenshot report sends 14 page images to every writer role, and rejects invalid batch settings before work',async()=>{
 const provider=mock();
 const result=await generateReport(paper,settings,{inputMode:'page-images',dataDir:'/fixture',renderImage:render(14),fetchImpl:provider.fetchImpl});
 assert.equal(provider.calls.length,3);
 assert.ok(provider.calls.every(call=>imageParts(call.messages[1].content).length===14));
 assert.equal(result.source.visualInput.batches,0);assert.equal(result.source.pixelsProvided,true);
 for(const imageBatchSize of [-1,1.5,'12',null,Infinity,Number.MAX_SAFE_INTEGER+1])
  await assert.rejects(generateReport(paper,settings,{imageBatchSize}),/imageBatchSize/);
});

test('provider rejection is returned without silently splitting a default full-image request',async()=>{
 let calls=0;
 await assert.rejects(generateReport(paper,settings,{inputMode:'page-images',dataDir:'/fixture',renderImage:render(14),fetchImpl:async(_url,options)=>{
  calls++;assert.equal(imageParts(JSON.parse(options.body).messages[1].content).length,14);
  return new Response(JSON.stringify({error:{message:'Too many images'}}),{status:400});
 }}));
 assert.equal(calls,1);
});
