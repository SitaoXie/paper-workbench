import {BUILTIN_ASSISTANT_STYLES,DEFAULT_ASSISTANT_PREFERENCES} from '../shared/assistant-prompts.mjs';
import {ApiError} from './network.mjs';
export function validateAssistantPreferences(input, current=DEFAULT_ASSISTANT_PREFERENCES) {
  if(input===undefined)return structuredClone(current);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['styleId','pdfMode','customStyles'].includes(k)))throw new ApiError('Invalid assistant preferences.');
  const result={...current,...input};
  if(!['text','images'].includes(result.pdfMode))throw new ApiError('PDF mode must be text or images.');
  if(!Array.isArray(result.customStyles)||result.customStyles.length>30)throw new ApiError('At most 30 custom styles are supported.');
  const ids=new Set(BUILTIN_ASSISTANT_STYLES.map(s=>s.id));
  result.customStyles=result.customStyles.map(s=>{
    if(!s||Object.keys(s).some(k=>!['id','name','prompt'].includes(k))||typeof s.id!=='string'||!/^custom-[a-zA-Z0-9_-]{1,80}$/.test(s.id)||ids.has(s.id))throw new ApiError('Custom styles need unique custom-prefixed IDs; built-in styles are read-only.');
    if(typeof s.name!=='string'||!s.name.trim()||s.name.length>80||typeof s.prompt!=='string'||!s.prompt.trim()||s.prompt.length>12000)throw new ApiError('A style needs a name (1–80 characters) and prompt (1–12,000 characters).');
    ids.add(s.id);return {id:s.id,name:s.name.trim(),prompt:s.prompt.trim()};
  });
  if(!ids.has(result.styleId))throw new ApiError('Choose an existing assistant style.');
  return result;
}
