import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const handler=fileURLToPath(new URL('../integration/codex-hooks.mjs',import.meta.url));
const wrapper=fileURLToPath(new URL('../bin/jev-verify.mjs',import.meta.url));
function fixture(t, active=true) {
  const root=mkdtempSync(path.join(tmpdir(),'jev-hook-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'features.json');
  writeFileSync(config,JSON.stringify({verification_enforcement:active,tool_gate:false}));
  const call=command=>{
    const result=spawnSync(process.execPath,[handler],{
      env:{...process.env,JEV_TOOLS_HOME:root,JEV_FEATURES_FILE:config,JEV_VERIFICATION_ENFORCEMENT_ENABLED:active?'1':'0',JEV_TOOL_GATE_ENABLED:'0'},
      input:JSON.stringify({hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command},session_id:'synthetic',tool_use_id:'synthetic'}),
      encoding:'utf8',timeout:3000,maxBuffer:4096
    });
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  return {root,call};
}

test('native hook emits supported deny before direct verification', t=>{
  const {call}=fixture(t);
  const result=call('npm test');
  assert.equal(result.hookSpecificOutput.hookEventName,'PreToolUse');
  assert.equal(result.hookSpecificOutput.permissionDecision,'deny');
  assert.equal(result.continue,undefined);
});

test('native hook preserves normal host approvals for a canonical wrapper and simple reads', t=>{
  const {call}=fixture(t);
  assert.deepEqual(call(`${wrapper} run --spec /tmp/synthetic.json --execute`),{});
  assert.deepEqual(call('rg -n symbol source.mjs 2>&1 | head -c 4000'),{});
  assert.equal(call(`${wrapper} run --spec /tmp/synthetic.json --execute && npm test`).hookSpecificOutput.permissionDecision,'deny');
});

test('disabled enforcement leaves the native path unchanged', t=>{
  assert.deepEqual(fixture(t,false).call('npm test'),{});
});

test('handler failure after recognizing an enabled PreToolUse fails closed', t=>{
  const {root,call}=fixture(t);
  mkdirSync(path.join(root,'state'),{recursive:true});
  writeFileSync(path.join(root,'state','hooks'),'not a directory');
  assert.equal(call('npm test').hookSpecificOutput.permissionDecision,'deny');
});
