import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {selectRecords} from '../integration/data-collection.mjs';

const record=(id,text,extra={})=>({id,text,source:`s-${id}`,offset:0,...extra});
const answer=(choice='KEEP',confidence=0.99)=>({choice,confidence});
const all=(questions,choice='KEEP',confidence=0.99)=>Object.fromEntries(Object.keys(questions).map(id=>[id,answer(choice,confidence)]));
async function fixture(t,extra={}) {
  const cacheDir=await mkdtemp(path.join(os.tmpdir(),'jev-data-collection-'));
  t.after(()=>rm(cacheDir,{recursive:true,force:true}));
  return {active:true,cacheDir,question:'Keep records about teaching.',now:()=>1000000,...extra};
}

test('deduplicates exact text and retains additional metadata and aliases',async t=>{
  const options=await fixture(t),calls=[];
  const input=[record('a','Teaching',{offset:7,record_index:1,aliases:[{id:'legacy',source:'old',offset:1}]}),record('b','Teaching',{offset:90,record_index:8}),record('c','Other')];
  const result=await selectRecords(input,{...options,decide:async(state,questions)=>{calls.push(state);return Object.fromEntries(Object.keys(questions).map((id,index)=>[id,answer(index?'DROP':'KEEP')]));}});
  assert.equal(result.records.length,2);assert.equal(result.stats.exact_duplicates,1);assert.equal(calls[0].records.length,2);
  const first=result.records[0];assert.equal(first.record_index,1);assert.equal(first.aliases.find(value=>value.id==='b').record_index,8);assert.equal(first.aliases[0].id,'legacy');
  assert.deepEqual(first.provenance.map(value=>value.id),['a','b']);assert.equal(result.records[1].decision,'DROP');assert.ok(!Object.hasOwn(result.records[1],'text'));
  assert.equal(result.stats.selected_bytes,Buffer.byteLength('Teaching'));assert.equal(result.stats.input_bytes,Buffer.byteLength('TeachingTeachingOther'));
});

test('batches at twelve and obeys serialized state bound',async t=>{
  const options=await fixture(t),requests=[];
  const inputs=Array.from({length:25},(_,index)=>record(`r${index}`,`${index}:`+'\u0001'.repeat(1490)));
  const result=await selectRecords(inputs,{...options,decide:async(state,questions)=>{requests.push({state,questions});return all(questions);}});
  assert.equal(result.stats.kept,25);assert.ok(requests.length>3);
  for(const {state,questions} of requests){assert.ok(state.records.length<=12);assert.ok(Buffer.byteLength(JSON.stringify(state))<=20*1024);assert.deepEqual(Object.keys(questions),state.records.map(value=>value.id));assert.equal(state.rules.split('untrusted data').length-1,1);for(const value of state.records){assert.ok(questions[value.id].instructions.includes(JSON.stringify(value.id)));assert.ok(questions[value.id].instructions.includes('state.rules'));assert.ok(!questions[value.id].instructions.includes('untrusted'));assert.ok(questions[value.id].instructions.length<100);}}
  const ordinary=await selectRecords(Array.from({length:25},(_,index)=>record(`a${index}`,`Teaching ${index}`)),{...options,decide:async(_state,questions)=>all(questions)});
  assert.equal(ordinary.stats.jev_requests,3);
});

test('confident cache is private, contains only hashes and decisions, and avoids calls',async t=>{
  const options=await fixture(t),input=[record('private-id','PRIVATE_TEXT_MARKER',{source:'PRIVATE_SOURCE_MARKER'})];let calls=0;
  const decide=async(_state,questions)=>{calls++;return all(questions);};
  await selectRecords(input,{...options,decide});const hit=await selectRecords(input,{...options,decide});
  assert.equal(calls,1);assert.equal(hit.stats.cache_hits,1);assert.equal(hit.stats.cached_records,1);assert.equal(hit.stats.jev_requests,0);
  const files=await readdir(options.cacheDir);assert.equal(files.length,1);const filename=path.join(options.cacheDir,files[0]),raw=await readFile(filename,'utf8');
  for(const marker of ['PRIVATE_TEXT_MARKER','PRIVATE_SOURCE_MARKER','private-id',options.question])assert.ok(!raw.includes(marker));
  assert.equal((await stat(options.cacheDir)).mode&0o777,0o700);assert.equal((await stat(filename)).mode&0o777,0o600);
});

test('cache invalidates on question, ids, text, mode, kind, provenance and expiry',async t=>{
  const options=await fixture(t),input=[record('a','Contact a@example.test; visit https://example.test')];let calls=0;
  const decide=async(_state,questions)=>{calls++;return Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,answer(Object.hasOwn(q.criteria,'KEEP')?'KEEP':'c0')]));};
  await selectRecords(input,{...options,decide});
  for(const change of [{question:'Keep all.'},{kind:'date'},{mode:'extract'},{now:()=>1000000+24*60*60*1000}])await selectRecords(input,{...options,...change,decide});
  for(const changed of [record('b',input[0].text),record('a',input[0].text+' changed'),{...input[0],offset:5}])await selectRecords([changed],{...options,decide});
  assert.equal(calls,8);
});

test('cache corruption, schema/model change and nonconfident cached values cause fresh decisions',async t=>{
  const options=await fixture(t),input=[record('a','Teaching')];let calls=0;
  const decide=async(_state,questions)=>{calls++;return all(questions);};
  await selectRecords(input,{...options,decide});const filename=path.join(options.cacheDir,(await readdir(options.cacheDir))[0]);
  const valid=JSON.parse(await readFile(filename,'utf8'));
  assert.equal(valid.schema,'data-collection-v2');
  for(const malformed of ['not json',JSON.stringify({...valid,schema:'data-collection-v1'}),JSON.stringify({...valid,model:'other'}),JSON.stringify({...valid,answers:[{...valid.answers[0],confidence:0.3}]}),JSON.stringify({...valid,answers:[{...valid.answers[0],choice:'UNKNOWN'}]})]){
    await writeFile(filename,malformed);const result=await selectRecords(input,{...options,decide});assert.equal(result.stats.cache_hits,0);
  }
  assert.equal(calls,6);
});

test('disabled operation preserves UNKNOWN and makes zero calls, including with an existing cache',async t=>{
  const options=await fixture(t),input=[record('a','Teaching')];let calls=0;
  const decide=async(_state,questions)=>{calls++;return all(questions);};await selectRecords(input,{...options,decide});
  const result=await selectRecords(input,{...options,active:false,decide});assert.equal(calls,1);assert.equal(result.records[0].decision,'UNKNOWN');assert.equal(result.stats.jev_requests,0);assert.equal(result.stats.cache_hits,0);assert.equal(result.stats.selected_bytes,Buffer.byteLength('Teaching'));
});

test('secrets are withheld before outbound and secret questions are rejected',async t=>{
  const options=await fixture(t),privateHeader='-----BEGIN '+'PRIVATE KEY-----';
  const secrets=[`${privateHeader}\nnot-a-real-key`,'Authorization: Bearer fake-value','api_key = synthetic-value','AWS_SECRET_ACCESS_KEY: synthetic-value','https://user:password@example.test/','https://opaque@example.test/'];
  const input=[...secrets.map((text,index)=>record(`secret${index}`,text)),record('good','Teaching')],seen=[];
  const result=await selectRecords(input,{...options,decide:async(state,questions)=>{seen.push(state);return all(questions);}});
  assert.equal(result.stats.withheld,secrets.length);assert.equal(result.stats.unknown,secrets.length);assert.equal(result.stats.kept,1);
  const sent=JSON.stringify(seen);for(const text of secrets)assert.ok(!sent.includes(text));assert.deepEqual(seen[0].records.map(value=>value.text),['Teaching']);
  await assert.rejects(selectRecords(input,{...options,question:'password = synthetic-value',decide:()=>assert.fail('must not call')}),/INVALID_QUESTION/);
});

test('low, invalid, null and thrown decisions stay UNKNOWN and are never cached',async t=>{
  const options=await fixture(t),input=[record('a','Teaching')];
  for(const decide of [async(_s,q)=>all(q,'KEEP',0.89),async(_s,q)=>all(q,'INVALID'),async()=>null,async()=>{throw Error('unavailable');},async(_s,q)=>all(q,'UNKNOWN'),async(_s,q)=>all(q,'KEEP',1.1)]) {
    const result=await selectRecords(input,{...options,decide});assert.equal(result.records[0].decision,'UNKNOWN');assert.equal(result.stats.selected_bytes,Buffer.byteLength('Teaching'));assert.equal((await readdir(options.cacheDir)).length,0);
  }
});

test('a private-key block split across a source withholds its body chunks too',async t=>{
  const options=await fixture(t),source='split-source';
  const input=[record('header','-----BEGIN '+'PRIVATE KEY-----',{source}),record('body','synthetic-base64-body',{source,offset:28}),record('footer','-----END '+'PRIVATE KEY-----',{source,offset:60})];
  const result=await selectRecords(input,{...options,decide:()=>assert.fail('private source must not leave the process')});
  assert.equal(result.stats.withheld,3);assert.equal(result.stats.unknown,3);assert.equal(result.stats.jev_requests,0);
});

test('one uncertain answer reasks only that id while preserving full context and eleven cached decisions',async t=>{
  const options=await fixture(t),input=Array.from({length:12},(_,index)=>record(`a${index}`,`Teaching ${index}`)),requests=[];
  const uncertain=async(state,questions)=>{requests.push({state,questions});return Object.fromEntries(Object.keys(questions).map(id=>[id,answer(id==='r11'?'UNKNOWN':'KEEP')]));};
  const first=await selectRecords(input,{...options,decide:uncertain});
  assert.equal(first.stats.kept,11);assert.equal(first.stats.unknown,1);assert.equal(first.stats.cached_records,0);
  const filename=path.join(options.cacheDir,(await readdir(options.cacheDir))[0]),partial=JSON.parse(await readFile(filename,'utf8'));
  assert.equal(partial.answers.length,11);assert.ok(partial.answers.every(value=>value.choice==='KEEP'));
  const second=await selectRecords(input,{...options,decide:uncertain});
  assert.equal(second.stats.cache_hits,1);assert.equal(second.stats.cached_records,11);assert.equal(second.stats.jev_requests,1);assert.equal(second.records[11].decision,'UNKNOWN');
  assert.deepEqual(Object.keys(requests[1].questions),['r11']);assert.deepEqual(requests[1].state,requests[0].state);assert.equal(requests[1].state.records.length,12);assert.ok(second.stats.outbound_bytes<first.stats.outbound_bytes);
  const third=await selectRecords(input,{...options,decide:async(state,questions)=>{assert.deepEqual(state,requests[0].state);assert.deepEqual(Object.keys(questions),['r11']);return all(questions);}});
  assert.equal(third.stats.kept,12);assert.equal(third.stats.cached_records,11);assert.equal(JSON.parse(await readFile(filename,'utf8')).answers.length,12);
  const fourth=await selectRecords(input,{...options,decide:()=>assert.fail('fully cached group')});assert.equal(fourth.stats.jev_requests,0);assert.equal(fourth.stats.cache_hits,1);assert.equal(fourth.stats.cached_records,12);
});

test('partial cache rejects invalid ids and duplicate entries instead of trusting any subset',async t=>{
  const options=await fixture(t),input=[record('a','Teaching a'),record('b','Teaching b')];
  const partial=async(_state,questions)=>Object.fromEntries(Object.keys(questions).map(id=>[id,answer(id==='r0'?'KEEP':'UNKNOWN')]));
  await selectRecords(input,{...options,decide:partial});const filename=path.join(options.cacheDir,(await readdir(options.cacheDir))[0]),valid=JSON.parse(await readFile(filename,'utf8'));
  for(const entries of [[{...valid.answers[0],id_hash:'f'.repeat(64)}],[valid.answers[0],valid.answers[0]],[{...valid.answers[0],choice:'UNKNOWN'}]]) {
    await writeFile(filename,JSON.stringify({...valid,answers:entries}));
    const result=await selectRecords(input,{...options,decide:async(_state,questions)=>{assert.equal(Object.keys(questions).length,2);return partial(_state,questions);}});
    assert.equal(result.stats.cache_hits,0);assert.equal(result.stats.cached_records,0);assert.equal(result.stats.jev_requests,1);
  }
});

test('partial cache binds the whole group and merging does not extend old decisions past TTL',async t=>{
  const options=await fixture(t),input=[record('a','Teaching a'),record('b','Teaching b')];
  const decide=async(_state,questions)=>Object.fromEntries(Object.keys(questions).map(id=>[id,answer(id==='r0'?'KEEP':'UNKNOWN')]));
  await selectRecords(input,{...options,decide});
  const filename=path.join(options.cacheDir,(await readdir(options.cacheDir))[0]),initial=JSON.parse(await readFile(filename,'utf8'));
  await selectRecords(input,{...options,now:()=>2000000,decide:async(_state,questions)=>{assert.deepEqual(Object.keys(questions),['r1']);return all(questions);}});
  const merged=JSON.parse(await readFile(filename,'utf8'));assert.equal(merged.created_at,initial.created_at);assert.equal(merged.expires_at,initial.expires_at);assert.equal(merged.answers.length,2);
  const expired=await selectRecords(input,{...options,now:()=>initial.expires_at,decide:async(_state,questions)=>{assert.equal(Object.keys(questions).length,2);return all(questions);}});assert.equal(expired.stats.cache_hits,0);
  const changed=await selectRecords([input[0],{...input[1],text:'Changed formerly unknown text'}],{...options,decide:async(_state,questions)=>{assert.equal(Object.keys(questions).length,2);return all(questions);}});assert.equal(changed.stats.cache_hits,0);
});

test('extracts exact candidate text and UTF-16 spans for every built-in kind',async t=>{
  const options=await fixture(t,{mode:'extract',question:'Select the listed value.'});
  for(const [kind,value] of [['email','a@example.test'],['url','https://example.test/a?q=1'],['amount','₩1,200'],['date','2026-09-19']]) {
    const text=`😀 값 ${value} end`,start=text.indexOf(value),input=[record('a',text,{offset:100}),record('b',text,{offset:900,record_index:3})];
    const result=await selectRecords(input,{...options,kind,decide:async(_state,questions)=>all(questions,'c0')});
    const extracted=result.records[0].extraction;assert.equal(result.records[0].decision,'EXTRACT');assert.equal(extracted.value,value);assert.equal(text.slice(extracted.span.start,extracted.span.end),value);assert.equal(extracted.span.start,start);assert.equal(extracted.offset,100+start);assert.equal(extracted.provenance[1].offset,900+start);assert.equal(extracted.provenance[1].record_index,3);assert.ok(!Object.hasOwn(result.records[0],'text'));
  }
});

test('extract invalid candidate, low confidence and unavailable results never invent values',async t=>{
  const options=await fixture(t,{mode:'extract',kind:'email'}),input=[record('a','a@example.test b@example.test')];
  for(const decide of [async(_state,questions)=>all(questions,'c99'),async(_state,questions)=>all(questions,'c1',0.8),async()=>null]) {
    const result=await selectRecords(input,{...options,decide});assert.equal(result.records[0].decision,'UNKNOWN');assert.equal(result.records[0].extraction,null);assert.equal((await readdir(options.cacheDir)).length,0);
  }
});

test('extract selects among candidates or NONE without generating values',async t=>{
  const options=await fixture(t,{mode:'extract',kind:'email'}),input=[record('a','a@example.test b@example.test')];
  const selected=await selectRecords(input,{...options,decide:async(_state,questions)=>all(questions,'c1')});assert.equal(selected.records[0].extraction.value,'b@example.test');
  const none=await selectRecords(input,{...options,question:'Find a third address.',decide:async(_state,questions)=>all(questions,'NONE')});assert.equal(none.records[0].decision,'NONE');assert.equal(none.records[0].extraction,null);assert.equal(none.stats.dropped,1);
  const absent=await selectRecords([record('b','No address here')],{...options,decide:()=>assert.fail('no regex candidates')});assert.equal(absent.records[0].decision,'NONE');assert.equal(absent.stats.jev_requests,0);
});

test('candidate overflow is UNKNOWN without calling Jev',async t=>{
  const options=await fixture(t,{mode:'extract',kind:'email'}),text=Array.from({length:25},(_,index)=>`a${index}@example.test`).join(' ');
  const result=await selectRecords([record('a',text)],{...options,decide:()=>assert.fail('candidate cap')});assert.equal(result.records[0].decision,'UNKNOWN');assert.equal(result.stats.candidate_limit,1);assert.equal(result.stats.jev_requests,0);
});

test('input count, byte bounds, offsets, unique ids, mode and question are enforced',async t=>{
  const options=await fixture(t),decide=()=>assert.fail('invalid input');
  for(const inputs of [Array.from({length:97},(_,index)=>record(String(index),'a')),[record('a','가'.repeat(501))],[record('a','x',{offset:-1})],[record('a','x'),record('a','y')]])await assert.rejects(selectRecords(inputs,{...options,decide}),/INVALID_RECORD/);
  for(const override of [{question:'x'.repeat(513)},{question:''},{mode:'other'},{kind:'other'},{now:()=>NaN}])await assert.rejects(selectRecords([record('a','x')],{...options,...override,decide}),/INVALID_/);
  const empty=await selectRecords([],{...options,decide});assert.equal(empty.records.length,0);assert.equal(empty.stats.jev_requests,0);
});
