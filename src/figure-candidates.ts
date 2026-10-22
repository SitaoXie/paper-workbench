import {OPS,Util,type PDFPageProxy} from 'pdfjs-dist';
import {boundedCrop,proposeFigureCandidates,type CropRect,type FigureTextBox,type GraphicRegion,type FigureComplexity} from './figure-geometry';

type GraphicsState = {matrix:number[];clip?:CropRect;unknownClip:boolean};
const intersect=(a:CropRect|undefined,b:CropRect|undefined):CropRect|undefined=>{
  if(!a||!b)return;
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
  return boundedCrop({x,y,width:Math.min(a.x+a.width,b.x+b.width)-x,height:Math.min(a.y+a.height,b.y+b.height)-y});
};

/** Local source proposals only. No model, image upload or persisted acceptance. */
export async function inspectFigureCandidates(page:PDFPageProxy,signal?:AbortSignal) {
  const viewport=page.getViewport({scale:1});
  const check=()=>{if(signal?.aborted)throw new DOMException('Figure scan cancelled','AbortError');};
  const normalized=(points:number[][]):CropRect|undefined=>{
    const x=Math.min(...points.map(p=>p[0]))/viewport.width,y=Math.min(...points.map(p=>p[1]))/viewport.height;
    return boundedCrop({x,y,width:Math.max(...points.map(p=>p[0]))/viewport.width-x,height:Math.max(...points.map(p=>p[1]))/viewport.height-y});
  };
  check();const content=await page.getTextContent();check();
  const text:FigureTextBox[]=[];
  const viewportScale=Math.hypot(viewport.transform[0],viewport.transform[1]);
  for(const item of content.items){
    if(!('str' in item)||!item.str.trim())continue;
    const m=Util.transform(viewport.transform,item.transform),length=Math.hypot(m[0],m[1]);
    if(!length)continue;
    const x=m[4],y=m[5],dx=m[0]/length*item.width*viewportScale,dy=m[1]/length*item.width*viewportScale;
    const rect=normalized([[x,y],[x+dx,y+dy],[x+m[2],y+m[3]],[x+dx+m[2],y+dy+m[3]]]);
    if(rect)text.push({...rect,text:item.str});
  }
  const operations=await page.getOperatorList();check();
  const graphics:GraphicRegion[]=[],stack:GraphicsState[]=[];
  let state:GraphicsState={matrix:[1,0,0,1,0,0],clip:{x:0,y:0,width:1,height:1},unknownClip:false};
  const complexity:Required<FigureComplexity>={forms:0,clips:0,paths:0,unsupportedClip:false};
  const transformed=(bounds:number[],local?:number[])=>{
    const transform=Util.transform(viewport.transform,local?Util.transform(state.matrix,local):state.matrix);
    const points=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[3]]];
    for(const point of points)Util.applyTransform(point,transform);
    return normalized(points);
  };
  const add=(bounds:number[],kind:GraphicRegion['kind'],local?:number[])=>{
    // An arbitrary clipping path is not the image's visible extent. Keep the
    // caption/manual entry instead of presenting its unclipped bounds as a crop.
    if(state.unknownClip){complexity.unsupportedClip=true;return;}
    const rect=intersect(state.clip,transformed(bounds,local));if(rect)graphics.push({...rect,kind});
  };
  const save=()=>stack.push({...state,matrix:[...state.matrix],clip:state.clip?{...state.clip}:undefined});
  const restore=()=>{state=stack.pop()||{matrix:[1,0,0,1,0,0],clip:{x:0,y:0,width:1,height:1},unknownClip:false};};
  const limited=operations.fnArray.length>80_000;
  if(!limited)for(let index=0;index<operations.fnArray.length;index++){
    if(index%8000===0){check();await new Promise<void>(resolve=>setTimeout(resolve,0));}
    const fn=operations.fnArray[index],args=operations.argsArray[index];
    if(fn===OPS.save)save();
    else if(fn===OPS.restore)restore();
    else if(fn===OPS.transform)state.matrix=Util.transform(state.matrix,args);
    else if(fn===OPS.constructPath)complexity.paths++;
    else if(fn===OPS.clip||fn===OPS.eoClip){complexity.clips++;state.unknownClip=true;}
    else if(fn===OPS.paintFormXObjectBegin){
      complexity.forms++;save();
      if(args[0])state.matrix=Util.transform(state.matrix,args[0]);
      if(args[1]){state.clip=intersect(state.clip,transformed(args[1]));add(args[1],'form');}
    }
    else if(fn===OPS.paintFormXObjectEnd)restore();
    else if(fn===OPS.beginGroup){
      save();
      // PDF.js uses group.matrix to compute bounds/clip. The subsequent Form
      // begin applies it to drawing coordinates; multiplying here applies twice.
      if(args[0]?.bbox)state.clip=intersect(state.clip,transformed(args[0].bbox,args[0].matrix||undefined));
    }
    else if(fn===OPS.endGroup)restore();
    else if(fn===OPS.paintImageXObject||fn===OPS.paintInlineImageXObject)add([0,0,1,1],'image');
    else if(fn===OPS.paintImageXObjectRepeat){const [,sx,sy,positions]=args;for(let i=0;i<positions.length&&i<20000;i+=2)add([0,0,1,1],'image',[sx,0,0,sy,positions[i],positions[i+1]]);}
    else if(fn===OPS.paintInlineImageXObjectGroup){for(const entry of args[1].slice(0,10000))if(entry.transform)add([0,0,1,1],'image',entry.transform);}
    if(graphics.length>10000){complexity.unsupportedClip=true;break;}
  }
  check();
  const candidates=proposeFigureCandidates(page.pageNumber,text,graphics,complexity);
  if(limited)for(const candidate of candidates){delete candidate.crop;candidate.warning='complex-vectors';}
  return {candidates,limited};
}
