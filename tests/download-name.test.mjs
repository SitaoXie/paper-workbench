import test from 'node:test';
import assert from 'node:assert/strict';
import {annotatedPdfFilename,annotatedPdfDisposition} from '../server/download-name.mjs';
test('annotated downloads retain recognizable Chinese and English titles without header or path syntax',()=>{
 assert.equal(annotatedPdfFilename('Deep Residual Learning'),'Deep Residual Learning-annotated.pdf');assert.equal(annotatedPdfFilename('中文论文：比较 A/B'),'中文论文：比较 A B-annotated.pdf');
 const disposition=annotatedPdfDisposition('A "quoted" title\r\nX-Fake: header');assert.ok(!/[\r\n]/.test(disposition));assert.equal(decodeURIComponent(disposition.split("UTF-8''")[1]),'A quoted title X-Fake header-annotated.pdf');
 for(const title of ['',null,'CON','LPT1.pdf'])assert.equal(annotatedPdfFilename(title),'paper-annotated.pdf');
 const name=annotatedPdfFilename('🧪'.repeat(140));assert.equal(Array.from(name.replace('-annotated.pdf','')).length,50);assert.ok(Buffer.byteLength(name,'utf8')<255);assert.ok(Buffer.byteLength(annotatedPdfFilename('研究'.repeat(140)),'utf8')<255);assert.doesNotThrow(()=>annotatedPdfDisposition('🧪'.repeat(140)));
 assert.doesNotThrow(()=>annotatedPdfDisposition('Broken \ud800 title'));assert.equal(annotatedPdfFilename('Broken \ud800 title'),'Broken � title-annotated.pdf');
});
