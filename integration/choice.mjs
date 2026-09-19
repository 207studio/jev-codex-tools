import {mkdir,appendFile} from 'node:fs/promises';
import {stateHome} from './paths.mjs';
import path from 'node:path';
import {enabled} from './features.mjs';
import {diagnoseUnknown} from './unknown-diagnosis.mjs';

async function recordMetrics(start,bodyBytes,data,outcome) {
  if(!enabled('decision_metrics'))return;
  try {
    const root=path.join(stateHome,'metrics');
    await mkdir(root,{recursive:true,mode:0o700});
    const token=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    await appendFile(path.join(root,'decisions.jsonl'),JSON.stringify({time:Date.now(),caller:path.basename(process.argv[1]||'unknown'),latency_ms:Date.now()-start,request_bytes:bodyBytes,input_tokens:token(data?.usage?.input_tokens),output_tokens:token(data?.usage?.output_tokens),outcome})+'\n',{mode:0o600});
  }catch{}
}

async function report(info,onDiagnostic) {
  try{onDiagnostic?.(info);}catch{}
  if(info.status==='decided'||!enabled('unknown_diagnostics'))return;
  try {
    const root=path.join(stateHome,'metrics');
    await mkdir(root,{recursive:true,mode:0o700});
    // No original state, instructions, key, provider error text or proposed literal is logged.
    await appendFile(path.join(root,'unknown-decisions.jsonl'),JSON.stringify({time:Date.now(),caller:path.basename(process.argv[1]||'unknown'),status:info.status,http_status:info.http_status??null,validation_code:info.validation_code??null,diagnosis:info.diagnosis?{reason:info.diagnosis.reason,confidence:info.diagnosis.confidence,request_attempted:info.diagnosis.request_attempted,proposed_option:Boolean(info.diagnosis.proposed_option)}:null})+'\n',{mode:0o600});
  }catch{}
}

function validationCode(answer,criteria) {
  const keys=Object.keys(criteria||{}),p=answer?.probabilities;
  if(answer?.type!=='choice'||!keys.includes(answer.choice))return 'answer_shape';
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join()!==[...keys].sort().join())return 'probability_keys';
  if(keys.some(k=>!Number.isFinite(p[k])||p[k]<0||p[k]>1)||Math.abs(keys.reduce((sum,k)=>sum+p[k],0)-1)>0.02)return 'probability_values';
  if(p[answer.choice]+0.001<Math.max(...Object.values(p)))return 'choice_distribution';
  if(!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)return 'confidence';
  return null;
}

async function request(state,questions,{timeout,key,fetchImpl,maxBytes,retries=0}) {
  if(!key)return {failure:{status:'missing_key'}};
  let body;
  try{body=JSON.stringify({model:'jev-latest',state,questions});}catch{return {failure:{status:'invalid_request'}};}
  const size=Buffer.byteLength(body);
  if(size>maxBytes)return {failure:{status:'request_too_large'}};
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30000||!Number.isSafeInteger(retries)||retries<0||retries>2)return {failure:{status:'invalid_request'}};
  for(let attempt=0;attempt<=retries;attempt++) {
    const start=Date.now();
    let response,data;
    try{response=await fetchImpl('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(timeout)});}
    catch(error){
      const status=['TimeoutError','AbortError'].includes(error?.name)?'timeout':'transport_error';
      await recordMetrics(start,size,null,status);
      if(attempt===retries)return {failure:{status}};
      continue;
    }
    if(!response.ok){await recordMetrics(start,size,null,'http_error');return {failure:{status:'http_error',http_status:Number.isInteger(response.status)?response.status:0}};}
    try{data=await response.json();}catch{await recordMetrics(start,size,null,'invalid_json');return {failure:{status:'invalid_json'}};}
    if(typeof data?.model!=='string'||!/^jev[-\w.]*$/i.test(data.model)){await recordMetrics(start,size,data,'invalid_model');return {failure:{status:'invalid_model'}};}
    await recordMetrics(start,size,data,'decision');
    return {data};
  }
}

function uncertainty(answer,minimum) {
  if(['UNKNOWN','INSUFFICIENT'].includes(answer.choice))return 'explicit_unknown';
  return answer.confidence<minimum?'low_confidence':'decided';
}

async function enrich(state,instructions,criteria,answer,info,options,started) {
  if(info.status!=='decided'&&options.diagnose!==false&&enabled('unknown_diagnostics')) {
    const remaining=options.timeout-(Date.now()-started);
    if(remaining<50)info.diagnosis={reason:'BUDGET_EXHAUSTED',confidence:0,request_attempted:false};
    else try {
      info.diagnosis=await diagnoseUnknown({state,instructions,criteria,answer},{timeout:Math.min(1500,remaining),
        decideMany:(diagnosticState,questions,limits)=>chooseMany(diagnosticState,questions,{...limits,key:options.key,fetchImpl:options.fetchImpl,diagnose:false})});
    }catch{info.diagnosis={reason:'UNKNOWN',confidence:0,request_attempted:false};}
  }
  await report(info,options.onDiagnostic);
  return info.status==='decided'?answer:{...answer,diagnostic:info};
}

// Detailed status is local evidence, never a replacement answer or execution right.
export async function chooseDetailed(state,instructions,criteria,options={}) {
  const opts={timeout:2500,retries:0,minConfidence:0.7,key:process.env.TYPESAFE_API_KEY||process.env.JEV_API_KEY,fetchImpl:fetch,...options};
  const started=Date.now();
  const result=await request(state,{decision:{type:'choice',instructions,criteria}},{...opts,maxBytes:65536});
  if(result.failure){await report(result.failure,opts.onDiagnostic);return {answer:null,diagnostic:result.failure};}
  const raw=result.data.answers?.decision,code=validationCode(raw,criteria);
  if(code){const diagnostic={status:'invalid_response',validation_code:code};await report(diagnostic,opts.onDiagnostic);return {answer:null,diagnostic};}
  const answer={choice:raw.choice,confidence:raw.confidence};
  const diagnostic={status:uncertainty(answer,opts.minConfidence)};
  return {answer:await enrich(state,instructions,criteria,answer,diagnostic,opts,started),diagnostic};
}

export async function choose(state,instructions,criteria,options={}) {
  return (await chooseDetailed(state,instructions,criteria,options)).answer;
}

// One request shares state across heads. At most one uncertain head gets a separate
// diagnostic request; that request explicitly disables recursive diagnosis.
export async function chooseMany(state,questions,options={}) {
  const opts={timeout:3500,minConfidence:0.7,key:process.env.TYPESAFE_API_KEY||process.env.JEV_API_KEY,fetchImpl:fetch,...options};
  const started=Date.now(),ids=Object.keys(questions||{});
  if(!ids.length||ids.length>24){await report({status:'invalid_request'},opts.onDiagnostic);return null;}
  const result=await request(state,questions,{...opts,maxBytes:60000,retries:0});
  if(result.failure){await report(result.failure,opts.onDiagnostic);return null;}
  const answers={};let diagnosed=false;
  for(const id of ids) {
    const raw=result.data.answers?.[id],code=validationCode(raw,questions[id].criteria);
    if(code){answers[id]=null;await report({status:'invalid_response',validation_code:code},opts.onDiagnostic);continue;}
    const answer={choice:raw.choice,confidence:raw.confidence},info={status:uncertainty(answer,opts.minConfidence)};
    answers[id]=await enrich(state,questions[id].instructions,questions[id].criteria,answer,info,{...opts,diagnose:opts.diagnose!==false&&!diagnosed},started);
    if(info.diagnosis)diagnosed=true;
  }
  return answers;
}
