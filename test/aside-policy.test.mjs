import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAsideStep} from '../integration/aside-policy.mjs';

const answer=(choice,confidence=0.95)=>({choice,confidence});
const element=(extra={})=>({id:'e1',role:'button',text:'Next',...extra});
const input=(extra={})=>({goal:'Open the next page',origin:'https://example.test',elements:[element()],...extra});
const result=(operation='CLICK',target='e1')=>({operation:answer(operation),click_target:answer(target)});

async function rejected(value,reason) {
  let calls=0;
  const actual=await chooseAsideStep(value,{decide:async()=>{calls++;return result();}});
  assert.equal(calls,0);
  assert.deepEqual(actual,{operation:'HANDOFF',reason,confidence:null,requested:false});
}

test('one request fans out operation and target over stripped bounded state',async()=>{
  let calls=0;
  const actual=await chooseAsideStep(input({rawSnapshot:'LOCAL_ONLY',elements:[element({fingerprint:'LOCAL_FINGERPRINT',path:'/Users/private',value:'LOCAL_VALUE',href:'https://private.test'})]}),{
    decide:async(state,questions,options)=>{
      calls++;
      assert.deepEqual(options,{timeout:2500});
      assert.deepEqual(state,input({transitioning:false}));
      assert.deepEqual(Object.keys(questions),['operation','click_target']);
      assert.deepEqual(Object.keys(questions.operation.criteria),['CLICK','HANDOFF']);
      assert.deepEqual(Object.keys(questions.click_target.criteria),['e1','HANDOFF']);
      assert.ok(Buffer.byteLength(JSON.stringify(state))<=16000);
      assert.ok(Buffer.byteLength(JSON.stringify(questions))<=8000);
      assert.ok(!JSON.stringify({state,questions}).includes('LOCAL_'));
      return {operation:answer('CLICK',0.8),click_target:answer('e1',0.9)};
    },
  });
  assert.equal(calls,1);
  assert.deepEqual(actual,{operation:'CLICK',targetId:'e1',confidence:0.8,requested:true});
});

test('WAIT and HANDOFF ignore unused target uncertainty',async()=>{
  for(const target of [undefined,null,answer('UNKNOWN'),answer('e1',0.1),{choice:'invented',confidence:Infinity}]) {
    const wait=await chooseAsideStep(input({transitioning:true}),{decide:async()=>({operation:answer('WAIT'),click_target:target})});
    assert.deepEqual(wait,{operation:'WAIT',confidence:0.95,requested:true});
    const handoff=await chooseAsideStep(input(),{decide:async()=>({operation:answer('HANDOFF'),click_target:target})});
    assert.deepEqual(handoff,{operation:'HANDOFF',reason:'policy_handoff',confidence:0.95,requested:true});
  }
});

test('WAIT requires observed transition and CLICK requires target confidence',async()=>{
  const invalidWait=await chooseAsideStep(input(),{decide:async()=>result('WAIT')});
  assert.equal(invalidWait.reason,'operation_uncertain');
  for(const click_target of [undefined,null,answer('UNKNOWN'),answer('invented'),answer('e1',0.699),answer('e1',NaN),answer('e1',1.1)]) {
    const actual=await chooseAsideStep(input(),{decide:async()=>({operation:answer('CLICK'),click_target})});
    assert.equal(actual.operation,'HANDOFF');
    assert.equal(actual.reason,'target_uncertain');
    assert.equal(actual.requested,true);
    assert.ok(!Object.hasOwn(actual,'targetId'));
  }
  const allowed=await chooseAsideStep(input(),{decide:async()=>({operation:answer('CLICK',0.7),click_target:answer('e1',0.7)})});
  assert.equal(allowed.operation,'CLICK');
  const handoff=await chooseAsideStep(input(),{decide:async()=>result('CLICK','HANDOFF')});
  assert.equal(handoff.reason,'target_handoff');
});

test('empty state hands off locally unless a transition offers WAIT alone',async()=>{
  await rejected(input({elements:[]}),'no_candidates');
  let calls=0;
  const actual=await chooseAsideStep(input({elements:[],transitioning:true}),{decide:async(_state,questions)=>{
    calls++;
    assert.deepEqual(Object.keys(questions),['operation']);
    assert.deepEqual(Object.keys(questions.operation.criteria),['WAIT','HANDOFF']);
    return {operation:answer('WAIT')};
  }});
  assert.equal(calls,1);
  assert.equal(actual.operation,'WAIT');
});

test('invalid, duplicate, reserved, or oversized IDs cannot become choices',async()=>{
  for(const id of ['',1,'#button','e1 button','e1\nCLICK','e'.repeat(65),'HANDOFF','__proto__'])
    await rejected(input({elements:[element({id})]}),'invalid_candidate');
  await rejected(input({elements:[element(),element({text:'Previous'})]}),'invalid_candidate');
});

test('candidate shape, roles, text bounds, and count are enforced before requesting',async()=>{
  for(const item of [null,[],element({role:'textbox'}),element({text:''}),element({text:42}),element({text:'a'.repeat(181)}),element({text:'😀'.repeat(181)})])
    await rejected(input({elements:[item]}),'invalid_candidate');
  await rejected(input({elements:Array.from({length:41},(_,i)=>element({id:`e${i}`}))}),'invalid_input');
  let state;
  await chooseAsideStep(input({elements:[element({text:'😀'.repeat(180)})]}),{decide:async value=>{state=value;return result();}});
  assert.equal(Buffer.byteLength(state.elements[0].text),720);
});

test('goal, origin, transition, and serialized state size are bounded',async()=>{
  for(const extra of [{goal:''},{goal:3},{goal:'a'.repeat(4097)},{goal:'가'.repeat(1366)},{origin:'x'.repeat(1001)},{elements:null},{transitioning:1}])
    await rejected(input(extra),'invalid_input');
  for(const origin of ['https://example.test/path','https://example.test?token=1','https://user:pass@example.test','file:///tmp/page','not a URL']) {
    let calls=0;
    const actual=await chooseAsideStep(input({origin}),{decide:async()=>{calls++;return result();}});
    assert.equal(actual.operation,'HANDOFF');
    assert.equal(calls,0);
  }
  await rejected(input({elements:Array.from({length:40},(_,i)=>element({id:`e${i}`,text:'가'.repeat(180)}))}),'state_too_large');
});

test('secrets, local paths, and consequential labels fail closed before the request',async()=>{
  for(const text of ['Bearer synthetic-private-value','sk-'+'syntheticprivatevalue','ghp_'+'syntheticprivatevalue','token=synthetic-private-value','password: synthetic-private-value','/Users/synthetic/private','file:///tmp/private','data:text/plain;base64,AAAA']) {
    await rejected(input({goal:text}),'sensitive_input');
    await rejected(input({elements:[element({text})]}),'sensitive_input');
  }
  for(const text of ['Delete item','Send message','Buy now','Submit','Publish','Sign in','결제','전송','삭제']) {
    await rejected(input({goal:text}),'consequential_input');
    await rejected(input({elements:[element({text})]}),'consequential_input');
  }
});

test('known environment secrets are rejected without forwarding them',async()=>{
  const name='JEV_ASIDE_POLICY_TEST_TOKEN',previous=process.env[name];
  process.env[name]='synthetic-private-environment-value';
  try {
    await rejected(input({goal:`Open ${process.env[name]}`}),'sensitive_input');
    await rejected(input({elements:[element({text:process.env[name]})]}),'sensitive_input');
  }finally{if(previous===undefined)delete process.env[name];else process.env[name]=previous;}
});

test('UNKNOWN, malformed operation, exceptions, and empty responses hand off without retries',async()=>{
  for(const response of [null,undefined,[],{}, {operation:answer('UNKNOWN')},{operation:answer('CLICK',0.699)},{operation:answer('CLICK',NaN)},{operation:answer('CLICK',1.1)},{operation:{choice:'CLICK',confidence:'0.99'}}]) {
    let calls=0;
    const actual=await chooseAsideStep(input(),{decide:async()=>{calls++;return response;}});
    assert.equal(calls,1);
    assert.equal(actual.operation,'HANDOFF');
    assert.equal(actual.requested,true);
    assert.equal(actual.confidence,null);
    assert.ok(!Object.hasOwn(actual,'targetId'));
  }
  let calls=0;
  const thrown=await chooseAsideStep(input(),{decide:()=>{calls++;throw Error('private transport detail');}});
  assert.equal(calls,1);
  assert.deepEqual(thrown,{operation:'HANDOFF',reason:'decision_unavailable',confidence:null,requested:true});
});

test('policy deadline hands off even if the injected decider never settles',async()=>{
  let calls=0;
  const actual=await chooseAsideStep(input(),{timeout:5,decide:()=>{calls++;return new Promise(()=>{});}});
  assert.equal(calls,1);
  assert.deepEqual(actual,{operation:'HANDOFF',reason:'decision_timeout',confidence:null,requested:true});
});
