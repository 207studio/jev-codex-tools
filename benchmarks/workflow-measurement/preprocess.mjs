import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const [runtime,fixture,out]=process.argv.slice(2);
if(![runtime,fixture,out].every(x=>x&&path.isAbsolute(x)))throw Error('absolute paths required');
const {planWorkflow}=await import(pathToFileURL(path.join(runtime,'integration/workflow-policy.mjs')));
const {persistedPlan}=await import(pathToFileURL(path.join(runtime,'integration/workflow-cli.mjs')));
const {chooseDetailed}=await import(pathToFileURL(path.join(runtime,'integration/choice.mjs')));
const cases=JSON.parse(await readFile(path.join(fixture,'cases.json'),'utf8'));
const usageKeys=['input_tokens','output_tokens','total_tokens','prompt_tokens','completion_tokens'];
await mkdir(out,{recursive:true,mode:0o700});
const save=(name,value)=>writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
for(const repetition of [1,2]) {
  const records=[],plans=[],provider=[];
  let requests=0;
  const fetchImpl=async(...args)=>{
    requests++;
    const result=await fetch(...args);
    try {const data=await result.clone().json();provider.push({model:data.model??null,usage:Object.fromEntries(usageKeys.filter(k=>Number.isFinite(data.usage?.[k])).map(k=>[k,data.usage[k]]))});}
    catch {provider.push({model:null,usage:null});}
    return result;
  };
  const decide=(s,i,c,o)=>chooseDetailed(s,i,c,{...o,fetchImpl});
  const start=performance.now();
  for(const item of cases) {
    const {id,...metadata}=item;const spec={context_id:`measurement-${repetition}-${id}`, ...metadata};
    const specFile=path.join(out,`spec-${repetition}-${id}.json`),outFile=path.join(out,`plan-${repetition}-${id}.json`);
    await writeFile(specFile,JSON.stringify(spec),{flag:'wx',mode:0o600});
    const plan=await persistedPlan({specFile,outFile},{isEnabled:()=>true,decide});
    records.push({id,strategy:plan.strategy});plans.push({id,...plan});
  }
  const coldMs=performance.now()-start,before=requests,warmStart=performance.now();
  for(const item of cases)await persistedPlan({specFile:path.join(out,`spec-${repetition}-${item.id}.json`),outFile:path.join(out,`plan-${repetition}-${item.id}.json`)},{isEnabled:()=>true,decide});
  await save(`C${repetition}.json`,{records,plans,requests:before,provider,cold_ms:coldMs,warm_ms:performance.now()-warmStart,warm_additional_requests:requests-before});
  const codeStart=performance.now(),code=[];
  for(const {id,...metadata} of cases) {const plan=await planWorkflow({context_id:`code-${repetition}-${id}`,...metadata},{enabled:false});code.push({id,strategy:plan.strategy});}
  await save(`B${repetition}.json`,{records:code,requests:0,provider:[],cold_ms:performance.now()-codeStart});
}
console.log(JSON.stringify({prepared_repetitions:2,raw_records:cases.length,raw_text_printed:false}));
