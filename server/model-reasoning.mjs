import {ApiError} from './network.mjs';
import {EFFORT_LEVELS,REASONING_PROTOCOLS} from '../shared/model-reasoning.mjs';
export function validateModelReasoning(input,models,current={},provider='openai'){
 if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)))throw new ApiError('modelReasoning must map model IDs to reasoning controls.');
 if(input&&Object.keys(input).some(model=>!models.includes(model)&&!Object.hasOwn(current,model)))throw new ApiError('Reasoning controls must reference configured models.');
 const result={};
 for(const model of models){
  const config=input!==undefined?input[model]:current[model];
  if(config===undefined||config===null)continue;
  if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(key=>!['protocol','levels','value'].includes(key))||!REASONING_PROTOCOLS.includes(config.protocol))throw new ApiError('Invalid reasoning protocol.');
  if(config.protocol==='anthropic-effort'&&provider!=='anthropic')throw new ApiError('Anthropic effort requires an Anthropic connection.');
  if(config.protocol.endsWith('-toggle')&&provider!=='openai')throw new ApiError('Thinking toggles require an OpenAI-compatible connection.');
  if(config.protocol==='openai-effort'&&provider!=='openai')throw new ApiError('OpenAI effort requires an OpenAI-compatible connection.');
  const toggle=config.protocol.endsWith('-toggle');
  const levels=toggle?['off','on']:config.levels;
  if(!Array.isArray(levels)||!levels.length||levels.length>EFFORT_LEVELS.length||new Set(levels).size!==levels.length||(!toggle&&levels.some(level=>!EFFORT_LEVELS.includes(level))))throw new ApiError('Declare supported reasoning levels for this model.');
  const value=config.value??'default';
  if(value!=='default'&&!levels.includes(value))throw new ApiError('Choose a supported reasoning level.');
  result[model]={protocol:config.protocol,levels:[...levels],value};
 }
 return result;
}
