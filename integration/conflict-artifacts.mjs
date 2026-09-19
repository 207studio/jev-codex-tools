import {mkdir,mkdtemp,lstat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {stateHome} from './paths.mjs';
import {digest} from './collection-sources.mjs';
import {boundedJSON} from './collection-artifacts.mjs';
import {sourceHasSecrets} from './data-collection.mjs';
import {sourceFingerprint} from './conflict-evidence.mjs';

const maximum=262144,bytes=value=>Buffer.byteLength(JSON.stringify(value));
const validStatus=value=>['CONTRADICTION','COMPATIBLE','UNKNOWN'].includes(value);
function validate(index) {
  if(index?.schema!==1||typeof index.root!=='string'||!path.isAbsolute(index.root)||typeof index.question!=='string'||!Array.isArray(index.spans)||index.spans.length>48||!Array.isArray(index.pairs)||index.pairs.length>24||!Array.isArray(index.findings)||index.findings.length!==index.pairs.length||!Array.isArray(index.issues)||index.issues.length>1024)throw Error('invalid_conflict_index');
  const ids=new Set();
  for(const s of index.spans){
    if(typeof s.id!=='string'||ids.has(s.id)||typeof s.file!=='string'||typeof s.text!=='string'||Buffer.byteLength(s.text)>1800||!Number.isSafeInteger(s.start_line)||!Number.isSafeInteger(s.end_line)||s.start_line<1||s.end_line<s.start_line||!/^[a-f0-9]{64}$/.test(s.file_sha256)||digest(s.text)!==s.sha256)throw Error('invalid_conflict_index');
    ids.add(s.id);
  }
  const pairIds=new Set();
  for(const p of index.pairs){if(typeof p.id!=='string'||pairIds.has(p.id)||!ids.has(p.left)||!ids.has(p.right))throw Error('invalid_conflict_index');pairIds.add(p.id);}
  const findingIds=new Set();
  for(const f of index.findings){if(!pairIds.has(f.id)||findingIds.has(f.id)||!validStatus(f.status))throw Error('invalid_conflict_index');findingIds.add(f.id);}
  if(sourceHasSecrets(JSON.stringify(index)))throw Error('private_evidence_withheld');
}
export async function saveIndex(index,{directory=path.join(stateHome,'conflict-index')}={}) {
  validate(index);
  const text=JSON.stringify(index)+'\n';
  if(Buffer.byteLength(text)>maximum)throw Error('conflict_index_too_large');
  await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077))throw Error('private_index_directory_required');
  const folder=await mkdtemp(path.join(directory,'index-'));
  await writeFile(path.join(folder,'index.json'),text,{mode:0o600,flag:'wx'});
  const manifest=path.join(folder,'manifest.json');
  await writeFile(manifest,JSON.stringify({schema:1,index_file:'index.json',index_sha256:digest(text),pairs:index.pairs.length,scope:'bounded_review_candidates'})+'\n',{mode:0o600,flag:'wx'});
  return manifest;
}
export async function readIndex(manifestFile,cursor=0) {
  if(typeof manifestFile!=='string'||Buffer.byteLength(manifestFile)>1000||!Number.isSafeInteger(cursor)||cursor<0)throw Error('invalid_cursor_or_manifest');
  const manifest=path.resolve(manifestFile),file=path.join(path.dirname(manifest),'index.json');
  for(const entry of [manifest,file]){const info=await lstat(entry);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error('private_index_required');}
  const {data:header}=await boundedJSON(manifest,4096),{data:index,text}=await boundedJSON(file,maximum);
  if(header.schema!==1||header.index_file!=='index.json'||digest(text)!==header.index_sha256)throw Error('artifact_integrity_failed');
  validate(index);
  if(cursor>index.pairs.length)throw Error('invalid_cursor');
  const spans=new Map(index.spans.map(s=>[s.id,s])),findings=new Map(index.findings.map(f=>[f.id,f]));
  const packet={status:index.status,scope:'bounded_review_candidates',proof:false,root:index.root,manifest,cursor,next_cursor:null,issue_count:index.issues.length,issue_codes:[...new Set(index.issues.map(i=>i.code))].slice(0,20),items:[]};
  const current=new Map();
  let at=cursor;
  for(;at<index.pairs.length;at++) {
    const pair=index.pairs[at],finding=findings.get(pair.id),a=spans.get(pair.left),b=spans.get(pair.right);
    for(const span of [a,b])if(!current.has(span.file)){try{current.set(span.file,await sourceFingerprint(index.root,span.file));}catch{current.set(span.file,null);}}
    const stale=[a,b].some(s=>current.get(s.file)!==s.file_sha256);
    const evidence=s=>({file:s.file,start_line:s.start_line,end_line:s.end_line,sha256:s.sha256,text:s.text});
    const item={...finding,group:pair.group,symbol:pair.symbol,context:pair.context??'',left:evidence(a),right:evidence(b),stale};
    if(stale){item.previous_status=item.status;item.status='UNKNOWN';item.reason='source_changed_or_unavailable';packet.status='STALE';}
    let next={...packet,next_cursor:at+1<index.pairs.length?at+1:null,items:[...packet.items,item]};
    if(bytes(next)>4000&&packet.items.length===0){delete item.left.text;delete item.right.text;item.excerpts_omitted_for_output_budget=true;next={...packet,next_cursor:at+1<index.pairs.length?at+1:null,items:[item]};}
    if(bytes(next)>4000)break;
    packet.items.push(item);
  }
  if(at===cursor&&at<index.pairs.length)throw Error('narrow_index_page_required');
  packet.next_cursor=at<index.pairs.length?at:null;
  if(bytes(packet)>4000)throw Error('output_budget_exceeded');
  return packet;
}
