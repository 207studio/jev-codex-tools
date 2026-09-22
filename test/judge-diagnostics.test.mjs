import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {judge, runCli} from '../jev-judge.mjs';

const flags = name => name === 'judge' || name === 'unknown_diagnostics';
const disabledDiagnostics = name => name === 'judge';
const primaryAnswer = (choice = 'UNKNOWN', confidence = 0.9) => ({type:'choice', choice, confidence,
  probabilities:Object.fromEntries(['YES', 'NO', 'UNKNOWN'].map(label => [label, label === choice ? 1 : 0]))});
const ok = answers => ({ok:true, status:200, json:async () => ({model:'jev-test', answers})});

async function fixture(t, text = 'PAUSE') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jev-judge-diagnostics-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const file = path.join(root, 'evidence.txt');
  await writeFile(file, text);
  return {file, cacheDir:path.join(root, 'cache'), question:'Does the supplied evidence support proceeding?',
    key:'synthetic-test-key', isEnabled:flags};
}

function mockFetch(answer = primaryAnswer(), reason = 'MISSING_OPTION') {
  const calls = [];
  return {calls, fetchImpl:async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (calls.length === 1) return ok({decision:answer});
    assert.equal(calls.length, 2, 'diagnosis must never recurse or retry');
    assert.equal(body.questions.reason.type, 'choice');
    assert.deepEqual(Object.keys(body.questions), ['reason']);
    const selections = {reason};
    return ok(Object.fromEntries(Object.entries(body.questions).map(([id, question]) => [id, {
      type:'choice', choice:selections[id], confidence:0.9,
      probabilities:Object.fromEntries(Object.keys(question.criteria).map(label => [label, label === selections[id] ? 1 : 0])),
    }])));
  }};
}

test('valid UNKNOWN keeps the original decision and request contract while adding one diagnosis', async t => {
  const options = await fixture(t), answer = primaryAnswer(), original = structuredClone(answer);
  const mock = mockFetch(answer);
  const output = await judge({...options, noCache:true, fetchImpl:mock.fetchImpl});
  assert.equal(output.decision, 'UNKNOWN');
  assert.equal(output.observed_choice, 'UNKNOWN');
  assert.equal(output.observed_confidence, 0.9);
  assert.equal(output.reason, 'EXPLICIT_UNKNOWN');
  assert.equal(output.apiCalls, 2);
  assert.equal(output.diagnosis.reason, 'MISSING_OPTION');
  assert.equal(output.diagnosis.proposed_option, undefined);
  assert.equal(output.unknown_reason.inferred, true);
  assert.equal(output.unknown_reason.source, 'jev');
  assert.match(output.unknown_reason.display, /추정/);
  assert.equal(mock.calls[0].questions.decision.instructions.question, options.question);
  assert.equal(typeof mock.calls[0].questions.decision.instructions, 'object');
  assert.equal(mock.calls[1].state.original_instructions, options.question);
  assert.deepEqual(answer, original);
});

test('low confidence YES remains UNKNOWN and preserves observed choice and confidence', async t => {
  const options = await fixture(t), mock = mockFetch(primaryAnswer('YES', 0.65), 'LOW_CONFIDENCE');
  const output = await judge({...options, noCache:true, fetchImpl:mock.fetchImpl});
  assert.equal(output.decision, 'UNKNOWN');
  assert.equal(output.observed_choice, 'YES');
  assert.equal(output.observed_confidence, 0.65);
  assert.equal(output.reason, 'LOW_CONFIDENCE');
  assert.equal(output.diagnosis, null);
  assert.equal(output.unknown_reason.code, 'LOW_CONFIDENCE');
  assert.equal(output.unknown_reason.inferred, false);
  assert.equal(output.apiCalls, 1);
});

test('cached UNKNOWN makes zero calls and stores diagnosis without literal value or path', async t => {
  const options = await fixture(t), mock = mockFetch();
  const first = await judge({...options, fetchImpl:mock.fetchImpl});
  const second = await judge({...options, fetchImpl:async () => { assert.fail('cache hit must not call the API'); }});
  assert.equal(first.apiCalls, 2);
  assert.equal(second.apiCalls, 0);
  assert.equal(second.source, 'cache');
  assert.equal(second.decision, 'UNKNOWN');
  assert.equal(second.observed_choice, first.observed_choice);
  assert.equal(second.observed_confidence, first.observed_confidence);
  assert.deepEqual(second.diagnosis, {reason:'MISSING_OPTION', confidence:0.9, request_attempted:true, proposed_option_present:false});
  assert.deepEqual(second.unknown_reason, first.unknown_reason);
  const [name] = await readdir(options.cacheDir);
  const raw = await readFile(path.join(options.cacheDir, name), 'utf8');
  assert.equal(raw.includes('PAUSE'), false);
  assert.equal(raw.includes('$["evidence"]'), false);
  assert.deepEqual(Object.keys(JSON.parse(raw).diagnosis).sort(), ['confidence', 'proposed_option_present', 'reason', 'request_attempted']);
});

test('disabled diagnostics preserves default one-word stdout and does not add a request', async t => {
  const options = await fixture(t), mock = mockFetch();
  const output = await runCli(['--file', options.file, '--question', options.question, '--no-cache'],
    {...options, fetchImpl:mock.fetchImpl, isEnabled:disabledDiagnostics});
  assert.equal(output.stdout, 'UNKNOWN');
  assert.equal(output.exitCode, 3);
  assert.match(output.stderr, /^UNKNOWN · 원인/);
  assert.equal(mock.calls.length, 1);
});

test('confident YES and NO never invoke unknown diagnostics', async t => {
  const options = await fixture(t);
  for (const choice of ['YES', 'NO']) {
    const mock = mockFetch(primaryAnswer(choice));
    const output = await runCli(['--file', options.file, '--question', options.question, '--no-cache'],
      {...options, fetchImpl:mock.fetchImpl});
    assert.equal(output.stdout, choice);
    assert.equal(output.exitCode, 0);
    assert.equal(mock.calls.length, 1);
  }
});

test('--details emits observed fields and diagnosis without revising UNKNOWN', async t => {
  const options = await fixture(t), mock = mockFetch();
  const output = await runCli(['--file', options.file, '--question', options.question, '--no-cache', '--details'],
    {...options, fetchImpl:mock.fetchImpl});
  const data = JSON.parse(output.stdout);
  assert.equal(data.decision, 'UNKNOWN');
  assert.equal(data.source, 'jev');
  assert.equal(data.apiCalls, 2);
  assert.equal(data.observed_choice, 'UNKNOWN');
  assert.equal(data.observed_confidence, 0.9);
  assert.equal(data.reason, 'EXPLICIT_UNKNOWN');
  assert.equal(data.diagnosis.reason, 'MISSING_OPTION');
  assert.equal(output.exitCode, 3);
});

test('--details error output includes only fixed codes and API count', async t => {
  const options = await fixture(t);
  for (const [fetchImpl, reason] of [
    [async () => ({ok:false, status:503, json:async () => { throw new Error('private response'); }}), 'HTTP_503'],
    [async () => { throw new Error('Bearer private-key user@example.com'); }, 'REQUEST_FAILED'],
    [async () => { throw Object.assign(new Error('private timeout detail'), {name:'TimeoutError'}); }, 'REQUEST_TIMEOUT'],
    [async () => ({ok:false, status:'private-key'}), 'HTTP_ERROR'],
    [async () => ok({decision:{choice:'UNKNOWN'}}), 'INVALID_RESPONSE'],
  ]) {
    const output = await runCli(['--file', options.file, '--question', options.question, '--no-cache', '--details'],
      {...options, fetchImpl});
    const {unknown_reason, ...fields} = JSON.parse(output.stdout);
    assert.deepEqual(fields, {decision:'UNKNOWN', source:'error', apiCalls:1,
      observed_choice:null, observed_confidence:null, reason, diagnosis:null});
    assert.equal(unknown_reason.source, 'runtime');
    assert.equal(unknown_reason.inferred, false);
    assert.equal(output.stderr, reason);
    assert.equal(output.exitCode, 2);
    assert.equal(output.stdout.includes('private'), false);
  }
});

test('missing credentials and invalid CLI options never call the API', async t => {
  const options = await fixture(t);
  const missing = await runCli(['--file', options.file, '--question', options.question, '--details', '--no-cache'],
    {...options, key:'', fetchImpl:async () => assert.fail('missing credentials must not fetch')});
  assert.equal(JSON.parse(missing.stdout).reason, 'MISSING_KEY');
  assert.equal(JSON.parse(missing.stdout).apiCalls, 0);
  const invalid = await runCli(['--details', '--unrecognized'], options);
  assert.equal(JSON.parse(invalid.stdout).reason, 'LOCAL_IO_OR_ARGUMENT_ERROR');
  assert.equal(JSON.parse(invalid.stdout).apiCalls, 0);
});

test('unsafe original evidence withholds only diagnostics and retains the primary UNKNOWN', async t => {
  const options = await fixture(t, 'person@example.com'), mock = mockFetch();
  const output = await judge({...options, noCache:true, fetchImpl:mock.fetchImpl});
  assert.equal(output.decision, 'UNKNOWN');
  assert.equal(output.observed_choice, 'UNKNOWN');
  assert.equal(output.apiCalls, 1);
  assert.deepEqual(output.diagnosis, {reason:'INPUT_WITHHELD', confidence:0, request_attempted:false});
});

test('a low-confidence explicit UNKNOWN never adds a semantic request', async t => {
  const options = await fixture(t), mock = mockFetch(primaryAnswer('UNKNOWN', 0.5));
  const output = await judge({...options, noCache:true, fetchImpl:mock.fetchImpl});
  assert.equal(mock.calls.length, 1);
  assert.equal(output.unknown_reason.code, 'LOW_CONFIDENCE');
});

test('plain error stdout stays parseable while stderr gives a safe Korean action', async t => {
  const options = await fixture(t);
  const output = await runCli(['--file', options.file, '--question', options.question, '--no-cache'],
    {...options, key:'', fetchImpl:async () => assert.fail('must not call without a key')});
  assert.equal(output.stdout, 'UNKNOWN');
  assert.equal(output.exitCode, 2);
  assert.match(output.stderr, /^MISSING_KEY: UNKNOWN · 인증 정보 없음/);
});
