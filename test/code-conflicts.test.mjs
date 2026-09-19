import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {indexContradictions} from '../integration/code-conflicts.mjs';
import {saveIndex,readIndex} from '../integration/conflict-artifacts.mjs';

async function fixture(t,count=2) {
  const root=await mkdtemp(path.join(os.tmpdir(),'jev-conflicts-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const files=Array.from({length:count},(_,i)=>`policy-${i}.mjs`);
  for(let i=0;i<count;i++)await writeFile(path.join(root,files[i]),`export const LIMIT = ${i+1};\n`);
  return {root,files,spec:{root,question:'Do both rules require incompatible limits in the same operation?',groups:[{id:'limit',symbol:'LIMIT',files,context:'Caller asks to compare the same operation; reachability still requires source evidence.'}]},options:{active:true,cacheDir:path.join(root,'cache')}};
}
const answers=(questions,choice='CONTRADICTION',confidence=0.95)=>Object.fromEntries(Object.keys(questions).map(id=>[id,{choice,confidence}]));

test('disabled feature never reads source or requests a decision',async()=>{
  const result=await indexContradictions(null,{active:false,decide:()=>assert.fail('network')});
  assert.equal(result.status,'DISABLED');assert.equal(result.stats.jev_requests,0);
});
test('finite judgments retain exact located evidence and are review candidates, not proof',async t=>{
  const {root,spec,options}=await fixture(t);let payload;
  const result=await indexContradictions(spec,{...options,decide:async(state,questions)=>{payload=state;assert.ok(Object.values(questions)[0].instructions.includes('SAME reachable'));return answers(questions);}});
  assert.equal(result.findings[0].status,'CONTRADICTION');assert.equal(result.scope.proof,false);assert.equal(result.scope.complete,false);
  assert.equal(result.spans[0].start_line,1);assert.match(result.spans[0].text,/LIMIT/);
  assert.equal(JSON.stringify(payload).includes(root),false);
  const again=await indexContradictions(spec,{...options,decide:()=>assert.fail('cached decision must not call API')});
  assert.equal(again.stats.cache_hits,1);assert.equal(again.findings[0].source,'cache');
});
test('low confidence and explicit UNKNOWN preserve model provenance without invented conclusions',async t=>{
  for(const [choice,confidence] of [['CONTRADICTION',0.4],['UNKNOWN',0.99]]) {
    const {spec,options}=await fixture(t);
    const result=await indexContradictions(spec,{...options,decide:async(_,q)=>answers(q,choice,confidence)});
    assert.equal(result.findings[0].status,'UNKNOWN');assert.equal(result.findings[0].model_choice,choice);assert.equal(result.findings[0].confidence,confidence);assert.equal(result.findings[0].source,'jev');
    const cached=await indexContradictions(spec,{...options,decide:()=>assert.fail('uncertainty cache')});
    assert.equal(cached.findings[0].status,'UNKNOWN');assert.equal(cached.stats.jev_requests,0);
  }
});
test('invalid, missing and rejected service responses retain UNKNOWN',async t=>{
  for(const decide of [async()=>null,async()=>{throw Error('synthetic');},async(_,q)=>answers(q,'FIX_NOW',1),async(_,q)=>answers(q,'COMPATIBLE',Infinity)]) {
    const {spec,options}=await fixture(t);
    const result=await indexContradictions(spec,{...options,decide});
    assert.equal(result.findings[0].status,'UNKNOWN');assert.equal(result.findings[0].source,'unavailable');assert.equal(result.findings[0].confidence,null);
  }
});
test('full-file changes outside excerpt invalidate cached judgments',async t=>{
  const {root,files,spec,options}=await fixture(t);let calls=0;
  const decide=async(_,q)=>{calls++;return answers(q,'COMPATIBLE');};
  await writeFile(path.join(root,files[0]),'export const LIMIT = 1;\n'+'\n'.repeat(20)+'// first enclosing context\n');
  const before=await indexContradictions(spec,{...options,decide});
  await writeFile(path.join(root,files[0]),'export const LIMIT = 1;\n'+'\n'.repeat(20)+'// changed enclosing context\n');
  const after=await indexContradictions(spec,{...options,decide});
  assert.equal(before.spans[0].text,after.spans[0].text);assert.equal(calls,2);assert.equal(after.stats.cache_hits,0);
});
test('bounded request budget retains unclassified pairs rather than dropping them',async t=>{
  const {spec,options}=await fixture(t,6);
  const result=await indexContradictions({...spec,max_requests:1,max_pairs:12},{...options,decide:async(_,q)=>answers(q,'COMPATIBLE')});
  assert.equal(result.stats.jev_requests,1);assert.equal(result.pairs.length,12);assert.equal(result.findings.length,12);
  assert.equal(result.findings.filter(f=>f.reason==='request_budget_exhausted').length,8);
});
test('source changes while awaiting Jev downgrade current findings to UNKNOWN',async t=>{
  const {root,files,spec,options}=await fixture(t);
  const result=await indexContradictions(spec,{...options,decide:async(_,q)=>{await writeFile(path.join(root,files[1]),'export const LIMIT = 9;\n');return answers(q);}});
  assert.equal(result.findings[0].status,'UNKNOWN');assert.equal(result.findings[0].stale,true);
});
test('private index pages preserve provenance and detect source staleness and tampering',async t=>{
  const {root,files,spec,options}=await fixture(t,4);
  const result=await indexContradictions(spec,{...options,decide:async(_,q)=>answers(q,'COMPATIBLE')});
  const manifest=await saveIndex(result,{directory:path.join(root,'indexes')});
  assert.equal((await stat(manifest)).mode&0o077,0);
  let cursor=0,seen=[];
  do {const page=await readIndex(manifest,cursor);assert.ok(Buffer.byteLength(JSON.stringify(page))<=4000);seen.push(...page.items.map(i=>i.id));cursor=page.next_cursor;}while(cursor!==null);
  assert.deepEqual(seen,result.pairs.map(p=>p.id));
  await writeFile(path.join(root,files[0]),'export const LIMIT = 30;\n');
  const stale=await readIndex(manifest,0);assert.equal(stale.status,'STALE');assert.equal(stale.items[0].status,'UNKNOWN');assert.equal(stale.items[0].previous_status,'COMPATIBLE');
  const artifact=path.join(path.dirname(manifest),'index.json');
  await writeFile(artifact,(await readFile(artifact,'utf8'))+' ');
  await assert.rejects(readIndex(manifest,0),/artifact_integrity_failed/);
});
