import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const scope={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/activity-result.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
const {matchingActivityAnnotation}=scope.exports;
const activity={kind:'translation',page:2,quote:'Source sentence',result:{text:'译文'},language:'zh-CN'};
const note={id:'autosaved',kind:'translation',page:2,quote:'Source sentence',body:'译文',language:'zh-CN',rects:[{x:.1,y:.2,width:.3,height:.04}]};
test('history recognizes an autosaved result while preserving its original geometry',()=>{
 const before=JSON.stringify(note);assert.equal(matchingActivityAnnotation(activity,[note]),true);assert.equal(JSON.stringify(note),before);
 assert.equal(matchingActivityAnnotation({...activity,result:'译文'},[note]),true);
});
test('history does not conflate different source pages, quotes, result languages, kinds or bodies',()=>{
 for(const patch of [{page:3},{quote:'Other source'},{language:'en'},{kind:'explanation'},{body:'另一份译文'},{segments:[{},{}]}])assert.equal(matchingActivityAnnotation(activity,[{...note,...patch}]),false);
 for(const patch of [{pages:[2,3]},{sourceScope:'reading'},{page:undefined},{result:null}])assert.equal(matchingActivityAnnotation({...activity,...patch},[note]),false);
 assert.equal(matchingActivityAnnotation(activity,[]),false);
});
