import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {readStoredPdf} from './stored-pdf.mjs';
import {ApiError} from './network.mjs';
let active=0;
/** Re-read only requested pages using the same PDF.js text assembly as the reader. */
export async function readPdfSourcePages(paper,directory,pageNumbers,{signal}={}){
 if(signal?.aborted)throw new ApiError('PDF text reading cancelled.',499);
 const pages=[...new Set(pageNumbers)].filter(n=>Number.isInteger(n)&&n>0).sort((a,b)=>a-b);
 if(!pages.length)return {pages:[],info:{}};
 if(active>=2)throw new ApiError('The PDF text reader is busy. Please retry.',409);
 active++;
 try{
  const bytes=await readStoredPdf(paper,directory);
  const sourceRevision=createHash('sha256').update(bytes).digest('hex');
  if(paper.pdfRevision&&sourceRevision!==paper.pdfRevision)throw new ApiError('The source PDF changed. Reopen the paper before locating citations.',409);
  return await new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./pdf-text-worker.mjs',import.meta.url),{workerData:{data:new Uint8Array(bytes),pages},resourceLimits:{maxOldGenerationSizeMb:256},execArgv:[]});
   let settled=false;
   const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(result);};
   const abort=()=>finish(new ApiError('PDF text reading cancelled.',499));
   const timer=setTimeout(()=>finish(new ApiError('PDF text reading timed out.',502)),30000);
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   worker.once('message',result=>result.error?finish(new ApiError(result.error,502)):finish(null,{...result,pdfRevision:sourceRevision}));
   worker.once('error',()=>finish(new ApiError('PDF text reading failed.',502)));
   worker.once('exit',()=>{if(!settled)finish(new ApiError('PDF text reader stopped before completing.',502));});
  });
 }finally{active--;}
}
