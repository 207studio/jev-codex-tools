import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../bin/jev-visual.mjs',import.meta.url));

test('CLI feature flag, mandatory metrics failure and unknown candidate never claim pixel review or apply',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'jev-visual-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const spec=path.join(root,'spec.json');
  const input={mode:'assess',question:'Check explicit containment',observation:{viewport:{width:100,height:100},elements:[{id:'button',rect:{x:90,y:0,width:20,height:20}}]},checks:[{id:'contain',type:'inside_viewport',ids:['button']}]};
  await writeFile(spec,JSON.stringify(input));
  const env={...process.env,JEV_VISUAL_REVIEW_ENABLED:'0',JEV_TOOLS_HOME:root,JEV_API_KEY:'',TYPESAFE_API_KEY:''};
  let run=spawnSync(process.execPath,[cli,'--spec',spec],{env,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).status,'DISABLED');
  env.JEV_VISUAL_REVIEW_ENABLED='1';run=spawnSync(process.execPath,[cli,'--spec',spec],{env,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const data=JSON.parse(run.stdout);
  assert.equal(data.status,'FAIL');assert.equal(data.pixel_review,'NOT_PERFORMED');assert.equal(data.applied,false);assert.equal(data.check_counts.FAIL,1);
  const original='{"gap":8}\n',target=path.join(root,'design-tokens.json');await writeFile(target,original);
  await writeFile(spec,JSON.stringify({mode:'pick',question:'Pick a candidate',candidates:[{id:'a',label:'A',tokens:{gap:12},observation:input.observation,checks:input.checks}],destination:{file:target,expected_sha256:'0'.repeat(64),keys:['gap']}}));
  run=spawnSync(process.execPath,[cli,'--spec',spec,'--apply','--execute'],{env,encoding:'utf8',cwd:root});
  assert.equal(run.status,3,run.stderr);assert.equal(JSON.parse(run.stdout).applied,false);assert.equal(await readFile(target,'utf8'),original);
});
