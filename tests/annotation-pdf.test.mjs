import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFDict, degrees, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportAnnotatedPdf } from '../server/annotation-pdf.mjs';

const name = value => PDFName.of(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fontUrl = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url));
const annotation = (kind, page, extra = {}) => ({ id: `${kind}-${page}`, paperId: 'test-paper', kind, page, color: 'yellow',
  body: '观察：中文笔记 / English note\n局限：样本量小。', quote: 'Original evidence (not generated).', tags: ['实验结果', 'limitations'],
  createdAt: '2026-01-02T03:04:05Z', updatedAt: '2026-01-03T04:05:06Z', ...extra });

async function fixture({ rotations = [0, 90, 180, 270], userUnit = 2 } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Public synthetic export fixture');
  const pages = rotations.map((rotation, index) => {
    const page = doc.addPage([700, 900]);
    page.setMediaBox(-50, -25, 700, 900);
    page.setCropBox(20, 30, 600, 800);
    page.setRotation(degrees(rotation));
    page.node.set(name('UserUnit'), PDFNumber.of(userUnit));
    page.drawText(`Original selectable text on source page ${index + 1}`, { x: 40, y: 790, size: 12, font, color: rgb(0, 0, 0) });
    const original = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [30, 700, 48, 718],
      Contents: PDFHexString.fromText('原有批注 original annotation'), T: PDFHexString.fromText('Synthetic author'),
      NM: PDFHexString.fromText(`existing-${index}`), F: 4 }));
    const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [30, 670, 70, 690],
      A: { S: 'URI', URI: PDFString.of('https://example.org/public-source') }, Border: [0, 0, 0] }));
    page.node.set(name('Annots'), doc.context.obj([original, link]));
    return page;
  });
  const root = doc.context.obj({ Type: 'Outlines', Count: 1 });
  const rootRef = doc.context.register(root);
  const childRef = doc.context.register(doc.context.obj({ Title: PDFHexString.fromText('Original outline'), Parent: rootRef, Dest: [pages[0].ref, 'Fit'] }));
  root.set(name('First'), childRef); root.set(name('Last'), childRef);doc.catalog.set(name('Outlines'), rootRef);
  return doc.save({ useObjectStreams: false });
}

async function parse(bytes) {
  return getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: fontUrl, useSystemFonts: false, disableFontFace: true }).promise;
}
async function rendered(page) {
  const viewport = page.getViewport({ scale: 0.75 / page.userUnit });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, viewport }).promise;
  return canvas;
}
function patch(canvas, x, y, radius = 2) {
  const ctx = canvas.getContext('2d');
  const px = Math.round(x * canvas.width), py = Math.round(y * canvas.height);
  return [...ctx.getImageData(Math.max(0, px - radius), Math.max(0, py - radius), radius * 2 + 1, radius * 2 + 1).data].reduce((pixels, value, index, data) => {
    if (index % 4 === 0) pixels.push(data.slice(index, index + 3));
    return pixels;
  }, []);
}
const yellow = ([r, g, b]) => r > 220 && g > 180 && b < 225;
const pink = ([r, g, b]) => r > 190 && g < 190 && b > g;
const blue = ([r, g, b]) => b > 200 && b > r + 30 && b > g + 10;

test('annotated copy preserves pages, original text, outline, existing annotations and source bytes', async () => {
  const source = await fixture(); const originalHash = hash(source);
  const before = await parse(source);
  const input = [annotation('highlight', 1, { rects: [{ x: 0.15, y: 0.2, width: 0.3, height: 0.05 }] })];
  const result = await exportAnnotatedPdf({ pdfBytes: source, annotations: input, paperId: 'test-paper' });
  assert.equal(hash(source), originalHash);assert.equal(result.annotationCount, 1);assert.deepEqual(result.warnings, []);
  const after = await parse(result.bytes);
  try {
    assert.equal(after.numPages, 4);assert.equal((await after.getOutline())[0].title, 'Original outline');
    for (let page = 1; page <= 4; page++) {
      const a = await before.getPage(page), b = await after.getPage(page);
      assert.deepEqual(b.view, a.view);assert.equal(b.rotate, a.rotate);assert.equal(b.userUnit, a.userUnit);
      assert.deepEqual((await b.getTextContent()).items.map(item => item.str), (await a.getTextContent()).items.map(item => item.str));
      const old = await a.getAnnotations(), current = await b.getAnnotations();
      assert.equal(current.length, old.length + (page === 1 ? 1 : 0));
      assert.equal(current.find(item => item.id === old[0].id).contentsObj.str, '原有批注 original annotation');
      assert.equal(current.find(item => item.subtype === 'Link').url, 'https://example.org/public-source');
    }
    const added = (await (await after.getPage(1)).getAnnotations()).find(item => item.subtype === 'Highlight');
    assert.equal(added.hasAppearance, true);assert.equal(added.titleObj.str, 'Paper Workbench');
    assert.ok(added.contentsObj.str.includes(input[0].body));assert.ok(added.contentsObj.str.includes(input[0].quote));
    assert.ok(added.contentsObj.str.includes('实验结果, limitations'));
    assert.equal(added.modificationDate, 'D:20260103040506Z');
  } finally { await before.loadingTask.destroy();await after.loadingTask.destroy(); }
  // Old page content streams and old annotation references are structurally
  // preserved, rather than being painted onto a replacement image page.
  const sourceDoc = await PDFDocument.load(source), resultDoc = await PDFDocument.load(result.bytes);
  for (let index = 0; index < 4; index++) {
    const a = sourceDoc.getPage(index), b = resultDoc.getPage(index);
    assert.equal(a.node.Contents().toString(), b.node.Contents().toString());
    const refs = a.node.Annots().asArray().map(ref => ref.toString());
    assert.deepEqual(b.node.Annots().asArray().slice(0, refs.length).map(ref => ref.toString()), refs);
  }
});

test('PDF.js renders highlight, underline and ink at the same visual location on all rotations', async () => {
  const source = await fixture();
  const notes = [1, 2, 3, 4].flatMap(page => [
    annotation('highlight', page, { rects: [{ x: 0.15, y: 0.2, width: 0.3, height: 0.05 }] }),
    annotation('underline', page, { color: 'pink', rects: [{ x: 0.15, y: 0.35, width: 0.3, height: 0.04 }] }),
    annotation('ink', page, { color: 'blue', strokes: [{ width: 0.008, points: [{x:0.2,y:0.6,pressure:0.2},{x:0.4,y:0.65,pressure:0.9}] }] }),
  ]);
  const result = await exportAnnotatedPdf({ pdfBytes: source, annotations: notes, paperId: 'test-paper' });
  const document = await parse(result.bytes);
  assert.equal(result.annotationCount,12);
  const canvases = [];
  try {
    for (let index = 1; index <= 4; index++) {
      const page = await document.getPage(index), canvas = await rendered(page);canvases.push(canvas);
      assert.ok(patch(canvas,0.3,0.225).some(yellow), `highlight visible at rotation ${page.rotate}`);
      assert.ok(patch(canvas,0.3,0.39).some(pink), `underline on visual bottom at rotation ${page.rotate}`);
      assert.ok(!patch(canvas,0.3,0.35).some(pink), `underline not incorrectly on visual top at rotation ${page.rotate}`);
      assert.ok(patch(canvas,0.3,0.625).some(blue), `ink follows visual path at rotation ${page.rotate}`);
      const exported = (await page.getAnnotations()).filter(item => ['Highlight','Underline','Ink'].includes(item.subtype));
      assert.equal(exported.length,3);assert.ok(exported.every(item => item.hasAppearance));
      assert.equal(exported.find(item=>item.subtype==='Ink').inkLists[0].length,4);
    }
    const sheet=createCanvas(1200,1000), ctx=sheet.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,sheet.width,sheet.height);
    canvases.forEach((canvas,index)=>{const x=(index%2)*600,y=Math.floor(index/2)*500;const scale=Math.min(560/canvas.width,460/canvas.height);ctx.drawImage(canvas,x+20,y+20,canvas.width*scale,canvas.height*scale);});
    const directory=await mkdtemp(join(tmpdir(),'pw-annotation-export-'));
    await writeFile(join(directory,'rotations.png'),await sheet.encode('png'));
    await writeFile(join(directory,'annotated-fixture.pdf'),result.bytes);
    console.info(`Synthetic annotated PDF/render: ${directory}`);
  } finally { await document.loadingTask.destroy(); }
});

test('multi-page logical notes, page comments, tags and different ink widths remain independent markup', async () => {
  const source = await fixture();
  const notes = [annotation('note', 1, { id: 'shared-logical-id', segments: [
    { page: 1, quote: '第一页证据', rects: [{x:0.2,y:0.2,width:0.4,height:0.04}] },
    { page: 3, quote: 'Third page evidence', rects: [{x:0.2,y:0.3,width:0.4,height:0.04}] },
  ] }), annotation('translation', 2, { id: 'page-comment', body: '需要核对的中文译文', quote: 'Source without saved geometry' }),
  annotation('ink', 4, { strokes: [
    {width:0.003,points:[{x:0.2,y:0.3},{x:0.3,y:0.4}]},
    {width:0.012,points:[{x:0.2,y:0.6},{x:0.3,y:0.7}]},
  ] }), annotation('note', 1, { id:'deleted-note',deletedAt:'2026-01-04T00:00:00Z',body:'must not export' })];
  const result = await exportAnnotatedPdf({pdfBytes:source,annotations:notes,paperId:'test-paper'});
  assert.equal(result.annotationCount,5);assert.deepEqual(result.warnings,[{code:'annotation_page_comment',annotationId:'page-comment',page:2}]);
  const doc = await PDFDocument.load(result.bytes), entries=[];
  doc.getPages().forEach((page,index)=>{for(const ref of page.node.Annots().asArray()){const item=doc.context.lookup(ref,PDFDict);const title=item.lookup(name('T'));if(title?.decodeText()==='Paper Workbench')entries.push({page:index+1,item});}});
  assert.equal(entries.length,5);
  const cross=entries.filter(({item})=>item.lookup(name('NM')).decodeText().includes('shared-logical-id'));
  assert.deepEqual(cross.map(item=>item.page),[1,3]);
  assert.ok(cross[0].item.lookup(name('Contents')).decodeText().includes('分段 1/2'));
  assert.ok(cross[1].item.lookup(name('Contents')).decodeText().includes('Third page evidence'));
  const pageComment=entries.find(({page})=>page===2).item;
  assert.equal(pageComment.get(name('Subtype')),name('Text'));
  assert.ok(pageComment.lookup(name('Contents')).decodeText().includes('未保存精确选文位置'));
  assert.ok(pageComment.lookup(name('Subj')).decodeText().includes('AI 翻译'));
  assert.ok(entries.every(({item})=>item.lookup(name('Contents')).decodeText().includes('实验结果')));
  const ink=entries.filter(({page})=>page===4);
  assert.ok(ink[1].item.lookup(name('BS'),PDFDict).lookup(name('W'),PDFNumber).asNumber()>ink[0].item.lookup(name('BS'),PDFDict).lookup(name('W'),PDFNumber).asNumber());
});

test('shared original annotation arrays stay page-local and exported names never collide', async () => {
  const source = await fixture({ rotations:[0,0] });
  const doc=await PDFDocument.load(source);
  const array=doc.getPage(0).node.Annots();
  const first=doc.context.lookup(array.get(0),PDFDict);first.set(name('NM'),PDFHexString.fromText('paper-workbench:highlight-1:p1:s0'));
  const shared=doc.context.register(array);doc.getPage(0).node.set(name('Annots'),shared);doc.getPage(1).node.set(name('Annots'),shared);
  const result=await exportAnnotatedPdf({pdfBytes:await doc.save(),annotations:[annotation('highlight',1,{rects:[{x:0.2,y:0.2,width:0.2,height:0.02}]})],paperId:'test-paper'});
  const after=await PDFDocument.load(result.bytes);
  assert.equal(after.getPage(0).node.Annots().size(),3);assert.equal(after.getPage(1).node.Annots().size(),2);
  const added=after.context.lookup(after.getPage(0).node.Annots().get(2),PDFDict);
  assert.equal(added.lookup(name('NM')).decodeText(),'paper-workbench:highlight-1:p1:s0:copy2');
});

test('ordinary pages and inherited MediaBox/CropBox/Rotate use the same source viewport; UserUnit is page-local', async () => {
  const doc=await PDFDocument.create();
  const ordinary=doc.addPage([600,800]);ordinary.setRotation(degrees(0));ordinary.setCropBox(0,0,600,800);
  const inherited=doc.addPage([600,800]);
  const parent=inherited.node.Parent();
  parent.set(name('MediaBox'),doc.context.obj([-20,-30,580,770]));
  parent.set(name('CropBox'),doc.context.obj([10,20,510,720]));
  parent.set(name('Rotate'),PDFNumber.of(270));
  parent.set(name('UserUnit'),PDFNumber.of(7));
  for(const key of ['MediaBox','CropBox','Rotate'])inherited.node.delete(name(key));
  inherited.node.set(name('UserUnit'),PDFNumber.of(2.5));
  const result=await exportAnnotatedPdf({pdfBytes:await doc.save(),paperId:'test-paper',annotations:[1,2].map(page=>annotation('highlight',page,{rects:[{x:0.15,y:0.2,width:0.3,height:0.05}]}))});
  const pdf=await parse(result.bytes);
  try{
    const first=await pdf.getPage(1),second=await pdf.getPage(2);
    assert.deepEqual(first.view,[0,0,600,800]);assert.equal(first.rotate,0);assert.equal(first.userUnit,1);
    assert.deepEqual(second.view,[10,20,510,720]);assert.equal(second.rotate,270);assert.equal(second.userUnit,2.5);
    for(const page of [first,second])assert.ok(patch(await rendered(page),0.3,0.225).some(yellow));
  }finally{await pdf.loadingTask.destroy();}
});

test('encrypted, signed, XFA, malformed annotations and bad geometry fail with stable safe 422 errors', async () => {
  const base=await fixture({rotations:[0]});
  const variants=[
    ['pdf_encrypted_unsupported',doc=>{doc.context.trailerInfo.Encrypt=doc.context.register(doc.context.obj({Filter:'Standard',V:1,R:2,Length:40}));}],
    ['pdf_signed_unsupported',doc=>{doc.catalog.set(name('Perms'),doc.context.obj({DocMDP:doc.context.register(doc.context.obj({Type:'Sig',ByteRange:[0,100,200,300],Contents:PDFHexString.of('00')}))}));}],
    ['pdf_xfa_unsupported',doc=>{doc.catalog.set(name('AcroForm'),doc.context.obj({XFA:PDFHexString.fromText('synthetic xfa')}));}],
    ['pdf_annotations_invalid',doc=>{doc.getPage(0).node.set(name('Annots'),doc.context.obj([123]));}],
    ['pdf_page_geometry_unsupported',doc=>{doc.getPage(0).node.set(name('Rotate'),PDFNumber.of(45));}],
  ];
  for(const[code,mutate]of variants){
    const doc=await PDFDocument.load(base);mutate(doc);const bytes=await doc.save();const digest=hash(bytes);
    await assert.rejects(exportAnnotatedPdf({pdfBytes:bytes,annotations:[],paperId:'test-paper'}),error=>error.code===code&&error.status===422&&!error.message.includes('/Users/'));
    assert.equal(hash(bytes),digest);
  }
  await assert.rejects(exportAnnotatedPdf({pdfBytes:new Uint8Array([1,2,3]),annotations:[]}),{code:'pdf_source_invalid',status:422});
  await assert.rejects(exportAnnotatedPdf({pdfBytes:base,annotations:[annotation('note',1)],paperId:'another-paper'}),{code:'annotation_paper_mismatch',status:422});
});
