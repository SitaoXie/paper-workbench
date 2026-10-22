import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../src/paper-bibliography.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {paperBibtex,paperCitationKey,escapeBibtexText,arxivReference,bibliographySourceUrl,publicationDay,formatPublicationDate,formatActivityDate,paperDisplayDate}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const resnet={title:'Deep Residual Learning for Image Recognition',authors:['Kaiming He','Xiangyu Zhang','Shaoqing Ren','Jian Sun'],publishedAt:'2015-12-10T19:51:55Z',createdAt:'2026-10-22T20:00:00Z',url:'https://arxiv.org/abs/1512.03385'};

test('arXiv references have meaningful reimport-stable keys and a version-specific public source',()=>{
  const paper={...resnet,url:'https://arxiv.org/pdf/1512.03385v2.pdf?download=1#page=7'};
  assert.equal(paperCitationKey(paper),'he2015deep151203385v2');
  assert.equal(paperCitationKey({...paper,id:'different-local-uuid',createdAt:'2030-01-01T00:00:00Z'}),paperCitationKey(paper));
  const bib=paperBibtex(paper);
  assert.match(bib,/author = \{Kaiming He and Xiangyu Zhang and Shaoqing Ren and Jian Sun\}/);
  assert.match(bib,/year = \{2015\}/);assert.match(bib,/eprint = \{1512\.03385v2\}/);assert.match(bib,/archivePrefix = \{arXiv\}/);
  assert.match(bib,/url = \{https:\/\/arxiv\.org\/abs\/1512\.03385v2\}/);assert.doesNotMatch(bib,/journal|doi|primaryClass|download=|#page=|local-uuid/);
  assert.notEqual(paperCitationKey(paper),paperCitationKey(resnet));
});

test('legacy identifiers and public PDF fallbacks retain only supplied arXiv metadata',()=>{
  assert.deepEqual(arxivReference('http://export.arxiv.org/abs/hep-th/9901001v3'),{eprint:'hep-th/9901001v3',url:'https://arxiv.org/abs/hep-th/9901001v3'});
  assert.equal(arxivReference('https://arxiv.org.evil.example/abs/1512.03385'),undefined);
  assert.equal(arxivReference('https://arxiv.org/abs/1513.03385'),undefined);
  assert.equal(arxivReference('https://arxiv.org/abs/1512.03385v0'),undefined);
  const bib=paperBibtex({title:'Archived source',pdfUrl:'https://arxiv.org/pdf/hep-th/9901001v3.pdf',createdAt:'2026-01-01T00:00:00Z'});
  assert.match(bib,/eprint = \{hep-th\/9901001v3\}/);assert.doesNotMatch(bib,/year =|1999|2026/);
});

test('metadata punctuation and unbalanced TeX cannot escape a field or execute as a command',()=>{
  const title='A {brace / path} and } lone opener { # $ % & _ ^ ~ \\input{private} \\write18{run}\n@preamble{bad}';
  const bib=paperBibtex({title,authors:['Zoë Müller','王小明','Research and Development Group']});
  assert.match(bib,/Zoë Müller and 王小明 and \{Research and Development Group\}/);
  assert.ok(bib.includes('\\textbraceleft{}brace / path\\textbraceright{}'));
  for(const escaped of ['\\#','\\$','\\%','\\&','\\_','\\textasciicircum{}','\\textasciitilde{}','\\textbackslash{}input'])assert.ok(bib.includes(escaped),escaped);
  assert.doesNotMatch(bib,/\\input\{|\\write18\{|\n@preamble/);
  // BibTeX counts braces even when preceded by a slash. Every generated brace
  // is structural or from a balanced safe text macro, including malformed input.
  let depth=0;for(const char of bib){if(char==='{')depth++;if(char==='}')depth--;assert.ok(depth>=0);}assert.equal(depth,0);
  assert.equal(escapeBibtexText('x\u0000\n y'),'x y');
});

test('portable bibliography omits local locations, credentials and generic query URLs',()=>{
  const privateUrls=['/Users/person/private.pdf','file:///Users/person/private.pdf','http://localhost:4318/api/pdf/id','http://127.0.0.1/api/pdf/id','http://192.168.1.10/paper','http://[::1]/paper','https://workspace.internal/paper','https://user:password@papers.org/file.pdf','https://papers.org/file.pdf?token=SECRET','https://papers.org/file.pdf?unknownSignedParameter=SECRET','https://papers.org/token/SECRET/file.pdf'];
  for(const url of privateUrls){assert.equal(bibliographySourceUrl(url),undefined,url);const bib=paperBibtex({title:'A public title',authors:['Jane Doe'],url,pdfUrl:url,localPdfUrl:url,createdAt:'2026-10-22T00:00:00Z'});assert.doesNotMatch(bib,/url =|SECRET|\/Users\/|localhost|password|year =/);}
  assert.equal(bibliographySourceUrl('https://papers.org/a_public-file.pdf#token=SECRET'),'https://papers.org/a_public-file.pdf');
  assert.equal(bibliographySourceUrl('https://arxiv.org/abs/1706.03762v1?token=SECRET'),'https://arxiv.org/abs/1706.03762v1');
  assert.equal(bibliographySourceUrl('https://papers.org/{odd}.pdf'),'https://papers.org/%7Bodd%7D.pdf');
});

test('fallback keys use stable metadata without inventing publication years or facts',()=>{
  const paper={title:'A study of deterministic exports',authors:['Müller, Zoë'],url:'https://papers.org/study.pdf',createdAt:'2026-10-22T00:00:00Z'};
  assert.match(paperCitationKey(paper),/^mullerndstudy[0-9a-f]{8}$/);
  assert.equal(paperCitationKey(paper),paperCitationKey({...paper,id:'random-uuid',createdAt:'2030-01-01T00:00:00Z'}));
  assert.notEqual(paperCitationKey(paper),paperCitationKey({...paper,title:'A study of another result'}));
  assert.doesNotMatch(paperBibtex(paper),/year =|journal =|doi =|2026/);
});

test('publication UTC days differ from local import dates across UTC+8 midnight',()=>{
  assert.equal(publicationDay(resnet.publishedAt),'2015-12-10');
  assert.equal(formatPublicationDate(resnet.publishedAt,'en-US'),'Dec 10, 2015');
  assert.equal(formatActivityDate(resnet.publishedAt,'en-US','Asia/Shanghai'),'Dec 11, 2015');
  assert.equal(formatPublicationDate('2017-06-12T17:57:34Z','en-US'),'Jun 12, 2017');
  assert.equal(formatActivityDate('2017-06-12T17:57:34Z','en-US','Asia/Shanghai'),'Jun 13, 2017');
  assert.equal(paperDisplayDate(resnet,'en-US','Asia/Shanghai'),'Dec 10, 2015');
  assert.equal(paperDisplayDate({createdAt:resnet.createdAt},'en-US','Asia/Shanghai'),'Oct 23, 2026');
  assert.equal(publicationDay('2024-01-01T00:30:00+08:00'),'2023-12-31');
  assert.match(paperBibtex({...resnet,publishedAt:'2024-01-01T00:30:00+08:00'}),/year = \{2023\}/);
});

test('invalid or ambiguous source dates stay unknown instead of silently normalizing',()=>{
  for(const value of ['2024-02-30','2023-02-29','2024-01-01T24:00:00Z','2024-01-01T12:00:00','not a date',undefined])assert.equal(publicationDay(value),undefined,String(value));
  assert.equal(publicationDay('2024-02-29'),'2024-02-29');assert.equal(formatPublicationDate('invalid','en'),'');
  assert.equal(paperDisplayDate({publishedAt:'invalid',createdAt:resnet.createdAt},'en-US','Asia/Shanghai'),'Oct 23, 2026');
});
