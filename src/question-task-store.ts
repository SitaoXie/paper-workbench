/** Tab-local subscription handoffs. No provider configuration or credentials. */
export type QuestionTaskMetadata = {quote?:string;page?:number;pages?:number[];sourceScope?:string;readingId?:string};
export type PreparedQuestionTask = {
  stylePrompt?: string;
  agentTaskId:string;task:string;question:string;boundQuestion:string;paperId:string;conversationId:string;language:string;
  metadata?:QuestionTaskMetadata|null;draftRevision:number;createdAt:number;updatedAt:number;
  status:'pending'|'completed';answerId?:string;copied:boolean;clipboardError?:boolean;
};
export type QuestionTaskMessages = {id?:string;role:'user'|'assistant';content:string;paperId?:string|null;conversationId?:string;agentTaskId?:string;mode?:string;source?:{agent?:string};metadata?:QuestionTaskMetadata}[];
export type QuestionTaskState = {tasks:Record<string,PreparedQuestionTask>;storageFailed:boolean};
export const questionTaskStorageKey='pw-question-tasks-v1';
const maxEntries=30,maxCharacters=500_000;
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=max;
export const questionTaskKey=(paperId:string,conversationId:string)=>JSON.stringify([paperId,conversationId]);
function metadataValid(value:unknown):value is QuestionTaskMetadata|null|undefined{
  if(value===undefined||value===null)return true;
  if(typeof value!=='object'||Array.isArray(value))return false;
  const m=value as QuestionTaskMetadata;
  return Object.keys(m).every(key=>['quote','page','pages','sourceScope','readingId'].includes(key))&&
    (m.quote===undefined||text(m.quote,12000))&&(m.page===undefined||(finite(m.page)&&m.page>0))&&
    (m.pages===undefined||(Array.isArray(m.pages)&&m.pages.length>0&&m.pages.length<=20&&m.pages.every((p,i)=>finite(p)&&p>0&&(!i||p>m.pages![i-1]))&&m.pages[0]===m.page))&&
    (m.sourceScope===undefined||['pdf','source-text','reading','abstract'].includes(m.sourceScope))&&
    (m.readingId===undefined||(id(m.readingId)&&m.sourceScope==='reading'));
}
function valid(value:unknown):value is PreparedQuestionTask{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const t=value as PreparedQuestionTask;
  return uuid(t.agentTaskId)&&id(t.paperId)&&id(t.conversationId)&&text(t.task,40_000)&&text(t.question,12000)&&text(t.boundQuestion,12000)&&
    typeof t.language==='string'&&/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(t.language)&&metadataValid(t.metadata)&&
    finite(t.draftRevision)&&finite(t.createdAt)&&finite(t.updatedAt)&&['pending','completed'].includes(t.status)&&
    (t.status!=='completed'||id(t.answerId))&&(t.answerId===undefined||id(t.answerId))&&typeof t.copied==='boolean'&&
    (t.stylePrompt===undefined||text(t.stylePrompt,12000))&&
    (t.clipboardError===undefined||typeof t.clipboardError==='boolean');
}
function bounded(input:unknown):Record<string,PreparedQuestionTask>{
  const tasks:Record<string,PreparedQuestionTask>=Object.create(null);
  if(!input||typeof input!=='object'||Array.isArray(input))return tasks;
  let size=2,count=0;
  for(const [key,value] of Object.entries(input).filter((entry):entry is [string,PreparedQuestionTask]=>valid(entry[1])).sort((a,b)=>b[1].updatedAt-a[1].updatedAt)){
    if(key!==questionTaskKey(value.paperId,value.conversationId)||count>=maxEntries)continue;
    // Copy only the declared fields; arbitrary stored properties cannot inflate
    // or carry configuration into the next serialization.
    const task:PreparedQuestionTask={agentTaskId:value.agentTaskId,task:value.task,question:value.question,boundQuestion:value.boundQuestion,paperId:value.paperId,conversationId:value.conversationId,language:value.language,draftRevision:value.draftRevision,createdAt:value.createdAt,updatedAt:value.updatedAt,status:value.status,copied:value.copied,
      ...(value.stylePrompt?{stylePrompt:value.stylePrompt}:{}),...(value.metadata!==undefined?{metadata:value.metadata}:{}),...(value.answerId?{answerId:value.answerId}:{}),...(value.clipboardError?{clipboardError:true}:{})};
    const bytes=JSON.stringify(key).length+JSON.stringify(task).length+2;if(size+bytes>maxCharacters)continue;
    tasks[key]=task;size+=bytes;count++;
  }
  return tasks;
}
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
export function loadQuestionTasks(storage?:StorageLike):QuestionTaskState{
  try{
    const raw=(storage||sessionStorage).getItem(questionTaskStorageKey);
    if(!raw)return {tasks:Object.create(null),storageFailed:false};
    if(raw.length>maxCharacters)return {tasks:Object.create(null),storageFailed:true};
    return {tasks:bounded(JSON.parse(raw)),storageFailed:false};
  }catch{return {tasks:Object.create(null),storageFailed:true};}
}
export function saveQuestionTasks(input:Record<string,PreparedQuestionTask>,storage?:StorageLike):QuestionTaskState{
  const tasks=bounded(input);
  try{(storage||sessionStorage).setItem(questionTaskStorageKey,JSON.stringify(tasks));return {tasks,storageFailed:false};}
  catch{return {tasks,storageFailed:true};}
}
function metadataEqual(expected:QuestionTaskMetadata|null|undefined,actual:QuestionTaskMetadata|undefined){
  if(expected===undefined)return true; // The task explicitly inherits its fixed conversation binding.
  if(expected===null)return actual===undefined;
  // /chats/import normalizes Markdown's outer whitespace; indentation within
  // the selected passage remains significant and must still match exactly.
  return ['quote','page','pages','sourceScope','readingId'].every(key=>key==='quote'
    ? expected.quote?.trim()===actual?.quote?.trim()
    : JSON.stringify(expected[key as keyof QuestionTaskMetadata])===JSON.stringify(actual?.[key as keyof QuestionTaskMetadata]));
}
/** An arbitrary assistant message, an old identical question or another task's
 * reply must never mark this handoff complete. */
export function completedQuestionTaskAnswer(task:PreparedQuestionTask,messages:QuestionTaskMessages):string|undefined{
  for(let index=0;index<messages.length-1;index++){
    const user=messages[index],answer=messages[index+1];
    if(user.role!=='user'||user.content!==task.boundQuestion||!metadataEqual(task.metadata,user.metadata))continue;
    if([user,answer].some(message=>message.agentTaskId!==task.agentTaskId||message.paperId!==task.paperId||message.conversationId!==task.conversationId))continue;
    if(answer.role==='assistant'&&answer.mode==='agent'&&text(answer.source?.agent,200)&&text(answer.content,200_000)&&id(answer.id))return answer.id;
  }
}
