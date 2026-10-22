import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationPageGeometry, normalizedPointToPdf, normalizedRectToPdf, normalizedInkToPdf, planAnnotationPdfGeometry } from '../server/annotation-pdf.mjs';

const source = { mediaBox: [0, 0, 600, 800], cropBox: [40, 70, 540, 770] };
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${actual} != ${expected}`));
};

test('all intrinsic rotations map visual page corners into a nonzero CropBox', () => {
  const expected = new Map([
    [0, [[40, 770], [540, 770], [40, 70], [540, 70]]],
    [90, [[40, 70], [40, 770], [540, 70], [540, 770]]],
    [180, [[540, 70], [40, 70], [540, 770], [40, 770]]],
    [270, [[540, 770], [540, 70], [40, 770], [40, 70]]],
  ]);
  for (const [rotation, corners] of expected) {
    const page = annotationPageGeometry({ ...source, rotation });
    [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}].forEach((point, index) => close(normalizedPointToPdf(page, point), corners[index]));
    close(normalizedPointToPdf(page, { x: 0.5, y: 0.5 }), [290, 420]);
    assert.equal(page.viewportWidth, rotation % 180 ? 700 : 500);
  }
});

test('crop coordinates are the MediaBox intersection, including negative origins', () => {
  const page = annotationPageGeometry({ mediaBox: [-50, -25, 550, 775], cropBox: [-100, 50, 600, 700] });
  assert.deepEqual(page.view, [-50, 50, 550, 700]);
  close(normalizedPointToPdf(page, {x:0,y:0}), [-50,700]);
  close(normalizedPointToPdf(page, {x:1,y:1}), [550,50]);
  assert.deepEqual(annotationPageGeometry({mediaBox:[550,775,-50,-25]}).view,[-50,-25,550,775]);
});

test('UserUnit affects physical size, not annotation coordinates or normalized stroke geometry', () => {
  const a = annotationPageGeometry({...source,rotation:90,userUnit:1});
  const b = annotationPageGeometry({...source,rotation:90,userUnit:2.5});
  const selected = {x:0.2,y:0.1,width:0.4,height:0.05};
  assert.deepEqual(normalizedRectToPdf(a,selected),normalizedRectToPdf(b,selected));
  assert.equal(b.physicalWidth,1750);assert.equal(b.physicalHeight,1250);
  const stroke={width:0.003,points:[{x:0.2,y:0.4},{x:0.3,y:0.6}]};
  assert.deepEqual(normalizedInkToPdf(a,stroke),normalizedInkToPdf(b,stroke));
});

test('QuadPoints retain visual order and the underline stays on the visual bottom at 90/180/270', () => {
  const selected={x:0.1,y:0.2,width:0.3,height:0.04};
  const expected=new Map([
    [0, {rect:[90,602,240,630],underline:[[90,602],[240,602]]}],
    [90, {rect:[140,140,160,350],underline:[[160,140],[160,350]]}],
    [180, {rect:[340,210,490,238],underline:[[490,238],[340,238]]}],
    [270, {rect:[420,490,440,700],underline:[[420,700],[420,490]]}],
  ]);
  for(const[rotation,result]of expected){
    const geometry=normalizedRectToPdf(annotationPageGeometry({...source,rotation}),selected);
    close(geometry.rect,result.rect);
    close(geometry.underline.flat(),result.underline.flat());
    close(geometry.quadPoints.slice(4),result.underline.flat());
  }
});

test('ink exports each point once and retains anisotropic normalized pen appearance', () => {
  const page=annotationPageGeometry({...source,rotation:90,userUnit:2});
  const stroke={width:0.01,points:[{x:0.2,y:0.3,pressure:0.1},{x:0.4,y:0.5,pressure:0.9}]};
  const ink=normalizedInkToPdf(page,stroke);
  close(ink.inkList,[190,210,290,350]);
  close(ink.rect,[187.5,206.5,292.5,353.5]);
  assert.deepEqual(ink.appearance.matrix,[0,700,500,0,40,70]);
  assert.equal(ink.appearance.width,0.01);
  assert.deepEqual(ink.appearance.points,[{x:0.2,y:0.3},{x:0.4,y:0.5}]);
  assert.ok(Math.abs(ink.fallbackWidth-0.01*Math.sqrt(700*500))<1e-9);
  assert.equal(stroke.points[0].pressure,0.1);
});

test('cross-page plans keep disjoint source segments and Unicode note contents', () => {
  const annotations=[{id:'cross',paperId:'p',kind:'highlight',body:'结果很好，但样本小。 Evidence / 局限',segments:[
    {page:1,quote:'first page',rects:[{x:0.1,y:0.9,width:0.2,height:0.04}]},
    {page:3,quote:'第三页',rects:[{x:0.2,y:0.1,width:0.4,height:0.05}]},
  ]}];
  const before=JSON.stringify(annotations);
  const result=planAnnotationPdfGeometry({pages:[source,source,{...source,rotation:270}],annotations,paperId:'p'});
  assert.deepEqual(result.plans.map(p=>p.page),[1,3]);
  assert.deepEqual(result.plans.map(p=>p.segmentIndex),[0,1]);
  assert.ok(result.plans.every(p=>p.segmentCount===2));
  assert.equal(result.plans[1].quote,'第三页');
  assert.equal(result.plans[1].body,annotations[0].body);
  assert.equal(result.plans[1].pageComment,false);
  assert.deepEqual(result.warnings,[]);assert.equal(JSON.stringify(annotations),before);
});

test('unpositioned records become explicit page comments; deleted notes never export', () => {
  const result=planAnnotationPdfGeometry({pages:[source],annotations:[
    {id:'plain',kind:'note',page:1,body:'我保存的页笔记'},
    {id:'quote',kind:'highlight',page:1,quote:'Legacy quote without rectangles'},
    {id:'deleted',kind:'note',page:1,body:'secret',deletedAt:'2026-01-01'},
  ]});
  assert.equal(result.plans.length,2);assert.ok(result.plans.every(p=>p.pageComment&&p.rectangles.length===0));
  assert.deepEqual(result.warnings.map(w=>w.annotationId),['plain','quote']);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('malformed metadata fails explicitly instead of guessing a different reader coordinate space', () => {
  for(const value of [
    {...source,mediaBox:[0,0,0,800]}, {...source,cropBox:[601,0,700,800]},
    {...source,rotation:45},{...source,userUnit:0},{...source,userUnit:Infinity},{...source,userUnit:75001},
  ]) assert.throws(()=>annotationPageGeometry(value),{name:'AnnotationPdfGeometryError'});
  assert.equal(annotationPageGeometry({...source,rotation:-90}).rotation,270);
  assert.equal(annotationPageGeometry({...source,rotation:450}).rotation,90);
});

test('invalid coordinates, paper binding, and missing source pages cannot silently export', () => {
  const page=annotationPageGeometry(source);
  assert.throws(()=>normalizedPointToPdf(page,{x:NaN,y:0.5}),{code:'annotation_geometry_invalid'});
  assert.throws(()=>normalizedRectToPdf(page,{x:0.9,y:0.2,width:0.2,height:0.1}),{code:'annotation_geometry_invalid'});
  assert.throws(()=>normalizedInkToPdf(page,{width:0.01,points:[]}),{code:'annotation_geometry_invalid'});
  assert.throws(()=>planAnnotationPdfGeometry({pages:[source],paperId:'a',annotations:[{id:'x',paperId:'b',kind:'note',page:1}]}),{code:'annotation_paper_mismatch'});
  assert.throws(()=>planAnnotationPdfGeometry({pages:[source],annotations:[{id:'x',kind:'note',page:2}]}),{code:'annotation_page_invalid'});
  assert.throws(()=>planAnnotationPdfGeometry({pages:[source,source],annotations:[{id:'x',kind:'note',segments:[{page:2},{page:1}]}]}),{code:'annotation_page_invalid'});
});

test('a legacy ink dot stays at the exact original point with a round-cap segment', () => {
  const result=normalizedInkToPdf(annotationPageGeometry(source),{width:0.01,points:[{x:0.3,y:0.4}]});
  close(result.inkList,[190,490,190,490]);
  assert.deepEqual(result.appearance.points,[{x:0.3,y:0.4},{x:0.3,y:0.4}]);
  assert.ok(result.rect[2]>result.rect[0]&&result.rect[3]>result.rect[1]);
});

test('saved API edge tolerance is clamped to the visible page without accepting larger excursions or empty areas', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const geometry = annotationPageGeometry({ ...source, rotation });
    const tolerant = normalizedRectToPdf(geometry, { x: .9, y: .96, width: .1000005, height: .0400005 });
    const exact = normalizedRectToPdf(geometry, { x: .9, y: .96, width: .1, height: .04 });
    assert.deepEqual(tolerant, exact);
    assert.throws(() => normalizedRectToPdf(geometry, { x: .9, y: .2, width: .100002, height: .04 }), { code: 'annotation_geometry_invalid' });
    assert.throws(() => normalizedRectToPdf(geometry, { x: 1, y: .2, width: .0000005, height: .04 }), { code: 'annotation_geometry_invalid' });
  }
});
