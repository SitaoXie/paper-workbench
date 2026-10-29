import {parentPort,workerData} from 'node:worker_threads';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {assemblePdfText} from '../shared/pdf-text.mjs';
let task;
try{
 task=getDocument({data:workerData.data,useSystemFonts:true,isEvalSupported:false});
 const pdf=await task.promise,pages=[];
 for(const number of workerData.pages){
  if(number<1||number>pdf.numPages)continue;
  const page=await pdf.getPage(number),content=await page.getTextContent();
  pages.push({number,text:assemblePdfText(content.items).raw});
 }
 const metadata=await pdf.getMetadata().catch(()=>({}));
 parentPort.postMessage({pages,pageCount:pdf.numPages,info:{title:metadata.info?.Title||'',author:metadata.info?.Author||''}});
}catch{parentPort.postMessage({error:'The PDF text layer could not be read.'});}
finally{await task?.destroy().catch(()=>{});}
