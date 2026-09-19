import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {applyTokens} from '../integration/visual-tokens.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');

test('selected token values apply atomically with backup and explicit allowed keys',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'jev-visual-tokens-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'design-tokens.json'),original='{"gap":8,"fontSize":16}\n';
  await writeFile(file,original);
  const destination={file,expected_sha256:hash(original),keys:['gap']};
  await assert.rejects(()=>applyTokens(destination,{fontSize:30},{cwd:root}),/invalid_token_destination/);
  const result=await applyTokens(destination,{gap:12},{cwd:root,backupRoot:path.join(root,'backups')});
  assert.equal(result.applied,true);assert.equal(result.pixel_review,'NOT_PERFORMED');
  assert.equal(await readFile(result.backup,'utf8'),original);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{gap:12,fontSize:16});
  await assert.rejects(()=>applyTokens(destination,{gap:24},{cwd:root}),/stale_token_file/);
});

test('application refuses unrelated config, outside paths and symlink target',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'jev-visual-target-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const original='{"gap":8}\n',real=path.join(root,'design-tokens.json');await writeFile(real,original);
  const base={expected_sha256:hash(original),keys:['gap']};
  for (const file of ['config.json','../outside.tokens.json']) await assert.rejects(()=>applyTokens({...base,file},{gap:12},{cwd:root}),/token_destination_outside_scope/);
  const link=path.join(root,'linked.tokens.json');await symlink(real,link);
  await assert.rejects(()=>applyTokens({...base,file:link},{gap:12},{cwd:root}),/token_symlink/);
  assert.equal(await readFile(real,'utf8'),original);
});
