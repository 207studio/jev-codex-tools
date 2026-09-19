import {parseArgs} from 'node:util';
import path from 'node:path';
import {enabled} from './features.mjs';
import {boundedJSON} from './collection-artifacts.mjs';

const help='jev-conflicts --spec FILE | --read MANIFEST [--cursor N]\n'+
  'Build or page a bounded local index of possible code contradictions. The code_contradictions feature defaults off.\n'+
  'Enabled builds send selected code excerpts, question and group context to TypeSafe Jev. No source files are edited.\n'+
  'Spec JSON is limited to 16 KiB; files and symbols must be explicit. UNKNOWN and incomplete scope remain visible.\n'+
  'Read mode needs no feature flag or API call and reports stale source evidence.';
function printPacket(packet) {
  const text=JSON.stringify(packet);
  if(Buffer.byteLength(text)>4000)throw Error('narrow_index_output');
  console.log(text);
}
function count(value) {
  if(!Number.isSafeInteger(value)||value<0)throw Error('invalid_index');
  return value;
}

try {
  const {values}=parseArgs({options:{spec:{type:'string'},read:{type:'string'},cursor:{type:'string'},help:{type:'boolean'}},allowPositionals:false});
  if(values.help)console.log(help);
  else {
    if(Boolean(values.spec)===Boolean(values.read)||values.cursor!==undefined&&!values.read)throw Error('invalid_arguments');
    if(values.read) {
      if(Buffer.byteLength(values.read)>1024||values.cursor!==undefined&&!/^\d+$/.test(values.cursor))throw Error('invalid_cursor_or_manifest');
      const cursor=Number(values.cursor??'0');
      if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('invalid_cursor_or_manifest');
      const {readIndex}=await import('./conflict-artifacts.mjs');
      printPacket(await readIndex(values.read,cursor));
    }else if(!enabled('code_contradictions')) {
      printPacket({status:'DISABLED',feature:'code_contradictions',jev_requests:0});
    }else {
      const {data:spec}=await boundedJSON(values.spec,16384);
      const {indexContradictions}=await import('./code-conflicts.mjs');
      const index=await indexContradictions(spec,{active:true,cwd:process.cwd()});
      if(!index||!Array.isArray(index.findings)||!Array.isArray(index.issues))throw Error('invalid_index');
      const finding_counts={CONTRADICTION:0,COMPATIBLE:0,UNKNOWN:0};
      for(const finding of index.findings) {
        if(!Object.hasOwn(finding_counts,finding.status))throw Error('invalid_index');
        finding_counts[finding.status]++;
      }
      const pairs=count(index.stats?.pairs),jev_requests=count(index.stats?.jev_requests),cache_hits=count(index.stats?.cache_hits);
      const {saveIndex}=await import('./conflict-artifacts.mjs');
      const manifest=await saveIndex(index);
      if(typeof manifest!=='string'||!path.isAbsolute(manifest))throw Error('invalid_manifest');
      printPacket({status:finding_counts.UNKNOWN||index.issues.length||!pairs?'PARTIAL':'INDEXED',manifest,pairs,finding_counts,
        jev_requests,cache_hits,issues_count:index.issues.length,scope:'bounded_literal_source_pairs',complete:false});
    }
  }
}catch(error) {
  const known=new Set(['invalid_arguments','invalid_cursor_or_manifest','artifact_too_large','invalid_manifest','artifact_integrity_failed','narrow_index_output','invalid_index']);
  console.log(JSON.stringify({status:'UNKNOWN',reason:known.has(error.message)?error.message:'invalid_or_unavailable_index',complete:false}));
  process.exitCode=2;
}
