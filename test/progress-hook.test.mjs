import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const handler=fileURLToPath(new URL('../integration/codex-hooks.mjs',import.meta.url));
const progress='progress 10\n'.repeat(1000);
const evidence='src/main.mjs\nResult: completed 17 items\n';
function invoke(t,{mode='PRUNE',active=true,raw=progress+evidence,percent,exit=0}={}) {
  const root=mkdtempSync(path.join(tmpdir(),'jev-progress-hook-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'features.json'),calls=path.join(root,'requests.json');
  writeFileSync(config,JSON.stringify({instant_compaction:true,progress_compaction:active,prune:false,early_compaction:percent!==undefined}));
  let transcript;
  if(percent!==undefined) {
    const sessions=path.join(root,'codex','sessions');mkdirSync(sessions,{recursive:true});transcript=path.join(sessions,'synthetic.jsonl');
    writeFileSync(transcript,JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{model_context_window:100000,last_token_usage:{total_tokens:percent*1000}}}})+'\n');
  }
  const choice=mode==='KEEP'?'KEEP':'PRUNE',confidence=mode==='low'?0.5:0.99;
  const program=`import {writeFileSync} from 'node:fs';
    const states=[];
    globalThis.fetch=async(_url,options)=>{states.push(JSON.parse(options.body));
      ${mode==='error' ? "throw Error('synthetic transport error');" : `return {ok:true,json:async()=>({model:'jev-latest',answers:{decision:{type:'choice',choice:${JSON.stringify(choice)},confidence:${confidence},probabilities:{PRUNE:${choice==='PRUNE'?0.99:0.01},KEEP:${choice==='KEEP'?0.99:0.01}}}}})};`}
    };
    await import(${JSON.stringify(handler)});writeFileSync(${JSON.stringify(calls)},JSON.stringify(states));`;
  const response=spawnSync(process.execPath,['--input-type=module','--eval',program],{
    env:{...process.env,JEV_TOOLS_HOME:root,JEV_FEATURES_FILE:config,CODEX_HOME:path.join(root,'codex'),JEV_API_KEY:'synthetic',TYPESAFE_API_KEY:'synthetic',JEV_PRUNE_ENTRY:''},
    input:JSON.stringify({hook_event_name:'PostToolUse',tool_name:'Bash',tool_input:{cmd:'build-command'},tool_response:{output:raw,exit_code:exit},transcript_path:transcript}),
    encoding:'utf8',timeout:5000,maxBuffer:4096
  });
  assert.equal(response.status,0,response.stderr);
  return {root,raw,result:JSON.parse(response.stdout),requests:JSON.parse(readFileSync(calls,'utf8'))};
}

test('built-in progress selection needs one Jev request and no external prune bridge',t=>{
  const value=invoke(t);
  assert.equal(value.requests.length,1);
  assert.equal(value.result.continue,false);assert.equal(value.result.decision,undefined);
  const feedback=JSON.parse(value.result.stopReason);
  assert.equal(feedback.exit_code,0);
  assert.ok(feedback.protected_lines.includes('src/main.mjs'));
  assert.ok(feedback.protected_lines.includes('Result: completed 17 items'));
  assert.equal(readFileSync(feedback.original_log,'utf8'),value.raw);
  const request=JSON.stringify(value.requests);
  assert.ok(!request.includes('src/main.mjs'));assert.ok(!request.includes('completed 17 items'));assert.ok(!request.includes('build-command'));
  assert.ok(Buffer.byteLength(value.result.stopReason)<=4000);
  const audit=JSON.parse(readFileSync(path.join(value.root,'state/hooks/compaction.jsonl'),'utf8').trim());
  assert.equal(audit.mode,'builtin-progress');assert.equal(audit.provider,'jev');
  assert.ok(audit.output_bytes<audit.input_bytes);
});

test('KEEP, low confidence and provider failure preserve original native behavior',t=>{
  for(const mode of ['KEEP','low','error']) {
    const value=invoke(t,{mode});assert.equal(value.requests.length,1);assert.deepEqual(value.result,{});
  }
});

test('the feature can be disabled and failures never enter progress selection',t=>{
  for(const input of [{active:false},{exit:2},{raw:progress+'fatal: unresolved issue\n'},{raw:'progress 10\n'.repeat(100)}]) {
    const value=invoke(t,input);assert.equal(value.requests.length,0);assert.deepEqual(value.result,{});
  }
});

test('85 percent retains the configured early threshold without changing native compaction',t=>{
  const raw='progress 10\n'.repeat(220)+evidence;
  const before=invoke(t,{raw,percent:84.9}),after=invoke(t,{raw,percent:85,exit:null});
  assert.deepEqual(before.result,{});assert.equal(before.requests.length,0);
  assert.equal(after.requests.length,1);assert.equal(JSON.parse(after.result.stopReason).exit_code,null);
});
