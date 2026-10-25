import {Worker} from 'node:worker_threads';
import {readStoredPdf} from './stored-pdf.mjs';
import {ApiError} from './network.mjs';
let active=0;
export function validatePdfImageRegion(crop) {
 if(!crop||Object.keys(crop).some(key=>!['x','y','width','height'].includes(key))||!['x','y','width','height'].every(key=>typeof crop[key]==='number'&&Number.isFinite(crop[key]))||crop.x<0||crop.y<0||crop.width<=0||crop.height<=0||crop.x+crop.width>1||crop.y+crop.height>1)
  throw new ApiError('Region must be normalized x/y/width/height inside the rotated PDF page.');
 return {x:crop.x,y:crop.y,width:crop.width,height:crop.height};
}
export async function renderPdfImage(paper,directory,{page,crop,signal}={}) {
 if(!Number.isInteger(page)||page<1)throw new ApiError('Choose a positive PDF page number.');
 if(crop)crop=validatePdfImageRegion(crop);
 if(!directory||!paper.filePath)throw new ApiError('This paper has no available local PDF. Import the PDF first.');
 if(signal?.aborted)throw new ApiError('Image request cancelled.');
 if(active>=2)throw new ApiError('PDF image renderer is busy. Retry this tool after the other render finishes.');
 active++;
 try{
  const buffer=await readStoredPdf(paper,directory).catch(()=>{throw new ApiError('The stored PDF is unavailable or outside this workspace.');});
  return await new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./pdf-image-worker.mjs',import.meta.url),{workerData:{data:new Uint8Array(buffer),page,crop},resourceLimits:{maxOldGenerationSizeMb:256},execArgv:[]});
   let settled=false;
   const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(result);};
   const abort=()=>finish(new ApiError('Image request cancelled.'));
   const timer=setTimeout(()=>finish(new ApiError('PDF image rendering timed out. Try a smaller region or another page.')),30000);
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   worker.once('message',result=>result.error?finish(new ApiError(result.error)):finish(null,result));
   worker.once('error',()=>finish(new ApiError('PDF image renderer unavailable. Check the canvas dependency.')));
   worker.once('exit',()=>{if(!settled)finish(new ApiError('PDF image renderer stopped before completing.'));});
  });
 }finally{active--;}
}
