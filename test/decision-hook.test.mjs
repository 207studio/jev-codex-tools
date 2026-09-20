import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const handler=fileURLToPath(new URL('../integration/codex-hooks.mjs',import.meta.url));
const wrapper=fileURLToPath(new URL('../bin/jev-verify.mjs',import.meta.url));
function fixture(t,extra={}) {
  const root=mkdtempSync(path.join(tmpdir(),'jev-decision-hook-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'features.json'), counter=path.join(root,'calls');
  writeFileSync(config,JSON.stringify({verification_enforcement:true,decision_enforcement:true,tool_gate:true,...extra}));
  return (tool,input,mode='valid',hookEvent='PreToolUse')=>{
    const program=`import {writeFileSync} from 'node:fs';
      let calls=0;
      globalThis.fetch=async()=>{calls++;${mode==='error' ? "throw Error('synthetic unavailable');" : `return {ok:true,json:async()=>({model:'jev-latest',answers:{decision:{type:'choice',choice:'reversible',confidence:${mode==='low'?'0.5':'0.99'},probabilities:{'read-only':0.0025,reversible:0.99,destructive:0.0025,'external-side-effect':0.0025,unknown:0.0025}}}})};`}};
      await import(${JSON.stringify(handler)});
      writeFileSync(${JSON.stringify(counter)},String(calls));`;
    const result=spawnSync(process.execPath,['--input-type=module','--eval',program],{
      env:{...process.env,JEV_TOOLS_HOME:root,JEV_FEATURES_FILE:config,JEV_API_KEY:'synthetic',TYPESAFE_API_KEY:'synthetic',JEV_DECISION_ENFORCEMENT_ENABLED:'1',JEV_VERIFICATION_ENFORCEMENT_ENABLED:extra.verification_enforcement===false?'0':'1',JEV_TOOL_GATE_ENABLED:'1',JEV_COLLECTION_ENFORCEMENT_ENABLED:extra.collection_enforcement?'1':'0',JEV_DECISION_RECOVERY_FASTPATH_ENABLED:extra.decision_recovery_fastpath?'1':'0',JEV_VISUAL_ENFORCEMENT_ENABLED:'0'},
      input:JSON.stringify({hook_event_name:hookEvent,session_id:'synthetic',turn_id:mode,tool_use_id:tool,tool_name:tool,tool_input:input}),
      encoding:'utf8',timeout:5000,maxBuffer:4096
    });
    assert.equal(result.status,0,result.stderr);
    return {output:JSON.parse(result.stdout),calls:Number(readFileSync(counter,'utf8'))};
  };
}

test('file and MCP calls each obtain one decision without legacy double classification or auto-approval', t=>{
  const call=fixture(t);
  for(const [tool,input] of [['apply_patch',{command:'*** Begin Patch\n*** Add File: example.txt\n+example\n*** End Patch'}],['mcp__example__fetch',{id:'synthetic'}]]) {
    const result=call(tool,input);
    assert.deepEqual(result.output,{});
    assert.equal(result.calls,1);
  }
});

test('unavailable Jev blocks non-shell actions but preserves the registered recovery path', t=>{
  const call=fixture(t);
  assert.equal(call('apply_patch',{command:'synthetic patch'},'error').output.hookSpecificOutput.permissionDecision,'deny');
  assert.equal(call('mcp__example__update',{id:'synthetic'},'error').output.hookSpecificOutput.permissionDecision,'deny');
  assert.deepEqual(call('Bash',{command:`${wrapper} run --spec /tmp/synthetic.json --execute`},'error').output,{});
});

test('uncertainty keeps native policy and existing direct-test denial remains stronger', t=>{
  const call=fixture(t);
  assert.deepEqual(call('apply_patch',{command:'synthetic patch'},'low').output,{});
  const blocked=call('Bash',{command:'npm test'});
  assert.equal(blocked.output.hookSpecificOutput.permissionDecision,'deny');
  assert.equal(blocked.calls,0);
});

test('maximum collection guard blocks raw bulk output before Jev and preserves bounded reads',t=>{
  const call=fixture(t,{collection_enforcement:true});
  const denied=call('Bash',{command:'cat dataset.json'});
  assert.equal(denied.output.hookSpecificOutput.permissionDecision,'deny');assert.equal(denied.calls,0);
  const allowed=call('Bash',{command:'cat dataset.json 2>&1 | head -c 4000'});
  assert.deepEqual(allowed.output,{});assert.equal(allowed.calls,1);
});

test('opt-in recovery fast path avoids provider calls without granting permission',t=>{
  const call=fixture(t,{decision_recovery_fastpath:true});
  for(const command of ['rg -n literal README.md 2>&1 | head -c 4000',`${wrapper} run --spec /tmp/synthetic.json --execute`]) {
    const result=call('Bash',{command},'error');
    assert.deepEqual(result.output,{});assert.equal(result.calls,0);
  }
  const patch=call('apply_patch',{command:'synthetic patch'});
  assert.equal(patch.calls,1);assert.deepEqual(patch.output,{});
});

test('unrecognized shell syntax still consults Jev when verification enforcement is off',t=>{
  const call=fixture(t,{decision_recovery_fastpath:true,verification_enforcement:false});
  const result=call('Bash',{command:'python3 -c "print(1)"'},'error');
  assert.equal(result.calls,1);
  assert.equal(result.output.hookSpecificOutput.permissionDecision,'deny');
});

test('subagent reminder is concise and does not require per-step Jev calls',t=>{
  const result=fixture(t,{subagent_contract:true})('spawn_agent',{},'valid','SubagentStart');
  const context=result.output.hookSpecificOutput.additionalContext;
  assert.ok(Buffer.byteLength(context)<600);
  assert.ok(!context.includes('plan --spec'));
  assert.equal(result.calls,0);
});
