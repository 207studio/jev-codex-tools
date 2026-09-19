import {mkdir,appendFile} from 'node:fs/promises';
import {stateHome} from './paths.mjs';
import path from 'node:path';
import {enabled} from './features.mjs';

async function recordMetrics(start,bodyBytes,data,outcome) {
  if(!enabled('decision_metrics'))return;
  try {
    const root=path.join(stateHome, 'metrics');
    await mkdir(root,{recursive:true,mode:0o700});
    const token=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    await appendFile(path.join(root,'decisions.jsonl'),JSON.stringify({time:Date.now(),caller:path.basename(process.argv[1]||'unknown'),latency_ms:Date.now()-start,request_bytes:bodyBytes,input_tokens:token(data?.usage?.input_tokens),output_tokens:token(data?.usage?.output_tokens),outcome})+'\n',{mode:0o600});
  }catch{}
}

export async function choose(state,instructions,criteria,{timeout=2500,retries=0}={}) {
  const key=process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
  if(!key) return null;
  const keys=Object.keys(criteria);
  const body=JSON.stringify({model:'jev-latest',state,questions:{decision:{type:'choice',instructions,criteria}}});
  if(Buffer.byteLength(body)>65536) return null;
  for(let attempt=0;attempt<=retries;attempt++) {
    const start=Date.now();
    try {
      const response=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(timeout)});
      if(!response.ok){await recordMetrics(start,Buffer.byteLength(body),null,'http_error');return null;}
      const data=await response.json(), answer=data.answers?.decision, p=answer?.probabilities;
      if(answer?.type!=='choice' || !keys.includes(answer.choice) || !p ||
        Object.keys(p).sort().join()!==[...keys].sort().join() ||
        keys.some(k=>!Number.isFinite(p[k]) || p[k]<0 || p[k]>1) ||
        Math.abs(keys.reduce((n,k)=>n+p[k],0)-1)>0.02 ||
        p[answer.choice]+0.001<Math.max(...Object.values(p)) ||
        !Number.isFinite(answer.confidence) || answer.confidence<0 || answer.confidence>1 ||
        typeof data.model!=='string' || !/^jev[-\w.]*$/i.test(data.model)){await recordMetrics(start,Buffer.byteLength(body),data,'invalid_response');return null;}
      await recordMetrics(start,Buffer.byteLength(body),data,'decision');
      return {choice:answer.choice,confidence:answer.confidence};
    } catch { await recordMetrics(start,Buffer.byteLength(body),null,'transport_error');if(attempt===retries) return null; }
  }
  return null;
}

// Several decisions over one bounded state, without resending that state per item.
export async function chooseMany(state,questions,{timeout=3500}={}) {
  const key=process.env.TYPESAFE_API_KEY||process.env.JEV_API_KEY;
  const ids=Object.keys(questions);
  if(!key||!ids.length||ids.length>24)return null;
  const body=JSON.stringify({model:'jev-latest',state,questions});
  const size=Buffer.byteLength(body);
  if(size>60000)return null;
  const start=Date.now();
  try {
    const response=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(timeout)});
    if(!response.ok){await recordMetrics(start,size,null,'http_error');return null;}
    const data=await response.json();
    if(typeof data.model!=='string'||!/^jev[-\w.]*$/i.test(data.model))throw Error('model');
    const answers={};
    for(const id of ids) {
      const keys=Object.keys(questions[id].criteria), a=data.answers?.[id], p=a?.probabilities;
      if(a?.type!=='choice'||!keys.includes(a.choice)||!p||
        Object.keys(p).sort().join()!==[...keys].sort().join()||
        keys.some(k=>!Number.isFinite(p[k])||p[k]<0||p[k]>1)||
        Math.abs(keys.reduce((sum,k)=>sum+p[k],0)-1)>0.02||
        p[a.choice]+0.001<Math.max(...Object.values(p))||
        !Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1) {
        answers[id]=null;
      } else answers[id]={choice:a.choice,confidence:a.confidence};
    }
    await recordMetrics(start,size,data,'decision');
    return answers;
  }catch{await recordMetrics(start,size,null,'transport_or_invalid_response');return null;}
}
