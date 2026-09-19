import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateSpec, fingerprintSpec, planVerification, runVerification, assessVerification} from '../integration/verification.mjs';
import {renderResult} from '../integration/verification-cli.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jev-verify-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const cwd = path.join(root, 'project'), stateDir = path.join(root, 'state');
  await mkdir(cwd); await writeFile(path.join(cwd, 'source.mjs'), 'export const value = 1;\n');
  const spec = {task:'Change one small function', goal:'The focused check supports the changed function', cwd, files:['source.mjs'], scope_complete:true, mandatory:false, risk:'low', new_failure:false, argv:['check-original','--one'], narrow_argv:['check-narrow','--one']};
  return {root,cwd,stateDir,spec};
}
const enabled = () => true;
const reply = choice => async () => ({choice,confidence:0.99});
function runner(calls, exitCode = 0, extra = {}) {
  return async (argv, {cwd,logPath}) => {
    calls.push({argv,cwd}); await writeFile(logPath, 'Focused check passed.\n', {mode:0o600});
    return {executed:true, exit_code:exitCode, log_path:logPath, timed_out:false, ...extra};
  };
}

test('SKIP cannot override mandatory, high-risk, new failure, or incomplete scope', async t => {
  const {spec,stateDir} = await fixture(t);
  for (const patch of [{mandatory:true},{risk:'high'},{new_failure:true},{scope_complete:false},{files:['missing.mjs']}]) {
    const result = await planVerification({...spec,...patch}, {stateDir,decide:reply('SKIP'),isEnabled:enabled});
    assert.notEqual(result.necessity.effective, 'SKIP');
    if (patch.mandatory || patch.risk === 'high' || patch.new_failure) assert.equal(result.necessity.effective, 'RUN');
    assert.equal(result.execution.executed, false);
  }
});

test('only complete optional low-risk scope accepts a confident SKIP', async t => {
  const {spec,stateDir} = await fixture(t), calls = [];
  const result = await runVerification(spec, {execute:true,stateDir,decide:reply('SKIP'),isEnabled:enabled,executeCommand:runner(calls)});
  assert.equal(result.necessity.effective, 'SKIP'); assert.equal(calls.length, 0);
  assert.equal(result.assessment.choice, 'INSUFFICIENT');
});

test('low confidence and missing decisions retain the nearest caller-provided check', async t => {
  const {spec,stateDir} = await fixture(t);
  for (const answer of [null,{choice:'SKIP',confidence:0.89}]) {
    const calls = [], result = await runVerification(spec, {execute:true,stateDir,decide:async()=>answer,isEnabled:enabled,executeCommand:runner(calls)});
    assert.equal(result.necessity.choice, 'UNKNOWN');
    assert.deepEqual(calls[0].argv, spec.narrow_argv);
    assert.equal(result.assessment.choice, 'INSUFFICIENT');
  }
});

test('a changed source invalidates the decision cache and the scope fingerprint', async t => {
  const {spec,stateDir,cwd} = await fixture(t); let decisions = 0;
  const decide = async () => {decisions++;return {choice:'SKIP',confidence:0.99};};
  const first = await planVerification(spec,{stateDir,decide,isEnabled:enabled});
  const cached = await planVerification(spec,{stateDir,decide,isEnabled:enabled});
  assert.equal(cached.necessity.source,'cache'); assert.equal(decisions,1);
  await writeFile(path.join(cwd,'source.mjs'),'export const value = 2;\n');
  const changed = await planVerification(spec,{stateDir,decide,isEnabled:enabled});
  assert.notEqual(changed.scope.fingerprint,first.scope.fingerprint); assert.equal(decisions,2);
});

test('source change during planning cancels a would-be skip before execution', async t => {
  const {spec,stateDir,cwd} = await fixture(t); let decisions=0; const calls=[];
  const decide=async (_state,_instructions,criteria)=>{
    if ('SUPPORTED' in criteria) return {choice:'INSUFFICIENT',confidence:0.99};
    decisions++;
    if(decisions===1){await writeFile(path.join(cwd,'source.mjs'),'export const value = 3;\n');return {choice:'SKIP',confidence:0.99};}
    return {choice:'RUN',confidence:0.99};
  };
  const result=await runVerification(spec,{execute:true,stateDir,decide,isEnabled:enabled,executeCommand:runner(calls)});
  assert.equal(decisions,2);assert.equal(result.execution.executed,true);assert.deepEqual(calls[0].argv,spec.argv);
});

test('NARROW without a supplied command cannot generate or execute a model command', async t => {
  const {spec,stateDir}=await fixture(t);delete spec.narrow_argv;const calls=[];
  const result=await runVerification(spec,{execute:true,stateDir,decide:async()=>({choice:'NARROW',confidence:0.99,argv:['model-generated']}),isEnabled:enabled,executeCommand:runner(calls)});
  assert.equal(result.necessity.effective,'RUN');assert.deepEqual(calls[0].argv,spec.argv);
});

test('invalid model choices cannot become executable commands', async t => {
  const {spec,stateDir}=await fixture(t),calls=[];
  const result=await runVerification(spec,{execute:true,stateDir,decide:reply('generated-command'),isEnabled:enabled,executeCommand:runner(calls)});
  assert.equal(result.necessity.choice,'UNKNOWN');assert.deepEqual(calls[0].argv,spec.narrow_argv);
});

test('nonzero actual exit code is preserved and cannot be promoted to SUPPORTED', async t => {
  const {spec,stateDir}=await fixture(t),calls=[];
  const decide=async(_state,_instructions,criteria)=>({choice:'RUN' in criteria?'RUN':'SUPPORTED',confidence:0.99});
  const result=await runVerification(spec,{execute:true,stateDir,decide,isEnabled:enabled,executeCommand:runner(calls,7)});
  assert.equal(result.execution.exit_code,7);assert.notEqual(result.assessment.choice,'SUPPORTED');
  assert.equal(await readFile(result.execution.log_path,'utf8'),'Focused check passed.\n');
  assert.equal((await stat(result.execution.log_path)).mode&0o077,0);
});

test('timeout never supports success even if a process exits zero', async t => {
  const {spec,stateDir}=await fixture(t),calls=[];
  const decide=async(_state,_instructions,criteria)=>({choice:'RUN' in criteria?'RUN':'SUPPORTED',confidence:0.99});
  const result=await runVerification(spec,{execute:true,stateDir,decide,isEnabled:enabled,executeCommand:runner(calls,0,{timed_out:true})});
  assert.equal(result.execution.exit_code,0);assert.notEqual(result.assessment.choice,'SUPPORTED');
});

test('disabled gate runs the original command and run without execute never invokes a runner', async t => {
  const {spec,stateDir}=await fixture(t),calls=[];
  const options={stateDir,isEnabled:()=>false,decide:async()=>{throw Error('must not call');},executeCommand:runner(calls)};
  await runVerification(spec,options);assert.equal(calls.length,0);
  const result=await runVerification(spec,{...options,execute:true});
  assert.deepEqual(calls[0].argv,spec.argv);assert.equal(result.assessment.choice,'INSUFFICIENT');
});

test('symlinks and outside paths leave scope incomplete', async t => {
  const {spec,cwd}=await fixture(t);
  await symlink(path.join(cwd,'source.mjs'),path.join(cwd,'alias.mjs'));
  for(const file of ['alias.mjs','../source.mjs'])assert.equal((await fingerprintSpec({...spec,files:[file]})).complete,false);
});

test('assessment sends only a bounded redacted tail and preserves caller exit provenance', async t => {
  const {spec,stateDir,root}=await fixture(t),log=path.join(root,'output.log');let captured;
  await writeFile(log,'older details\n'.repeat(1000)+'password=do-not-share\n');
  const result=await assessVerification(spec,{log,exitCode:0,stateDir,isEnabled:enabled,decide:async state=>{captured=state;return {choice:'INSUFFICIENT',confidence:0.99};}});
  assert.equal(captured.log.truncated,true);assert.ok(Buffer.byteLength(captured.log.tail)<4100);
  assert.ok(!captured.log.tail.includes('do-not-share'));assert.equal(result.execution.exit_code_source,'caller_supplied');
  assert.ok(Buffer.byteLength(renderResult(result))<=3999);
});

test('required spec booleans and caller commands reject malformed input', async t => {
  const {spec}=await fixture(t);
  assert.throws(()=>validateSpec({...spec,mandatory:'false'}));
  assert.throws(()=>validateSpec({...spec,argv:[]}));
  assert.throws(()=>validateSpec({...spec,unexpected:true}));
});


test('mandatory and non-low-risk checks retain original argv for NARROW and UNKNOWN', async t => {
  const {spec,stateDir}=await fixture(t);
  for(const patch of [{mandatory:true},{risk:'normal'},{risk:'high'},{new_failure:true}]) {
    for(const choice of ['NARROW','UNKNOWN']) {
      const result=await planVerification({...spec,...patch},{stateDir,decide:reply(choice),isEnabled:enabled});
      assert.equal(result.necessity.effective,'RUN');
    }
  }
});

test('a completed execution changes the next necessity cache context', async t => {
  const {spec,stateDir}=await fixture(t),calls=[];let necessityCalls=0,seenPrevious=null;
  const decide=async(state,_instructions,criteria)=>{
    if('SUPPORTED' in criteria)return {choice:'SUPPORTED',confidence:0.99};
    necessityCalls++;seenPrevious=state.previous_success;
    return {choice:seenPrevious?'SKIP':'RUN',confidence:0.99};
  };
  const options={stateDir,decide,isEnabled:enabled,executeCommand:runner(calls)};
  await planVerification(spec,options);
  await runVerification(spec,{...options,execute:true});
  assert.equal(necessityCalls,1);
  const next=await planVerification(spec,options);
  assert.equal(necessityCalls,2);assert.equal(next.necessity.effective,'SKIP');
  assert.equal(seenPrevious.exit_code,0);assert.equal(typeof seenPrevious.command_hash,'string');
});


test('relative cwd resolves against the calling process and matches the absolute scope fingerprint', async t => {
  const {spec}=await fixture(t);
  const relativeSpec={...spec,cwd:path.relative(process.cwd(),spec.cwd)};
  assert.equal(validateSpec(relativeSpec).cwd,spec.cwd);
  assert.equal(validateSpec({...spec,cwd:'.'}).cwd,process.cwd());
  assert.equal((await fingerprintSpec(relativeSpec)).key,(await fingerprintSpec(spec)).key);
});


test('uncertain or failed necessity is cached for a plan/run pair without promoting confidence', async t => {
  const {spec,stateDir}=await fixture(t);
  for(const mode of ['missing','low_confidence','failure']) {
    const input={...spec,goal:spec.goal+' '+mode,mandatory:true};let decisions=0;const calls=[];
    const decide=async()=>{
      decisions++;
      if(mode==='failure')throw Error('provider_unavailable');
      return mode==='missing'?null:{choice:'SKIP',confidence:0.5};
    };
    const options={stateDir,decide,isEnabled:name=>name==='verification_gate',executeCommand:runner(calls)};
    const planned=await planVerification(input,options);
    const result=await runVerification(input,{...options,execute:true});
    assert.equal(decisions,1);assert.equal(planned.necessity.choice,'UNKNOWN');
    assert.equal(result.necessity.choice,'UNKNOWN');assert.equal(result.necessity.confidence,0);
    assert.equal(result.necessity.source,'cache');assert.equal(result.necessity.effective,'RUN');
    assert.deepEqual(calls[0].argv,input.argv);
  }
});
