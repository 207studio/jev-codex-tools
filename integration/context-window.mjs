import {open,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {settings,enabled} from './features.mjs';

// Read only recent telemetry locally; transcript contents never go to Jev.
export async function contextWindow(event) {
  const config=settings();
  const configured=config.early_compaction_start_percent;
  const start=Number.isFinite(configured)&&configured>=5&&configured<=95?configured:85;
  const unknown={known:false,start_percent:start,active:false};
  if(!enabled('early_compaction')||typeof event.transcript_path!=='string')return unknown;
  let file;
  try {
    const root=await realpath(path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions'));
    const target=await realpath(event.transcript_path);
    if(!target.startsWith(root+path.sep)||!target.endsWith('.jsonl'))return unknown;
    file=await open(target,'r');
    const stat=await file.stat();
    if(!stat.isFile())return unknown;
    const size=Math.min(stat.size,2*1024*1024),buffer=Buffer.alloc(size);
    const {bytesRead}=await file.read(buffer,0,size,stat.size-size);
    let text=buffer.subarray(0,bytesRead).toString('utf8');
    if(stat.size>size)text=text.slice(text.indexOf('\n')+1);
    const lines=text.trimEnd().split('\n');
    for(let i=lines.length-1;i>=0;i--) {
      let row;try{row=JSON.parse(lines[i]);}catch{continue;}
      if(row.type==='compacted'||row.payload?.type==='context_compacted')return unknown;
      if(row.type!=='event_msg'||row.payload?.type!=='token_count')continue;
      const info=row.payload.info,usage=info?.last_token_usage;
      const limit=info?.model_context_window;
      const tokens=usage?.total_tokens;
      if(!Number.isSafeInteger(limit)||limit<=0||!Number.isSafeInteger(tokens)||tokens<0)return unknown;
      const percent=100*tokens/limit;
      return {known:true,used_tokens:tokens,window_tokens:limit,observed_percent:Math.round(percent*100)/100,start_percent:start,active:percent>=start};
    }
  }catch{}finally{await file?.close().catch(()=>{});}
  return unknown;
}

export function minimumOutputBytes(window) {
  if(!window.active)return 8000;
  const configured=settings().early_compaction_min_bytes;
  return Number.isInteger(configured)&&configured>=1000&&configured<=8000?configured:2000;
}

// Native Bash hooks expose plain stdout, without the executor's exit metadata.
// Never infer an exit code from content controlled by the command.
export function toolOutput(event) {
  const response=event.tool_response;
  if(typeof response==='string')return {raw:response,exit:null,format:'native-text'};
  if(response&&typeof response==='object') {
    const exit=response.exit_code??response.exitCode;
    const raw=typeof response.output==='string'?response.output:typeof response.stdout==='string'?response.stdout+(typeof response.stderr==='string'?response.stderr:''):null;
    return {raw,exit:Number.isInteger(exit)?exit:null,format:'structured'};
  }
  return {raw:null,exit:null,format:'unsupported'};
}
