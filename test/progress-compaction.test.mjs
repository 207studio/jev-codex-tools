import test from 'node:test';
import assert from 'node:assert/strict';
import {selectProgress} from '../integration/progress-compaction.mjs';

const progress=Array.from({length:600},(_,index)=>`INFO progress ${index}`).join('\n');
const successful={choice:'PRUNE',confidence:0.95};
const retainedLines=raw=>raw.split('\n');
const repeatToBytes=bytes=>{
  const line='progress 1\n';
  return line.repeat(Math.floor(bytes/line.length))+' '.repeat(bytes%line.length);
};
const forbiddenDecision=async()=>assert.fail('ineligible output must not request a decision');

test('selects with one bounded decision and preserves original protected lines in order',async()=>{
  const before='Saved /tmp/수업 자료/result.json',after='결과: 완료';
  const raw=`${before}\r\n${progress}\n\n${after}\r\n`;
  let calls=0;
  const result=await selectProgress({raw,exit:0},{decide:async(state,instructions,criteria,options)=>{
    calls++;
    assert.deepEqual(Object.keys(state).sort(),['exit_code','input_bytes','progress_counts','protected_bytes','samples']);
    assert.equal(state.input_bytes,Buffer.byteLength(raw));
    assert.equal(state.exit_code,0);
    assert.deepEqual(state.progress_counts,{info_progress:600});
    assert.ok(state.samples.length<=4);
    for(const sample of state.samples)assert.ok(Buffer.byteLength(sample.text)<=160);
    assert.ok(!JSON.stringify(state).includes(before));
    assert.ok(!JSON.stringify(state).includes(after));
    assert.ok(!JSON.stringify(state).includes(raw));
    assert.deepEqual(Object.keys(criteria),['PRUNE','KEEP']);
    assert.equal(options.retries,0);
    assert.match(instructions,/unknown/);
    return successful;
  }});
  assert.equal(calls,1);
  assert.equal(result.status,'selected');
  assert.deepEqual(result.protected_lines,[`${before}\r`,'',`${after}\r`,'']);
  assert.equal(result.input_bytes,Buffer.byteLength(raw));
  assert.ok(result.decision_bytes>0&&result.decision_bytes<1000);
});

test('KEEP, missing, malformed, low-confidence and thrown decisions retain the complete output',async()=>{
  const cases=[
    [{choice:'KEEP',confidence:0.99},'kept_by_decision'],
    [null,'decision_unavailable'],
    [undefined,'decision_unavailable'],
    ['PRUNE','decision_unavailable'],
    [{choice:'UNKNOWN',confidence:0.99},'unknown_decision'],
    [{choice:'PRUNE',confidence:0.8999},'low_confidence'],
    [{choice:'PRUNE',confidence:NaN},'low_confidence'],
    [{choice:'PRUNE',confidence:1.01},'low_confidence'],
    [{choice:'PRUNE',confidence:'1'},'low_confidence']
  ];
  for(const [answer,reason] of cases){
    let calls=0;
    const result=await selectProgress({raw:progress,exit:0},{decide:async()=>{calls++;return answer;}});
    assert.equal(calls,1);assert.equal(result.status,'retained');assert.equal(result.reason,reason);
    assert.deepEqual(result.protected_lines,retainedLines(progress));
  }
  let calls=0;
  const result=await selectProgress({raw:progress,exit:0},{decide:async()=>{calls++;throw Error('synthetic');}});
  assert.equal(calls,1);assert.equal(result.reason,'decision_error');
  assert.deepEqual(result.protected_lines,retainedLines(progress));
});

test('null exit stays unknown in decision evidence and 0.9 is the inclusive confidence boundary',async()=>{
  const result=await selectProgress({raw:progress,exit:null},{decide:async state=>{
    assert.equal(state.exit_code,null);return {choice:'PRUNE',confidence:0.9};
  }});
  assert.equal(result.status,'selected');assert.equal(result.confidence,0.9);
  for(const exit of [undefined,1,-1,0.5,'0',false,NaN,Infinity]){
    const retained=await selectProgress({raw:progress,exit},{decide:forbiddenDecision});
    assert.equal(retained.reason,'invalid_exit');
    assert.deepEqual(retained.protected_lines,retainedLines(progress));
  }
});

test('secrets and required evidence retain every line without sending a decision',async()=>{
  const secrets=['token=synthetic','api_key: synthetic','key=synthetic','auth: synthetic','Authorization: Bearer synthetic',
    'password=synthetic','secret=synthetic','Bearer synthetic','sk-abcdefghijklmnop','ghp_abcdefghijklmnop',
    'AKIAABCDEFGHIJKLMN','-----BEGIN PRIVATE KEY-----'];
  const critical=['error','Exception','FAILED','failure','Warning','FATAL','Traceback','constraint','decision','must','never',
    '요구사항','제약','결정','수정 절대 금지'];
  for(const [items,reason] of [[secrets,'secret_output'],[critical,'critical_output']])for(const text of items){
    const raw=`${progress}\n${text}`;
    const result=await selectProgress({raw,exit:0},{decide:forbiddenDecision});
    assert.equal(result.reason,reason,text);assert.equal(result.decision_bytes,0);
    assert.deepEqual(result.protected_lines,retainedLines(raw));
  }
});

test('complete numeric forms are removable while descriptions and paths stay exact',async()=>{
  const removable=['INFO cache warming 1','INFO progress 2%','progress 3','[4/20]','Downloading 5','Downloaded 6','7%',
    'progress 8%','INFO progress 9','\tprogress 10 \r'];
  const protectedLines=['INFO cache warming','INFO progress 2 files','progress 3 /tmp/result','[4/20] built result.js',
    'Downloading 5 /tmp/가 나.txt','Downloaded 6 files','7% done','progress 10.js','progress 10/README',
    'progress 123456789012345678901','INFO progress 10\u00a0','progress 1\rhidden','progress 1\r\r',
    'progress 8/20','Downloaded 9/20','INFO progress [9/20]','README','완료'];
  const raw=[...removable,...protectedLines,...Array(800).fill('progress 1')].join('\n');
  const result=await selectProgress({raw,exit:0},{decide:async state=>{
    assert.equal(Object.values(state.progress_counts).reduce((sum,count)=>sum+count,0),removable.length+800);
    assert.ok(!JSON.stringify(state).includes('/tmp/'));
    assert.ok(!JSON.stringify(state).includes('완료'));
    return successful;
  }});
  assert.equal(result.status,'selected');assert.deepEqual(result.protected_lines,protectedLines);
});

test('UTF-8 sizes govern the minimum and upper bounds',async()=>{
  for(const [bytes,status,reason] of [[7999,'retained','below_minimum'],[8000,'selected','selected'],
    [65536,'selected','selected'],[65537,'retained','oversized_output']]){
    const raw=repeatToBytes(bytes);
    const result=await selectProgress({raw,exit:0},{decide:status==='selected'?async()=>successful:forbiddenDecision});
    assert.equal(Buffer.byteLength(raw),bytes);assert.equal(result.input_bytes,bytes);
    assert.equal(result.status,status);assert.equal(result.reason,reason);
  }
  const raw=`${repeatToBytes(7998)}가`;
  assert.equal(raw.length,7999);assert.equal(Buffer.byteLength(raw),8001);
  assert.equal((await selectProgress({raw,exit:0},{decide:async()=>successful})).status,'selected');
});

test('minimum override and strict 700-byte savings boundary are enforced',async()=>{
  assert.equal((await selectProgress({raw:repeatToBytes(2000),exit:0},{minimumBytes:2000,decide:async()=>successful})).status,'selected');
  for(const minimumBytes of [0,-1,NaN,Infinity,'2000',65537])
    assert.equal((await selectProgress({raw:progress,exit:0},{minimumBytes,decide:forbiddenDecision})).reason,'invalid_minimum');
  for(const [bytes,reason] of [[3299,'selected'],[3300,'insufficient_savings']]){
    const raw=`${progress}\n${'x'.repeat(bytes)}`;
    const result=await selectProgress({raw,exit:0},{decide:reason==='selected'?async()=>successful:forbiddenDecision});
    assert.equal(result.reason,reason);
  }
  for(const [bytes,reason] of [[1299,'selected'],[1300,'insufficient_savings']]){
    const padding=2000-bytes-'progress 1\nprogress 2\n'.length;
    const raw=`${' '.repeat(padding)}progress 1\nprogress 2\n${'x'.repeat(bytes)}`;
    assert.equal(Buffer.byteLength(raw),2000);
    assert.equal((await selectProgress({raw,exit:0},{minimumBytes:2000,decide:reason==='selected'?async()=>successful:forbiddenDecision})).reason,reason);
  }
});

test('at least two progress lines are required and unsupported inputs are retained',async()=>{
  const one=`${' '.repeat(8000)}progress 1`;
  assert.equal((await selectProgress({raw:one,exit:0},{decide:forbiddenDecision})).reason,'insufficient_progress');
  for(const raw of [null,undefined,42,{},[]]){
    const result=await selectProgress({raw,exit:0},{decide:forbiddenDecision});
    assert.equal(result.reason,'unsupported_output');assert.equal(result.input_bytes,0);
  }
  assert.equal((await selectProgress({}, {decide:forbiddenDecision})).reason,'unsupported_output');
});

test('sample count and sample byte limits are global and independent of padding',async()=>{
  const raw=[' '.repeat(9000)+'progress 1',...Array(100).fill('INFO cache warming 2'),...Array(100).fill('Downloaded 3')].join('\n');
  const result=await selectProgress({raw,exit:0},{decide:async state=>{
    assert.equal(state.samples.length,4);
    assert.equal(state.progress_counts.progress,1);
    assert.equal(state.progress_counts.cache_warming,100);
    assert.equal(state.progress_counts.downloaded,100);
    for(const sample of state.samples)assert.ok(Buffer.byteLength(sample.text)<=160);
    assert.ok(Buffer.byteLength(JSON.stringify(state))<1000);
    return successful;
  }});
  assert.equal(result.status,'selected');
});
