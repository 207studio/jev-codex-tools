import test from 'node:test';
import assert from 'node:assert/strict';
import {formatUnknownReason} from '../integration/unknown-reason.mjs';

test('observed runtime boundaries override stale semantic diagnoses', () => {
  for (const [status, code] of [['http_error','HTTP_ERROR'],['timeout','TIMEOUT'],['low_confidence','LOW_CONFIDENCE']]) {
    const reason = formatUnknownReason({status, diagnosis:{reason:'MISSING_EVIDENCE',confidence:1,request_attempted:true}});
    assert.equal(reason.code,code);assert.equal(reason.source,'runtime');assert.equal(reason.inferred,false);assert.ok(!reason.display.includes('(추정)'));
  }
});

test('known local diagnosis limits are observed without exposing inputs', () => {
  for (const code of ['INPUT_WITHHELD','INPUT_LIMIT','BUDGET_EXHAUSTED']) {
    const reason = formatUnknownReason({status:'explicit_unknown',diagnosis:{reason:code,confidence:0,request_attempted:false,input:'private'}});
    assert.equal(reason.code,code);assert.equal(reason.source,'runtime');assert.equal(reason.inferred,false);assert.ok(!JSON.stringify(reason).includes('private'));
  }
});
