import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const allowedEnvironment=new Set(['PATH','SYSTEMROOT','COMSPEC','PATHEXT','WINDIR','LANG','LC_ALL','LC_CTYPE','TERM','COLORTERM','CI','NO_COLOR','FORCE_COLOR','NUMBER_OF_PROCESSORS']);

// Keep only OS/terminal settings: provider keys, feature overrides, preload options,
// proxy credentials, agent configuration and other account variables do not reach tests.
export function isolatedEnvironment(environment,root,featuresFile) {
  const isolated={};
  for(const [key,value] of Object.entries(environment)) {
    if(/^(?:JEV|TYPESAFE)/i.test(key)||!allowedEnvironment.has(key.toUpperCase())||typeof value!=='string')continue;
    isolated[key]=value;
  }
  const home=path.join(root,'home'),temporary=path.join(root,'tmp');
  return {...isolated,HOME:home,USERPROFILE:home,CODEX_HOME:path.join(root,'codex'),
    XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),
    XDG_STATE_HOME:path.join(root,'state'),XDG_CACHE_HOME:path.join(root,'cache'),
    TMPDIR:temporary,TMP:temporary,TEMP:temporary,
    JEV_TOOLS_HOME:path.join(root,'jev-tools'),JEV_FEATURES_FILE:featuresFile};
}

export async function runTests({root=projectRoot,environment=process.env,spawnProcess=spawn}={}) {
  const directory=path.join(root,'test');
  const entries=await readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const tests=entries.filter(entry=>entry.isFile()&&entry.name.endsWith('.test.mjs')).map(entry=>path.join(directory,entry.name)).sort();
  if(!tests.length)throw Error('npm test requires a Git clone containing test/*.test.mjs; the npm package does not include test fixtures.');
  const temporary=await mkdtemp(path.join(tmpdir(),'jev-tools-tests-'));
  try {
    const featuresFile=path.join(temporary,'jev-tools','config','features.json'),env=isolatedEnvironment(environment,temporary,featuresFile);
    for(const destination of new Set([env.HOME,env.CODEX_HOME,env.XDG_CONFIG_HOME,env.XDG_DATA_HOME,env.XDG_STATE_HOME,env.XDG_CACHE_HOME,env.TMPDIR,path.dirname(featuresFile)]))await mkdir(destination,{recursive:true,mode:0o700});
    await writeFile(featuresFile,'{}\n',{mode:0o600,flag:'wx'});
    const child=spawnProcess(process.execPath,['--test',...tests],{cwd:root,env,stdio:'inherit',shell:false});
    const interrupt=()=>child.kill('SIGINT'),terminate=()=>child.kill('SIGTERM');
    process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
    try {
      return await new Promise((resolve,reject)=>{
        child.once('error',reject);
        child.once('close',(code,signal)=>resolve({code,signal}));
      });
    }finally {
      process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);
    }
  }finally {
    // The child owns the unmodified output and exit result; cleanup must not rewrite them.
    await rm(temporary,{recursive:true,force:true}).catch(error=>process.stderr.write(`test runner cleanup failed: ${error.code||'unknown'}\n`));
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==2)throw Error('Use npm test from a Git clone; this runner takes no arguments.');
    const result=await runTests();
    if(result.signal) {
      try{process.kill(process.pid,result.signal);}catch{process.exitCode=1;}
    }else process.exitCode=result.code??1;
  }catch(error) {
    process.stderr.write(`test runner: ${error.message}\n`);process.exitCode=1;
  }
}
