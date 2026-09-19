import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {measure,review} from '../integration/visual-review.mjs';

const observation=()=>({viewport:{width:320,height:200},elements:[
  {id:'a',rect:{x:10,y:10,width:44,height:44},text:'Open settings',foreground:'#000',background:'#fff'},
  {id:'b',rect:{x:70,y:10,width:44,height:44},text:'Next',foreground:'#777777',background:'#ffffff'}]});
const check=(id,type,ids,min,extra={})=>({id,type,ids,...(min===undefined?{}:{min}),...extra});
const checks=()=>[check('inside','inside_viewport',['a']),check('target','min_target',['a'],44),check('color','contrast',['a'],7),check('separate','no_overlap',['a','b']),check('space','gap',['a','b'],16,{axis:'x'}),check('label','contains_text',['a'],undefined,{text:'settings'})];
const assessment=()=>({mode:'assess',question:'Do the supplied metrics support these explicit checks?',observation:observation(),checks:checks()});
const candidate=(id,extra={})=>({id,label:`Candidate ${id}`,tokens:{background:'#fff',spacing:16,enabled:true,note:null},observation:observation(),checks:checks(),...extra});
const picking=()=>({mode:'pick',question:'Choose a candidate supported by the supplied checks.',candidates:[candidate('one'),candidate('two',{tokens:{background:'#eee',spacing:20}})]});
const answer=(choice='METRICS_SUPPORTED',confidence=0.99)=>({choice,confidence});
async function fixture(t) {
  const cacheDir=await mkdtemp(path.join(os.tmpdir(),'jev-visual-review-'));
  t.after(()=>rm(cacheDir,{recursive:true,force:true}));
  return {cacheDir,active:true,now:()=>1000000};
}

test('supplied geometry, explicit targets, contrast and literal text are deterministic',()=>{
  const result=measure(observation(),checks());
  assert.equal(result.status,'PASS');assert.ok(result.checks.every(value=>value.status==='PASS'));assert.equal(result.pixel_review,'NOT_PERFORMED');assert.equal(result.scope,'supplied_metrics_only');
  assert.equal(result.checks.find(value=>value.id==='color').evidence.ratio,21);assert.equal(result.checks.find(value=>value.id==='space').evidence.gap,16);
  assert.ok(!JSON.stringify(result).includes('Open settings'));
});

test('deterministic failures remain FAIL and touching edges are not overlap',()=>{
  const observed=observation();observed.elements[0].rect.x=-1;observed.elements[1].rect.x=20;
  const result=measure(observed,[check('inside','inside_viewport',['a']),check('target','min_target',['a'],45),check('contrast','contrast',['b'],4.5),check('overlap','no_overlap',['a','b']),check('gap','gap',['a','b'],1,{axis:'x'}),check('text','contains_text',['a'],undefined,{text:'SETTINGS'})]);
  assert.equal(result.status,'FAIL');assert.ok(result.checks.every(value=>value.status==='FAIL'));
  observed.elements[1].rect.x=43;assert.equal(measure(observed,[check('touch','no_overlap',['a','b'])]).status,'PASS');
});

test('vertical and reversed-order gaps use exact separation with an explicit threshold',()=>{
  const observed=observation();observed.elements[1].rect.y=64;
  const result=measure(observed,[check('vertical','gap',['b','a'],10,{axis:'y'})]);assert.equal(result.status,'PASS');assert.equal(result.checks[0].evidence.gap,10);
});

test('missing elements, unsupported colors, thresholds and evidence remain UNKNOWN',()=>{
  const observed=observation();delete observed.viewport;delete observed.elements[0].rect;delete observed.elements[0].text;observed.elements[0].foreground='rgba(0,0,0,.5)';
  for(const input of [check('missing','inside_viewport',['absent']),check('rect','inside_viewport',['a']),check('target','min_target',['b']),check('color','contrast',['a'],4.5),check('label','contains_text',['a'],undefined,{text:'x'}),check('axis','gap',['b','b'],4),check('unsupported','beauty',['a'])])assert.equal(measure(observed,[input]).status,'UNKNOWN');
  assert.equal(measure(observation(),[]).status,'UNKNOWN');assert.equal(measure({elements:observation().elements},[check('viewport','inside_viewport',['a'])]).status,'UNKNOWN');
  assert.equal(measure(observation(),[check('gap','gap',['a','b'],3)]).status,'UNKNOWN');
});

test('malformed numeric bounds, duplicate IDs and collection limits reject',()=>{
  for(const change of [{x:NaN},{width:-1},{height:Infinity},{x:10000001}]){const observed=observation();Object.assign(observed.elements[0].rect,change);assert.throws(()=>measure(observed,checks()));}
  const duplicate=observation();duplicate.elements[1].id='a';assert.throws(()=>measure(duplicate,checks()),/invalid_element/);
  assert.throws(()=>measure({...observation(),viewport:{width:0,height:200}},checks()),/invalid_viewport/);
  assert.throws(()=>measure({elements:Array.from({length:81},(_,i)=>({id:`e${i}`}))},[]),/invalid_observation/);
  assert.throws(()=>measure(observation(),Array.from({length:33},(_,i)=>check(`c${i}`,'inside_viewport',['a']))),/invalid_checks/);
  assert.throws(()=>measure(observation(),[check('bad','min_target',['a'],-1)]),/invalid_threshold/);
});

test('disabled assessment performs no semantic call and never certifies pixels',async t=>{
  const options=await fixture(t),result=await review(assessment(),{...options,active:false,decide:()=>assert.fail('disabled')});
  assert.equal(result.measurement.status,'PASS');assert.equal(result.status,'UNKNOWN');assert.equal(result.decision.choice,'UNKNOWN');assert.equal(result.decision.source,'inactive');assert.equal(result.selected,null);assert.equal(result.pixel_review,'NOT_PERFORMED');assert.match(result.evidence_hash,/^[a-f0-9]{64}$/);assert.equal((await readdir(options.cacheDir)).length,0);
});

test('deterministic FAIL and UNKNOWN cannot be overridden by a semantic answer',async t=>{
  const options=await fixture(t);
  for(const min of [45,undefined]) {
    const spec=assessment();spec.checks=[check('size','min_target',['a'],min)];
    const result=await review(spec,{...options,decide:()=>assert.fail('metric failure cannot go to Jev')});assert.equal(result.decision.choice,'UNKNOWN');assert.equal(result.status,min===45?'FAIL':'UNKNOWN');
  }
});

test('assessment supports metrics or asks for pixels without pretending to inspect them',async t=>{
  const options=await fixture(t),sent=[];
  const supported=await review(assessment(),{...options,decide:async state=>{sent.push(state);return answer();}});
  assert.equal(supported.status,'PASS');assert.equal(supported.decision.choice,'METRICS_SUPPORTED');assert.equal(supported.decision.source,'jev');assert.equal(supported.pixel_review,'NOT_PERFORMED');assert.ok(!JSON.stringify(sent).includes('Open settings'));
  const pixels=await review({...assessment(),question:'Does the appearance look balanced?'},{...options,decide:async()=>answer('PIXEL_REVIEW')});assert.equal(pixels.status,'UNKNOWN');assert.equal(pixels.decision.choice,'PIXEL_REVIEW');assert.equal(pixels.pixel_review,'NOT_PERFORMED');
});

test('valid UNKNOWN and low confidence preserve Jev provenance while invalid or unavailable replies do not',async t=>{
  const options=await fixture(t);
  for(const [decide,source,confidence] of [
    [async()=>answer('METRICS_SUPPORTED',0.89),'jev',0.89],
    [async()=>answer('UNKNOWN'),'jev',0.99],
    [async()=>answer('UNKNOWN',0),'jev',0],
    [async()=>answer('INVALID'),'unavailable',null],
    [async()=>null,'unavailable',null],
    [async()=>{throw Error('offline');},'unavailable',null],
    [async()=>answer('METRICS_SUPPORTED',1.1),'unavailable',null],
    [async()=>answer('METRICS_SUPPORTED',NaN),'unavailable',null]
  ]) {
    const result=await review(assessment(),{...options,decide});assert.equal(result.status,'UNKNOWN');assert.deepEqual(result.decision,{choice:'UNKNOWN',confidence,source});assert.equal(result.selected,null);assert.equal(result.cache_hit,false);assert.equal((await readdir(options.cacheDir)).length,0);
  }
});

test('pick also preserves valid low-confidence and UNKNOWN responses without selecting tokens',async t=>{
  const options=await fixture(t);
  for(const decision of [answer('one',0.85),answer('UNKNOWN',0.97)]) {
    const result=await review(picking(),{...options,decide:async()=>decision});
    assert.deepEqual(result.decision,{choice:'UNKNOWN',confidence:decision.confidence,source:'jev'});assert.equal(result.status,'UNKNOWN');assert.equal(result.selected,null);assert.equal((await readdir(options.cacheDir)).length,0);
  }
});

test('pick excludes failed or unknown candidates and returns original selected tokens verbatim',async t=>{
  const options=await fixture(t),spec=picking();
  spec.candidates.push(candidate('failed',{checks:[check('tooBig','min_target',['a'],50)]}),candidate('unknown',{checks:[check('unspecified','min_target',['a'])]}));
  const original=JSON.stringify(spec.candidates[1].tokens);
  const result=await review(spec,{...options,decide:async(state,_instructions,criteria)=>{assert.deepEqual(state.candidates.map(value=>value.id),['one','two']);assert.deepEqual(Object.keys(criteria),['one','two','UNKNOWN']);return answer('two');}});
  assert.equal(result.selected.id,'two');assert.equal(JSON.stringify(result.selected.tokens),original);assert.equal(result.status,'PASS');assert.deepEqual(result.candidate_measurements.map(value=>value.measurement.status),['PASS','PASS','FAIL','UNKNOWN']);assert.equal(result.pixel_review,'NOT_PERFORMED');
});

test('invalid or disqualified candidate choice stays UNKNOWN and no eligible candidate skips Jev',async t=>{
  const options=await fixture(t),spec=picking();spec.candidates[1].checks=[check('tooBig','min_target',['a'],100)];
  for(const choice of ['missing','two']) {const result=await review(spec,{...options,decide:async()=>answer(choice)});assert.equal(result.selected,null);assert.equal(result.status,'UNKNOWN');}
  spec.candidates[0].checks=[];const none=await review(spec,{...options,decide:()=>assert.fail('no candidate passes')});assert.equal(none.selected,null);assert.equal(none.status,'UNKNOWN');
});

test('confident cache contains only decision metadata, remains private, and invalidates on inputs/TTL',async t=>{
  const options=await fixture(t),spec=picking();spec.candidates[1].label='PRIVATE_LABEL_MARKER';spec.candidates[1].tokens.note='PRIVATE_TOKEN_VALUE';let calls=0;
  const decide=async()=>{calls++;return answer('two');};
  await review(spec,{...options,decide});const hit=await review(spec,{...options,decide});assert.equal(calls,1);assert.equal(hit.cache_hit,true);assert.equal(hit.decision.source,'cache');
  const files=await readdir(options.cacheDir),filename=path.join(options.cacheDir,files[0]),raw=await readFile(filename,'utf8');assert.equal(files.length,1);
  for(const marker of ['PRIVATE_LABEL_MARKER','PRIVATE_TOKEN_VALUE',spec.question,'Open settings'])assert.ok(!raw.includes(marker));assert.equal((await stat(filename)).mode&0o777,0o600);assert.equal((await stat(options.cacheDir)).mode&0o777,0o700);
  await review({...spec,question:'Choose based on an updated question.'},{...options,decide});
  const changed=structuredClone(spec);changed.candidates[1].tokens.spacing=24;await review(changed,{...options,decide});
  await review(spec,{...options,now:()=>1000000+60*60*1000,decide});assert.equal(calls,4);
});

test('tampered cached choices or schema never bypass valid choices',async t=>{
  const options=await fixture(t),spec=assessment();let calls=0;const decide=async()=>{calls++;return answer();};
  await review(spec,{...options,decide});const filename=path.join(options.cacheDir,(await readdir(options.cacheDir))[0]),valid=JSON.parse(await readFile(filename,'utf8'));
  for(const changed of [{...valid,choice:'UNKNOWN'},{...valid,confidence:0.4},{...valid,schema:'unsupported'}]){await writeFile(filename,JSON.stringify(changed));const result=await review(spec,{...options,decide});assert.equal(result.cache_hit,false);}
  assert.equal(calls,4);
});

test('credential-bearing questions, labels, tokens or observations are withheld before any API call',async t=>{
  const options=await fixture(t),secrets=['Authorization: Bearer synthetic-value','api_key=synthetic-value','token=synthetic-value','https://user:password@example.test/'];
  for(const secret of secrets) {
    const spec=assessment();spec.observation.elements[0].text=secret;spec.checks=[check('inside','inside_viewport',['a'])];
    const result=await review(spec,{...options,decide:()=>assert.fail('credential source')});assert.equal(result.decision.source,'withheld');assert.equal(result.decision.choice,'UNKNOWN');assert.equal(result.status,'UNKNOWN');
  }
  const question={...assessment(),question:'password=synthetic-value'};assert.equal((await review(question,{...options,decide:()=>assert.fail('secret question')})).decision.source,'withheld');
  const spec=picking();spec.candidates[0].tokens.api_key='synthetic-value';const withheld=await review(spec,{...options,decide:()=>assert.fail('secret metadata')});assert.equal(withheld.decision.source,'withheld');assert.equal(withheld.selected,null);assert.equal((await readdir(options.cacheDir)).length,0);
});

test('image/base64 payloads, oversized specs and invalid candidate tokens reject',async t=>{
  const options=await fixture(t);
  await assert.rejects(review({...assessment(),image_url:'https://example.test/screen.png'},options),/pixel_input_not_supported/);
  const image=assessment();image.observation.elements[0].text='data:image/png;base64,AAAA';await assert.rejects(review(image,options),/pixel_input_not_supported/);
  await assert.rejects(review({...assessment(),question:'q '.repeat(257)},options),/invalid_review_spec/);
  await assert.rejects(review({...assessment(),extra:'long '.repeat(14000)},options),/spec_too_large/);
  const nested=picking();nested.candidates[0].tokens.nested={color:'#fff'};await assert.rejects(review(nested,options),/invalid_candidate_tokens/);
  const many=picking();many.candidates=Array.from({length:9},(_,i)=>candidate(`c${i}`));await assert.rejects(review(many,options),/invalid_candidates/);
  const duplicate=picking();duplicate.candidates[1].id='one';await assert.rejects(review(duplicate,options),/invalid_candidate/);
});
