import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDFDocument,rgb,degrees} from 'pdf-lib';
import {loadImage,createCanvas} from '@napi-rs/canvas';
import {renderPdfImage} from '../server/pdf-images.mjs';
import {answerQuestion,validateSettings} from '../server/models.mjs';
import {defaultSettings,normalizeProfiles} from '../server/storage.mjs';
import {createQuestionToolbox} from '../server/question-agent.mjs';
import {validateAssistantPreferences} from '../server/assistant-preferences.mjs';
const paper={id:'p',title:'Sample',authors:[],filePath:'paper.pdf',pageCount:2,pages:[{number:1,text:'TEXT_PAGE_ONE'},{number:2,text:'TEXT_PAGE_TWO'}],figures:[{id:'fig1',page:1,caption:'Red panel',crop:{x:0,y:0,width:.5,height:1}}]};
const settings={...defaultSettings,model:'test',apiKey:'test-key',modelCapabilities:{test:'vision'}};
const fixtureImage={width:200,height:300,image:{mimeType:'image/jpeg',data:Buffer.from('IMAGE_SENTINEL'.repeat(10000)).toString('base64')}};
const reply=(provider,calls,text='')=>new Response(JSON.stringify(provider==='anthropic'?{content:calls.length?calls.map(c=>({type:'tool_use',id:c.id,name:c.name,input:c.args})):[{type:'text',text}],stop_reason:calls.length?'tool_use':'end_turn'}:{choices:[{message:{role:'assistant',content:text||null,...(calls.length?{tool_calls:calls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{})},finish_reason:calls.length?'tool_calls':'stop'}]}));

test('real PDF renderer preserves full-page and cropped pixels, rotation, page bounds and cancellation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'pdf-image-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const doc=await PDFDocument.create();const p=doc.addPage([200,100]);p.drawRectangle({x:0,y:0,width:100,height:100,color:rgb(1,0,0)});p.drawRectangle({x:100,y:0,width:100,height:100,color:rgb(0,0,1)});doc.addPage([200,100]).setRotation(degrees(90));await writeFile(join(dir,'paper.pdf'),await doc.save());
 const full=await renderPdfImage(paper,dir,{page:1});assert.equal(full.width/full.height,2);
 const crop=await renderPdfImage(paper,dir,{page:1,crop:paper.figures[0].crop});assert.equal(crop.width,crop.height);
 const img=await loadImage(Buffer.from(crop.image.data,'base64')),c=createCanvas(img.width,img.height),ctx=c.getContext('2d');ctx.drawImage(img,0,0);const pixel=ctx.getImageData(100,100,1,1).data;assert.ok(pixel[0]>230&&pixel[2]<20);
 const rotated=await renderPdfImage(paper,dir,{page:2});assert.equal(rotated.width/rotated.height,.5);
 await assert.rejects(renderPdfImage(paper,dir,{page:3}),/rendering failed/);
 await assert.rejects(renderPdfImage({...paper,filePath:'../outside.pdf'},dir,{page:1}),/unavailable|outside/);
 await assert.rejects(renderPdfImage(paper,dir,{page:1,signal:AbortSignal.abort()}),/cancelled/);
 await assert.rejects(renderPdfImage(paper,dir,{page:1,crop:{x:.9,y:0,width:.5,height:1}}),/Region/);
});

for(const provider of ['openai','anthropic'])test(`${provider}: image tools return pixels to subsequent agent rounds, including region and page attribution`,async()=>{
 let count=0,renders=0;const events=[];
 const result=await answerQuestion([paper],'Inspect the chart',[],{...settings,provider},{renderImage:async()=>{renders++;return fixtureImage;},onEvent:e=>events.push(e),fetchImpl:async(_url,opts)=>{
   const body=JSON.parse(opts.body);count++;
   if(count===1){assert.match(JSON.stringify(body.tools),/view_pdf_page/);return reply(provider,[{id:'a',name:'view_pdf_page',args:{paperId:'p',page:1}},{id:'b',name:'view_figure',args:{paperId:'p',figureId:'fig1'}}]);}
   assert.match(JSON.stringify(body.messages),new RegExp(fixtureImage.image.data.slice(0,60)));
   if(count===2){
     if(provider==='anthropic'){const blocks=body.messages.at(-1).content;assert.deepEqual(blocks.map(b=>b.tool_use_id),['a','b']);assert.equal(blocks[0].content[1].type,'image');}
     else{assert.deepEqual(body.messages.slice(-3,-1).map(m=>m.tool_call_id),['a','b']);assert.equal(body.messages.at(-1).content[1].type,'image_url');}
     return reply(provider,[{id:'c',name:'view_pdf_region',args:{paperId:'p',page:1,crop:{x:0,y:0,width:.5,height:1}}}]);
   }
   return reply(provider,[],'The panel is red. [p.1]');
 }});
 assert.equal(count,3);assert.equal(renders,3);assert.equal(result.source.toolImageCount,3);assert.equal(result.source.pixelsProvided,true);assert.equal(result.source.questionAgent.steps[1].references[0].figureId,'fig1');assert.ok(result.source.questionAgent.toolCharacters<5000);assert.ok(!JSON.stringify(result).includes(fixtureImage.image.data));assert.ok(events.some(e=>e.type==='tool'&&e.tool==='view_figure'));
});

test('visual tool guards reject unsupported models, wrong scope, unknown figures and invalid crops',async()=>{
 const text=createQuestionToolbox({papers:[paper]});await assert.rejects(text('view_pdf_page',{paperId:'p',page:1}),/vision/);
 const visual=createQuestionToolbox({papers:[paper],vision:true,renderImage:async()=>fixtureImage});
 for(const [name,args] of [['view_pdf_page',{paperId:'other',page:1}],['view_pdf_page',{paperId:'p',page:0}],['view_figure',{paperId:'p',figureId:'missing'}],['view_pdf_region',{paperId:'p',page:1,crop:{x:0,y:0,width:2,height:1}}]])await assert.rejects(visual(name,args));
 assert.equal((await visual('list_figures',{paperId:'p'})).figures[0].id,'fig1');
});

for(const provider of ['openai','anthropic'])test(`${provider}: image input sends ordered full pages in a stable prefix and selected style`,async()=>{
 const requests=[];const answer=await answerQuestion([paper],'Explain',[],{...settings,provider,assistant:{styleId:'concise',pdfMode:'images',customStyles:[]}},{renderImage:async(_p,_d,{page})=>{requests.push(page);return fixtureImage;},fetchImpl:async(_u,o)=>{
   const body=JSON.parse(o.body),serialized=JSON.stringify(body);assert.ok(!serialized.includes('TEXT_PAGE_ONE'));assert.match(serialized,/Answer style: concise/);const imageMessage=body.messages.find(m=>Array.isArray(m.content));assert.equal(imageMessage.content.length,4);assert.match(imageMessage.content[0].text,/page 1/);assert.match(imageMessage.content[2].text,/page 2/);return reply(provider,[],'Answer');
 }});assert.deepEqual(requests,[1,2]);assert.equal(answer.source.initialPageImageCount,2);assert.equal(answer.source.pixelsProvided,true);assert.equal(answer.source.questionAgent.initialSources[0].coverage,'full-page-images');
});

test('long image-mode PDFs use brief metadata; text mode preserves full text and hides vision tools',async()=>{
 await answerQuestion([{...paper,pageCount:16}],'Explain',[],{...settings,assistant:{styleId:'detailed',pdfMode:'images',customStyles:[]}},{renderImage:()=>{throw Error('Should be on demand');},fetchImpl:async(_u,o)=>{const body=JSON.parse(o.body);assert.ok(!JSON.stringify(body).includes('TEXT_PAGE_ONE'));assert.match(JSON.stringify(body),/Answer style: detailed/);return reply('openai',[],'Needs page inspection');}});
 await answerQuestion([paper],'Explain',[],{...settings,modelCapabilities:{test:'text'}},{fetchImpl:async(_u,o)=>{const body=JSON.parse(o.body);assert.match(JSON.stringify(body),/TEXT_PAGE_ONE/);assert.ok(!body.tools.some(t=>t.function.name==='view_pdf_page'));return reply('openai',[],'Text answer');}});
 await assert.rejects(answerQuestion([paper],'Explain',[],{...settings,modelCapabilities:{test:'text'},assistant:{styleId:'balanced',pdfMode:'images',customStyles:[]}}),/vision-capable/);
});

test('custom styles persist across model changes; built-ins cannot be overwritten',()=>{
 const assistant={styleId:'custom-mine',pdfMode:'images',customStyles:[{id:'custom-mine',name:'My style',prompt:'Focus on examples.'}]};
 const updated=validateSettings({assistant},normalizeProfiles(settings));assert.deepEqual(updated.assistant,assistant);assert.deepEqual(validateSettings({model:'test'},updated).assistant,assistant);
 for(const patch of [{customStyles:[{id:'balanced',name:'Override',prompt:'X'}]},{styleId:'missing'},{pdfMode:'unknown'},{customStyles:[{id:'custom-a',name:'A',prompt:''}]}])assert.throws(()=>validateAssistantPreferences(patch));
});

test('visual loop caches repeated renders, stops at six image results and continues after tool errors',async()=>{
 let count=0,renders=0;
 const answer=await answerQuestion([paper],'Inspect',[],settings,{renderImage:async()=>{renders++;return fixtureImage;},fetchImpl:async(_u,o)=>{
   count++;const body=JSON.parse(o.body);
   if(count===1)return reply('openai',Array.from({length:7},(_,i)=>({id:`i${i}`,name:'view_pdf_page',args:{paperId:'p',page:1}})));
   assert.match(JSON.stringify(body.messages),/Image budget reached/);
   return reply('openai',[],'Supported conclusion');
 }});
 assert.equal(renders,1);assert.equal(answer.source.toolImageCount,6);assert.equal(answer.source.questionAgent.steps[6].ok,false);assert.equal(answer.source.questionAgent.steps[1].cached,true);
 let round=0;
 const failed=await answerQuestion([paper],'Inspect',[],settings,{renderImage:async()=>{throw Error('private-path-must-not-leak');},fetchImpl:async(_u,o)=>{
   if(++round===1)return reply('openai',[{id:'bad',name:'view_pdf_page',args:{paperId:'p',page:1}}]);
   assert.match(JSON.stringify(JSON.parse(o.body).messages),/No source evidence/);return reply('openai',[],'Image unavailable');
 }});
 assert.equal(failed.source.pixelsProvided,false);assert.ok(!JSON.stringify(failed).includes('private-path'));assert.equal(round,2);
});

test('HTTP preferences persist, invalid built-in edits are atomic, image-mode text-model rejection precedes chat mutation',async t=>{
 const {createApp}=await import('../server/index.mjs');const {Store}=await import('../server/storage.mjs');
 const dir=await mkdtemp(join(tmpdir(),'assistant-prefs-'));const app=await createApp({dataDir:dir});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const send=(path,body,method='PUT')=>fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const preferences={styleId:'custom-tutor',pdfMode:'images',customStyles:[{id:'custom-tutor',name:'Tutor',prompt:'Teach with examples.'}]};
 const response=await send('settings',{assistant:preferences});assert.equal(response.status,200);assert.deepEqual((await response.json()).assistant,preferences);
 const reopened=await new Store(dir).init();assert.deepEqual(reopened.data.settings.assistant,preferences);
 const before=JSON.stringify(app.locals.store.data);assert.equal((await send('settings',{assistant:{customStyles:[{id:'balanced',name:'Override',prompt:'X'}]}})).status,400);assert.equal(JSON.stringify(app.locals.store.data),before);
 Object.assign(app.locals.store.data.settings,{...settings,modelCapabilities:{test:'text'}});const beforeChat=JSON.stringify(app.locals.store.data);
 assert.equal((await send('chat',{message:'Question',processing:'api'},'POST')).status,409);assert.equal(JSON.stringify(app.locals.store.data),beforeChat);
});

test('historical PDF visual interpretations do not imply pixels are still visible',async()=>{
 const {prepareConversationHistory}=await import('../server/conversation-context.mjs');
 const result=prepareConversationHistory([{role:'user',content:'See page one'},{role:'assistant',content:'A red panel',source:{visualEvidenceIds:[],toolImageCount:1}}]);
 assert.match(result.messages[1].content,/not automatically replayed/);
});
