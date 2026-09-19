import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const handler=fileURLToPath(new URL('../integration/codex-hooks.mjs',import.meta.url));
const wrapper=fileURLToPath(new URL('../bin/jev-verify.mjs',import.meta.url));
function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),'jev-decision-hook-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'features.json'), counter=path.join(root,'calls');
  writeFileSync(config,JSON.stringify({verification_enforcement:true,decision_enforcement:true,tool_gate:true}));
  return (tool,input,mode='valid')=>{
    const program=`import {writeFileSync} from 'node:fs';
      let calls=0;
      globalThis.fetch=async()=>{calls++;${mode==='error' ? "throw Error('synthetic unavailable');" : `return {ok:true,json:async()=>({model:'jev-latest',answers:{decision:{type:'choice',choice:'reversible',confidence:${mode==='low'?'0.5':'0.99'},probabilities:{'read-only':0.0025,reversible:0.99,destructive:0.0025,'external-side-effect':0.0025,unknown:0.0025}}}})};`}};
      await import(${JSON.stringify(handler)});
      writeFileSync(${JSON.stringify(counter)},String(calls));`;
    const result=spawnSync(process.execPath,['--input-type=module','--eval',program],{
      env:{...process.env,JEV_TOOLS_HOME:root,JEV_FEATURES_FILE:config,JEV_API_KEY:'synthetic',TYPESAFE_API_KEY:'synthetic',JEV_DECISION_ENFORCEMENT_ENABLED:'1',JEV_VERIFICATION_ENFORCEMENT_ENABLED:'1',JEV_TOOL_GATE_ENABLED:'1'},
      input:JSON.stringify({hook_event_name:'PreToolUse',session_id:'synthetic',turn_id:mode,tool_use_id:tool,tool_name:tool,tool_input:input}),
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
