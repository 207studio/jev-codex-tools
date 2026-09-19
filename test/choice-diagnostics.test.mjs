import test from 'node:test';
import assert from 'node:assert/strict';
import {choose,chooseDetailed,chooseMany} from '../integration/choice.mjs';

const criteria={YES:'Yes',NO:'No',UNKNOWN:'Cannot determine'};
const options={key:'synthetic-test-only',diagnose:false};
function response(body,chooseHead=id=>({choice:id==='decision'?'UNKNOWN':'YES',confidence:1})) {
  const answers=Object.fromEntries(Object.entries(body.questions).map(([id,question])=>{
    const selected=chooseHead(id,question);
    return [id,{type:'choice',...selected,probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key===selected.choice?1:0]))}];
  }));
  return {ok:true,json:async()=>({model:'jev-test',answers})};
}
async function withDiagnosis(fn) {
  const prior=process.env.JEV_UNKNOWN_DIAGNOSTICS_ENABLED;
  process.env.JEV_UNKNOWN_DIAGNOSTICS_ENABLED='1';
  try{await fn();}finally{if(prior===undefined)delete process.env.JEV_UNKNOWN_DIAGNOSTICS_ENABLED;else process.env.JEV_UNKNOWN_DIAGNOSTICS_ENABLED=prior;}
}

test('transport, HTTP, JSON and response-shape failures retain distinct safe reasons',async()=>{
  const cases=[
    ['http_error',async()=>({ok:false,status:429})],
    ['timeout',async()=>{throw Object.assign(Error('sensitive detail'),{name:'TimeoutError'});}],
    ['transport_error',async()=>{throw Error('sensitive detail');}],
    ['invalid_json',async()=>({ok:true,json:async()=>{throw Error('sensitive detail');}})],
    ['invalid_model',async()=>({ok:true,json:async()=>({model:'other-model',answers:{}})})],
    ['invalid_response',async()=>({ok:true,json:async()=>({model:'jev-test',answers:{}})})],
  ];
  for(const [status,fetchImpl] of cases) {
    let observed;
    const result=await chooseDetailed({},'Question',criteria,{...options,fetchImpl,onDiagnostic:info=>{observed=info;}});
    assert.equal(result.answer,null);assert.equal(result.diagnostic.status,status);assert.equal(observed.status,status);
    assert.ok(!JSON.stringify(result).includes('sensitive detail'));
    if(status==='http_error')assert.equal(result.diagnostic.http_status,429);
  }
});

test('missing credentials and oversized requests are local and never call the API',async()=>{
  const fetchImpl=async()=>{throw Error('must not request');};
  const absent=await chooseDetailed({},'Question',criteria,{...options,key:'',fetchImpl});
  const large=await chooseDetailed({value:'x'.repeat(66000)},'Question',criteria,{...options,fetchImpl});
  assert.equal(absent.diagnostic.status,'missing_key');assert.equal(large.diagnostic.status,'request_too_large');
});

test('strict probability validation remains in force and reports its boundary',async()=>{
  const result=await chooseDetailed({},'Question',criteria,{...options,fetchImpl:async()=>({ok:true,json:async()=>({model:'jev-test',answers:{decision:{type:'choice',choice:'YES',confidence:1,probabilities:{YES:0.2,NO:0.8,UNKNOWN:0}}}})})});
  assert.equal(result.answer,null);assert.equal(result.diagnostic.validation_code,'choice_distribution');
});

test('low confidence preserves the actual model choice and caller threshold',async()=>{
  const answer=await choose({},'Question',criteria,{...options,minConfidence:0.9,fetchImpl:async(_url,request)=>response(JSON.parse(request.body),()=>({choice:'YES',confidence:0.85}))});
  assert.equal(answer.choice,'YES');assert.equal(answer.confidence,0.85);assert.equal(answer.diagnostic.status,'low_confidence');
});

test('semantic UNKNOWN receives one bounded diagnosis and a literal suggestion without changing the answer',async()=>withDiagnosis(async()=>{
  let calls=0;
  const result=await chooseDetailed({label:'MAYBE'},'Classify this label',criteria,{...options,diagnose:true,fetchImpl:async(_url,request)=>{
    calls++;const body=JSON.parse(request.body);
    return response(body,id=>({choice:id==='decision'?'UNKNOWN':id==='reason'?'MISSING_OPTION':'C1',confidence:1}));
  }});
  assert.equal(calls,2);assert.equal(result.answer.choice,'UNKNOWN');assert.equal(result.answer.confidence,1);
  assert.equal(result.diagnostic.diagnosis.reason,'MISSING_OPTION');
  assert.equal(result.diagnostic.diagnosis.proposed_option.value,'MAYBE');
}));

test('API failures cannot trigger semantic retries even when diagnosis is enabled',async()=>withDiagnosis(async()=>{
  let calls=0;
  const result=await chooseDetailed({},'Question',criteria,{...options,diagnose:true,fetchImpl:async()=>{calls++;return {ok:false,status:503};}});
  assert.equal(calls,1);assert.equal(result.diagnostic.status,'http_error');assert.equal(result.diagnostic.diagnosis,undefined);
}));

test('a multi-head response gets at most one diagnosis and diagnosis cannot recurse',async()=>withDiagnosis(async()=>{
  let calls=0;
  const questions={first:{type:'choice',instructions:'Classify label',criteria},second:{type:'choice',instructions:'Classify label again',criteria}};
  const answers=await chooseMany({label:'MAYBE'},questions,{...options,diagnose:true,fetchImpl:async(_url,request)=>{
    calls++;const body=JSON.parse(request.body);
    return response(body,id=>({choice:id==='candidate'?'NONE':'UNKNOWN',confidence:1}));
  }});
  assert.equal(calls,2);assert.equal(answers.first.choice,'UNKNOWN');assert.equal(answers.second.choice,'UNKNOWN');
  assert.equal(answers.first.diagnostic.diagnosis.reason,'UNKNOWN');assert.equal(answers.second.diagnostic.diagnosis,undefined);
}));

test('valid decisions and disabled diagnostics retain a single request',async()=>{
  for(const choice of ['YES','UNKNOWN']) {
    let calls=0;
    const result=await choose({},'Question',criteria,{...options,fetchImpl:async(_url,request)=>{calls++;return response(JSON.parse(request.body),()=>({choice,confidence:1}));},onDiagnostic:()=>{throw Error('observer does not own result');}});
    assert.equal(calls,1);assert.equal(result.choice,choice);assert.equal(result.diagnostic?.diagnosis,undefined);
  }
});
