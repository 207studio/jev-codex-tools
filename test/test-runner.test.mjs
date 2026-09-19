import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {isolatedEnvironment,runTests} from '../scripts/test.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'jev-runner-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'test'));return root;
}

test('isolated environment omits actual credentials, feature flags, user state and Node preloads',()=>{
  const root=path.join(tmpdir(),'synthetic-isolation'),features=path.join(root,'features.json');
  const env=isolatedEnvironment({PATH:'/synthetic/bin',LANG:'C',JEV_API_KEY:'synthetic-key',jev_custom:'synthetic',TYPESAFE_API_KEY:'synthetic-key',TypesafeOther:'synthetic',
    HOME:'/synthetic/user',CODEX_HOME:'/synthetic/codex',XDG_CONFIG_HOME:'/synthetic/config',NODE_OPTIONS:'--import /synthetic/module.mjs',NODE_PATH:'/synthetic/modules',OPENAI_API_KEY:'synthetic-key',GITHUB_TOKEN:'synthetic-key',SSH_AUTH_SOCK:'/synthetic/socket'},root,features);
  assert.equal(env.PATH,'/synthetic/bin');assert.equal(env.LANG,'C');assert.equal(env.HOME,path.join(root,'home'));assert.equal(env.USERPROFILE,env.HOME);
  assert.equal(env.JEV_TOOLS_HOME,path.join(root,'jev-tools'));assert.equal(env.JEV_FEATURES_FILE,features);
  for(const name of ['JEV_API_KEY','jev_custom','TYPESAFE_API_KEY','TypesafeOther','NODE_OPTIONS','NODE_PATH','OPENAI_API_KEY','GITHUB_TOKEN','SSH_AUTH_SOCK'])assert.ok(!Object.hasOwn(env,name));
});

test('runner discovers all test files without shell globbing and preserves exit/output configuration',async t=>{
  const root=await fixture(t);
  await writeFile(path.join(root,'test','b.test.mjs'),'');await writeFile(path.join(root,'test','a.test.mjs'),'');await writeFile(path.join(root,'test','fixture.txt'),'');
  let captured;
  const result=await runTests({root,environment:{JEV_API_KEY:'synthetic',TYPESAFE_API_KEY:'synthetic'},spawnProcess:(command,args,options)=>{
    captured={command,args,options};const child=new EventEmitter();child.kill=()=>true;
    queueMicrotask(async()=>{
      try{assert.deepEqual(JSON.parse(await readFile(options.env.JEV_FEATURES_FILE,'utf8')),{});assert.equal((await stat(options.env.JEV_FEATURES_FILE)).mode&0o777,0o600);child.emit('close',7,null);}catch(error){child.emit('error',error);}
    });return child;
  }});
  assert.deepEqual(result,{code:7,signal:null});assert.equal(captured.command,process.execPath);assert.deepEqual(captured.args,['--test',path.join(root,'test','a.test.mjs'),path.join(root,'test','b.test.mjs')]);
  assert.equal(captured.options.stdio,'inherit');assert.equal(captured.options.shell,false);assert.equal(captured.options.cwd,root);
  await assert.rejects(stat(captured.options.env.JEV_TOOLS_HOME),{code:'ENOENT'});
});

test('runner removes temporary state after spawn errors and preserves child signals',async t=>{
  const root=await fixture(t);await writeFile(path.join(root,'test','one.test.mjs'),'');let temporary;
  await assert.rejects(runTests({root,spawnProcess:(_command,_args,options)=>{
    temporary=options.env.JEV_TOOLS_HOME;const child=new EventEmitter();child.kill=()=>true;queueMicrotask(()=>child.emit('error',Error('synthetic launch failure')));return child;
  }}),/synthetic launch failure/);await assert.rejects(stat(temporary),{code:'ENOENT'});
  const result=await runTests({root,spawnProcess:(_command,_args,options)=>{
    temporary=options.env.JEV_TOOLS_HOME;const child=new EventEmitter();child.kill=()=>true;queueMicrotask(()=>child.emit('close',null,'SIGTERM'));return child;
  }});
  assert.deepEqual(result,{code:null,signal:'SIGTERM'});await assert.rejects(stat(temporary),{code:'ENOENT'});
});

test('published package without clone fixtures fails clearly before launching anything',async t=>{
  const root=await fixture(t);
  await assert.rejects(runTests({root,spawnProcess:()=>assert.fail('no fixture suite')}),/requires a Git clone/);
});
