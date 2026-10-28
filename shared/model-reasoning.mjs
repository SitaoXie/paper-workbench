export const EFFORT_LEVELS = Object.freeze(['minimal','low','medium','high','xhigh','max']);
export const REASONING_PROTOCOLS = Object.freeze(['openai-effort','anthropic-effort','thinking-toggle','template-toggle']);
export function reasoningControl(profile){
 const configured=profile.modelReasoning?.[profile.model];
 if(configured){
  const toggle=configured.protocol.endsWith('-toggle');
  return {kind:toggle?'toggle':'effort',protocol:configured.protocol,levels:toggle?['default','off','on']:['default',...configured.levels],value:configured.value||'default'};
 }
 // Use only variants explicitly saved in this connection. Do not infer native
 // API support from a model's brand or invent a model identifier.
 const base=profile.model.replace(/-(minimal|low|medium|high|xhigh|max)$/,'');
 const variants=EFFORT_LEVELS.map(level=>({level,model:`${base}-${level}`})).filter(item=>profile.models?.includes(item.model));
 if(!variants.length || ![base,...variants.map(item=>item.model)].includes(profile.model))return null;
 const options=[...(profile.models?.includes(base)?[{level:'default',model:base}]:[]),...variants];
 if(options.length<2)return null;
 return {kind:'variants',levels:options.map(item=>item.level),value:options.find(item=>item.model===profile.model)?.level||options[0].level,models:Object.fromEntries(options.map(item=>[item.level,item.model]))};
}

export function reasoningBody(settings){
 const config=settings.modelReasoning?.[settings.model];
 const value=config?.value;
 if(!config||!value||value==='default')return settings.extraBody||{};
 const body={...settings.extraBody};
 // Explicit per-model controls own these fields; unrelated provider options stay.
 delete body.reasoning_effort;
 if(config.protocol==='openai-effort'){
  if(body.output_config){const {effort,...rest}=body.output_config;body.output_config=rest;}
  return {...body,reasoning_effort:value};
 }
 if(config.protocol==='anthropic-effort')return {...body,thinking:{type:'adaptive'},output_config:{...body.output_config,effort:value}};
 if(config.protocol==='thinking-toggle')return {...body,thinking:value==='on'?{...body.thinking,type:'enabled'}:{type:'disabled'}};
 if(config.protocol==='template-toggle')return {...body,chat_template_kwargs:{...body.chat_template_kwargs,thinking:value==='on'}};
 return body;
}
