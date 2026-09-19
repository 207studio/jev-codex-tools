import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('../bin/jev-conflicts.mjs',import.meta.url));
async function fixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'jev-conflict-cli-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const features=path.join(root,'features.json');await writeFile(features,'{}\n');
  const env={...process.env,JEV_TOOLS_HOME:root,JEV_FEATURES_FILE:features,JEV_CODE_CONTRADICTIONS_ENABLED:'0',JEV_API_KEY:'',TYPESAFE_API_KEY:''};
  return {root,env,run:(args,overrides={})=>spawnSync(process.execPath,[cli,...args],{cwd:root,env:{...env,...overrides},encoding:'utf8',timeout:10000})};
}

test('help and disabled mode require neither source files nor model calls or new state',async t=>{
  const fixtureData=await fixture(t),before=await readdir(fixtureData.root,{recursive:true});
  const help=fixtureData.run(['--help']);assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/TypeSafe Jev/);assert.match(help.stdout,/--read MANIFEST/);
  const disabled=fixtureData.run(['--spec',path.join(fixtureData.root,'does-not-exist.json')]);assert.equal(disabled.status,0,disabled.stderr);
  assert.deepEqual(JSON.parse(disabled.stdout),{status:'DISABLED',feature:'code_contradictions',jev_requests:0});
  assert.deepEqual(await readdir(fixtureData.root,{recursive:true}),before);
});

test('malformed arguments and noninteger cursors fail without model access',async t=>{
  const {run}=await fixture(t);
  for(const args of [[],['--spec','a','--read','b'],['--spec','a','--cursor','0'],['--read','a','--cursor','-1'],['--read','a','--cursor','1.5'],['--read','a','--cursor','1e2'],['--read','a','--cursor','9007199254740992'],['--spec','a','--execute']]) {
    const result=run(args);assert.equal(result.status,2,result.stderr);assert.equal(JSON.parse(result.stdout).status,'UNKNOWN');assert.ok(Buffer.byteLength(result.stdout)<=4000);
  }
});

test('enabled mode rejects malformed or oversized specs before indexing',async t=>{
  const {root,run}=await fixture(t),spec=path.join(root,'spec.json');
  for(const content of ['not-json',' '.repeat(16385)]) {
    await writeFile(spec,content);const result=run(['--spec',spec],{JEV_CODE_CONTRADICTIONS_ENABLED:'1'});
    assert.equal(result.status,2,result.stderr);assert.equal(JSON.parse(result.stdout).status,'UNKNOWN');assert.ok(Buffer.byteLength(result.stdout)<=4000);
  }
});

test('read mode remains available when the feature is off and reports missing evidence as UNKNOWN',async t=>{
  const {root,run}=await fixture(t),result=run(['--read',path.join(root,'missing-manifest.json'),'--cursor','0']);
  assert.equal(result.status,2,result.stderr);assert.equal(JSON.parse(result.stdout).status,'UNKNOWN');assert.notEqual(JSON.parse(result.stdout).status,'DISABLED');
});
