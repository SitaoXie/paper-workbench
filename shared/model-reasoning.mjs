export const EFFORT_LEVELS = Object.freeze(['none','minimal','low','medium','high','xhigh','max']);
export const REASONING_PROTOCOLS = Object.freeze(['openai-effort','anthropic-effort','thinking-toggle','template-toggle']);
// Endpoint-scoped, documented capabilities. Never apply these to an arbitrary
// compatible gateway solely because its model has the same name.
export function documentedReasoning(profile){
 let endpoint;try{endpoint=new URL(profile.baseUrl);}catch{return null;}
 if(profile.provider!=='openai'||endpoint.protocol!=='https:'||endpoint.hostname!=='ark.cn-beijing.volces.com'||endpoint.pathname.replace(/\/$/,'')!=='/api/v3')return null;
 const levels={
  'deepseek-v4-1-flash-261017':['none','low','high','max'],
  'deepseek-v4-1-flash-economy-261017':['none','low','high','max'],
  'deepseek-v4-1-flash-260910':['none','low','high','max'],
  'glm-5-3-flash-260828':['low','high','max'],
  'kimi-k3-1-pro-261024':['low','high','max'],
  'doubao-seed-2-1-pro-260915':['minimal','low','medium','high'],
  'doubao-seed-2-1-lite-260915':['minimal','low','medium','high'],
  'doubao-seed-2-0-lite-260428':['minimal','low','medium','high'],
 }[profile.model];
 return levels?{protocol:'openai-effort',levels,value:'default',offValues:profile.model.startsWith('doubao-')?['minimal']:[],sourceUrl:'https://docs.volcengine.com/docs/ark/deep-thinking?lang=zh'}:null;
}
export function reasoningControl(profile){
 const manual=profile.modelReasoning?.[profile.model];
 const documented=documentedReasoning(profile);
 const configured=manual||documented;
 if(configured){
  const toggle=configured.protocol.endsWith('-toggle');
  const matchesDocs=documented&&configured.protocol===documented.protocol&&JSON.stringify(configured.levels)===JSON.stringify(documented.levels);
  return {source:matchesDocs?'documented':'configured',sourceUrl:matchesDocs?documented.sourceUrl:undefined,offValues:matchesDocs?documented.offValues:[],kind:toggle?'toggle':'effort',protocol:configured.protocol,levels:toggle?['default','off','on']:['default',...configured.levels],value:configured.value||'default'};
 }
 // Use only variants explicitly saved in this connection. Do not infer native
 // API support from a model's brand or invent a model identifier.
 const base=profile.model.replace(/-(none|minimal|low|medium|high|xhigh|max)$/,'');
 const variants=EFFORT_LEVELS.map(level=>({level,model:`${base}-${level}`})).filter(item=>profile.models?.includes(item.model));
 if(!variants.length || ![base,...variants.map(item=>item.model)].includes(profile.model))return null;
 const options=[...(profile.models?.includes(base)?[{level:'default',model:base}]:[]),...variants];
 if(options.length<2)return null;
 return {source:'variants',kind:'variants',levels:options.map(item=>item.level),value:options.find(item=>item.model===profile.model)?.level||options[0].level,models:Object.fromEntries(options.map(item=>[item.level,item.model]))};
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
