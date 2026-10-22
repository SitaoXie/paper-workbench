import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationSourceState, annotationSourceFingerprint, prepareAnnotationSourceAcceptance } from '../server/annotation-source.mjs';

const hash = 'a'.repeat(64), other = 'b'.repeat(64);
const acceptedAt = '2026-01-02T03:04:05.000Z';
const request = { expectedPdfRevision: hash, acceptCurrentSource: true };

test('original and accepted-current bindings have distinct provenance and neither can hide changed bytes', () => {
  const legacy = { source: 'arxiv', filePath: 'source.pdf', pdfRevision: hash };
  assert.deepEqual(annotationSourceState(legacy, hash), { pdfRevision: hash, bindingStatus: 'unbound' });
  const snapshot = structuredClone(legacy);
  const binding = prepareAnnotationSourceAcceptance(legacy, request, hash, acceptedAt);
  assert.deepEqual(legacy, snapshot);
  legacy.annotationExportBinding = binding;
  assert.deepEqual(annotationSourceState(legacy, hash), { pdfRevision: hash, boundPdfRevision: hash, bindingStatus: 'user-accepted', annotationExportBinding: binding });
  assert.equal(annotationSourceState(legacy, other).bindingStatus, 'changed');
  const original = { ...legacy, sourcePdfRevision: other };
  assert.deepEqual(annotationSourceState(original, hash), { pdfRevision: hash, boundPdfRevision: other, bindingStatus: 'changed' }, 'A matching user acceptance cannot bypass an original fingerprint');
  assert.throws(() => prepareAnnotationSourceAcceptance(original, request, hash), error => error.status === 409 && error.code === 'pdf_source_changed');
  assert.throws(() => prepareAnnotationSourceAcceptance(legacy, request, hash), error => error.status === 409 && error.code === 'pdf_source_already_bound');
  assert.deepEqual(annotationSourceState({source:'pdf',contentHash:hash},hash), { pdfRevision: hash, boundPdfRevision: hash, bindingStatus: 'original' });
});

test('unusable stored binding metadata fails safely instead of silently creating a new acceptance', () => {
  for (const annotationExportBinding of [null, {}, {pdfRevision:hash,acceptedAt,method:'verified-original'}, {pdfRevision:hash,acceptedAt:'bad date',method:'user-accepted-current-pdf'}, {pdfRevision:'bad hash',acceptedAt,method:'user-accepted-current-pdf'}]) {
    assert.throws(() => annotationSourceState({source:'arxiv',annotationExportBinding},hash), error => error.status === 409 && error.code === 'pdf_source_binding_invalid');
  }
  assert.throws(() => annotationSourceState({sourcePdfRevision:'malformed'},hash), error => error.code === 'pdf_source_binding_invalid');
  assert.throws(() => prepareAnnotationSourceAcceptance({},request,other), error => error.code === 'pdf_source_changed');
});

test('concurrency fingerprint follows source identity and binding changes without treating note edits as source acceptance', () => {
  const paper = {source:'arxiv',filePath:'one.pdf',pdfRevision:hash};
  const before=annotationSourceFingerprint(paper);
  assert.equal(annotationSourceFingerprint({...paper,title:'Updated title',pdfRevision:other}),before);
  for (const change of [{filePath:'two.pdf'}, {sourcePdfRevision:hash}, {annotationExportBinding:{pdfRevision:hash,acceptedAt,method:'user-accepted-current-pdf'}}])
    assert.notEqual(annotationSourceFingerprint({...paper,...change}),before);
});
