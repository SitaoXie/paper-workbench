import {createContext,lazy,Suspense,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {t} from './i18n';
export const CitationSourceContext=createContext<string|undefined>(undefined);
const Preview=lazy(()=>import('./CitationSourcePreview'));
export default function CitationLink({page,quote,children,onPage}:{page:number;quote?:string;children:ReactNode;onPage:(page:number,quote?:string)=>void}) {
  const url=useContext(CitationSourceContext),anchor=useRef<HTMLButtonElement>(null),timer=useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open,setOpen]=useState(false);
  const show=()=>{clearTimeout(timer.current);if(url)timer.current=setTimeout(()=>setOpen(true),220);};
  const close=()=>{clearTimeout(timer.current);setOpen(false);};
  const leave=()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>setOpen(false),180);};
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{close();},[url,page,quote]);
  return <><button ref={anchor} className="citation-link" onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={leave} aria-haspopup={url?'dialog':undefined} aria-expanded={url?open:undefined} data-citation-kind={quote?'passage':'page'} title={quote?t(`定位原文 · p.${page}`,`Locate source passage · p.${page}`):t(`页码引用 · p.${page} · 未指定段落`,`Page reference · p.${page} · no passage specified`)} onClick={()=>{close();onPage(page,quote);}}>{children}{quote&&typeof children==='string'&&!/^p\./i.test(children)&&<small> · p.{page}</small>}</button>
    {url&&open&&anchor.current&&<Suspense fallback={null}><Preview key={`${url}:${page}:${quote||''}`} url={url} page={page} quote={quote} anchor={anchor.current} onClose={close} onEnter={()=>clearTimeout(timer.current)} onLeave={leave} onPage={onPage}/></Suspense>}</>;
}
