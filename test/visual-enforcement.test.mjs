import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {classifyVisual,visualDecision,recordVisualExecution} from '../integration/visual-enforcement.mjs';

const event=(tool_name,tool_input,extra={})=>({hook_event_name:'PreToolUse',session_id:'session',turn_id:'turn',tool_use_id:'call',cwd:'/project',tool_name,tool_input,...extra});
const answer=(choice='PIXEL_REVIEW',confidence=0.99)=>({choice,confidence});
async function fixture(t){
  const stateDir=await mkdtemp(path.join(os.tmpdir(),'jev-visual-'));
  t.after(()=>rm(stateDir,{recursive:true,force:true}));
  return {active:true,stateDir};
}
const isDenied=result=>result.hookOutput?.hookSpecificOutput?.permissionDecision==='deny';

test('classifies visible capture, generation, Figma, CUA, UI patch and file edits',()=>{
  const cases=[
    ['view_image',{path:'/private/image.png'},'inspect'],
    ['mcp__browser__screenshot',{},'inspect'],
    ['image_gen__imagegen',{prompt:'PRIVATE PROMPT'},'generate'],
    ['mcp__figma__get_design_context',{nodeId:'1'},'inspect'],
    ['mcp__figma__generate_figma_design',{},'implement'],
    ['mcp__cua_repl__js',{code:'await nodeRepl.emitImage(await tab.screenshot());'},'inspect'],
    ['apply_patch','*** Begin Patch\n*** Update File: src/Private.swift\n@@\n+Text("private")\n*** End Patch','implement'],
    ['apply_patch','*** Begin Patch\n*** Update File: src/widget.js\n@@\n+const x = <div className="box"/>;\n*** End Patch','implement'],
    ['mcp__filesystem__edit_file',{path:'src/private.vue',edits:[]},'implement'],
    ['Bash',{command:'xcrun simctl io booted screenshot private.png'},'inspect'],
    ['exec_command',{cmd:'aside capture'},'inspect']
  ];
  for(const [tool,input,kind] of cases)assert.equal(classifyVisual(event(tool,input))?.kind,kind,tool);
  for(const extension of ['swift','tsx','jsx','html','css','scss','storyboard','xib','qml','vue','svelte'])
    assert.equal(classifyVisual(event('write_file',{path:`view.${extension}`,content:'secret'}))?.kind,'implement');
});

test('does not claim coverage of indirect scripts, generic reads or nonvisual patches',()=>{
  for(const item of [event('mcp__host__run',{code:'await screenshot()'}),event('Bash',{command:'node script.js'}),event('read_file',{path:'view.swift'}),
    event('mcp__cua_repl__js',{code:'await tab.click()'}),event('apply_patch','*** Begin Patch\n*** Update File: lib/math.mjs\n@@\n+return a+b;\n*** End Patch')])
    assert.equal(classifyVisual(item),null);
});

test('each visual kind requests its allowed routing choices without approving execution',async t=>{
  const options=await fixture(t),seen=[];
  for(const [tool,input,choice] of [['view_image',{path:'image.png'},'MEASURE_FIRST'],['write_file',{path:'view.tsx',content:'private'},'CODE_REQUIRED'],['mcp__other__generate_image',{prompt:'private'},'GENERATOR_REQUIRED']]){
    const result=await visualDecision(event(tool,input),{...options,decide:async(state,instructions,criteria,requestOptions)=>{
      seen.push(state);assert.deepEqual(requestOptions,{timeout:1800,retries:0});assert.ok(Object.hasOwn(criteria,choice));
      assert.match(instructions,/does not skip execution/);return answer(choice);
    }});
    assert.equal(result.completed,true);assert.equal(result.choice,choice);assert.equal(result.hookOutput,null);
  }
  assert.equal(seen.length,3);
});

test('registered GPT image generation skips only the visual routing decision',async t=>{
  const options=await fixture(t);let calls=0,getters=0;
  const input={};Object.defineProperty(input,'prompt',{enumerable:true,get(){getters++;throw Error('must not read');}});
  for(const tool of ['image_gen__imagegen','image_gen.imagegen']){
    const result=await visualDecision(event(tool,input),{...options,decide:async()=>{calls++;throw Error('visual unavailable');}});
    assert.equal(result.covered,false);assert.equal(result.completed,false);
    assert.equal(result.hookOutput,null);assert.equal(result.fingerprint,null);
    assert.equal(result.source,'gpt_image_generation_exempt');
  }
  assert.equal(calls,0);assert.equal(getters,0);assert.deepEqual(await readdir(options.stateDir),[]);
});

test('image generation exemption cannot be widened by names, arguments or wrapper code',async t=>{
  const options=await fixture(t);let calls=0;
  const items=[
    ...['imagegen','mcp__other__imagegen','mcp__image_gen__imagegen','tools.image_gen__imagegen','image_gen__imagegen_extra','IMAGE_GEN__IMAGEGEN']
      .map(tool=>event(tool,{prompt:'image_gen__imagegen'})),
    event('view_image',{path:'image_gen__imagegen.png',tool_name:'image_gen__imagegen'}),
    event('mcp__browser__screenshot',{prompt:'image_gen.imagegen'}),
    event('mcp__cua_repl__js',{code:'await tab.screenshot(); // tools.image_gen__imagegen'}),
    event('exec_command',{cmd:'xcrun simctl io booted screenshot imagegen.png'}),
    event('write_file',{path:'imagegen.swift',content:'image_gen__imagegen'})
  ];
  for(const item of items){
    const result=await visualDecision(item,{...options,decide:async()=>{calls++;throw Error('visual unavailable');}});
    assert.equal(result.covered,true,item.tool_name);assert.equal(isDenied(result),true,item.tool_name);
  }
  assert.equal(calls,items.length);
});

test('GPT image generation keeps observed execution separate from unperformed pixel review',async t=>{
  const options=await fixture(t);
  const result=await recordVisualExecution(event('image_gen__imagegen',{prompt:'synthetic asset'},{hook_event_name:'PostToolUse'}),options);
  assert.equal(result.covered,true);assert.equal(result.recorded,true);
  assert.equal(result.pixel_review,'NOT_PERFORMED');assert.equal(result.quality_verdict,'NOT_ASSESSED');
});

test('outbound state, cache and audit contain no paths, prompts, code, image or output bodies',async t=>{
  const options=await fixture(t),states=[];
  const inputs=[event('imagegen',{prompt:'SECRET_PROMPT',image:'data:image/png;base64,SECRET_IMAGE',token:'SECRET_TOKEN'}),
    event('apply_patch','*** Begin Patch\n*** Update File: /SECRET_PATH/private.tsx\n@@\n+const title = "SECRET_CODE";\n*** End Patch'),
    event('mcp__cua_repl__js',{code:'await tab.screenshot(); const secret="SECRET_SCRIPT";'}),
    event('view_image',{path:'/SECRET_IMAGE_PATH.png'})];
  for(const input of inputs){
    const result=await visualDecision(input,{...options,decide:async state=>{states.push(state);return answer('UNKNOWN',0.4);}});
    assert.equal(result.completed,true);
    await recordVisualExecution({...input,hook_event_name:'PostToolUse',tool_response:{body:'SECRET_OUTPUT'}},options);
  }
  const disk=await Promise.all((await readdir(options.stateDir)).map(file=>readFile(path.join(options.stateDir,file),'utf8')));
  const all=JSON.stringify(states)+disk.join('');
  for(const secret of ['SECRET_PROMPT','SECRET_IMAGE','SECRET_TOKEN','SECRET_PATH','SECRET_CODE','SECRET_SCRIPT','SECRET_IMAGE_PATH','SECRET_OUTPUT'])assert.ok(!all.includes(secret),secret);
  for(const state of states){
    assert.ok(Buffer.byteLength(JSON.stringify(state))<=4000);
    assert.equal(state.capabilities.pixels_provided,false);assert.equal(state.capabilities.measurements_provided,false);
    assert.equal(state.capabilities.pixel_review,'NOT_PERFORMED');
  }
});

test('disabled and non-PreToolUse calls make no API or filesystem changes',async t=>{
  const options=await fixture(t);let calls=0;
  const decide=async()=>{calls++;throw Error('must not call');};
  const input=event('view_image',{path:'image.png'});
  for(const [item,active] of [[input,false],[{...input,hook_event_name:'PostToolUse'},true],[event('read_file',{path:'index.mjs'}),true]]){
    const result=await visualDecision(item,{...options,active,decide});
    assert.equal(result.covered,false);assert.equal(result.hookOutput,null);
  }
  assert.equal(calls,0);assert.deepEqual(await readdir(options.stateDir),[]);
});

test('valid low confidence and UNKNOWN stay uncertain under native policy and are cached',async t=>{
  const options=await fixture(t);let calls=0;
  for(const [pathValue,choice,confidence] of [['low.png','PIXEL_REVIEW',0.8],['unknown.png','UNKNOWN',0.99]]){
    const input=event('view_image',{path:pathValue}),decide=async()=>{calls++;return answer(choice,confidence);};
    const result=await visualDecision(input,{...options,decide});
    assert.equal(result.choice,'UNKNOWN');assert.equal(result.confidence,confidence);assert.equal(result.completed,true);
    assert.equal(result.uncertain,true);assert.equal(result.hookOutput,null);
    const again=await visualDecision(input,{...options,decide});assert.equal(again.source,'cache');
  }
  assert.equal(calls,2);
});

test('missing, invalid and rejected responses deny and are not cached',async t=>{
  const options=await fixture(t);let calls=0;
  for(const value of [undefined,answer('ALLOW'),answer('PIXEL_REVIEW',NaN),{type:'text',...answer()},answer('PIXEL_REVIEW',1.1)]){
    const result=await visualDecision(event('view_image',{path:'image.png'}),{...options,decide:async()=>{calls++;return value;}});
    assert.equal(isDenied(result),true);assert.equal(result.completed,false);assert.equal(result.choice,'UNKNOWN');
  }
  const rejected=await visualDecision(event('view_image',{path:'image.png'}),{...options,decide:async()=>{calls++;throw Error('missing key');}});
  assert.equal(isDenied(rejected),true);assert.equal(calls,6);
  assert.deepEqual(await readdir(options.stateDir),['visual-decisions.jsonl']);
});

test('routing cache uses full arguments, session, turn, tool and TTL, excluding tool use id',async t=>{
  const options=await fixture(t);let calls=0,time=1000;
  const decide=async()=>{calls++;return answer();},now=()=>time,input=event('view_image',{path:'image.png'});
  const first=await visualDecision(input,{...options,decide,now});
  const repeated=await visualDecision({...input,tool_use_id:'other-call'},{...options,decide,now});
  assert.equal(repeated.source,'cache');assert.equal(repeated.fingerprint,first.fingerprint);
  for(const item of [{...input,tool_input:{path:'different.png'}},{...input,turn_id:'new-turn'},
    {...input,session_id:'new-session'},{...input,tool_name:'screenshot'}]){
    const changed=await visualDecision(item,{...options,decide,now});
    assert.notEqual(changed.fingerprint,first.fingerprint);assert.equal(changed.source,'jev');
  }
  assert.equal(calls,5);time+=120000;
  const expired=await visualDecision(input,{...options,decide,now});
  assert.equal(expired.source,'jev');assert.equal(calls,6);
});

test('only exact registered helper executables avoid nested routing decisions',async t=>{
  const options={...await fixture(t),trustedExecutables:['/registered/jev-aside']};let calls=0;
  const decide=async()=>{calls++;return answer();};
  const skipped=await visualDecision(event('Bash',{command:'/registered/jev-aside capture | head -c 4000'}),{...options,decide});
  assert.equal(skipped.covered,false);assert.equal(calls,0);
  for(const command of ['jev-aside capture','/other/jev-aside capture','/registered/jev-aside capture ; screencapture image.png']){
    const routed=await visualDecision(event('Bash',{command}),{...options,decide});
    assert.equal(routed.covered,true);assert.equal(routed.completed,true);
  }
  assert.equal(calls,3);
});

test('oversized, deep and accessor inputs fail closed without executing getters',async t=>{
  const options=await fixture(t);let getters=0,calls=0;
  const accessor={};Object.defineProperty(accessor,'path',{enumerable:true,get(){getters++;return 'private.png';}});
  const array=[];Object.defineProperty(array,0,{enumerable:true,get(){getters++;return 'private';}});
  let deep={path:'image.png'};for(let index=0;index<14;index++)deep={nested:deep};
  const wide=Object.fromEntries(Array.from({length:129},(_,index)=>[`key${index}`,index]));
  for(const input of [{image:'x'.repeat(70000)},deep,wide,accessor,array]){
    const result=await visualDecision(event('view_image',input),{...options,decide:async()=>{calls++;return answer();}});
    assert.equal(isDenied(result),true);assert.equal(result.completed,false);
  }
  assert.equal(getters,0);assert.equal(calls,0);
});

test('a never-resolving decision is denied at the 1800ms deadline',async t=>{
  const options=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});
  let started;const ready=new Promise(resolve=>{started=resolve;});
  const pending=visualDecision(event('view_image',{path:'image.png'}),{...options,decide:()=>{started();return new Promise(()=>{});}});
  await ready;t.mock.timers.tick(1800);
  const result=await pending;
  assert.equal(isDenied(result),true);assert.equal(result.completed,false);assert.equal(result.choice,'UNKNOWN');
});

test('audit separates routing from observed execution and never creates a pixel verdict',async t=>{
  const options=await fixture(t),input=event('view_image',{path:'private.png'});
  const before=await visualDecision(input,{...options,decide:async()=>answer()});
  assert.equal((await recordVisualExecution(input,options)).covered,false);
  const after=await recordVisualExecution({...input,hook_event_name:'PostToolUse',tool_response:{exit_code:9,output:'PRIVATE_OUTPUT'}},options);
  assert.equal(after.recorded,true);assert.equal(after.fingerprint,before.fingerprint);
  assert.equal(after.pixel_review,'NOT_PERFORMED');assert.equal(after.quality_verdict,'NOT_ASSESSED');
  const rows=(await readFile(path.join(options.stateDir,'visual-decisions.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row=>row.phase),['before_execution','actual_execution']);
  assert.equal(rows[0].execution_observed,false);assert.equal(rows[0].disposition,'native');
  assert.equal(rows[1].execution_observed,true);assert.equal(rows[1].exit_code,9);
  assert.equal(Object.hasOwn(rows[1],'choice'),false);assert.equal(Object.hasOwn(rows[1],'completed'),false);
  for(const row of rows){assert.equal(row.pixel_review,'NOT_PERFORMED');assert.equal(row.quality_verdict,'NOT_ASSESSED');}
  assert.equal((await stat(options.stateDir)).mode & 0o777,0o700);
  for(const file of await readdir(options.stateDir))assert.equal((await stat(path.join(options.stateDir,file))).mode & 0o777,0o600);
});

test('unreadable cache and unavailable audit storage never become permission',async t=>{
  const options=await fixture(t),input=event('view_image',{path:'image.png'});let calls=0;
  const decide=async()=>{calls++;return answer();};
  const first=await visualDecision(input,{...options,decide});
  await writeFile(path.join(options.stateDir,`${first.fingerprint}.json`),'invalid JSON');
  const corrupted=await visualDecision(input,{...options,decide});
  assert.equal(isDenied(corrupted),true);assert.equal(calls,1);
  const file=path.join(options.stateDir,'not-a-directory');await writeFile(file,'',{mode:0o600});
  const unavailable=await visualDecision(input,{...options,stateDir:file,decide});
  assert.equal(isDenied(unavailable),true);assert.equal(calls,1);
  const after=await recordVisualExecution({...input,hook_event_name:'PostToolUse'},{...options,stateDir:file});
  assert.equal(after.covered,true);assert.equal(after.recorded,false);
});
