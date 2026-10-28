export type ReasoningProtocol='openai-effort'|'anthropic-effort'|'thinking-toggle'|'template-toggle';
export type ModelReasoning={protocol:ReasoningProtocol;levels:string[];value:string};
export type ReasoningControl={kind:'toggle'|'effort'|'variants';protocol?:ReasoningProtocol;levels:string[];value:string;models?:Record<string,string>};
export const EFFORT_LEVELS:readonly string[];
export const REASONING_PROTOCOLS:readonly ReasoningProtocol[];
export function reasoningControl(profile:{model:string;models?:string[];modelReasoning?:Record<string,ModelReasoning>}):ReasoningControl|null;
export function reasoningBody(settings:{model:string;modelReasoning?:Record<string,ModelReasoning>;extraBody?:Record<string,unknown>}):Record<string,unknown>;
