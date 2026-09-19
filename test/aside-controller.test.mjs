import test from 'node:test';
import assert from 'node:assert/strict';
import {runAside} from '../integration/aside-controller.mjs';

const element={id:'e1',role:'button',text:'Next',fingerprint:'synthetic-current-node'};
const state=(changes={})=>({status:'observed',url:'https://example.test/',elements:[element],done:false,transitioning:false,...changes});
function options(extra={}) {
  return {goal:'Open the next panel',origin:'https://example.test',maxSteps:4,execute:true,deadline:Date.now()+10000,metrics:{decision_calls:0,decision_ms:0},record:()=>{},...extra};
}
const flags=name=>['browser_selector','control_loop','browser_fanout'].includes(name);

test('fanout executes only the observed target after the existing freshness check',async()=>{
  const calls=[],records=[];let decisions=0;
  const result=await runAside(options(),{featureEnabled:flags,
    observePage:async(_options,expected)=>{calls.push(expected);return expected?state({status:'clicked',done:true}):state();},
    chooseStep:async()=>{decisions++;return {operation:'CLICK',targetId:'e1',confidence:0.9,requested:true};},writeAction:async record=>records.push(record)});
  assert.equal(result.status,'done');assert.equal(result.actions,1);assert.equal(decisions,1);
  assert.equal(calls[1].fingerprint,element.fingerprint);assert.equal(calls[1].url,'https://example.test/');
  assert.equal(records[0].executed,true);assert.equal(records[0].policy,'operation-target');
});

test('selection-only mode performs no action and stale reobservation reports zero actions',async()=>{
  for(const execute of [false,true]) {
    let observed=0;
    const result=await runAside(options({execute}),{featureEnabled:flags,
      observePage:async(_options,expected)=>{observed++;return expected?state({status:'state_changed'}):state();},
      chooseStep:async()=>({operation:'CLICK',targetId:'e1',confidence:0.9,requested:true}),writeAction:async()=>{}});
    assert.equal(result.status,execute?'state_changed':'selected');assert.equal(result.actions,0);assert.equal(observed,execute?2:1);
  }
});

test('WAIT requires observed transition, is capped, and never increments click count',async()=>{
  for(const transitioning of [false,true]) {
    let waits=0;
    const result=await runAside(options(),{featureEnabled:flags,observePage:async()=>state({transitioning,elements:[]}),
      chooseStep:async()=>({operation:'WAIT',confidence:0.9,requested:true}),pause:async ms=>{assert.equal(ms,250);waits++;},writeAction:async()=>{throw Error('no action');}});
    assert.equal(result.status,'needs_aside_host');assert.equal(result.actions,0);assert.equal(waits,transitioning?2:0);
  }
});

test('unused WAIT branch and invalid click target cannot cause side effects',async()=>{
  for(const selected of [{operation:'HANDOFF',reason:'low_confidence',requested:true},{operation:'CLICK',targetId:'missing',confidence:1,requested:true}]) {
    const result=await runAside(options(),{featureEnabled:flags,observePage:async(_o,expected)=>{assert.equal(expected,undefined);return state();},
      chooseStep:async()=>selected,pause:async()=>{throw Error('no wait');},writeAction:async()=>{throw Error('no action');}});
    assert.equal(result.actions,0);assert.ok(['needs_aside_host','invalid_choice'].includes(result.status));
  }
});

test('disabled fanout retains the prior single-target path',async()=>{
  let single=0;
  const result=await runAside(options({execute:false}),{featureEnabled:name=>name!=='browser_fanout',observePage:async()=>state(),
    chooseSingle:async()=>{single++;return {choice:'e1',confidence:0.9};},chooseStep:async()=>{throw Error('fanout disabled');}});
  assert.equal(result.status,'selected');assert.equal(single,1);
});

test('confirmed done state and disabled browser selection make no Jev call',async()=>{
  for(const disabled of [false,true]) {
    const result=await runAside(options(),{featureEnabled:()=>!disabled,observePage:async()=>state({done:true}),chooseStep:async()=>{throw Error('no decision');}});
    assert.equal(result.status,disabled?'disabled':'done');assert.equal(result.actions,0);
  }
});
