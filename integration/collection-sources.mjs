import {open,realpath} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import {get} from 'node:https';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';

export const MAX_SOURCE_BYTES = 65536;
export const digest = value => createHash('sha256').update(value).digest('hex');
const sensitiveName = /(?:^|[/\\])(?:\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|id_rsa|id_ed25519|[^/\\]*\.(?:pem|key))$/i;

export function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function publicURL(input) {
  const url = new URL(input);
  const decoded=decodeURIComponent(url.href);
  const knownSecret=[process.env.JEV_API_KEY,process.env.TYPESAFE_API_KEY].some(key=>key && key.length>=8 && decoded.includes(key));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (url.port && url.port !== '443') || isIP(url.hostname) ||
      !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname) ||
      knownSecret || /(?:token|secret|password|api[_-]?key)[=/]|(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}/i.test(decoded)) throw Error('public_https_url_required');
  return url;
}

export async function fetchPublic(input, {resolveDNS=lookup,requestHTTPS=get,maxBytes=MAX_SOURCE_BYTES}={}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>1048576) throw Error('invalid_source_limit');
  const url = publicURL(input);
  let timer;
  const addresses = await Promise.race([
    resolveDNS(url.hostname,{all:true,family:4}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('source_fetch_failed')),8000);})
  ]).finally(()=>clearTimeout(timer));
  if (!addresses.length || addresses.some(item => !publicIPv4(item.address))) throw Error('non_public_address');
  const address = addresses[0].address;
  return new Promise((resolve,reject) => {
    // Pin the validated IP; keep normal hostname certificate verification.
    const request = requestHTTPS(url,{signal:AbortSignal.timeout(8000),headers:{Accept:'text/plain, text/markdown, application/json, application/x-ndjson','User-Agent':'jev-codex-tools-collector/0.1'},lookup:(_host,options,callback) => {
      callback(null, options?.all ? [{address,family:4}] : address, 4);
    }},response => {
      const type = String(response.headers['content-type'] || '').split(';')[0].trim();
      if (response.statusCode !== 200 || !['text/plain','text/markdown','text/csv','application/csv','application/json','application/x-ndjson','application/jsonl'].includes(type) ||
          (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') ||
          Number(response.headers['content-length'] || 0) > maxBytes) {
        response.destroy(); reject(Error('unsupported_http_response')); return;
      }
      const chunks=[]; let size=0;
      response.on('data',chunk => {
        size+=chunk.length;
        if (size>maxBytes) {response.destroy();reject(Error('source_too_large'));}
        else chunks.push(chunk);
      });
      response.on('error',()=>reject(Error('source_read_failed')));
      response.on('end',()=>resolve(Buffer.concat(chunks)));
    });
    request.on('error',()=>reject(Error('source_fetch_failed')));
  });
}

export async function readSource(source, {fetcher=fetchPublic,maxBytes=MAX_SOURCE_BYTES}={}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>1048576) throw Error('invalid_source_limit');
  if (!source || !['text','jsonl','json','csv'].includes(source.format) ||
      Object.keys(source).some(key=>!['file','url','format','records_path','text_fields'].includes(key)) ||
      (typeof source.file === 'string') === (typeof source.url === 'string')) throw Error('invalid_source');
  let bytes;
  if (source.file) {
    if (sensitiveName.test(source.file) || sensitiveName.test(await realpath(source.file))) throw Error('sensitive_source_name');
    const handle=await open(source.file,'r');
    try {
      const info=await handle.stat();
      if (!info.isFile() || info.size>maxBytes) throw Error('source_too_large_or_not_regular');
      const buffer=Buffer.alloc(maxBytes+1);
      let size=0;
      while (size<buffer.length) {
        const {bytesRead}=await handle.read(buffer,size,buffer.length-size,size);
        if (!bytesRead) break;
        size+=bytesRead;
      }
      if (size>maxBytes) throw Error('source_too_large');
      bytes=buffer.subarray(0,size);
    } finally {await handle.close();}
  } else {
    publicURL(source.url);
    bytes=await fetcher(source.url,{maxBytes});
  }
  if (!Buffer.isBuffer(bytes) || bytes.length>maxBytes) throw Error('source_too_large');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if (text.includes('\0')) throw Error('binary_source');
  return {text,bytes,sha256:digest(bytes)};
}

export function parseRecords(text, format, source) {
  const records=[];
  const add=(value,offset,record_index) => {
    if (typeof value !== 'string') throw Error('record_text_required');
    if (!value.trim()) return;
    // Never silently split or truncate a field: narrow it explicitly upstream.
    if (Buffer.byteLength(value)>1500 || records.length>=96) throw Error('narrow_source_first');
    records.push({id:`${source}r${records.length+1}`,source,text:value,offset,...(record_index === undefined ? {} : {record_index})});
  };
  if (format==='text') {
    let offset=0;
    for (const line of text.split('\n')) {add(line,offset);offset+=line.length+1;}
  } else if (format==='jsonl') {
    let offset=0,index=0;
    for (const line of text.split('\n')) {
      if (line.trim()) {
        const row=JSON.parse(line),before=records.length;
        add(typeof row==='string'?row:row?.text,0,index++);
        if (records.length>before) records.at(-1).source_line_offset=offset;
      }
      offset+=line.length+1;
    }
  } else if (format==='json') {
    const rows=JSON.parse(text);
    if (!Array.isArray(rows)) throw Error('json_array_required');
    rows.forEach((row,index)=>add(typeof row==='string'?row:row?.text,0,index));
  } else throw Error('invalid_format');
  return records;
}
