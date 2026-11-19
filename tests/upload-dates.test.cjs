const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function store(){
 const exports={};
 const code=ts.transpileModule(fs.readFileSync('src/lib/uploadDates.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,Date,Intl,Map,Set});return exports;
}
const response=(headers)=>({headers:new Headers(headers)});
test('uses upload headers, latest relevant file and Brisbane date',()=>{
 const s=store();let changes=0;const stop=s.subscribeUploadDates(()=>changes++);
 s.recordUploadDate('team',response({'last-modified':'2026-11-19T16:00:00Z'}));
 s.recordUploadDate('career',response({'x-file-last-modified':'2026-11-21T01:00:00Z'}));
 assert.equal(s.formatUploadDate(s.latestUploadDate(['team'])),'20 Nov 2026');
 assert.equal(s.formatUploadDate(s.latestUploadDate(['team','career'])),'21 Nov 2026');
 assert.equal(changes,2);stop();
 s.recordUploadDate('team',response({}));assert.equal(changes,2);
 assert.equal(s.latestUploadDate(['team']),null);
 assert.equal(s.formatUploadDate(null),'Unavailable');
});
test('missing/invalid metadata never becomes the current date',()=>{
 const s=store();s.recordUploadDate('file',response({'last-modified':'not a date'}));
 assert.equal(s.latestUploadDate(['file']),null);
 assert.equal(s.latestUploadDate(['unloaded']),null);
});
