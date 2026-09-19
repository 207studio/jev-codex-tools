import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {decideTool} from '../integration/tool-decisions.mjs';

async function fixture(t) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(),'jev-tool-decisions-'));
  t.after(() => rm(stateDir,{recursive:true,force:true}));
  return {stateDir,active:true};
}
const event = (tool_name,tool_input,extra = {}) => ({hook_event_name:'PreToolUse',session_id:'session-one',turn_id:'turn-one',tool_use_id:'call-one',cwd:'/project',tool_name,tool_input,...extra});
const answer = (choice = 'read-only',confidence = 0.99) => ({choice,confidence});

test('MCP, edit, and agent calls each request an effects classification',async t => {
  const options = await fixture(t),states = [];
  for (const item of [event('mcp__notes__update',{page_id:'page-one',body:'PRIVATE_BODY'}),event('apply_patch','*** Begin Patch\n*** Update File: src/main.mjs\n@@\n+PRIVATE_PATCH_BODY\n*** End Patch'),event('spawn_agent',{message:'PRIVATE_AGENT_PROMPT'})]) {
    const result = await decideTool(item,{...options,decide:async(state,_instructions,_criteria,requestOptions) => {states.push(state);assert.deepEqual(requestOptions,{timeout:2500,retries:0});return answer('reversible');}});
    assert.equal(result.covered,true);assert.equal(result.completed,true);assert.equal(result.disposition,'native');
  }
  assert.equal(states.length,3);
  assert.deepEqual(states[1].arguments.operations,[{operation:'Update File',path:'src/main.mjs'}]);
  assert.ok(states[1].arguments.lines > 0);
  const text = JSON.stringify(states);
  for(const secret of ['PRIVATE_BODY','PRIVATE_PATCH_BODY','PRIVATE_AGENT_PROMPT'])assert.ok(!text.includes(secret));
});

test('secrets, data URLs, images, logs, and arbitrary script bodies are never sent',async t => {
  const options = await fixture(t),states = [];
  const inputs = [event('mcp__service__write',{password:'PRIVATE_PASSWORD',Authorization:'Bearer PRIVATE_BEARER',api_key:'PRIVATE_KEY',token:'PRIVATE_TOKEN',image:'data:image/png;base64,PRIVATE_IMAGE',log:'PRIVATE_LOG',path:'src/main.mjs',access_token:123456789}),event('Bash',{command:'python3 -c "print(\'PRIVATE_SCRIPT_BODY\')"'}),event('Bash',{command:'curl --header "Authorization: Bearer PRIVATE_HEADER" https://example.test'}),event('mcp__file__read',{path:'data:text/plain,PRIVATE_PATH_DATA'})];
  for(const input of inputs)await decideTool(input,{...options,decide:async state=>{states.push(state);return answer('unknown');}});
  const serialized=JSON.stringify(states);
  for(const secret of ['PRIVATE_PASSWORD','PRIVATE_BEARER','PRIVATE_KEY','PRIVATE_TOKEN','PRIVATE_IMAGE','PRIVATE_LOG','PRIVATE_SCRIPT_BODY','PRIVATE_HEADER','PRIVATE_PATH_DATA','123456789'])assert.ok(!serialized.includes(secret),secret);
  for(const state of states)assert.ok(Buffer.byteLength(JSON.stringify(state))<=4000);
  assert.equal(states[1].arguments.command_form,'complex_or_unavailable');
});

test('cache excludes tool_use_id but invalidates changed original arguments',async t => {
  const options=await fixture(t);let calls=0;
  const decide=async()=>{calls++;return answer();};
  const first=await decideTool(event('mcp__files__read',{path:'one'}),{...options,decide});
  const second=await decideTool(event('mcp__files__read',{path:'one'},{tool_use_id:'call-two'}),{...options,decide});
  const changed=await decideTool(event('mcp__files__read',{path:'two'}),{...options,decide});
  assert.equal(calls,2);assert.equal(second.source,'cache');assert.equal(first.fingerprint,second.fingerprint);assert.notEqual(changed.fingerprint,first.fingerprint);
});

test('cache expires after 120 seconds and is separated by turn',async t => {
  const options=await fixture(t);let calls=0,time=1000;
  const decide=async()=>{calls++;return answer();},now=()=>time,input=event('Bash',{command:'pwd'});
  await decideTool(input,{...options,decide,now});time+=119999;
  assert.equal((await decideTool(input,{...options,decide,now})).source,'cache');time++;
  await decideTool(input,{...options,decide,now});
  await decideTool({...input,turn_id:'turn-two'},{...options,decide,now});
  assert.equal(calls,3);
});

test('valid low-confidence and unknown results retain native policy without another judge',async t => {
  const options=await fixture(t);
  for(const [choice,confidence] of [['read-only',0.3],['unknown',0.99]]) {
    let calls=0;const input=event('mcp__service__tool',{case:choice});
    const decide=async()=>{calls++;return answer(choice,confidence);};
    for(let count=0;count<2;count++) {
      const result=await decideTool(input,{...options,decide});
      assert.equal(result.choice,'unknown');assert.equal(result.completed,true);assert.equal(result.uncertain,true);assert.equal(result.disposition,'native');assert.equal(result.hookOutput,null);
    }
    assert.equal(calls,1);
  }
});

test('provider failure is denied and cached; recovery is a caller-controlled exception',async t => {
  const options=await fixture(t);let calls=0;
  const decide=async()=>{calls++;throw Error('timeout');},input=event('mcp__service__write',{body:'PRIVATE_BODY'});
  const denied=await decideTool(input,{...options,decide});
  assert.equal(denied.completed,false);assert.equal(denied.disposition,'deny');assert.equal(denied.hookOutput.hookSpecificOutput.permissionDecision,'deny');
  const recovered=await decideTool(input,{...options,decide,recovery:true});
  assert.equal(calls,1);assert.equal(recovered.source,'cache');assert.equal(recovered.disposition,'recovery');assert.equal(recovered.completed,false);assert.equal(recovered.hookOutput,null);
  const records=(await readFile(path.join(options.stateDir,'tool-decisions.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(records.map(record=>record.disposition),['deny','recovery']);
  assert.ok(records.every(record=>record.tool_name==='mcp__service__write'));
});

test('invalid API responses cannot become completed classifications',async t => {
  const options=await fixture(t);
  for(const [index,value] of [null,{choice:'allow',confidence:1},{choice:'read-only',confidence:NaN},{type:'text',choice:'read-only',confidence:1}].entries()) {
    let calls=0;const decide=async()=>{calls++;return value;},input=event('Bash',{command:'pwd',case:index});
    const first=await decideTool(input,{...options,decide});
    const second=await decideTool(input,{...options,decide});
    assert.equal(first.disposition,'deny');assert.equal(second.completed,false);assert.equal(second.source,'cache');assert.equal(calls,1);
  }
});

test('high confidence never grants permission regardless of effect category',async t => {
  const options=await fixture(t);
  for(const choice of ['read-only','reversible','destructive','external-side-effect']) {
    const result=await decideTool(event('tool',{case:choice}),{...options,decide:async()=>answer(choice,1)});
    assert.equal(result.choice,choice);assert.equal(result.disposition,'native');assert.equal(result.hookOutput,null);
    assert.ok(!JSON.stringify(result).includes('"permissionDecision":"allow"'));
  }
});

test('audit and cache retain hashes and decisions but no original arguments or paths',async t => {
  const options=await fixture(t),input=event('mcp__documents__write',{path:'PRIVATE_FILENAME',body:'PRIVATE_DOCUMENT',password:'PRIVATE_PASSWORD'});
  await decideTool(input,{...options,decide:async()=>answer('external-side-effect')});
  let serialized='';
  for(const name of await readdir(options.stateDir)) {
    serialized+=await readFile(path.join(options.stateDir,name),'utf8');
    assert.equal((await stat(path.join(options.stateDir,name))).mode&0o077,0);
  }
  for(const text of ['PRIVATE_FILENAME','PRIVATE_DOCUMENT','PRIVATE_PASSWORD','/project'])assert.ok(!serialized.includes(text));
  const audit=JSON.parse(await readFile(path.join(options.stateDir,'tool-decisions.jsonl'),'utf8'));
  assert.equal(audit.phase,'before_execution');assert.equal(audit.tool_use_id,'call-one');assert.equal(typeof audit.input_hash,'string');
  assert.equal(audit.tool_name,'mcp__documents__write');assert.equal(audit.disposition,'native');
});

test('unavailable private state fails closed without calling the provider',async t => {
  const options=await fixture(t),badState=path.join(options.stateDir,'not-a-directory');
  await writeFile(badState,'occupied');let calls=0;
  const result=await decideTool(event('Bash',{command:'pwd'}),{...options,stateDir:badState,decide:async()=>{calls++;return answer();}});
  assert.equal(calls,0);assert.equal(result.disposition,'deny');assert.equal(result.completed,false);
});

test('oversized inputs are rejected before provider transmission',async t => {
  const options=await fixture(t);let calls=0;
  const result=await decideTool(event('Bash',{command:'x'.repeat(200000)}),{...options,decide:async()=>{calls++;return answer();}});
  assert.equal(calls,0);assert.equal(result.fingerprint,null);assert.equal(result.disposition,'deny');
});

test('disabled or non-PreToolUse calls do not invoke a provider or mutate feature flags',async t => {
  const options=await fixture(t),before=process.env.JEV_VERIFICATION_GATE_ENABLED;let calls=0;
  const decide=async()=>{calls++;return answer();};
  assert.equal((await decideTool(event('Bash',{command:'pwd'}),{...options,active:false,decide})).source,'disabled');
  assert.equal((await decideTool({...event('Bash',{command:'pwd'}),hook_event_name:'PostToolUse'},{...options,decide})).covered,false);
  assert.equal(calls,0);assert.deepEqual(await readdir(options.stateDir),[]);assert.equal(process.env.JEV_VERIFICATION_GATE_ENABLED,before);
});
