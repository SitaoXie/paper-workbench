import type {Paper} from './types';
import {t} from './i18n';
export type Collection = {id:string;name:string;kind:'custom'|'status';status?:string;parentId:string|null;paperIds:string[];createdAt:string};
export function collectionName(folder:Collection) {
  return folder.kind==='status' ? ({'want-to-read':t('想读','Want to read'),reading:t('在读','Reading'),completed:t('已读','Completed')}[folder.status||'']||folder.name) : folder.name;
}
export function collectionPath(folders:Collection[],id:string):Collection[] {
  const path:Collection[]=[],seen=new Set<string>();let item=folders.find(f=>f.id===id);
  while(item&&!seen.has(item.id)){seen.add(item.id);path.unshift(item);item=folders.find(f=>f.id===item!.parentId);}
  return path;
}
export function collectionDescendants(folders:Collection[],id:string):Set<string> {
  return new Set(folders.filter(f=>f.id===id||collectionPath(folders,f.id).some(p=>p.id===id)).map(f=>f.id));
}
export function collectionTotal(folders:Collection[],id:string):number {
  const ids=collectionDescendants(folders,id);return new Set(folders.filter(f=>ids.has(f.id)).flatMap(f=>f.paperIds)).size;
}
export function collectionPapers(papers:Paper[],folders:Collection[],selected:string) {
  if(selected==='all')return papers;
  if(selected==='unfiled'){const filed=new Set(folders.filter(f=>f.kind==='custom').flatMap(f=>f.paperIds));return papers.filter(p=>!filed.has(p.id));}
  const ids=new Set(folders.find(f=>f.id===selected)?.paperIds||[]);return papers.filter(p=>ids.has(p.id));
}
export function filterCollectionPapers(papers:Paper[],query:string,tag:string,sort:string) {
  const q=query.trim().toLocaleLowerCase();return papers.filter(p=>(!tag||p.tags?.includes(tag))&&(!q||[p.title,...(p.authors||[]),...(p.tags||[])].join(' ').toLocaleLowerCase().includes(q))).slice().sort((a,b)=>sort==='title'?a.title.localeCompare(b.title):String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
export function collectionError(error:unknown) {
  const message=error instanceof Error?error.message:String(error);
  const translations:Record<string,string>={
    'A folder with this name already exists here.':t('此位置已有同名文件夹。','A folder with this name already exists here.'),
    'Move or remove subfolders before deleting this folder.':t('请先移走或删除子文件夹，再删除此文件夹。','Move or remove subfolders before deleting this folder.'),
    'A folder cannot be placed inside itself or its descendants.':t('不能将文件夹移入自身或其子文件夹。','A folder cannot be placed inside itself or its descendants.'),
    'Folder not found.':t('文件夹已不存在，请刷新文库。','Folder not found. Refresh the library.'),
  };return translations[message]||message;
}
