import * as pdfText from '../shared/pdf-text.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PDFDocument,StandardFonts,degrees} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
function mod(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>imports[name]});return exports;}
const search=mod('../src/pdf-search.ts',{'../shared/pdf-text.mjs':pdfText});const {citationExcerpt,citationLineBoxes}=mod('../src/citation-preview.ts',{'./pdf-search':search});
test('source previews highlight only a unique original-language passage, not generated or ambiguous text',()=>{
 const item=str=>({str,transform:[10,0,0,10,20,80],width:100,height:10,hasEOL:true});
 const content=[item('A preceding line.'),item('The encoder uses visible patches.'),item('A following line.')];
 const result=citationExcerpt(content,2,'The encoder uses visible patches.');assert.equal(result.status,'matched');assert.equal(result.matchedText,'The encoder uses visible patches.');assert.match(result.text,/preceding/);
 assert.equal(citationExcerpt(content,2,'编码器只处理可见图块').status,'missing');assert.equal(citationExcerpt([...content,content[1]],2,'The encoder uses visible patches.').status,'ambiguous');assert.equal(citationExcerpt(content,2).status,'page');assert.equal(citationExcerpt([],2,'text').match,undefined);
});
test('real PDF extraction and crop boxes agree with original pages including rotated pages',async()=>{
 const document=await PDFDocument.create(),font=await document.embedFont(StandardFonts.Helvetica);for(const angle of [0,90]){const page=document.addPage([400,500]);page.setRotation(degrees(angle));page.drawText('Only visible patches enter the encoder.',{x:40,y:400,size:12,font});}
 const task=getDocument({data:await document.save(),useSystemFonts:true}),pdf=await task.promise;
 try{for(const number of [1,2]){const page=await pdf.getPage(number),content=await page.getTextContent(),viewport=page.getViewport({scale:1});const excerpt=citationExcerpt(content.items,number,'Only visible patches enter the encoder.');assert.equal(excerpt.status,'matched');const boxes=citationLineBoxes(content.items,excerpt.match,viewport);assert.ok(boxes.length);for(const b of boxes){assert.ok(b.left>=0&&b.top>=0&&b.right<=viewport.width&&b.bottom<=viewport.height);assert.ok(b.right>b.left&&b.bottom>b.top);}}}finally{await task.destroy();}
});
