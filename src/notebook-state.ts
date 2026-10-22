export type NotebookView = { selectedId?: string; editing: boolean; preview: boolean };
export type NoteDrafts = Record<string, {body: string; tags: string}>;
export function readNotebookView(paperId: string): NotebookView | undefined {
  try {
    const raw=sessionStorage.getItem(`pw-note-view:${paperId}`);
    if(!raw||raw.length>1000)return;
    const value=JSON.parse(raw);
    if(value&&typeof value.editing==='boolean'&&typeof value.preview==='boolean'&&(value.selectedId===undefined||(typeof value.selectedId==='string'&&value.selectedId.length<=256)))return value;
  } catch { /* A restricted or obsolete session must not prevent reading. */ }
}
export function writeNotebookView(paperId: string, view: NotebookView) {
  try {sessionStorage.setItem(`pw-note-view:${paperId}`,JSON.stringify(view));} catch { /* The current editor remains usable. */ }
}
export function readNoteDrafts(paperId: string): NoteDrafts {
  try {
    const raw=sessionStorage.getItem(`pw-note-drafts:${paperId}`);
    if(!raw||raw.length>500_000)return {};
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    const drafts: NoteDrafts={};
    for(const [key,entry] of Object.entries(value).slice(-100)){
      if(key.length>256||!entry||typeof entry!=='object')continue;
      const draft=entry as NoteDrafts[string];
      if(typeof draft.body==='string'&&draft.body.length<=20000&&typeof draft.tags==='string'&&draft.tags.length<=4000)drafts[key]={body:draft.body,tags:draft.tags};
    }
    return drafts;
  } catch { return {}; }
}
