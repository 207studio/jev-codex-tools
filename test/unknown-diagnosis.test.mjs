import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseUnknown} from '../integration/unknown-diagnosis.mjs';

const input = () => ({
  state:{available:['RUN', 'PAUSE']}, instructions:'Choose the appropriate next label.',
  criteria:{RUN:'Continue the requested operation.', UNKNOWN:'Insufficient evidence.'},
  answer:{choice:'UNKNOWN', confidence:0.95},
});
const head = (choice, confidence = 0.9) => ({choice, confidence});
const response = (reason = 'MISSING_OPTION', candidate = 'C1', confidence = 0.9) => ({reason:head(reason), candidate:head(candidate, confidence)});

test('one request proposes an exact missing literal and preserves the original response', async () => {
  const original = input(), before = structuredClone(original);
  let calls = 0;
  const diagnostic = await diagnoseUnknown(original, {decideMany:async (state, questions, options) => {
    calls++;
    assert.equal(Buffer.byteLength(JSON.stringify(state)) <= 6000, true);
    assert.equal(options.timeout, 1500);
    assert.deepEqual(Object.keys(questions), ['reason', 'candidate']);
    assert.equal(questions.reason.type, 'choice');
    assert.equal(questions.candidate.type, 'choice');
    assert.equal(state.literal_candidates.length, 1);
    assert.deepEqual(state.literal_candidates[0], {id:'C1', value:'PAUSE', path:'$["available"][1]'});
    return response();
  }});
  assert.deepEqual(diagnostic, {reason:'MISSING_OPTION', confidence:0.9, request_attempted:true,
    proposed_option:{value:'PAUSE', path:'$["available"][1]'}});
  assert.deepEqual(original, before);
  assert.equal(calls, 1);
});

test('unrelated reason does not require or use candidate confidence', async () => {
  const result = await diagnoseUnknown(input(), {decideMany:async () => ({reason:head('MISSING_EVIDENCE'), candidate:head('C1', NaN)})});
  assert.equal(result.reason, 'MISSING_EVIDENCE');
  assert.equal(result.confidence, 0.9);
  assert.equal(result.proposed_option, undefined);
});

test('low reason confidence remains UNKNOWN even with a strong candidate', async () => {
  const result = await diagnoseUnknown(input(), {decideMany:async () => ({reason:head('MISSING_OPTION', 0.69), candidate:head('C1', 1)})});
  assert.deepEqual(result, {reason:'UNKNOWN', confidence:0, request_attempted:true});
});

test('candidate confidence, NONE, UNKNOWN and invented candidates cannot create an option', async () => {
  for (const candidate of [head('C1', 0.69), head('NONE'), head('UNKNOWN'), head('C99'), head('PAUSE'), head('C1', 1.1)]) {
    const result = await diagnoseUnknown(input(), {decideMany:async () => ({reason:head('MISSING_OPTION'), candidate})});
    assert.equal(result.reason, 'MISSING_OPTION');
    assert.equal(result.proposed_option, undefined);
  }
});

test('a literal removed during the request is not proposed', async () => {
  const original = input();
  const result = await diagnoseUnknown(original, {decideMany:async () => {
    original.state.available.pop();
    return response();
  }});
  assert.equal(result.proposed_option, undefined);
});

test('replacing state with a getter during a request does not execute it', async () => {
  const original = input();
  let getters = 0;
  const result = await diagnoseUnknown(original, {decideMany:async () => {
    Object.defineProperty(original, 'state', {get() { getters++; return {available:['RUN', 'PAUSE']}; }});
    return response();
  }});
  assert.equal(result.proposed_option, undefined);
  assert.equal(getters, 0);
});

test('candidate extraction is bounded and excludes existing keys and long prose', async () => {
  const original = input();
  original.state = {labels:['RUN', 'run', 'This sentence is deliberately far too long to serve as a short option label.',
    ...Array.from({length:12}, (_, i) => `LABEL_${i}`)]};
  await diagnoseUnknown(original, {decideMany:async state => {
    assert.equal(state.literal_candidates.length, 8);
    assert.deepEqual(state.literal_candidates.map(value => value.value), Array.from({length:8}, (_, i) => `LABEL_${i}`));
    return response('UNKNOWN', 'UNKNOWN');
  }});
});

test('sensitive original values and suspicious JSON path keys make zero requests', async () => {
  const unsafeStates = [
    {value:'TYPESAFE_API_KEY'}, {value:'sk-proj-1234567890abcdef'}, {value:'person@example.com'},
    {value:'/Users/example/document'}, {value:'file:///Users/example/document'}, {value:'../private'}, {value:'C:\\Users\\example'},
    {value:'https://example.com/search?q=private'}, {value:'%2FUsers%2Fexample'},
    {'safe"]["other':'PAUSE'}, {'api_key':'PAUSE'}, {token:'PAUSE'}, {'la\u200bbel':'PAUSE'},
    JSON.parse('{"__proto__":"PAUSE"}'), {value:'Bearer abcdefghijklmnop'},
  ];
  let calls = 0;
  for (const state of unsafeStates) {
    const result = await diagnoseUnknown({...input(), state}, {decideMany:async () => { calls++; return response(); }});
    assert.equal(result.reason, 'INPUT_WITHHELD');
    assert.equal(result.request_attempted, false);
  }
  assert.equal(calls, 0);
});

test('sensitive instructions, criteria and original answer are also withheld', async () => {
  let calls = 0;
  for (const extra of [{instructions:'Read /home/example/file'}, {criteria:{RUN:'Email person@example.com'}},
    {answer:{choice:'UNKNOWN', confidence:0, access_token:'private'}}]) {
    const result = await diagnoseUnknown({...input(), ...extra}, {decideMany:async () => { calls++; }});
    assert.equal(result.reason, 'INPUT_WITHHELD');
    assert.equal(result.request_attempted, false);
  }
  assert.equal(calls, 0);
});

test('oversized state, instructions or criteria produce no API request', async () => {
  let calls = 0;
  for (const extra of [{state:{text:'a'.repeat(6001)}}, {state:{text:'a'.repeat(5900)}},
    {instructions:'a'.repeat(1001)}, {criteria:Object.fromEntries(Array.from({length:25}, (_, i) => [`LABEL_${i}`, 'A label']))}]) {
    const result = await diagnoseUnknown({...input(), ...extra}, {decideMany:async () => { calls++; }});
    assert.equal(result.reason, 'INPUT_LIMIT');
    assert.equal(result.request_attempted, false);
  }
  assert.equal(calls, 0);
});

test('invalid objects, cycles and getters are withheld without executing a getter', async () => {
  const cyclic = {}; cyclic.self = cyclic;
  let getters = 0, calls = 0;
  const getter = {}; Object.defineProperty(getter, 'label', {enumerable:true, get() { getters++; return 'PAUSE'; }});
  for (const state of [cyclic, getter, new Date(), {label:undefined}, {label:Infinity}]) {
    const result = await diagnoseUnknown({...input(), state}, {decideMany:async () => { calls++; }});
    assert.equal(result.reason, 'INPUT_WITHHELD');
    assert.equal(result.request_attempted, false);
  }
  assert.equal(getters, 0);
  assert.equal(calls, 0);
});

test('timeout and thrown or invalid responses remain UNKNOWN with one attempted request', async () => {
  for (const operation of [() => new Promise(() => {}), () => { throw new Error('Unavailable'); },
    () => null, () => ({reason:head('UNRECOGNIZED'), candidate:head('C1')})]) {
    let calls = 0;
    const result = await diagnoseUnknown(input(), {timeout:5, decideMany:() => { calls++; return operation(); }});
    assert.deepEqual(result, {reason:'UNKNOWN', confidence:0, request_attempted:true});
    assert.equal(calls, 1);
  }
});

test('free text in a response cannot supply a value or path', async () => {
  const result = await diagnoseUnknown(input(), {decideMany:async () => ({
    reason:head('MISSING_OPTION'), candidate:{...head('NONE'), value:'DELETE', path:'$["other"]'},
    proposed_option:{value:'DELETE', path:'$["other"]'},
  })});
  assert.equal(result.proposed_option, undefined);
});
