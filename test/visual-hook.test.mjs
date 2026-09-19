import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const handler=fileURLToPath(new URL('../integration/codex-hooks.mjs',import.meta.url));

function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),'jev-visual-hook-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'features.json'),count=path.join(root,'calls');
  writeFileSync(config,JSON.stringify({visual_enforcement:true,decision_enforcement:true,verification_enforcement:true}));
  return (tool,input,fail=false)=>{
    const program=`import {writeFileSync} from 'node:fs';let n=0;
      globalThis.fetch=async(_url,options)=>{n++;const body=JSON.parse(options.body);const q=body.questions.decision;const keys=Object.keys(q.criteria);const visual=!keys.includes('reversible');
        if(visual && ${JSON.stringify(fail)}) throw Error('synthetic unavailable');
        const choice=visual?keys.find(k=>k!=='UNKNOWN'):'reversible';
        return {ok:true,json:async()=>({model:'jev-latest',answers:{decision:{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))}}})};};
      await import(${JSON.stringify(handler)});writeFileSync(${JSON.stringify(count)},String(n));`;
    const r=spawnSync(process.execPath,['--input-type=module','--eval',program],{input:JSON.stringify({hook_event_name:'PreToolUse',session_id:'visual-test',turn_id:fail?'fail':'valid',tool_name:tool,tool_input:input}),encoding:'utf8',timeout:5000,maxBuffer:4096,
      env:{...process.env,JEV_TOOLS_HOME:root,JEV_FEATURES_FILE:config,JEV_API_KEY:'synthetic',TYPESAFE_API_KEY:'synthetic',JEV_VISUAL_ENFORCEMENT_ENABLED:'1',JEV_DECISION_ENFORCEMENT_ENABLED:'1',JEV_VERIFICATION_ENFORCEMENT_ENABLED:'1',JEV_COLLECTION_ENFORCEMENT_ENABLED:'0'}});
    assert.equal(r.status,0,r.stderr);return {output:JSON.parse(r.stdout),calls:Number(readFileSync(count,'utf8'))};
  };
}
test('visual tools require separate routing and effect judgments with private cache reuse',t=>{
  const call=fixture(t),args={path:'/tmp/synthetic.png'};
  const first=call('view_image',args);assert.deepEqual(first.output,{});assert.equal(first.calls,2);
  const repeat=call('view_image',args);assert.deepEqual(repeat.output,{});assert.equal(repeat.calls,0);
});
test('UI edits and asset generation cannot bypass unavailable visual judgment',t=>{
  const call=fixture(t);
  for (const [tool,input] of [['apply_patch',{command:'*** Begin Patch\n*** Update File: App.swift\n@@\n-old\n+new\n*** End Patch'}],['image_gen__imagegen',{prompt:'synthetic asset'}]]) {
    const result=call(tool,input,true);assert.equal(result.output.hookSpecificOutput.permissionDecision,'deny');assert.equal(result.calls,2);
  }
});
