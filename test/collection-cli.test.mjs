import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../bin/jev-collect.mjs',import.meta.url));

test('CLI disable, missing API fallback, artifacts and overwrite protection',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jev-collection-cli-'));
  try {
    const spec=path.join(root,'spec.json'), input=path.join(root,'input.txt'), output=path.join(root,'results');
    await writeFile(input,'public source sentence\nanother source sentence\n');
    await writeFile(spec,JSON.stringify({question:'Keep useful records',mode:'filter',sources:[{file:input,format:'text'}],output_dir:output}));
    const env={...process.env,JEV_TOOLS_HOME:root,JEV_API_KEY:'',TYPESAFE_API_KEY:'',JEV_DATA_COLLECTION_ENABLED:'0'};
    const run=()=>spawnSync(process.execPath,[cli,'--spec',spec],{env,encoding:'utf8'});
    let r=run();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).status,'DISABLED');
    await assert.rejects(()=>stat(output));
    env.JEV_DATA_COLLECTION_ENABLED='1';r=run();assert.equal(r.status,0,r.stderr);
    assert.ok(Buffer.byteLength(r.stdout)<=4000);assert.equal(JSON.parse(r.stdout).status,'PARTIAL');
    assert.equal((await readFile(path.join(output,'s1.source'),'utf8')),await readFile(input,'utf8'));
    const records=JSON.parse(await readFile(path.join(output,'records.json'),'utf8'));
    assert.ok(records.every(row=>row.decision==='UNKNOWN'));assert.equal(records.length,2);
    assert.equal((await stat(path.join(output,'records.json'))).mode & 0o777,0o600);
    r=run();assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).reason,'output_already_exists');
    await mkdir(path.join(root,'present'));
  } finally {await rm(root,{recursive:true,force:true});}
});
