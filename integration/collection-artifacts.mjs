import {open} from 'node:fs/promises';
import path from 'node:path';
import {digest} from './collection-sources.mjs';

export async function boundedJSON(file,limit) {
  const handle=await open(file,'r');
  try {
    const info=await handle.stat();
    if (!info.isFile() || info.size>limit) throw Error('artifact_too_large');
    const buffer=Buffer.alloc(limit+1);let size=0;
    while (size<buffer.length) {
      const result=await handle.read(buffer,size,buffer.length-size,size);
      if (!result.bytesRead) break;
      size+=result.bytesRead;
    }
    if (size>limit) throw Error('artifact_too_large');
    const text=new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,size));
    return {data:JSON.parse(text),text};
  } finally {await handle.close();}
}

export async function readCollection(manifestFile,cursor=0) {
  if (typeof manifestFile!=='string' || Buffer.byteLength(manifestFile)>1000 || !Number.isSafeInteger(cursor) || cursor<0) throw Error('invalid_cursor_or_manifest');
  const manifestPath=path.resolve(manifestFile);
  const {data:manifest}=await boundedJSON(manifestPath,32768);
  if (manifest.schema!==2 || manifest.records_file!=='records.json' || !/^[a-f0-9]{64}$/.test(manifest.records_sha256)) throw Error('invalid_manifest');
  const {data:records,text}=await boundedJSON(path.join(path.dirname(manifestPath),'records.json'),8388608);
  if (digest(text)!==manifest.records_sha256 || !Array.isArray(records) || records.length>768 || cursor>records.length) throw Error('artifact_integrity_failed');
  const packet={status:manifest.status,manifest:manifestPath,cursor,next_cursor:null,items:[]};
  let index=cursor;
  for (;index<records.length;index++) {
    const record=records[index];
    if (!['KEEP','UNKNOWN','EXTRACT'].includes(record.decision)) continue;
    const item={id:record.id,source:record.source,decision:record.decision,offset:record.offset};
    for (const field of ['record_index','representation','chunk','chunk_start','chunk_end','source_line_offset']) if (record[field]!==undefined) item[field]=record[field];
    if (record.reason) item.reason=record.reason;
    if (record.reason?.includes('secret')) item.withheld=true;
    else if (record.text!==undefined) item.text=record.text;
    if (record.extraction) item.extraction={kind:record.extraction.kind,value:record.extraction.value,span:record.extraction.span};
    const candidate={...packet,next_cursor:index+1<records.length?index+1:null,items:[...packet.items,item]};
    if (Buffer.byteLength(JSON.stringify(candidate))>4000) {
      if (!packet.items.length) throw Error('narrow_artifact_first');
      break;
    }
    packet.items.push(item);
  }
  packet.next_cursor=index<records.length?index:null;
  if (Buffer.byteLength(JSON.stringify(packet))>4000) throw Error('output_budget_exceeded');
  return packet;
}
