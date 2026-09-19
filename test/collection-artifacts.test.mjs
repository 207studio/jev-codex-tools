import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {readCollection} from '../integration/collection-artifacts.mjs';
import {digest} from '../integration/collection-sources.mjs';
import {selectRecords} from '../integration/data-collection.mjs';

test('read pages preserve unknown evidence, hide secrets and never repeat dropped records',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'jev-artifact-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const records=Array.from({length:7},(_,i)=>({id:`r${i}`,source:'s1',decision:'UNKNOWN',text:'가'.repeat(400),offset:i*400}));
  records.splice(2,0,{id:'d',source:'s1',decision:'DROP',offset:0});
  records.push({id:'secret',source:'s1',decision:'UNKNOWN',reason:'secret_withheld',text:'private fixture value',offset:0});
  const text=JSON.stringify(records),manifest=path.join(root,'manifest.json');
  await writeFile(path.join(root,'records.json'),text);
  await writeFile(manifest,JSON.stringify({schema:2,status:'PARTIAL',records_file:'records.json',records_sha256:digest(text)}));
  const seen=[];let cursor=0;
  do {
    const page=await readCollection(manifest,cursor);
    assert.ok(Buffer.byteLength(JSON.stringify(page))<=4000);
    for (const item of page.items) {seen.push(item.id);if(item.id==='secret'){assert.equal(item.text,undefined);assert.equal(item.withheld,true);}}
    cursor=page.next_cursor;
  } while (cursor!==null);
  assert.deepEqual(seen,[...Array.from({length:7},(_,i)=>`r${i}`),'secret']);
  await writeFile(path.join(root,'records.json'),text+' ');
  await assert.rejects(()=>readCollection(manifest),/artifact_integrity_failed/);
});

test('protected and cross-page secret records remain UNKNOWN without model calls',async()=>{
  let calls=0;
  const result=await selectRecords([
    {id:'error',source:'s1',offset:0,text:'Exact error evidence',protected:true},
    {id:'body',source:'s2',offset:10000,text:'secret body outside the header page',secret_source:true}
  ],{question:'Find relevant records',active:true,decide:async()=>{calls++;return null;}});
  assert.equal(calls,0);assert.equal(result.stats.unknown,2);
  assert.deepEqual(result.records.map(r=>r.reason),['protected_evidence','secret_withheld']);
});
