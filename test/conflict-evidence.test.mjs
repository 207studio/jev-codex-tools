import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,symlink,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {collectEvidence,sourceFingerprint} from '../integration/conflict-evidence.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const group=(files,extra={})=>({id:'behavior',symbol:'target',files,...extra});
const spec=(groups,extra={})=>({question:'Do these explicit excerpts disagree under the same condition?',groups,...extra});
const hasIssue=(result,code)=>result.issues.some(issue=>issue.code===code);
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'jev-conflict-evidence-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const write=async(file,text)=>{
    const target=path.join(root,file);await mkdir(path.dirname(target),{recursive:true});
    await writeFile(target,text,{mode:0o600});return target;
  };
  const collect=input=>collectEvidence(input,{cwd:root});
  return {root,write,collect};
}

test('preserves exact CRLF excerpts, 1-based locations and full-source hashes',async t=>{
  const f=await fixture(t),a='before\r\nfunction target() {}\r\nafter\r\n',b='target()\n';
  await f.write('src/a.ts',a);await f.write('src/b.ts',b);
  const result=await f.collect(spec([group(['src/b.ts','src/a.ts','./src/a.ts'],{context:'Called with the same inputs.'})],{context_lines:1}));
  assert.equal(result.root,await realpath(f.root));assert.equal(result.schema,1);
  assert.deepEqual(result.spans.map(({file,start_line,end_line,text,sha256,file_sha256})=>({file,start_line,end_line,text,sha256,file_sha256})),[
    {file:'src/a.ts',start_line:1,end_line:3,text:a,sha256:hash(a),file_sha256:hash(a)},
    {file:'src/b.ts',start_line:1,end_line:1,text:b,sha256:hash(b),file_sha256:hash(b)}
  ]);
  assert.deepEqual(result.pairs.map(({group,symbol,context,left,right})=>({group,symbol,context,left,right})),[
    {group:'behavior',symbol:'target',context:'Called with the same inputs.',left:result.spans[0].id,right:result.spans[1].id}
  ]);
  assert.deepEqual(result.scope,{complete:false,files_considered:2,pairs_omitted:0});
  assert.deepEqual(result.issues,[]);
});

test('symbol is literal, repeated matches in the same span are deduplicated',async t=>{
  const f=await fixture(t);await f.write('literal.js','axb\na.*b(); a.*b();\nlast\n');
  const result=await f.collect(spec([group(['literal.js'],{symbol:'a.*b'})],{context_lines:0}));
  assert.equal(result.spans.length,1);assert.equal(result.spans[0].start_line,2);
  assert.equal(result.spans[0].text,'a.*b(); a.*b();\n');
  assert.equal(result.pairs.length,0);assert.equal(hasIssue(result,'insufficient_spans'),true);
});

test('multiline literals and trailing-newline boundaries keep exact source bytes',async t=>{
  const f=await fixture(t),text='prefix\nfirst\nsecond\nlast';await f.write('multiline.py',text);
  const result=await f.collect(spec([group(['multiline.py'],{symbol:'first\nsecond'})],{context_lines:0}));
  assert.equal(result.spans[0].text,'first\nsecond\n');assert.equal(result.spans[0].start_line,2);assert.equal(result.spans[0].end_line,3);
  assert.equal(result.spans[0].sha256,hash('first\nsecond\n'));assert.equal(result.spans[0].file_sha256,hash(text));
});

test('default context is four lines and oversized spans are omitted without truncation',async t=>{
  const f=await fixture(t);await f.write('context.go',['one','two','three','four','five','target','seven','eight','nine','ten','eleven'].join('\n'));
  const normal=await f.collect(spec([group(['context.go'])]));
  assert.equal(normal.spans[0].start_line,2);assert.equal(normal.spans[0].end_line,10);
  await f.write('large-span.ts','target '+ '한'.repeat(600));
  const oversized=await f.collect(spec([group(['large-span.ts'])],{context_lines:0}));
  assert.equal(oversized.spans.length,0);assert.equal(oversized.pairs.length,0);assert.ok(hasIssue(oversized,'snippet_too_large'));
});

test('source size limit is measured in bytes before content extraction',async t=>{
  const f=await fixture(t),exact='target\n'+'x'.repeat(65529);
  await f.write('exact.rs',exact);await f.write('too-large.rs',exact+'x');
  const result=await f.collect(spec([group(['exact.rs','too-large.rs'])],{context_lines:0}));
  assert.deepEqual(result.spans.map(span=>span.file),['exact.rs']);
  assert.equal(result.spans[0].file_sha256,hash(exact));assert.ok(hasIssue(result,'file_too_large'));
  await assert.rejects(sourceFingerprint(f.root,'too-large.rs'),{message:'file_too_large'});
});

test('hidden, dependency, generated, secret-name, lock and nonallowlisted files are excluded',async t=>{
  const f=await fixture(t),files=['.hidden/a.ts','node_modules/a.ts','vendor/a.ts','generated/a.ts','pnpm-lock.yaml','credentials.toml','script.min.js','package.json'];
  for(const file of files)await f.write(file,'target\n');
  const result=await f.collect(spec([group(files)]));
  assert.equal(result.spans.length,0);assert.ok(hasIssue(result,'blocked_path'));
  await f.write('compiled.ts','// @generated\ntarget\n');await f.write('bad-utf8.ts',Buffer.from([0xff,0xfe]));await f.write('binary.ts',Buffer.from('target\0body'));
  const other=await f.collect(spec([group(['compiled.ts','bad-utf8.ts','binary.ts'])]));
  assert.equal(other.spans.length,0);assert.ok(hasIssue(other,'generated_source'));assert.ok(hasIssue(other,'invalid_text'));
});

test('missing symbols and missing files leave explicit incomplete evidence',async t=>{
  const f=await fixture(t);await f.write('unrelated.md','ordinary text\n');
  const result=await f.collect(spec([group(['unrelated.md','missing.ts'])]));
  assert.equal(result.spans.length,0);assert.ok(hasIssue(result,'symbol_not_found'));assert.ok(hasIssue(result,'source_unavailable'));
  assert.deepEqual(result.scope,{complete:false,files_considered:2,pairs_omitted:0});
});

test('group span and global pair limits count omissions with deterministic ordering',async t=>{
  const f=await fixture(t);
  for(const file of ['a.ts','b.ts'])await f.write(file,'target\ntarget\ntarget\ntarget\n');
  const first=await f.collect(spec([group(['b.ts','a.ts'])],{context_lines:0,max_pairs:4}));
  const second=await f.collect(spec([group(['a.ts','b.ts'])],{context_lines:0,max_pairs:4}));
  assert.deepEqual(second,first);assert.equal(first.spans.length,6);assert.equal(first.pairs.length,4);
  assert.equal(first.scope.pairs_omitted,24);assert.ok(hasIssue(first,'span_limit'));assert.ok(hasIssue(first,'pair_limit'));
  for(const pair of first.pairs){assert.ok(first.spans.some(span=>span.id===pair.left));assert.ok(first.spans.some(span=>span.id===pair.right));}
  const groups=[group(['b.ts'],{id:'z'}),group(['a.ts'],{id:'a'})];
  const ordered=await f.collect(spec(groups,{context_lines:0,max_pairs:1}));
  assert.equal(ordered.pairs[0].group,'a');assert.equal(ordered.scope.pairs_omitted,11);
});

test('secrets anywhere in a source or metadata are withheld without values or hashes',async t=>{
  const f=await fixture(t),credential=['Bearer','fixture-only-credential'].join(' '),secretId='sk-'+'a'.repeat(20);
  await f.write('withheld.ts','target\n'+'ordinary\n'.repeat(30)+['Authorization',credential].join(': '));
  const result=await f.collect(spec([group(['withheld.ts'])],{context_lines:0}));
  assert.equal(result.spans.length,0);assert.equal(result.pairs.length,0);
  assert.deepEqual(result.issues.find(issue=>issue.code==='source_withheld'),{code:'source_withheld'});
  assert.ok(!JSON.stringify(result).includes(credential));
  await assert.rejects(sourceFingerprint(f.root,'withheld.ts'),{message:'source_withheld'});
  for(const item of [group(['safe.ts'],{id:secretId}),group(['safe.ts'],{symbol:credential}),group([`${secretId}.ts`])]){
    const withheld=await f.collect(spec([item]));
    assert.equal(withheld.spans.length,0);assert.equal(withheld.pairs.length,0);assert.ok(hasIssue(withheld,'source_withheld'));
    const serialized=JSON.stringify(withheld);assert.ok(!serialized.includes(credential));assert.ok(!serialized.includes(secretId));
    assert.deepEqual(withheld.issues.find(issue=>issue.code==='source_withheld'),{code:'source_withheld'});
  }
  for(const input of [spec([group(['safe.ts'])],{question:credential}),spec([group(['safe.ts'])],{root:credential}),spec([group(['safe.ts'],{context:credential})])])
    await assert.rejects(f.collect(input),{message:'invalid_spec'});
});

test('outside paths and file or directory symlinks cannot contribute evidence',async t=>{
  const f=await fixture(t),inside=await f.write('safe.ts','target\n');
  const outside=await mkdtemp(path.join(os.tmpdir(),'jev-conflict-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(path.join(outside,'outside.ts'),'target\n');
  await symlink(inside,path.join(f.root,'inside-link.ts'));
  await symlink(path.join(outside,'outside.ts'),path.join(f.root,'escape.ts'));
  await symlink(outside,path.join(f.root,'directory-link'),'dir');
  const result=await f.collect(spec([group(['../outside.ts',path.join(outside,'outside.ts'),'inside-link.ts','escape.ts','directory-link/outside.ts'])]));
  assert.equal(result.spans.length,0);assert.ok(hasIssue(result,'outside_root'));assert.ok(hasIssue(result,'symlink'));
  assert.ok(!JSON.stringify(result).includes(outside));
  await assert.rejects(sourceFingerprint(f.root,'inside-link.ts'),{message:'symlink'});
  await assert.rejects(sourceFingerprint(f.root,'../outside.ts'),{message:'outside_root'});
  const rootLink=path.join(outside,'root-link');await symlink(f.root,rootLink,'dir');
  await assert.rejects(f.collect(spec([group(['safe.ts'])],{root:rootLink})),{message:'invalid_spec'});
});

test('typed schema limits reject invalid specs with only a static error',async t=>{
  const f=await fixture(t),base=()=>spec([group(['a.ts'])]);
  const invalid=[null,{},spec([]),{...base(),unknown:true},{...base(),question:'한'.repeat(171)},
    {...base(),context_lines:null},{...base(),context_lines:9},{...base(),max_pairs:0},{...base(),max_pairs:25},
    spec([group(['a.ts'],{symbol:'x'.repeat(101)})]),spec([group(['a.ts'],{literal:'target'})]),
    spec([group(['a.ts'],{context:'x'.repeat(513)})]),spec([group(['a.ts'],{id:'bad id'})]),
    spec([group(['a.ts']),group(['b.ts'])]),spec([group(['a'.repeat(241)])]),
    spec([group(Array.from({length:9},(_,i)=>`${i}.ts`))]),
    spec(Array.from({length:9},(_,i)=>group(['a.ts'],{id:`g${i}`}))),
    spec([group(Array.from({length:8},(_,i)=>`${i}.ts`),{id:'a'}),group(Array.from({length:8},(_,i)=>`${i+8}.ts`),{id:'b'}),group(['16.ts'],{id:'c'})])];
  for(const input of invalid)await assert.rejects(f.collect(input),{message:'invalid_spec'});
});

test('fingerprints cover full current bytes and collection never writes or calls a model',async t=>{
  const f=await fixture(t),filename=await f.write('source.swift','target\noriginal unrelated line\n');
  t.mock.method(globalThis,'fetch',()=>{throw Error('unexpected_network_call');});
  const input=spec([group(['source.swift'])],{context_lines:0}),before=await readdir(f.root);
  const first=await f.collect(input),firstHash=await sourceFingerprint(f.root,'source.swift');
  assert.equal(firstHash,hash(await readFile(filename)));assert.equal(first.spans[0].file_sha256,firstHash);
  assert.deepEqual(await readdir(f.root),before);
  const changed='target\nchanged unrelated line\n';await writeFile(filename,changed);
  const second=await f.collect(input),secondHash=await sourceFingerprint(f.root,'source.swift');
  assert.notEqual(secondHash,firstHash);assert.equal(secondHash,hash(changed));
  assert.equal(second.spans[0].text,first.spans[0].text);assert.equal(second.spans[0].sha256,first.spans[0].sha256);
  assert.notEqual(second.spans[0].id,first.spans[0].id);assert.equal(second.spans[0].file_sha256,secondHash);
  assert.equal(await readFile(filename,'utf8'),changed);assert.deepEqual(await readdir(f.root),before);
});
