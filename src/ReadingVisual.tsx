import {useEffect,useRef,useState} from 'react';
import {parseChart,validateDiagram,orderIndependentDiagramGroups,type ChartData} from '../shared/reading-visuals.mjs';
import {t} from './i18n';
import './reading-visual.css';
import DiagramViewport, {diagramSize, type DiagramSize} from './DiagramViewport';
let renderQueue:Promise<unknown>=Promise.resolve();
function Chart({data}:{data:ChartData}) {
  const [selected,setSelected]=useState<number>();
  const low=Math.min(0,...data.data.map(p=>p.value)),high=Math.max(0,...data.data.map(p=>p.value));
  const width=Math.max(520,data.data.length*56+80),point=selected===undefined?undefined:data.data[selected];
  const range=high-low||1, y=(value:number)=>210-(value-low)/range*170, step=(width-80)/data.data.length;
  const number=(value:number)=>new Intl.NumberFormat(undefined,{maximumSignificantDigits:5}).format(value);
  return <><div className="chart-scroll"><svg className="reading-chart" style={{minWidth:width>520?width:undefined}} viewBox={`0 0 ${width} 270`} role="img" aria-label={`${data.title} (${data.unit})`}>
    <text x="12" y="18" className="chart-label">{data.unit}</text>
    {[0,.5,1].map(f=><g key={f}><line x1="64" x2={width-16} y1={40+f*170} y2={40+f*170} className="chart-grid"/><text x="56" y={44+f*170} textAnchor="end" className="chart-label">{number(high-f*(high-low))}</text></g>)}
    <line x1="64" x2={width-16} y1={y(0)} y2={y(0)} className="chart-zero"/>
    {data.type==='line'&&<polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={data.data.map((p,i)=>`${64+step*(i+.5)},${y(p.value)}`).join(' ')}/>}
    {data.data.map((p,i)=><g key={p.label} tabIndex={0} role="img" aria-label={`${p.label}: ${p.value} ${data.unit}`} onFocus={()=>setSelected(i)} onBlur={()=>setSelected(undefined)} onMouseEnter={()=>setSelected(i)} onMouseLeave={()=>setSelected(undefined)} onClick={()=>setSelected(i)}>
      <title>{`${p.label}: ${p.value} ${data.unit}`}</title>
      {data.type==='bar'?<rect x={64+step*(i+.18)} y={Math.min(y(p.value),y(0))} width={step*.64} height={Math.max(1,Math.abs(y(p.value)-y(0)))} fill="var(--accent)" opacity={selected===i?1:.75}/>:<circle cx={64+step*(i+.5)} cy={y(p.value)} r={selected===i?6:4} fill="var(--accent)"/>}
      <text x={64+step*(i+.5)} y="234" textAnchor="middle" className="chart-label">{p.label.length>10?p.label.slice(0,9)+'…':p.label}</text>
    </g>)}
  </svg></div><p className="chart-selection" aria-live="polite">{!point?t('悬停或点选数据查看数值','Hover or select a point to inspect its value'):`${point.label}: ${point.value} ${data.unit}`}</p><small>{t('数据来源：','Data source: ')}{data.source}</small><details><summary>{t('查看数据表','View data table')}</summary><table><thead><tr><th>{t('项目','Item')}</th><th>{data.unit}</th></tr></thead><tbody>{data.data.map(p=><tr key={p.label}><td>{p.label}</td><td>{p.value}</td></tr>)}</tbody></table></details></>;
}
export default function ReadingVisual({source,kind}:{source:string;kind:'mermaid'|'chart'}) {
  const [svg,setSvg]=useState(''),[size,setSize]=useState<DiagramSize>({width:640,height:300}),[error,setError]=useState(''),[theme,setTheme]=useState(()=>typeof document==='undefined'?'light':document.documentElement.dataset.theme||'light');
  const slot=useRef<HTMLDivElement>(null);
  let data:ChartData|undefined,invalid='',diagram='';try{if(kind==='chart')data=parseChart(source);else diagram=validateDiagram(source);}catch(e){invalid=(e as Error).message;}
  useEffect(()=>{const observer=new MutationObserver(()=>setTheme(document.documentElement.dataset.theme||'light'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
  useEffect(()=>{
    if(kind!=='mermaid'||invalid)return;let disposed=false;setSvg('');setError('');
    // Debounce partial streamed fences; serialize Mermaid's global configuration.
    const timer=setTimeout(()=>{renderQueue=renderQueue.catch(()=>{}).then(async()=>{
      if(disposed)return;const {default:mermaid}=await import('mermaid');if(disposed)return;
      mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:theme==='dark'?'dark':'default',htmlLabels:false,maxTextSize:16000,maxEdges:150,suppressErrorRendering:true,flowchart:{htmlLabels:false}});
      let layoutSource=diagram;
      if(/^\s*(?:flowchart|graph)\b/.test(diagram)){
        const parsed=await mermaid.mermaidAPI.getDiagramFromText(diagram);
        const db=parsed.db as {getSubGraphs?:()=>{id:string;nodes:string[]}[];getEdges?:()=>{start:string;end:string}[];getVertices?:()=>Map<string,unknown>};
        if(db.getSubGraphs&&db.getEdges&&db.getVertices)layoutSource=orderIndependentDiagramGroups(diagram,{groups:db.getSubGraphs(),edges:db.getEdges(),nodeIds:[...db.getVertices().keys()]});
      }
      if(disposed)return;
      const container=document.createElement('div');slot.current?.append(container);
      try{const {svg}=await mermaid.render(`diagram-${crypto.randomUUID()}`,layoutSource,container);if(!disposed){setSize(diagramSize(svg));setSvg(svg);}}
      finally{container.remove();}
    }).catch(()=>{if(!disposed)setError(t('图形语法暂不可渲染，可展开源代码查看。','This diagram could not be rendered. Expand the source to inspect it.'));});},350);
    return()=>{disposed=true;clearTimeout(timer);};
  },[diagram,kind,theme,invalid]);
  return <figure className="reading-visual">
    <figcaption><span>{data?.title||t('示意图','Explanatory diagram')}</span><small>{t('AI 辅助绘制','AI-generated visual')}</small></figcaption>
    {invalid||error?<p role="status">{invalid||error}</p>:data?<Chart data={data}/>:svg?<DiagramViewport svg={svg} size={size}/>:<p role="status">{t('正在绘图…','Drawing…')}</p>}
    <div ref={slot} className="diagram-render-slot" aria-hidden="true"/>
    <details><summary>{t('查看源代码','View source')}</summary><pre><code>{source}</code></pre></details>
  </figure>;
}
