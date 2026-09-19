import {open,mkdir,writeFile,lstat} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {enabled} from './features.mjs';
import {selectRecords} from './data-collection.mjs';
import {readSource,parseRecords,digest} from './collection-sources.mjs';

async function readSpec(file) {
  const handle=await open(file,'r');
  try {
    const info=await handle.stat();
    if (!info.isFile() || info.size>16384) throw Error('invalid_spec');
    const buffer=Buffer.alloc(16385), {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if (bytesRead>16384) throw Error('invalid_spec');
    return JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
  } finally {await handle.close();}
}

export async function collect(spec) {
  if (!spec || Object.keys(spec).some(k=>!['question','mode','kind','sources','output_dir'].includes(k)) ||
      typeof spec.question!=='string' || !spec.question.trim() || Buffer.byteLength(spec.question)>512 ||
      !['filter','extract'].includes(spec.mode) || (spec.kind!==undefined && !['email','url','amount','date'].includes(spec.kind)) || !Array.isArray(spec.sources) || !spec.sources.length || spec.sources.length>4 ||
      typeof spec.output_dir!=='string' || !path.isAbsolute(spec.output_dir) || Buffer.byteLength(spec.output_dir)>1000) throw Error('invalid_spec');
  // Disabled means no source/network access and no newly created artifacts.
  if (!enabled('data_collection')) return {status:'DISABLED',jev_requests:0};
  try {await lstat(spec.output_dir);throw Error('output_already_exists');}
  catch (error) {if (error.code!=='ENOENT') throw error;}
  const sources=[],records=[]; let total=0;
  for (const [index,source] of spec.sources.entries()) {
    const loaded=await readSource(source);total+=loaded.bytes.length;
    if (total>131072) throw Error('total_sources_too_large');
    const id=`s${index+1}`;
    records.push(...parseRecords(loaded.text,source.format,id));
    if (records.length>96) throw Error('narrow_source_first');
    sources.push({id,input:source.file || source.url,format:source.format,sha256:loaded.sha256,bytes:loaded.bytes});
  }
  const result=await selectRecords(records,{question:spec.question,mode:spec.mode,kind:spec.kind,active:true});
  // A fresh directory is required: no user output is overwritten.
  await mkdir(spec.output_dir,{mode:0o700});
  for (const source of sources) await writeFile(path.join(spec.output_dir,`${source.id}.source`),source.bytes,{flag:'wx',mode:0o600});
  const artifact=path.join(spec.output_dir,'records.json');
  await writeFile(artifact,JSON.stringify(result.records,null,2)+'\n',{flag:'wx',mode:0o600});
  const manifest={schema:1,status:result.stats.unknown?'PARTIAL':'COMPLETE',mode:spec.mode,question_hash:digest(spec.question),
    sources:sources.map(({bytes,...source})=>({...source,bytes:bytes.length})),stats:result.stats,records_file:'records.json',
    offsets:'UTF-16 characters; text offsets index the source. JSON/JSONL extraction offsets index decoded text at zero-based record_index, with source_line_offset separately locating JSONL lines.',
    limitations:['Completeness is relative to the supplied sources only.','UNKNOWN is retained, never treated as irrelevant.','Byte counts are not measured token savings.']};
  await writeFile(path.join(spec.output_dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {status:manifest.status,stats:result.stats,manifest:path.join(spec.output_dir,'manifest.json'),records:artifact};
}

try {
  const {values}=parseArgs({options:{spec:{type:'string'},help:{type:'boolean'}}});
  if (values.help) console.log('jev-collect --spec FILE\nExplicit text / JSONL / JSON sources; <=4 sources, <=96 short records. Fresh absolute output_dir required. Enable data_collection first. Full results stay on disk; stdout is a bounded manifest.');
  else {
    if (!values.spec) throw Error('spec_required');
    const result=await collect(await readSpec(values.spec));
    const output=JSON.stringify(result);
    if (Buffer.byteLength(output)>4000) throw Error('output_budget_exceeded');
    console.log(output);
  }
} catch (error) {
  // Do not reflect paths, HTTP bodies, queries, credentials or arbitrary errors.
  const known=new Set(['spec_required','invalid_spec','output_already_exists','total_sources_too_large','narrow_source_first','output_budget_exceeded','invalid_source','sensitive_source_name','source_too_large_or_not_regular','source_too_large','source_fetch_failed','source_read_failed','unsupported_http_response','non_public_address','public_https_url_required','binary_source','record_text_required','json_array_required','invalid_format']);
  console.log(JSON.stringify({status:'ERROR',reason:known.has(error.message)?error.message:'source_or_selection_failed',complete:false}));
  process.exitCode=2;
}
