import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {planWorkflow,validateSpec,DEFAULT_MODELS} from '../integration/workflow-policy.mjs';
import {persistedPlan} from '../integration/workflow-cli.mjs';
import {chooseDetailed} from '../integration/choice.mjs';

const base = {context_id:'task-1-revision-1',kind:'edit',scope_known:true,role:'implementation',semantic_items:0,independent_units:1,parallel_benefit:false,goal:'Update a known document setting.'};
const mixed = {...base,kind:'mixed',role:'mixed',goal:'Choose an approach for two independent pieces of implementation and evidence review.'};
const noProvider = () => { throw Error('UNEXPECTED_PROVIDER_CALL'); };
const checked = plan => {
  assert.equal(plan.advisory_only,true);
  assert.equal(plan.verification,'existing_required_checks');
  assert.equal(plan.fork_turns,'none');
  assert.equal(plan.lookup_bytes,1000);
  assert.equal(plan.expanded_lookup_bytes,4000);
  assert.equal(Object.hasOwn(plan,'goal'),false);
  assert.equal(Object.hasOwn(plan,'context_id'),false);
  assert.ok(Buffer.byteLength(JSON.stringify(plan))<=1000);
};

test('known work, role mapping and bulk boundary avoid every provider call', async () => {
  const cases = [
    [{...base,kind:'lookup',independent_units:4,parallel_benefit:true},'MAIN_DIRECT',null],
    [base,'MAIN_DIRECT',null],
    [{...base,kind:'debug',scope_known:false},'MAIN_SCOPED',null],
    [{...base,semantic_items:4},'MAIN_DIRECT',null],
    [{...base,semantic_items:5},'BATCH_JEV',null],
    ...Object.entries({procedure:'CHILD_PROCEDURE',implementation:'CHILD_IMPLEMENTATION',design:'CHILD_DESIGN'}).map(([role,strategy])=>[{...base,role,independent_units:2,parallel_benefit:true},strategy,DEFAULT_MODELS[role]]),
  ];
  for (const [spec,strategy,model] of cases) {
    const plan=await planWorkflow(spec,{decide:noProvider,enabled:true});
    assert.equal(plan.strategy,strategy); assert.equal(plan.api_calls,0);
    assert.equal(plan.source,'policy'); assert.equal(plan.confidence,null);
    assert.deepEqual(plan.model_hint,model);checked(plan);
  }
});

test('manual model wins even when a mixed parallel task would otherwise be routed', async () => {
  const manual_model={model:'custom-model',reasoning_effort:'high'};
  const plan=await planWorkflow({...mixed,independent_units:2,parallel_benefit:true,manual_model},{decide:noProvider,enabled:true});
  assert.equal(plan.strategy,'MAIN_SCOPED');assert.equal(plan.api_calls,0);assert.deepEqual(plan.model_hint,manual_model);checked(plan);
});

test('disabled and missing-context mixed work abstain before an API call', async () => {
  for(const [spec,enabled] of [[mixed,false],[{...mixed,goal:''},true]]) {
    const plan=await planWorkflow(spec,{decide:noProvider,enabled});
    assert.equal(plan.strategy,'UNKNOWN');assert.equal(plan.api_calls,0);checked(plan);
  }
});

test('mixed work asks once with metadata only and no hidden diagnosis or retries', async () => {
  let calls=0;
  const plan=await planWorkflow(mixed,{enabled:true,decide:async(state,instructions,criteria,options)=>{
    calls++;assert.equal(Object.hasOwn(state,'context_id'),false);assert.equal(Object.hasOwn(state,'manual_model'),false);
    assert.equal(Object.hasOwn(criteria,'CHILD_IMPLEMENTATION'),false);assert.equal(Object.hasOwn(criteria,'BATCH_JEV'),false);
    assert.equal(options.diagnose,false);assert.equal(options.retries,0);assert.equal(options.timeout,1500);
    return {answer:{choice:'MAIN_SCOPED',confidence:0.92},diagnostic:{status:'decided'}};
  }});
  assert.equal(calls,1);assert.equal(plan.api_calls,1);assert.equal(plan.source,'jev');assert.equal(plan.confidence,0.92);checked(plan);
});

test('Jev can select an eligible scoped child but cannot grant execution', async () => {
  const spec={...mixed,independent_units:2,parallel_benefit:true};
  const plan=await planWorkflow(spec,{enabled:true,decide:async()=>({answer:{choice:'CHILD_IMPLEMENTATION',confidence:0.91},diagnostic:{status:'decided'}})});
  assert.equal(plan.strategy,'CHILD_IMPLEMENTATION');assert.deepEqual(plan.model_hint,DEFAULT_MODELS.implementation);checked(plan);
});

test('low confidence, explicit uncertainty, malformed answers and failures never retry', async () => {
  const answers=[{choice:'MAIN_SCOPED',confidence:0.4},{choice:'UNKNOWN',confidence:0.99},{choice:'CHILD_DESIGN',confidence:0.99},{choice:'MAIN_SCOPED',confidence:2},null];
  for(const answer of answers) {
    let calls=0;
    const plan=await planWorkflow(mixed,{enabled:true,decide:async()=>{calls++;return {answer,diagnostic:{status:answer?.choice==='UNKNOWN'?'explicit_unknown':answer===null?'timeout':'decided'}};}});
    assert.equal(calls,1);assert.equal(plan.strategy,'UNKNOWN');assert.equal(plan.api_calls,1);
    if(answer?.confidence===0.4)assert.equal(plan.confidence,0.4);
    checked(plan);
  }
  let calls=0;const plan=await planWorkflow(mixed,{enabled:true,decide:async()=>{calls++;throw Error('private-provider-error');}});
  assert.equal(calls,1);assert.equal(plan.strategy,'UNKNOWN');assert.ok(!JSON.stringify(plan).includes('private-provider-error'));
});

test('sensitive task text is withheld and never echoed', async () => {
  for(const goal of ['api_key=synthetic-secret-value','Authorization: Bearer synthetic-token','contact person@example.invalid','-----BEGIN PRIVATE KEY-----']) {
    const plan=await planWorkflow({...mixed,goal},{enabled:true,decide:noProvider});
    assert.equal(plan.strategy,'UNKNOWN');assert.equal(plan.reason,'INPUT_WITHHELD');assert.equal(plan.api_calls,0);
    assert.ok(!JSON.stringify(plan).includes(goal));
  }
});

test('invalid, oversized and accessor specs fail before provider use', async () => {
  let getterCalls=0;const accessor={...base};Object.defineProperty(accessor,'goal',{get(){getterCalls++;return 'private';},enumerable:true});
  for(const spec of [{...base,source:'raw source'}, {...base,goal:'x'.repeat(1001)}, {...base,semantic_items:-1}, {...base,scope_known:'yes'},accessor])
    assert.throws(()=>validateSpec(spec));
  assert.equal(getterCalls,0);
});

async function fixture(fn,spec=mixed) {
  const directory=await mkdtemp(path.join(tmpdir(),'workflow-policy-'));
  const paths={specFile:path.join(directory,'spec.json'),outFile:path.join(directory,'plan.json')};
  await writeFile(paths.specFile,JSON.stringify(spec));
  try { await fn(paths,directory); } finally { await rm(directory,{recursive:true,force:true}); }
}

test('an unchanged plan is reused with zero additional API calls', async()=>fixture(async paths=>{
  let calls=0;const options={isEnabled:()=>true,decide:async()=>{calls++;return {answer:{choice:'MAIN_SCOPED',confidence:0.9},diagnostic:{status:'decided'}};}};
  const first=await persistedPlan(paths,options);const second=await persistedPlan(paths,options);
  assert.equal(calls,1);assert.equal(first.api_calls,1);assert.equal(first.cache_hit,false);assert.equal(second.api_calls,0);assert.equal(second.cache_hit,true);checked(second);
}));

test('changed context and feature opt-out reject a plan before another API call', async()=>fixture(async paths=>{
  const options={isEnabled:()=>true,decide:async()=>({answer:{choice:'MAIN_SCOPED',confidence:0.9},diagnostic:{status:'decided'}})};
  await persistedPlan(paths,options);const original=await readFile(paths.outFile,'utf8');
  await assert.rejects(persistedPlan(paths,{isEnabled:()=>false,decide:noProvider}),/WORKFLOW_PLAN_STALE/);
  await writeFile(paths.specFile,JSON.stringify({...mixed,context_id:'task-1-revision-2'}));
  await assert.rejects(persistedPlan(paths,{...options,decide:noProvider}),/WORKFLOW_PLAN_STALE/);
  assert.equal(await readFile(paths.outFile,'utf8'),original);
}));

test('corrupt and augmented plan files remain untouched and do not call Jev', async()=>fixture(async paths=>{
  await writeFile(paths.outFile,'private preexisting content');
  await assert.rejects(persistedPlan(paths,{isEnabled:()=>true,decide:noProvider}),/INVALID_WORKFLOW_CACHE/);
  assert.equal(await readFile(paths.outFile,'utf8'),'private preexisting content');
  await rm(paths.outFile);
  await persistedPlan(paths,{isEnabled:()=>true,decide:async()=>({answer:{choice:'MAIN_SCOPED',confidence:0.9},diagnostic:{status:'decided'}})});
  const record=JSON.parse(await readFile(paths.outFile,'utf8'));record.plan.command='untrusted command';await writeFile(paths.outFile,JSON.stringify(record));
  await assert.rejects(persistedPlan(paths,{isEnabled:()=>true,decide:noProvider}),/INVALID_WORKFLOW_CACHE/);
}));

test('concurrent reuse cannot cause duplicate provider requests', async()=>fixture(async paths=>{
  let calls=0;
  const options={isEnabled:()=>true,decide:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,25));return {answer:{choice:'MAIN_SCOPED',confidence:0.9},diagnostic:{status:'decided'}};}};
  const results=await Promise.allSettled([persistedPlan(paths,options),persistedPlan(paths,options)]);
  assert.equal(calls,1);assert.ok(results.some(r=>r.status==='fulfilled'));
}));

test('CLI emits a bounded advisory result without requiring an API key', async()=>fixture(async paths=>{
  const cli=fileURLToPath(new URL('../bin/jev-workflow.mjs',import.meta.url));
  const result=await promisify(execFile)(process.execPath,[cli,'--spec',paths.specFile,'--out',paths.outFile],{env:{...process.env,JEV_WORKFLOW_ADVISOR_ENABLED:'0'}});
  const plan=JSON.parse(result.stdout);assert.equal(plan.strategy,'MAIN_DIRECT');assert.equal(plan.api_calls,0);checked(plan);
},base));


test('cached decisions cannot promote low confidence or a local policy score', async()=>fixture(async paths=>{
  await persistedPlan(paths,{isEnabled:()=>true,decide:async()=>({answer:{choice:'MAIN_SCOPED',confidence:0.9},diagnostic:{status:'decided'}})});
  const original=JSON.parse(await readFile(paths.outFile,'utf8'));
  for(const change of [{confidence:0.4},{reason:'LOW_CONFIDENCE'},{source:'policy',api_calls:0}]) {
    const record=structuredClone(original);Object.assign(record.plan,change);
    await writeFile(paths.outFile,JSON.stringify(record));
    await assert.rejects(persistedPlan(paths,{isEnabled:()=>true,decide:noProvider}),/INVALID_WORKFLOW_CACHE/);
  }
}));


test('real choice client accepts criteria and preserves its uncertainty contract', async()=>{
  for(const [choice,confidence,expected] of [['MAIN_SCOPED',0.9,'MAIN_SCOPED'],['MAIN_SCOPED',0.4,'UNKNOWN'],['UNKNOWN',0.9,'UNKNOWN']]) {
    let requests=0;
    const plan=await planWorkflow(mixed,{enabled:true,decide:(state,instructions,criteria,options)=>chooseDetailed(state,instructions,criteria,{...options,key:'synthetic-test-key',fetchImpl:async(_url,request)=>{
      requests++;const body=JSON.parse(request.body);const rules=body.questions.decision.criteria;
      assert.equal(Array.isArray(rules),false);assert.equal(typeof rules.MAIN_SCOPED,'string');
      const probabilities=Object.fromEntries(Object.keys(rules).map(key=>[key,key===choice?0.9:0.1/(Object.keys(rules).length-1)]));
      return {ok:true,json:async()=>({model:'jev-test',answers:{decision:{type:'choice',choice,confidence,probabilities}}})};
    }})});
    assert.equal(requests,1);assert.equal(plan.api_calls,1);assert.equal(plan.strategy,expected);assert.equal(plan.confidence,confidence);checked(plan);
  }
});

test('missing credentials and missing client report zero requests',async()=>{
  const missing=await planWorkflow(mixed,{enabled:true,decide:(s,i,c,o)=>chooseDetailed(s,i,c,{...o,key:'',fetchImpl:noProvider})});
  const absent=await planWorkflow(mixed,{enabled:true});
  for(const plan of [missing,absent]){assert.equal(plan.strategy,'UNKNOWN');assert.equal(plan.api_calls,0);checked(plan);}
});

test('an error diagnostic cannot promote a plausible-looking answer',async()=>{
  const plan=await planWorkflow(mixed,{enabled:true,decide:async()=>({answer:{choice:'MAIN_SCOPED',confidence:0.99},diagnostic:{status:'timeout'}})});
  assert.equal(plan.strategy,'UNKNOWN');assert.equal(plan.source,'unavailable');assert.equal(plan.confidence,null);
});
