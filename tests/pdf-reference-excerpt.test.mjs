import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {PDFDocument,PDFName,StandardFonts,degrees} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

async function sourceModule(path){
  const code=ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const {extractPdfReferenceExcerpt:extract,readPdfReferenceExcerpt:read}=await sourceModule('../src/pdf-reference-excerpt.ts');
const {resolvePdfDestination}=await sourceModule('../src/pdf-destination.ts');
const viewport={width:612,height:792,transform:[1,0,0,-1,0,792]};
const item=(str,x,baseline,width=220)=>({str,width,height:8,transform:[8,0,0,8,x,792-baseline],fontName:'fixture',dir:'ltr',hasEOL:false});
const content=()=>({items:[
  item('[14] Left-column unrelated reference.',50,395),item('Left-column continuation, not reference 42.',68,405),
  item('[15] Another unrelated left entry.',50,425),item('More left-column text.',68,435),
  item('[41] Earlier right-column entry.',309,380),item('Earlier continuation.',327,390),
  item('[42] Target author. Target reference title.',309,408),item('Target publication, 2015.',327,418),
  item('[43] Later right-column entry.',309,438),item('Later continuation.',327,448),
]});
const target={x:309/612,y:398/792};
function validCrop(crop){
  for(const value of Object.values(crop))assert.ok(Number.isFinite(value));
  assert.ok(crop.x>=0&&crop.y>=0&&crop.width>0&&crop.height>0);
  assert.ok(crop.x+crop.width<=1+1e-10&&crop.y+crop.height<=1+1e-10);
}

test('real PDF.js text and XYZ destination select the right-column reference, not the same-height left column',async t=>{
  const pdf=await PDFDocument.create(),first=pdf.addPage([612,792]),references=pdf.addPage([612,792]);
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  first.drawText('[42]',{x:400,y:700,size:10,font});
  for(const entry of content().items)references.drawText(entry.str,{x:entry.transform[4],y:entry.transform[5],size:8,font});
  const link=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[400,698,420,710],Border:[0,0,0],Dest:[references.ref,PDFName.of('XYZ'),309,394,null]});
  first.node.set(PDFName.of('Annots'),pdf.context.obj([pdf.context.register(link)]));
  const task=getDocument({data:new Uint8Array(await pdf.save()),useSystemFonts:true});t.after(()=>task.destroy());
  const document=await task.promise,destination=(await(await document.getPage(1)).getAnnotations())[0].dest;
  const point=await resolvePdfDestination(document,destination);assert.equal(point.page,2);
  const result=await read(await document.getPage(point.page),point,'[42]');
  assert.match(result.text,/^\[42\] Target author/);assert.match(result.text,/Target publication, 2015/);
  assert.doesNotMatch(result.text,/\[14\]|\[15\]|\[41\]|\[43\]|Left-column/);
  assert.equal(result.uncertain,false);assert.equal(result.matchedLabel,'[42]');
  assert.ok(result.crop.x>.45&&result.crop.width<.5);validCrop(result.crop);
});

test('unordered PDF spans form one nearby entry and keep Chinese continuation in the same column',()=>{
  const input=content();input.items=input.items.filter(row=>!row.str.startsWith('[42]')&&!row.str.startsWith('Target publication'));
  input.items.push(item('[',309,408,2.6),item('42',311.6,408,8),item(']',319.6,408,2.6),item('作者。引用标题。',327,408,90),item('中文续行',327,418,32),item('内容。',359,418,24));
  input.items.reverse();
  const result=extract(input,viewport,target,'42');
  assert.equal(result.text,'[42] 作者。引用标题。\n中文续行内容。');
  assert.equal(result.uncertain,false);validCrop(result.crop);
});

test('a requested number cannot override a different nearby destination or search a distant same-number entry',()=>{
  const actual41=extract(content(),viewport,{x:target.x,y:370/792},'[42]');
  assert.match(actual41.text,/^\[41\]/);assert.doesNotMatch(actual41.text,/\[42\]/);
  assert.equal(actual41.uncertain,true);assert.equal(actual41.matchedLabel,undefined);
  const otherColumn=extract(content(),viewport,{x:50/612,y:385/792},'[42]');
  assert.match(otherColumn.text,/^\[14\]/);assert.equal(otherColumn.uncertain,true);
  const far=extract(content(),viewport,{x:target.x,y:.1},'[42]');
  assert.equal(far.text,'');assert.equal(far.uncertain,true);
});

test('ambiguous columns, duplicate nearby labels and nonnumeric link labels remain explicitly uncertain',()=>{
  const noX=extract(content(),viewport,{y:target.y},'[42]');assert.equal(noX.text,'');assert.equal(noX.uncertain,true);validCrop(noX.crop);
  const duplicate=content();duplicate.items.push(item('[42] Ambiguous second label.',309,413));
  const result=extract(duplicate,viewport,target,'[42]');assert.equal(result.uncertain,true);assert.equal(result.matchedLabel,undefined);
  for(const label of ['Figure 42','[42,43]','42–43']){
    const result=extract(content(),viewport,target,label);assert.match(result.text,/^\[42\]/);assert.equal(result.uncertain,true);assert.equal(result.matchedLabel,undefined);
  }
  const bridged=content();bridged.items.push(item('A spanning heading overlaps both columns.',180,362,220));
  const ambiguous=extract(bridged,viewport,target,'[42]');assert.equal(ambiguous.text,'');assert.equal(ambiguous.uncertain,true);
});

test('rotated source coordinates produce a bounded source-region fallback instead of fabricated horizontal text',async t=>{
  const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]);page.setRotation(degrees(90));
  const font=await pdf.embedFont(StandardFonts.Helvetica);page.drawText('[42] Rotated source reference.',{x:309,y:384,size:8,font});
  const task=getDocument({data:new Uint8Array(await pdf.save()),useSystemFonts:true});t.after(()=>task.destroy());const doc=await task.promise;
  const actual=await doc.getPage(1),vp=actual.getViewport({scale:1}),[x,y]=vp.convertToViewportPoint(309,394);
  const result=await read(actual,{x:x/vp.width,y:y/vp.height},'[42]');
  assert.equal(result.text,'');assert.equal(result.uncertain,true);validCrop(result.crop);
  assert.ok(result.crop.x<=x/vp.width&&result.crop.x+result.crop.width>=x/vp.width);
  assert.ok(result.crop.y<=y/vp.height&&result.crop.y+result.crop.height>=y/vp.height);
});

test('oversized pages, missing coordinates and excessive text remain bounded; long excerpts disclose truncation',()=>{
  const huge={width:1e6,height:1e6,transform:[1,0,0,-1,0,1e6]};
  const large=extract({items:[]},huge,{x:.99,y:.99},'[42]');validCrop(large.crop);
  assert.ok(large.crop.width*huge.width<=720.000001);assert.ok(large.crop.height*huge.height<=260.000001);
  assert.equal(extract(content(),viewport,{},'[42]').text,'');
  assert.equal(extract({items:Array(50001).fill(item('x',1,1))},viewport,target,'[42]').uncertain,true);
  const long=content();long.items.find(row=>row.str.startsWith('[42]')).str+=' Long source text.'.repeat(30);
  const limited=extract(long,viewport,target,'[42]',{maxChars:120});assert.equal(limited.text.length,120);assert.ok(limited.text.endsWith('…'));assert.equal(limited.uncertain,true);
});

test('single-column prose is a source excerpt, and cancellation cannot publish a completed stale request',async()=>{
  const prose={items:[item('A full-width paragraph begins here.',50,408,500),item('Its next line remains source text.',50,420,500)]};
  const result=extract(prose,viewport,target,'Methods');assert.match(result.text,/^A full-width paragraph/);assert.equal(result.uncertain,true);validCrop(result.crop);
  const before=new AbortController();before.abort();let calls=0;
  await assert.rejects(read({getTextContent:async()=>{calls++;return content();},getViewport:()=>viewport},target,'[42]',{signal:before.signal}),{name:'AbortError'});assert.equal(calls,0);
  const after=new AbortController();let finish;
  const pending=read({getTextContent:()=>new Promise(resolve=>finish=resolve),getViewport:()=>viewport},target,'[42]',{signal:after.signal});
  after.abort();finish(content());await assert.rejects(pending,{name:'AbortError'});
});
