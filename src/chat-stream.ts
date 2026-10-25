import { readSse } from '../shared/sse.mjs';
import type { Message } from './types';
export type ChatResult = {message:Message;userMessage?:Message;conversationId?:string};
export type ChatEvent = {type:'round'|'text'|'reasoning'|'tool';round?:number;delta?:string;tool?:string;ok?:boolean};
export async function streamChat(body: unknown, onEvent:(event:ChatEvent)=>void):Promise<ChatResult> {
  const response = await fetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify(body)});
  if (!response.ok) { const data = await response.json().catch(()=>({})); throw new Error(data.error || `Request failed (${response.status})`); }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  for await (const frame of readSse(response.body)) {
    const event = JSON.parse(frame.data);
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'done') return event.result;
    onEvent(event);
  }
  throw new Error('连接中断，回答未完成 / Connection interrupted; answer incomplete.');
}
export function applyChatEvent(message:Message,event:ChatEvent):Message {
  if(event.type==='round')return {...message,content:'',streamStatus:'reading'};
  if(event.type==='text')return {...message,content:message.content+(event.delta||''),streamStatus:'answering'};
  if(event.type==='reasoning') {
    const reasoning=(message.reasoning||[]).map(p=>({...p}));let part=reasoning.find(p=>p.round===event.round);
    if(!part){part={round:event.round||1,text:''};reasoning.push(part);}part.text+=event.delta||'';
    return {...message,reasoning,streamStatus:'thinking'};
  }
  if(event.type==='tool')return {...message,streamStatus:event.ok===false?'tool-error':event.tool};
  return message;
}

/** Failed previews never become history for a retried question. */
export function completedChat(messages:Message[]):Message[] {
  const result:Message[]=[];
  for(const message of messages){
    if(message.streaming || message.streamError){if(result.at(-1)?.role==='user' && !result.at(-1)?.id)result.pop();continue;}
    result.push(message);
  }
  return result;
}
