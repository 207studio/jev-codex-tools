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
    const read=spawnSync(process.execPath,[cli,'--read',path.join(output,'manifest.json')],{env,encoding:'utf8'});
    assert.equal(read.status,0,read.stderr);assert.equal(JSON.parse(read.stdout).items.length,2);
    r=run();assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).reason,'output_already_exists');
    await mkdir(path.join(root,'present'));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('maximum collection pages projected sources and preserves global duplicate provenance',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jev-maximum-cli-'));
  try {
    const input=path.join(root,'rows.json'),spec=path.join(root,'spec.json'),out=path.join(root,'out');
    const rows=Array.from({length:101},(_,i)=>({message:`Required evidence must be retained ${i}`,other:'unused'}));
    rows.push({...rows[0]});
    await writeFile(input,JSON.stringify({data:{items:rows}}));
    await writeFile(spec,JSON.stringify({profile:'maximum',question:'Find evidence',mode:'filter',sources:[{file:input,format:'json',records_path:['data','items'],text_fields:['message']}],output_dir:out}));
    const result=spawnSync(process.execPath,[cli,'--spec',spec],{env:{...process.env,JEV_DATA_COLLECTION_ENABLED:'1',JEV_TOOLS_HOME:root,JEV_API_KEY:'',TYPESAFE_API_KEY:''},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr+result.stdout);
    const data=JSON.parse(result.stdout);assert.equal(data.profile,'maximum');
    assert.equal(data.stats.pages,2);assert.equal(data.stats.input_records,102);assert.equal(data.stats.exact_duplicates,1);assert.equal(data.stats.jev_requests,0);
    const records=JSON.parse(await readFile(path.join(out,'records.json'),'utf8'));
    assert.equal(records.length,101);assert.equal(records[0].aliases.length,1);assert.equal(records[0].aliases[0].record_index,101);
    assert.equal(await readFile(path.join(out,'s1.source'),'utf8'),await readFile(input,'utf8'));
  } finally {await rm(root,{recursive:true,force:true});}
});
