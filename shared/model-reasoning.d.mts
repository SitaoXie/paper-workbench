export type ReasoningProtocol='openai-effort'|'anthropic-effort'|'thinking-toggle'|'template-toggle';
export type ModelReasoning={protocol:ReasoningProtocol;levels:string[];value:string};
export type ReasoningControl={source?:'configured'|'documented'|'variants';sourceUrl?:string;offValues?:string[];kind:'toggle'|'effort'|'variants';protocol?:ReasoningProtocol;levels:string[];value:string;models?:Record<string,string>};
export const EFFORT_LEVELS:readonly string[];
export const REASONING_PROTOCOLS:readonly ReasoningProtocol[];
export function reasoningControl(profile:{provider?:string;baseUrl?:string;model:string;models?:string[];modelReasoning?:Record<string,ModelReasoning>}):ReasoningControl|null;
export function reasoningBody(settings:{model:string;modelReasoning?:Record<string,ModelReasoning>;extraBody?:Record<string,unknown>}):Record<string,unknown>;

export function documentedReasoning(profile:{provider?:string;baseUrl?:string;model:string}):(ModelReasoning & {sourceUrl:string;offValues:string[]})|null;
