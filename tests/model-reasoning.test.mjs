import test from 'node:test';
import assert from 'node:assert/strict';
import {reasoningControl,reasoningBody} from '../shared/model-reasoning.mjs';
import {validateSettings,callModel} from '../server/models.mjs';
import {defaultSettings} from '../server/storage.mjs';
const profile={...defaultSettings,id:'one',name:'Fixture',apiKey:'fixture',baseUrl:'https://example.com/v1',models:['model','model-low','model-high'],model:'model'};
test('reasoning sliders only use actually configured variants in the selected connection',()=>{
 const control=reasoningControl(profile);assert.equal(control.kind,'variants');assert.deepEqual(control.levels,['default','low','high']);assert.equal(control.models.high,'model-high');
 assert.equal(reasoningControl({...profile,model:'model-tiered'}),null);
 assert.equal(reasoningControl({...profile,models:['model']}),null);
 assert.equal(reasoningControl({...profile,model:'model-high'}).value,'high');
});
test('declared native controls validate per provider and model, persist and can be cleared',()=>{
 let settings=validateSettings({profiles:[profile],activeProfileId:'one'},defaultSettings);
 settings=validateSettings({modelReasoning:{model:{protocol:'openai-effort',levels:['low','high'],value:'high'}}},settings);
 assert.equal(settings.profiles[0].modelReasoning.model.value,'high');
 assert.equal(reasoningControl(settings).kind,'effort');
 for(const patch of [
  {model:{protocol:'openai-effort',levels:['unsupported'],value:'default'}},
  {model:{protocol:'openai-effort',levels:['low'],value:'high'}},
  {missing:{protocol:'openai-effort',levels:['low'],value:'low'}},
  {model:{protocol:'anthropic-effort',levels:['low'],value:'low'}},
 ])assert.throws(()=>validateSettings({modelReasoning:patch},settings));
 const removed=validateSettings({profiles:[{...settings.profiles[0],model:'model-low',models:['model-low','model-high']}]},settings);
 assert.equal(removed.disabledModels.find(item=>item.model==='model').reasoning.value,'high');
 const restored=validateSettings({restoreModel:{profileId:'one',model:'model'}},removed);
 assert.equal(restored.modelReasoning.model.value,'high');
 assert.deepEqual(validateSettings({modelReasoning:{}},settings).modelReasoning,{});
});
test('native request body keeps unrelated options, respects default and only applies selected model controls',()=>{
 const extraBody={temperature:.3,reasoning_effort:'low'};
 assert.deepEqual(reasoningBody({...profile,extraBody}),extraBody);
 const modelReasoning={model:{protocol:'openai-effort',levels:['low','high'],value:'high'}};
 assert.equal(reasoningBody({...profile,extraBody,modelReasoning}).reasoning_effort,'high');
 assert.equal(extraBody.reasoning_effort,'low');
 assert.equal(reasoningBody({...profile,model:'model-low',extraBody,modelReasoning}).reasoning_effort,'low');
 assert.deepEqual(reasoningBody({...profile,extraBody,modelReasoning:{model:{...modelReasoning.model,value:'default'}}}),extraBody);
 assert.deepEqual(reasoningBody({...profile,extraBody:{chat_template_kwargs:{other:1}},modelReasoning:{model:{protocol:'template-toggle',value:'on'}}}),{chat_template_kwargs:{other:1,thinking:true}});
 assert.deepEqual(reasoningBody({...profile,extraBody:{thinking:{type:'enabled',budget_tokens:2000}},modelReasoning:{model:{protocol:'thinking-toggle',value:'off'}}}),{thinking:{type:'disabled'}});
});
for(const provider of ['openai','anthropic'])test(`native ${provider} reasoning parameters reach model transport`,async()=>{
 const settings={...profile,provider,modelReasoning:{model:{protocol:provider==='openai'?'openai-effort':'anthropic-effort',levels:['low','high'],value:'high'}}};
 let sent;
 const result=await callModel(settings,[{role:'user',content:'Hello'}],{fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify(provider==='anthropic'?{content:[{type:'text',text:'Hello'}]}:{choices:[{message:{content:'Hello'}}]}));}});
 assert.equal(result,'Hello');assert.equal(sent.model,'model');
 if(provider==='openai')assert.equal(sent.reasoning_effort,'high');else {assert.equal(sent.output_config.effort,'high');assert.equal(sent.thinking.type,'adaptive');assert.equal(sent.reasoning_effort,undefined);}
});
