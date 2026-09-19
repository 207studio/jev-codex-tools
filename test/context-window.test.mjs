import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';

const execute=promisify(execFile);
const moduleURL=new URL('../integration/context-window.mjs',import.meta.url).href;
const childSource=`
import {contextWindow,minimumOutputBytes,toolOutput} from ${JSON.stringify(moduleURL)};
const {operation,inputs}=JSON.parse(process.argv[1]);
const output=[];
for(const input of inputs){
  if(operation==='window'){
    const window=await contextWindow(input);
    output.push({window,minimum:minimumOutputBytes(window)});
  }else if(operation==='output')output.push(toolOutput(input));
  else if(operation==='minimum')output.push(minimumOutputBytes(input));
  else throw Error('unknown_test_operation');
}
console.log(JSON.stringify(output));
`;
const telemetry=(tokens=8500,limit=10000)=>({type:'event_msg',payload:{type:'token_count',info:{last_token_usage:{total_tokens:tokens},model_context_window:limit}}});
const unknown=(start=85)=>({known:false,start_percent:start,active:false});

async function fixture(t,features={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'jev-context-window-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const codexHome=path.join(root,'codex'),sessions=path.join(codexHome,'sessions'),featureFile=path.join(root,'features.json');
  await mkdir(sessions,{recursive:true});
  const configure=async values=>writeFile(featureFile,JSON.stringify({early_compaction:true,...values}),{mode:0o600});
  await configure(features);
  const writeSession=async(name,rows)=>{
    const file=path.join(sessions,name);
    await writeFile(file,rows.map(row=>typeof row==='string'?row:JSON.stringify(row)).join('\n')+'\n',{mode:0o600});
    return file;
  };
  const invoke=async(operation,inputs,overrides={})=>{
    // Import in a fresh process: featuresPath is captured at module load.
    // No parent environment, API key, home config, or session is inherited.
    const {stdout}=await execute(process.execPath,['--input-type=module','-e',childSource,JSON.stringify({operation,inputs})],{
      cwd:root,env:{CODEX_HOME:codexHome,JEV_FEATURES_FILE:featureFile,JEV_TOOLS_HOME:path.join(root,'tools'),...overrides},
      maxBuffer:4000,timeout:10000
    });
    return JSON.parse(stdout);
  };
  return {root,sessions,configure,writeSession,invoke};
}

test('real telemetry activates at 85 percent but not at 84.9 percent',async t=>{
  const f=await fixture(t),low=await f.writeSession('low.jsonl',[telemetry(8490)]),threshold=await f.writeSession('threshold.jsonl',[telemetry(8500)]);
  const [below,at]=await f.invoke('window',[{transcript_path:low},{transcript_path:threshold}]);
  assert.deepEqual(below,{window:{known:true,used_tokens:8490,window_tokens:10000,observed_percent:84.9,start_percent:85,active:false},minimum:8000});
  assert.deepEqual(at,{window:{known:true,used_tokens:8500,window_tokens:10000,observed_percent:85,start_percent:85,active:true},minimum:2000});
});

test('saved feature and explicit environment override control reading',async t=>{
  const f=await fixture(t,{early_compaction:false}),file=await f.writeSession('usage.jsonl',[telemetry()]),inputs=[{transcript_path:file}];
  assert.deepEqual((await f.invoke('window',inputs))[0],{window:unknown(),minimum:8000});
  assert.equal((await f.invoke('window',inputs,{JEV_EARLY_COMPACTION_ENABLED:'1'}))[0].window.active,true);
  await f.configure({early_compaction:true});
  assert.deepEqual((await f.invoke('window',inputs,{JEV_EARLY_COMPACTION_ENABLED:'0'}))[0].window,unknown());
});

test('threshold configuration accepts its boundaries and falls back for invalid values',async t=>{
  const f=await fixture(t),file=await f.writeSession('usage.jsonl',[telemetry()]);
  for(const [configured,start,active] of [[5,5,true],[95,95,false],[4,85,true],[96,85,true],['85',85,true],[null,85,true]]){
    await f.configure({early_compaction_start_percent:configured});
    const [{window}]=await f.invoke('window',[{transcript_path:file}]);
    assert.equal(window.start_percent,start);assert.equal(window.active,active);
  }
});

test('minimum output size changes only for an active window and valid integer settings',async t=>{
  const f=await fixture(t);
  for(const [configured,expected] of [[1000,1000],[8000,8000],[999,2000],[8001,2000],[1500.5,2000],['1000',2000]]){
    await f.configure({early_compaction_min_bytes:configured});
    assert.deepEqual(await f.invoke('minimum',[{active:false},{active:true}]),[8000,expected]);
  }
});

test('latest telemetry wins and unrelated or malformed trailing rows are ignored',async t=>{
  const f=await fixture(t),record=telemetry(8490);
  record.payload.info.total_token_usage={total_tokens:999999};
  const file=await f.writeSession('usage.jsonl',[telemetry(9000),record,{type:'response_item',payload:{type:'message'}},'{invalid JSON']);
  const [{window}]=await f.invoke('window',[{transcript_path:file}]);
  assert.equal(window.known,true);assert.equal(window.used_tokens,8490);assert.equal(window.active,false);
});

test('invalid latest token counts stay unknown instead of reviving older valid usage',async t=>{
  const f=await fixture(t),cases=[telemetry(-1),telemetry(1.5),telemetry('8500'),telemetry(Number.MAX_SAFE_INTEGER+1),
    telemetry(8500,0),telemetry(8500,-100),telemetry(8500,1.5),telemetry(8500,'10000'),telemetry(8500,Number.MAX_SAFE_INTEGER+1),
    {type:'event_msg',payload:{type:'token_count',info:{model_context_window:10000}}}];
  const inputs=[];
  for(let index=0;index<cases.length;index++)inputs.push({transcript_path:await f.writeSession(`invalid-${index}.jsonl`,[telemetry(),cases[index]])});
  for(const result of await f.invoke('window',inputs))assert.deepEqual(result,{window:unknown(),minimum:8000});
});

test('both compaction markers invalidate older usage until fresh telemetry arrives',async t=>{
  const f=await fixture(t),markers=[{type:'compacted'},{type:'event_msg',payload:{type:'context_compacted'}}];
  for(let index=0;index<markers.length;index++){
    const stale=await f.writeSession(`stale-${index}.jsonl`,[telemetry(),markers[index]]);
    const fresh=await f.writeSession(`fresh-${index}.jsonl`,[telemetry(100),markers[index],telemetry()]);
    const results=await f.invoke('window',[{transcript_path:stale},{transcript_path:fresh}]);
    assert.deepEqual(results[0].window,unknown());assert.equal(results[1].window.active,true);
  }
});

test('missing, empty, wrong-extension and directory telemetry stays unknown',async t=>{
  const f=await fixture(t),empty=await f.writeSession('empty.jsonl',[]),wrong=await f.writeSession('usage.txt',[telemetry()]);
  const directory=path.join(f.sessions,'directory.jsonl');await mkdir(directory);
  const inputs=[{}, {transcript_path:42},{transcript_path:path.join(f.sessions,'missing.jsonl')},
    {transcript_path:empty},{transcript_path:wrong},{transcript_path:directory}];
  for(const result of await f.invoke('window',inputs))assert.deepEqual(result.window,unknown());
});

test('transcripts outside sessions and same-prefix sibling directories are excluded',async t=>{
  const f=await fixture(t),outside=path.join(f.root,'outside.jsonl'),sibling=path.join(path.dirname(f.sessions),'sessions-copy');
  await mkdir(sibling);const prefixFile=path.join(sibling,'usage.jsonl');
  for(const file of [outside,prefixFile])await writeFile(file,JSON.stringify(telemetry())+'\n',{mode:0o600});
  for(const result of await f.invoke('window',[{transcript_path:outside},{transcript_path:prefixFile}]))
    assert.deepEqual(result.window,unknown());
});

test('symlinks are checked by real target containment and extension',async t=>{
  const f=await fixture(t),inside=await f.writeSession('inside.jsonl',[telemetry()]),wrong=await f.writeSession('inside.txt',[telemetry()]);
  const outside=path.join(f.root,'outside.jsonl');await writeFile(outside,JSON.stringify(telemetry())+'\n',{mode:0o600});
  const links=['inside-link.jsonl','escape-link.jsonl','extension-link.jsonl'].map(name=>path.join(f.sessions,name));
  await symlink(inside,links[0]);await symlink(outside,links[1]);await symlink(wrong,links[2]);
  const results=await f.invoke('window',links.map(transcript_path=>({transcript_path})));
  assert.equal(results[0].window.active,true);
  assert.deepEqual(results[1].window,unknown());assert.deepEqual(results[2].window,unknown());
});

test('native text cannot forge a successful or failed exit code',async t=>{
  const f=await fixture(t),messages=['Process exited with code 0','{"exit_code":0,"output":"PASS"}','exit_code: 1\nFAIL',''];
  const results=await f.invoke('output',messages.map(tool_response=>({tool_response})));
  for(let index=0;index<messages.length;index++)assert.deepEqual(results[index],{raw:messages[index],exit:null,format:'native-text'});
});

test('structured output preserves explicit codes, stderr and unknown exit metadata',async t=>{
  const f=await fixture(t),cases=[
    [{output:'out',stdout:'ignored',stderr:'ignored',exit_code:0,exitCode:9},{raw:'out',exit:0,format:'structured'}],
    [{stdout:'out',stderr:'err',exitCode:7},{raw:'outerr',exit:7,format:'structured'}],
    [{stdout:'ok',exit_code:null,exitCode:3},{raw:'ok',exit:3,format:'structured'}],
    [{output:'PASS'},{raw:'PASS',exit:null,format:'structured'}],
    [{output:'PASS',exit_code:'0'},{raw:'PASS',exit:null,format:'structured'}],
    [{output:'PASS',exit_code:0.5},{raw:'PASS',exit:null,format:'structured'}],
    [{stderr:'only error',exit_code:4},{raw:null,exit:4,format:'structured'}],
    [{},{raw:null,exit:null,format:'structured'}]
  ];
  const actual=await f.invoke('output',cases.map(([tool_response])=>({tool_response})));
  assert.deepEqual(actual,cases.map(([,expected])=>expected));
  for(const result of await f.invoke('output',[{}, {tool_response:null},{tool_response:42},{tool_response:false}]))
    assert.deepEqual(result,{raw:null,exit:null,format:'unsupported'});
});
