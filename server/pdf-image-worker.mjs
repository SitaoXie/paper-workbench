import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import path from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const root=path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
let task;
try{
 task=getDocument({data:workerData.data,useSystemFonts:true,isEvalSupported:false,standardFontDataUrl:path.join(root,'standard_fonts/'),wasmUrl:path.join(root,'wasm/')});
 const pdf=await task.promise;
 if(workerData.page>pdf.numPages)throw Error('Page outside PDF');
 const page=await pdf.getPage(workerData.page),natural=page.getViewport({scale:1});
 const crop=workerData.crop||{x:0,y:0,width:1,height:1};
 const w=natural.width*crop.width,h=natural.height*crop.height;
 const scale=Math.min(3,2600/Math.max(w,h),Math.sqrt(6_000_000/(w*h)));
 const viewport=page.getViewport({scale}),width=Math.max(1,Math.ceil(w*scale)),height=Math.max(1,Math.ceil(h*scale));
 const canvas=createCanvas(width,height);
 await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-viewport.width*crop.x,-viewport.height*crop.y],background:'#fff'}).promise;
 const buffer=canvas.toBuffer('image/jpeg',90);
 if(buffer.length>4*1024*1024)throw Error('Rendered image exceeds limit');
 parentPort.postMessage({width,height,pageCount:pdf.numPages,image:{mimeType:'image/jpeg',data:buffer.toString('base64')}});
}catch{parentPort.postMessage({error:'PDF image rendering failed. The page may be unavailable, encrypted, malformed or too large.'});}
finally{await task?.destroy().catch(()=>{});}
