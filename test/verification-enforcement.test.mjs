import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationEnforcement,decisionRecovery} from '../integration/verification-enforcement.mjs';

const WRAPPER = '/opt/jev/bin/jev-verify';
const options = {active:true,trustedExecutables:[WRAPPER]};
const event = command => ({hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command}});
const result = command => verificationEnforcement(event(command),options);

test('registered Jev adapters retain strict single-command boundaries', () => {
  const adapter='/opt/jev/bin/jev-judge';
  const configured={...options,trustedDecisionExecutables:[adapter]};
  const valid=event(`${adapter} --file evidence.txt --question 'Is the required input present?' | head -c 4000`);
  assert.equal(verificationEnforcement(valid,configured),null);
  assert.equal(decisionRecovery(valid,configured),true);
  for(const command of [`${adapter} --file a && npm test`, `env X=1 ${adapter} --file a`, 'jev-judge --file a', '/tmp/jev-judge --file a'])
    assert.equal(verificationEnforcement(event(command),configured)?.hookSpecificOutput.permissionDecision,'deny');
});

test('recovery eligibility is limited to observations and registered Jev paths', () => {
  assert.equal(decisionRecovery(event('rg -n symbol source.mjs'),options),true);
  assert.equal(decisionRecovery(event(`${WRAPPER} run --spec a.json --execute`),options),true);
  assert.equal(decisionRecovery(event('python3 script.py'),options),false);
  assert.equal(decisionRecovery({hook_event_name:'PreToolUse',tool_name:'apply_patch',tool_input:{command:'patch'}},options),false);
});
function blocked(command) {
  const answer = result(command);
  assert.equal(answer?.hookSpecificOutput?.hookEventName,'PreToolUse',command);
  assert.equal(answer?.hookSpecificOutput?.permissionDecision,'deny',command);
  assert.match(answer.hookSpecificOutput.permissionDecisionReason,/jev-verify/);
  assert.ok(!answer.hookSpecificOutput.permissionDecisionReason.includes(command) || command.length < 2);
}

test('direct verification and arbitrary code commands require the wrapper', () => {
  for(const command of ['pytest -q','npm test','node --test test/example.mjs','xcodebuild test','make check','python3 -c "print(1)"','node app.mjs','bash script.sh','/tmp/ls','env PATH=/tmp ls'])blocked(command);
});

test('every simple command in a compound command is checked', () => {
  for(const command of ['pwd && pytest','ls; npm test','cat input | python3 script.py','pwd\nmake test','echo jev-verify && node --test','echo "'+WRAPPER+' run --spec test.json --execute"; pytest'])blocked(command);
});

test('environment assignments and unsupported expansion cannot bypass the wrapper', () => {
  for(const command of ['PATH=/tmp ls','JEV_VERIFICATION_GATE_ENABLED=0 '+WRAPPER+' run --spec check.json --execute','echo $(pytest)','echo `pytest`','cat <(pytest)','cat <<EOF\ndata\nEOF','ls &','echo hi > out','cat < input','ls || pytest','ls *','ls {a,b}'])blocked(command);
});

test('narrow read-only queries return null without granting permission', () => {
  for(const command of ['pwd','/bin/pwd','ls -la','cat "file with spaces"','head -c 4000 file','tail -n 20 file','wc -l file','stat file','date -u +%FT%TZ','uname -a','whoami','echo "literal text"',"echo '$(literal)'", "printf '%s\\n' 'literal text'",'rg -n "needle" file',"rg --files -g '*.mjs'", "sed -n '2,9p' file",'git status --short','git --no-pager log -3 --oneline','git -C "project directory" diff --stat','git show HEAD:file','git ls-files','git rev-parse HEAD','pwd && ls; cat file | head -c 4000','cd "project directory" && git status --short'])assert.equal(result(command),null,command);
});

test('query tools cannot use execution or mutation options', () => {
  for(const command of ['rg --pre python needle file','rg --pre=python needle file','rg --hostname-bin executable needle','sed -n "1e python" file','sed -i s/a/b/ file','git -c alias.sneak=command status','git diff --check','git diff --ext-diff','git show --textconv','git log --output=out','git config value','date -s now','date 09191200',"printf -v PATH '%s' /tmp", "printf '%n' PATH"])blocked(command);
});

test('only an exact registered absolute wrapper executable is accepted', () => {
  for(const command of [WRAPPER+' plan --spec check.json',WRAPPER+' run --spec "check file.json" --execute',WRAPPER+' assess --spec check.json --log result.log --exit-code 7',WRAPPER+' --help','"'+WRAPPER+'" run --execute --spec check.json','cd project && '+WRAPPER+' run --spec check.json --execute'])assert.equal(result(command),null,command);
  for(const command of ['jev-verify run --spec check.json --execute','./jev-verify run --spec check.json --execute','/tmp/jev-verify run --spec check.json --execute','node '+WRAPPER+' run --spec check.json --execute'])blocked(command);
});

test('wrapper commands require their exact CLI contract', () => {
  for(const args of ['run --spec check.json','run --execute','run --spec check.json --execute --anything','plan --spec check.json --execute','plan --spec a --spec b','assess --spec a --log b --exit-code -1','assess --spec a --log b --exit-code 256','--help extra'])blocked(WRAPPER+' '+args);
});

test('wrapper output may only be limited by head and tail', () => {
  for(const command of [WRAPPER+' run --spec a --execute 2>&1 | head -c 4000',WRAPPER+' plan --spec a | tail -n 5',WRAPPER+' --help | head -c 1000 | tail -n 5'])assert.equal(result(command),null,command);
  for(const command of [WRAPPER+' run --spec a --execute; pwd','pwd && '+WRAPPER+' --help',WRAPPER+' --help | cat',WRAPPER+' --help && '+WRAPPER+' --help',WRAPPER+' --help > file'])blocked(command);
});

test('empty, malformed, oversized and unsupported syntax fails closed without throwing', () => {
  for(const command of ['', '   ', 'cat "unterminated', 'ls &&', 'pwd;; ls', 'echo \\', 'pwd\0', 'x'.repeat(32769), '2>&1', '(pwd)'])assert.doesNotThrow(()=>blocked(command));
  assert.equal(verificationEnforcement({...event('x'),tool_input:{command:['pytest']}},options)?.hookSpecificOutput.permissionDecision,'deny');
});

test('inactive enforcement and unrelated events are unchanged', () => {
  assert.equal(verificationEnforcement(event('pytest')),null);
  assert.equal(verificationEnforcement(event('pytest'),{active:false}),null);
  assert.equal(verificationEnforcement({...event('pytest'),hook_event_name:'PostToolUse'},options),null);
  assert.equal(verificationEnforcement({...event('pytest'),tool_name:'apply_patch'},options),null);
  assert.equal(verificationEnforcement(null,options),null);
});

test('exec_command cmd input and shell tool names use the same enforcement', () => {
  for(const tool_name of ['exec_command','shell','shell_command']) {
    assert.equal(verificationEnforcement({hook_event_name:'PreToolUse',tool_name,tool_input:{cmd:'npm test'}},options)?.hookSpecificOutput.permissionDecision,'deny');
    assert.equal(verificationEnforcement({hook_event_name:'PreToolUse',tool_name,tool_input:{cmd:'pwd'}},options),null);
  }
});
