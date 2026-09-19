import {mkdir,writeFile,lstat} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {enabled,settings} from './features.mjs';
import {selectRecords,sourceHasSecrets} from './data-collection.mjs';
import {readSource,parseRecords,digest} from './collection-sources.mjs';
import {recordsFrom} from './collection-records.mjs';
import {boundedJSON,readCollection} from './collection-artifacts.mjs';

export async function collect(spec) {
  if (!spec || Object.keys(spec).some(k=>!['question','mode','kind','sources','output_dir','profile'].includes(k)) ||
      typeof spec.question!=='string' || !spec.question.trim() || Buffer.byteLength(spec.question)>512 ||
      !['filter','extract'].includes(spec.mode) || (spec.kind!==undefined && !['email','url','amount','date'].includes(spec.kind)) ||
      (spec.profile!==undefined && !['bounded','maximum'].includes(spec.profile)) ||
      !Array.isArray(spec.sources) || !spec.sources.length || spec.sources.length>4 ||
      typeof spec.output_dir!=='string' || !path.isAbsolute(spec.output_dir) || Buffer.byteLength(spec.output_dir)>1000) throw Error('invalid_spec');
  if (!enabled('data_collection')) return {status:'DISABLED',jev_requests:0};
  if (sourceHasSecrets(spec.question)) throw Error('sensitive_question');
  const maximum=(spec.profile || settings().collection_profile)==='maximum';
  const limit=maximum?768:96,maxBytes=maximum?1048576:65536;
  try {await lstat(spec.output_dir);throw Error('output_already_exists');}
  catch (error) {if (error.code!=='ENOENT') throw error;}
  const sources=[],input=[];let total=0;
  for (const [index,source] of spec.sources.entries()) {
    const loaded=await readSource(source,{maxBytes});total+=loaded.bytes.length;
    if (total>(maximum?4194304:131072)) throw Error('total_sources_too_large');
    const id=`s${index+1}`;
    const rows=maximum || source.format==='csv' || source.records_path || source.text_fields
      ? recordsFrom(loaded.text,source,id,{maxRecords:limit,chunkText:maximum})
      : parseRecords(loaded.text,source.format,id);
    if (sourceHasSecrets(loaded.text)) for (const row of rows) row.secret_source=true;
    input.push(...rows);
    if (input.length>limit) throw Error('narrow_source_first');
    sources.push({id,input:source.file || source.url,format:source.format,sha256:loaded.sha256,bytes:loaded.bytes});
  }
  // Global exact deduplication retains every source location before paging.
  const unique=new Map();
  for (const record of input) {
    const prior=unique.get(record.text);
    if (prior) {
      const {text,...alias}=record;prior.aliases.push(alias);
      prior.protected ||= record.protected===true;prior.secret_source ||= record.secret_source===true;
    } else unique.set(record.text,{...record,aliases:[]});
  }
  await mkdir(spec.output_dir,{mode:0o700});
  for (const source of sources) await writeFile(path.join(spec.output_dir,`${source.id}.source`),source.bytes,{flag:'wx',mode:0o600});
  const result={records:[],stats:{input_bytes:0,selected_bytes:0,kept:0,dropped:0,unknown:0,exact_duplicates:0,jev_requests:0,cache_hits:0,input_records:0,unique_records:0,withheld:0,candidate_limit:0,cached_records:0,outbound_bytes:0,max_state_bytes:0,pages:0}};
  const records=[...unique.values()];
  for (let start=0;start<records.length;start+=96) {
    const page=await selectRecords(records.slice(start,start+96),{question:spec.question,mode:spec.mode,kind:spec.kind,active:true});
    result.records.push(...page.records);result.stats.pages++;
    for (const [key,value] of Object.entries(page.stats)) result.stats[key]=key==='max_state_bytes'?Math.max(result.stats[key]||0,value):(result.stats[key]||0)+value;
  }
  result.stats.input_records=input.length;
  result.stats.input_bytes=input.reduce((sum,record)=>sum+Buffer.byteLength(record.text),0);
  result.stats.exact_duplicates=input.length-records.length;
  const artifact=path.join(spec.output_dir,'records.json'),serialized=JSON.stringify(result.records,null,2)+'\n';
  if (Buffer.byteLength(serialized)>8388608) throw Error('artifact_too_large');
  await writeFile(artifact,serialized,{flag:'wx',mode:0o600});
  const manifest={schema:2,status:result.stats.unknown?'PARTIAL':'COMPLETE',mode:spec.mode,profile:maximum?'maximum':'bounded',question_hash:digest(spec.question),
    sources:sources.map(({bytes,...source})=>({...source,bytes:bytes.length})),stats:result.stats,records_file:'records.json',records_sha256:digest(serialized),
    offsets:'UTF-16 offsets. Read representation/offset_basis and field/chunk provenance for structured or chunked records. source_line_offset locates a raw JSONL line.',
    limitations:['Completeness is relative to the supplied sources only.','UNKNOWN is retained, never treated as irrelevant.','Byte counts are not measured token savings.']};
  const manifestPath=path.join(spec.output_dir,'manifest.json');
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {status:manifest.status,profile:manifest.profile,stats:result.stats,manifest:manifestPath,records:artifact};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const {values}=parseArgs({options:{spec:{type:'string'},read:{type:'string'},cursor:{type:'string'},help:{type:'boolean'}}});
    if (values.help) console.log('jev-collect --spec FILE | --read MANIFEST [--cursor N]\nExplicit text/JSONL/JSON/CSV sources; bounded or maximum profile; fresh absolute output_dir. --read pages selected/UNKNOWN records without API calls. Stdout <=4000 bytes.');
    else {
      if (Boolean(values.spec)===Boolean(values.read) || (values.cursor!==undefined && (!values.read || !/^\d{1,6}$/.test(values.cursor)))) throw Error('invalid_command');
      const result=values.read?await readCollection(values.read,Number(values.cursor||0)):await collect((await boundedJSON(values.spec,16384)).data);
      const output=JSON.stringify(result);
      if (Buffer.byteLength(output)>4000) throw Error('output_budget_exceeded');
      console.log(output);
    }
  } catch (error) {
    const known=new Set(['invalid_command','invalid_spec','sensitive_question','output_already_exists','total_sources_too_large','narrow_source_first','output_budget_exceeded','invalid_source','sensitive_source_name','source_too_large_or_not_regular','source_too_large','source_fetch_failed','source_read_failed','unsupported_http_response','non_public_address','public_https_url_required','binary_source','record_text_required','json_array_required','invalid_format','artifact_too_large','invalid_cursor_or_manifest','invalid_manifest','artifact_integrity_failed','narrow_artifact_first']);
    console.log(JSON.stringify({status:'ERROR',reason:known.has(error.message)?error.message:'source_or_selection_failed',complete:false}));
    process.exitCode=2;
  }
}
