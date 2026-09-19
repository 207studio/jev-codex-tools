import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionEnforcement} from '../integration/collection-enforcement.mjs';
import {verificationEnforcement,parseShellCommand} from '../integration/verification-enforcement.mjs';

const VERIFY = '/opt/jev/bin/jev-verify', COLLECT = '/opt/jev/bin/jev-collect';
const event = command => ({hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command}});
const options = {active:true,trustedExecutables:[VERIFY,COLLECT]};
const result = command => collectionEnforcement(event(command),options);
const blocked = command => assert.equal(result(command)?.hookSpecificOutput?.permissionDecision,'deny',command);

test('unbounded bulk readers and Git output require a byte bound',() => {
  for (const command of ['cat file','rg -n needle file','grep needle file','find directory','sed -n "1,20p" file','ls -la','git diff','git log -1','git show HEAD','git ls-files','git --no-pager -C directory log -3','head -n 20 file','tail -n 20 file']) blocked(command);
});

test('each supported bulk command can use a downstream byte-bound filter',() => {
  for (const command of ['cat file | head -c 4000','rg -n needle file | tail -c 3000','grep needle file | head -c1','find directory | head -c 1000','sed -n "1,20p" file | head -c 4000','ls -la | head -c 4000','git --no-pager -C directory diff | head -c4000','git show HEAD 2>&1 | tail -c 4000']) assert.equal(result(command),null,command);
});

test('direct head and tail bounds require positive counts no greater than 4000',() => {
  for (const command of ['head -c 1 file','head -c4000 "file with spaces"','tail -c 4000 file','/usr/bin/head -c 4000 file','head -q -c 2000 file','head -c 4000 -- -filename']) assert.equal(result(command),null,command);
  for (const command of ['head -c 0 file','head -c 4001 file','head -c -10 file','tail -c +10 file','head -c 4k file','head -c 4000 -n 20 file','tail -f -c 4000 file','head -v -c 4000 file','head -c 4000 first second','head -c 4000 -c 1 file']) blocked(command);
});

test('semicolon, newline, and conditional segments each need their own output bound',() => {
  for (const command of ['cat first; cat second | head -c 4000','cat first | head -c 4000; ls','cat first && head -c 4000 second','cat first\nhead -c 4000 second','pwd && rg needle file','cat file | head -c 4000 | cat']) blocked(command);
  for (const command of ['cat first | head -c 2000; ls | tail -c 2000','pwd && cat file | head -c 4000','cat first | head -c 4000\nrg needle second | head -c 1000','cat file | rg needle | head -c 4000']) assert.equal(result(command),null,command);
});

test('line limits and head text in quoted filenames do not count as byte bounds',() => {
  for (const command of ['cat file | head -n 20','rg needle file | tail -n 5',"cat 'head -c 4000'",'cat "file | head -c 4000"','ls "head" "-c" "4000"','cat file; echo "head -c 4000"']) blocked(command);
});

test('only exact registered executable paths receive the helper exemption',() => {
  assert.equal(result(`${COLLECT} --spec collection.json`),null);
  assert.equal(result(`${VERIFY} run --spec verification.json --execute`),null);
  assert.equal(collectionEnforcement(event('/opt/helpers/cat --spec collection.json'),{active:true,trustedExecutables:['/opt/helpers/cat']}),null);
  assert.equal(collectionEnforcement(event('cat file'),{active:true,trustedExecutables:['cat']})?.hookSpecificOutput.permissionDecision,'deny');
  blocked(`${COLLECT} --spec collection.json; cat file`);
});

test('minimal facts, inactive mode, and unrelated tool paths remain unchanged',() => {
  for (const command of ['pwd','wc -l file','stat file','date -u','uname -a','git status --short','git rev-parse HEAD']) assert.equal(result(command),null,command);
  assert.equal(collectionEnforcement(event('cat file')),null);
  assert.equal(collectionEnforcement(event('cat file'),{active:false}),null);
  assert.equal(collectionEnforcement({...event('cat file'),hook_event_name:'PostToolUse'},options),null);
  assert.equal(collectionEnforcement({...event('cat file'),tool_name:'mcp__files__read'},options),null);
});

test('unsupported parser inputs defer to the existing verification guard',() => {
  for (const command of ['cat $(python script.py)','cat "unterminated','cat file > output','cat file || pwd','']) {
    assert.equal(result(command),null,command);
    assert.equal(verificationEnforcement(event(command),{active:true})?.hookSpecificOutput.permissionDecision,'deny',command);
  }
  assert.deepEqual(parseShellCommand('cat file | head -c 4000').links,['|']);
});

test('composition keeps arbitrary commands and fake wrapper basenames blocked',() => {
  const verificationOptions={active:true,trustedExecutables:[VERIFY],trustedDecisionExecutables:[COLLECT]};
  const combined=command=>verificationEnforcement(event(command),verificationOptions) || result(command);
  for (const command of ['python script.py','jev-collect --spec collection.json','/other/jev-collect --spec collection.json','cat file','rg --pre python needle file | head -c 4000']) assert.equal(combined(command)?.hookSpecificOutput.permissionDecision,'deny',command);
  for (const command of [`${COLLECT} --spec collection.json`,`${VERIFY} plan --spec verification.json`,'cat file | head -c 4000','pwd']) assert.equal(combined(command),null,command);
});

test('exec_command and shell variants inspect their command input',() => {
  for(const tool_name of ['exec_command','shell','shell_command']) {
    const input={hook_event_name:'PreToolUse',tool_name,tool_input:{cmd:'cat file'}};
    assert.equal(collectionEnforcement(input,options)?.hookSpecificOutput.permissionDecision,'deny');
    assert.equal(collectionEnforcement({...input,tool_input:{cmd:'cat file | head -c 4000'}},options),null);
  }
});
