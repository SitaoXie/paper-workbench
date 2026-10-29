import {withEmptyCitationPhase} from './helpers/citation-phase.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {questionPageContext} from '../server/question-pages.mjs';
import {answerQuestion as answerQuestionWithCitations} from '../server/models.mjs';
import {createQuestionToolbox} from '../server/question-agent.mjs';
import {defaultSettings} from '../server/storage.mjs';
const paper=count=>({id:'whole-pages',title:'Whole source pages',authors:[],abstract:'Brief source description.',pages:Array.from({length:count},(_,i)=>({number:i+1,text:`START_${i+1} `+'Original source. '.repeat(550)+` END_${i+1}`}))});
const reply=()=>new Response(JSON.stringify({choices:[{message:{content:'A source-grounded answer. [p.1]'},finish_reason:'stop'}]}));
test('15-page threshold supplies every complete page in ascending order, never per-page fragments',()=>{
 for(const count of [1,14,15]){const p=paper(count);p.pages.reverse();const context=questionPageContext(p);assert.equal(context.coverage,'full-text-extracted');assert.deepEqual(context.initialPages,Array.from({length:count},(_,i)=>i+1));let last=-1;for(let n=1;n<=count;n++){const position=context.text.indexOf(`START_${n}`);assert.ok(position>last);last=position;assert.ok(context.text.includes(`END_${n}`));}assert.ok(!context.text.includes('Page/source excerpt truncated'));}
 const brief=questionPageContext(paper(16));assert.equal(brief.coverage,'brief-page-index');assert.deepEqual(brief.initialPages,[]);assert.ok(!brief.text.includes('START_'));assert.match(brief.text,/read_pages/);
});
test('single-paper prefix is identical across questions, history and source selections even with a small old character budget',async()=>{
 const p=paper(14),bodies=[];const settings={...defaultSettings,apiKey:'synthetic',contextChars:8000};
 for(const [question,history,metadata] of [['What is the method?',[],undefined],['What are the limitations?',[{role:'user',content:'Earlier question'}],{page:5,quote:'Different selection'}]]){
  const result=await answerQuestion([p],question,history,settings,{metadata,fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return reply();}});
  assert.ok(result.source.inputContext.sourceCharacters>8000);assert.equal(result.source.questionAgent.initialSources[0].initialPages.length,14);
 }
 assert.equal(bodies[0].messages[0].content,bodies[1].messages[0].content);assert.ok(bodies[0].messages[0].content.includes('END_14'));
 assert.ok(!bodies[1].messages[0].content.includes('Different selection'));assert.match(bodies[1].messages.at(-1).content,/Different selection/);
});
test('on-demand reads return whole dense pages in source order or an explicit error; never 6000-character slices',async()=>{
 const p=paper(16),execute=createQuestionToolbox({papers:[p]});const result=await execute('read_pages',{paperId:p.id,pages:[9,2]});assert.deepEqual(result.pages.map(p=>p.page),[2,9]);
 for(const row of result.pages){assert.equal(row.text,p.pages[row.page-1].text);assert.equal(row.complete,true);assert.equal(row.start,0);assert.equal(row.nextOffset,null);}
 await assert.rejects(execute('read_pages',{paperId:p.id,pages:[2]},1000),/No page was truncated/);
 await assert.rejects(execute('read_pages',{paperId:p.id,pages:[2],offset:20}));
});
test('missing/extraction-limited sources are never mislabeled as complete original papers',()=>{
 const p=paper(3);p.pages.splice(1,1);const partial=questionPageContext(p);assert.equal(partial.coverage,'partial-extracted-pages');assert.match(partial.text,/Missing extracted pages: 2/);
 const incomplete=questionPageContext({...paper(1),extractionTruncated:true});assert.equal(incomplete.coverage,'partial-extracted-pages');assert.match(incomplete.text,/Extraction is incomplete/);
});

function answerQuestion(paper,settingsOrQuestion,optionsOrHistory,maybeSettings,maybeOptions){
 const options=maybeOptions||{};return answerQuestionWithCitations(paper,settingsOrQuestion,optionsOrHistory,maybeSettings,{...options,fetchImpl:withEmptyCitationPhase(options.fetchImpl)});
}
