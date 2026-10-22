import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('../src/figure-drafts.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function store(blocked=false){const values=new Map();const context={exports:{},sessionStorage:{getItem:key=>values.get(key),setItem:(key,value)=>{if(blocked)throw Error('quota');values.set(key,value);}}};vm.runInNewContext(code,context);return context.exports;}
const draft=(extra={})=>({key:'manual-1',page:1,caption:'Submitted caption',label:'Figure 1',crop:{x:.1,y:.1,width:.5,height:.4},method:'manual',reviewed:true,dirty:true,baseFiguresRevision:'r0',...extra});
const completed=extra=>draft({key:'figure-f1',figureId:'f1',dirty:false,reviewed:false,baseFiguresRevision:'r1',...extra});

test('late save keeps newer caption and crop, adopts the saved identity, and preserves another selected draft',()=>{
 const s=store(),submitted=draft(),newer=draft({caption:'Newer caption',crop:{x:.2,y:.2,width:.4,height:.3}}),other=draft({key:'manual-other',caption:'Independent draft'});
 s.saveFigureDrafts('paper','pdf',{selected:other.key,drafts:{[newer.key]:newer,[other.key]:other}});
 s.completeFigureDraftSave('paper','pdf',submitted,completed());
 const current=s.readFigureDrafts('paper','pdf',false);
 assert.equal(current.selected,other.key);assert.equal(current.drafts[other.key].caption,other.caption);assert.equal(current.drafts[other.key].reviewed,true);
 assert.equal(current.drafts['manual-1'],undefined);const saved=current.drafts['figure-f1'];assert.equal(saved.caption,newer.caption);assert.equal(saved.crop.x,.2);assert.equal(saved.figureId,'f1');assert.equal(saved.baseFiguresRevision,'r1');assert.equal(saved.dirty,true);assert.equal(saved.reviewed,false);
});

test('a completion cleans only an unchanged submitted draft and never resurrects a removed draft',()=>{
 const s=store(),submitted=draft();s.saveFigureDrafts('paper','pdf',{selected:submitted.key,drafts:{[submitted.key]:submitted}});
 s.completeFigureDraftSave('paper','pdf',submitted,completed());const current=s.readFigureDrafts('paper','pdf');assert.equal(current.selected,'figure-f1');assert.equal(current.drafts['figure-f1'].dirty,false);
 s.saveFigureDrafts('paper','pdf',{drafts:{}});s.completeFigureDraftSave('paper','pdf',submitted,completed());assert.equal(Object.keys(s.readFigureDrafts('paper','pdf').drafts).length,0);
});

test('older completions cannot overwrite a newer acknowledged revision or another saved identity',()=>{
 const s=store(),submitted=draft({key:'figure-f1',figureId:'f1'}),newer=draft({key:'figure-f1',figureId:'f1',caption:'Saved later',baseFiguresRevision:'r2'});
 const state={selected:newer.key,drafts:{[newer.key]:newer}};assert.equal(s.reconcileFigureDraftSave(state,submitted,completed()),state);
 const collision={selected:'manual-1',drafts:{'manual-1':draft(),'figure-f1':newer}};assert.equal(s.reconcileFigureDraftSave(collision,draft(),completed()),collision);
});

test('a reopened editor receives a completion across the subscription gap without repeating it on later edits',()=>{
 const s=store(),submitted=draft();let visible={selected:submitted.key,drafts:{[submitted.key]:draft({caption:'Edit after reopen'})}};
 s.saveFigureDrafts('paper','pdf',visible);s.completeFigureDraftSave('paper','pdf',submitted,completed());
 const unsubscribe=s.subscribeFigureDraftSaves('paper','pdf',event=>{visible=s.reconcileFigureDraftSave(visible,event.submitted,event.saved);});
 assert.equal(visible.selected,'figure-f1');assert.equal(visible.drafts['figure-f1'].caption,'Edit after reopen');
 visible.drafts['figure-f1'].caption='Next edit';s.completeFigureDraftSave('paper','pdf',submitted,completed());assert.equal(visible.drafts['figure-f1'].caption,'Next edit');unsubscribe();
});

test('blocked tab storage still reconciles pending saves and isolates papers and PDF revisions',()=>{
 const s=store(true),submitted=draft();for(const [paper,pdf] of [['paper','pdf'],['other','pdf'],['paper','replacement']])s.saveFigureDrafts(paper,pdf,{selected:submitted.key,drafts:{[submitted.key]:draft({caption:`${paper}/${pdf}`})}});
 s.completeFigureDraftSave('paper','pdf',submitted,completed());assert.equal(s.readFigureDrafts('paper','pdf').drafts['figure-f1'].caption,'paper/pdf');assert.equal(s.readFigureDrafts('other','pdf').drafts['manual-1'].caption,'other/pdf');assert.equal(s.readFigureDrafts('paper','replacement').drafts['manual-1'].caption,'paper/replacement');
});

test('an in-flight save is shared across editors and releases on either success or failure',()=>{
 const s=store();let updates=0;const stop=s.subscribeFigureDraftActivity('paper','pdf',()=>updates++),finish=s.beginFigureDraftSave('paper','pdf','manual-1');assert.equal(s.isFigureDraftSaving('paper','pdf','manual-1'),true);assert.equal(s.beginFigureDraftSave('paper','pdf','manual-1'),undefined);assert.equal(s.isFigureDraftSaving('other','pdf','manual-1'),false);assert.equal(s.isFigureDraftSaving('paper','replacement','manual-1'),false);assert.equal(updates,2);finish();assert.equal(s.isFigureDraftSaving('paper','pdf','manual-1'),false);assert.equal(updates,3);const retry=s.beginFigureDraftSave('paper','pdf','manual-1');assert.equal(typeof retry,'function');retry();stop();
});
