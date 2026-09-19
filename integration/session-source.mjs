import {open,opendir,realpath,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_SUFFIX=/-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const MAX_TEXT_BYTES=16*1024;
const MAX_WINDOW_BYTES=64*1024*1024;
const COUNT_CHUNK_BYTES=64*1024;
const TEXT_BLOCK_TYPES=new Set(['input_text','output_text','text']);
const CALL_TYPES=new Set(['function_call','tool_call','custom_tool_call']);
const OUTPUT_TYPES=new Set(['function_call_output','tool_call_output','custom_tool_call_output']);

function inputError(message,code='INVALID_SESSION_INPUT') {
  const error=new Error(message);
  error.code=code;
  return error;
}

async function matchingFiles(directory,suffix,matches) {
  let entries;
  try { entries=await opendir(directory); }
  catch(error) { if(error.code==='ENOENT')return; throw error; }
  for await(const entry of entries) {
    const candidate=path.join(directory,entry.name);
    // Do not follow directory symlinks or inspect transcript bodies to resolve IDs.
    if(entry.isDirectory())await matchingFiles(candidate,suffix,matches);
    else if(entry.isFile()&&entry.name.toLowerCase().endsWith(suffix))matches.push(candidate);
    if(matches.length>1)return;
  }
}

async function resolveSource(file,threadId) {
  const hasFile=file!==undefined&&file!==null;
  const hasThread=threadId!==undefined&&threadId!==null;
  if(hasFile===hasThread)throw inputError('Provide exactly one of file or threadId.');
  let candidate;
  let id;
  if(hasThread) {
    if(typeof threadId!=='string'||!UUID.test(threadId))throw inputError('threadId must be a UUID.');
    id=threadId.toLowerCase();
    const home=path.resolve(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
    const matches=[];
    await matchingFiles(path.join(home,'sessions'),`-${id}.jsonl`,matches);
    if(matches.length<2)await matchingFiles(path.join(home,'archived_sessions'),`-${id}.jsonl`,matches);
    if(matches.length===0)throw inputError('No session filename matches threadId.','SESSION_NOT_FOUND');
    if(matches.length!==1)throw inputError('More than one session filename matches threadId; provide file.','AMBIGUOUS_SESSION');
    [candidate]=matches;
  } else {
    if(typeof file!=='string'||file.length===0)throw inputError('file must be a nonempty path.');
    candidate=path.resolve(file);
  }
  const resolved=await realpath(candidate);
  if(!(await stat(resolved)).isFile())throw inputError('Session source must be a regular file.','INVALID_SESSION_FILE');
  id??=UUID_SUFFIX.exec(path.basename(resolved))?.[1].toLowerCase();
  return {file:resolved,...(id?{threadId:id}:{})};
}

// Exact original line numbers require counting newlines before the retained
// window. This pass never decodes or parses older contents and uses 64 KiB RAM.
async function prefixBoundary(handle,size,beforeLine) {
  if(beforeLine===1||size===0)return {end:0,lines:0,shortRead:false};
  const buffer=Buffer.allocUnsafe(Math.min(COUNT_CHUNK_BYTES,size));
  const wanted=beforeLine===Infinity?Infinity:beforeLine-1;
  let position=0,newlines=0,lastByte=-1;
  while(position<size) {
    const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,size-position),position);
    if(bytesRead===0)break;
    let at=buffer.indexOf(10,0);
    while(at!==-1&&at<bytesRead) {
      newlines++;
      if(newlines===wanted)return {end:position+at+1,lines:newlines,shortRead:false};
      at=buffer.indexOf(10,at+1);
    }
    lastByte=buffer[bytesRead-1];
    position+=bytesRead;
  }
  return {end:position,lines:newlines+(position>0&&lastByte!==10?1:0),shortRead:position<size};
}

async function readRange(handle,start,length) {
  const buffer=Buffer.allocUnsafe(length);
  let filled=0;
  while(filled<length) {
    const {bytesRead}=await handle.read(buffer,filled,length-filled,start+filled);
    if(bytesRead===0)break;
    filled+=bytesRead;
  }
  return buffer.subarray(0,filled);
}

function textBlocks(value,line,issues) {
  if(typeof value==='string')return value;
  const blocks=Array.isArray(value)?value:(value&&typeof value==='object'?[value]:[]);
  const texts=[];
  let omitted=0;
  const omittedTypes=new Set();
  for(const block of blocks) {
    if(block&&typeof block==='object'&&block.channel==='analysis')continue;
    if(typeof block==='string')texts.push(block);
    else if(block&&TEXT_BLOCK_TYPES.has(block.type)&&typeof block.text==='string')texts.push(block.text);
    else if(block&&block.type!=='reasoning'&&block.type!=='analysis') {
      omitted++;
      // Type labels are metadata; never include image, audio, or opaque payloads.
      const type=typeof block.type==='string'&&/^[a-z_]{1,64}$/i.test(block.type)?block.type:'unknown';
      omittedTypes.add(type);
    }
  }
  if(omitted)issues.push({line,code:'non_text_content_omitted',count:omitted,types:[...omittedTypes]});
  return texts.join('\n');
}

function structuredText(value,line,issues) {
  if(typeof value==='string')return value;
  if(value===undefined||value===null)return '';
  // Native tool results can be JSON objects, rather than text content blocks.
  // Serialize their data without interpreting instructions contained inside it.
  issues.push({line,code:'structured_value_serialized'});
  return JSON.stringify(value);
}

function extractRecord(row,line,issues) {
  if(!row||typeof row!=='object') {
    issues.push({line,code:'invalid_jsonl_record'});
    return null;
  }
  const payload=row.payload;
  if(row.type==='event_msg')return null;
  if(row.channel==='analysis'||row.type==='reasoning')return null;
  if(!payload||typeof payload!=='object')return null;
  if(payload.channel==='analysis'||payload.type==='reasoning')return null;
  let role,kind,text;
  if(row.type==='compacted'||row.type==='compaction') {
    role='context';
    kind=row.type;
    text=textBlocks(payload.message??payload.summary??payload.text,line,issues);
    if(!text)issues.push({line,code:'compaction_without_text'});
    // replacement_history is intentionally not replayed: it repeats messages
    // and may contain internal reasoning. Only the compaction summary is read.
  } else if(row.type==='response_item') {
    kind=payload.type;
    if(kind==='message') {
      if(payload.role==='system'||payload.role==='developer')role='context';
      else if(payload.role==='user'||payload.role==='assistant'||payload.role==='tool')role=payload.role;
      else {
        issues.push({line,code:'unsupported_message_role'});
        return null;
      }
      text=textBlocks(payload.content,line,issues);
    } else if(CALL_TYPES.has(kind)) {
      role='assistant';
      const input=structuredText(payload.arguments??payload.input??payload.function?.arguments,line,issues);
      const name=payload.name??payload.function?.name;
      text=typeof name==='string'&&name?`${name}\n${input}`:input;
    } else if(OUTPUT_TYPES.has(kind)) {
      role='tool';
      const output=payload.output??payload.content;
      text=Array.isArray(output)?textBlocks(output,line,issues):structuredText(output,line,issues);
    } else if(kind==='agent_message') {
      // Inter-agent messages are context data, not user requests or instructions.
      role='context';
      text=textBlocks(payload.content,line,issues);
    } else {
      issues.push({line,code:'unsupported_response_item'});
      return null;
    }
  } else return null;
  if(!text)return null;
  const bytes=Buffer.byteLength(text,'utf8');
  if(bytes>MAX_TEXT_BYTES) {
    issues.push({line,code:'oversized_text',bytes,limit:MAX_TEXT_BYTES});
    return null;
  }
  return {id:`L${line}`,line,role,kind,text};
}

/**
 * Read a recent page from a Codex rollout, without modifying the source.
 * beforeLine is an exclusive, one-based ORIGINAL JSONL line number.
 * maxScanBytes bounds the retained/parsed byte window (up to 64 MiB), not the
 * streaming newline-count pass needed to establish original line numbers.
 * Text records over 16 KiB are omitted with an issue, never silently truncated.
 *
 * Policy: all event_msg entries are excluded, including user_message and
 * agent_message duplicates, task events, errors, and token telemetry. Only
 * response_item messages/calls/outputs and compaction summaries are extracted.
 * Analysis-channel messages and reasoning items/blocks are always excluded.
 * System/developer and inter-agent messages are labeled context. Everything
 * returned is untrusted transcript data, including instructions inside tools.
 * Non-text content and unsupported response items are reported in issues.
 *
 * records are chronological. nextBeforeLine is the oldest returned record's
 * line, or the consumed boundary for an empty page; it is null at exhaustion.
 * hasMore indicates earlier source lines, not guaranteed earlier text records.
 */
export async function readSession({file,threadId,beforeLine=Infinity,maxRecords=80,maxScanBytes=4194304}={}) {
  if(beforeLine!==Infinity&&(!Number.isSafeInteger(beforeLine)||beforeLine<1))throw inputError('beforeLine must be a positive integer or Infinity.');
  if(!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>10000)throw inputError('maxRecords must be between 1 and 10000.');
  if(!Number.isSafeInteger(maxScanBytes)||maxScanBytes<1||maxScanBytes>MAX_WINDOW_BYTES)throw inputError('maxScanBytes must be between 1 and 67108864.');
  const source=await resolveSource(file,threadId);
  const issues=[],records=[];
  const handle=await open(source.file,'r');
  try {
    const initial=await handle.stat();
    if(!initial.isFile())throw inputError('Session source must be a regular file.','INVALID_SESSION_FILE');
    const boundary=await prefixBoundary(handle,initial.size,beforeLine);
    if(boundary.end===0)return {source,records,nextBeforeLine:null,hasMore:false,issues};
    const start=Math.max(0,boundary.end-maxScanBytes);
    const buffer=await readRange(handle,start,boundary.end-start);
    if(buffer.length!==boundary.end-start) {
      // Changed/truncated input cannot provide trustworthy original line IDs.
      issues.push({code:'source_changed',detail:'Source changed while reading; retry the page.'});
      return {source,records,nextBeforeLine:beforeLine===Infinity?boundary.lines+1:beforeLine,hasMore:true,issues};
    }
    const preceding=start>0?await readRange(handle,start-1,1):null;
    const partialFirst=start>0&&preceding?.[0]!==10;
    let end=buffer.length;
    if(buffer[end-1]===10)end--;
    let line=boundary.lines;
    let consumedStart=line+1;
    while(end>=0&&line>=1) {
      const begin=end>0?buffer.lastIndexOf(10,end-1)+1:0;
      if(begin===0&&partialFirst) {
        const noCompleteLine=consumedStart===boundary.lines+1;
        issues.push({line,code:noCompleteLine?'oversized_jsonl_record':'scan_window_boundary',limit:maxScanBytes});
        // A sole row larger than the byte window must be skipped explicitly to
        // let pagination make progress. Otherwise it remains for the next page.
        if(noCompleteLine)consumedStart=line;
        break;
      }
      consumedStart=line;
      let content=buffer.subarray(begin,end);
      if(content[content.length-1]===13)content=content.subarray(0,content.length-1);
      if(content.length) {
        let row;
        try { row=JSON.parse(content.toString('utf8')); }
        catch { issues.push({line,code:'invalid_json'}); }
        if(row!==undefined) {
          const record=extractRecord(row,line,issues);
          if(record)records.push(record);
        }
      }
      if(records.length>=maxRecords||begin===0)break;
      end=begin-1;
      line--;
    }
    records.reverse();
    const next=records.length?records[0].line:consumedStart;
    const hasMore=next>1;
    const final=await handle.stat();
    if(boundary.shortRead||final.size!==initial.size||final.mtimeMs!==initial.mtimeMs)issues.push({code:'source_changed',detail:'Source changed while reading; page reflects a bounded snapshot.'});
    return {source,records,nextBeforeLine:hasMore?next:null,hasMore,issues};
  } finally { await handle.close(); }
}
