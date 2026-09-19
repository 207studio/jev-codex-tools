import {constants} from 'node:fs';
import {lstat,realpath,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {sourceHasSecrets} from './data-collection.mjs';

const LIMIT=65536,SNIPPET_LIMIT=1800;
const EXTENSIONS=new Set(['.mjs','.js','.ts','.tsx','.jsx','.py','.swift','.rs','.go','.c','.cpp','.h','.cs','.java','.kt','.vue','.svelte','.css','.html','.md','.toml','.yml','.yaml']);
const BLOCKED_DIR=/^(?:node_modules|vendor|vendors|third[-_]party|thirdparty|dist|build|out|target|coverage|generated|gen|__generated__|__pycache__|venv|env|site-packages|pods|carthage|deriveddata|bower_components|cache|caches|logs|artifacts)$/i;
const SECRET_NAME=/(?:^|[._-])(?:secrets?|credentials?|passwords?|private[-_]?keys?)(?:[._-]|$)/i;
const LOCK_NAME=/(?:^|[._-])lock(?:[._-]|$)|^(?:go\.sum|yarn\.lock|Cargo\.lock)$/i;
const GENERATED_NAME=/(?:\.min\.|\.generated\.|\.g\.|(?:^|[._-])generated(?:[._-]|$))/i;
const bytes=value=>Buffer.byteLength(value,'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const error=code=>{throw Error(code);};
const compare=(left,right)=>left<right?-1:left>right?1:0;
function object(value,allowed){
  if(!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)))error('invalid_spec');
  for(const key of Object.keys(value)){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!allowed.includes(key) || !descriptor || !Object.hasOwn(descriptor,'value'))error('invalid_spec');
  }
}
const bounded=(value,max,nonempty=true)=>typeof value==='string' && (!nonempty || value.length>0) && bytes(value)<=max;
function validate(spec){
  object(spec,['root','question','groups','context_lines','max_pairs']);
  if(!bounded(spec.question,512) || sourceHasSecrets(spec.question) ||
    (spec.root!==undefined && (typeof spec.root!=='string' || !spec.root || spec.root.includes('\0') || sourceHasSecrets(spec.root))) ||
    !Array.isArray(spec.groups) || !spec.groups.length || spec.groups.length>8)error('invalid_spec');
  const contextLines=spec.context_lines===undefined?4:spec.context_lines,maxPairs=spec.max_pairs===undefined?12:spec.max_pairs;
  if(!Number.isInteger(contextLines) || contextLines<0 || contextLines>8 || !Number.isInteger(maxPairs) || maxPairs<1 || maxPairs>24)error('invalid_spec');
  const ids=new Set(),files=new Set();
  for(const group of spec.groups){
    object(group,['id','symbol','files','context']);
    if(!bounded(group.id,48) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(group.id) || ids.has(group.id) ||
      !bounded(group.symbol,100) || !Array.isArray(group.files) || !group.files.length || group.files.length>8 ||
      (group.context!==undefined && (!bounded(group.context,512,false) || sourceHasSecrets(group.context))))error('invalid_spec');
    ids.add(group.id);
    for(const file of group.files){if(!bounded(file,240))error('invalid_spec');files.add(path.posix.normalize(file));}
  }
  if(files.size>16)error('invalid_spec');
  return {contextLines,maxPairs,filesConsidered:files.size};
}

async function rootDirectory(root,cwd){
  try{
    if(typeof root!=='string' || !root || root.includes('\0') || sourceHasSecrets(root) || typeof cwd!=='string')error('invalid_spec');
    const requested=path.resolve(cwd,root),stat=await lstat(requested);
    if(!stat.isDirectory() || stat.isSymbolicLink())error('invalid_spec');
    const resolved=await realpath(requested);
    if(sourceHasSecrets(resolved))error('invalid_spec');
    return resolved;
  }catch{error('invalid_spec');}
}
function relativeFile(file){
  if(typeof file!=='string' || !file || bytes(file)>240)error('invalid_path');
  if(sourceHasSecrets(file))error('source_withheld');
  if(file.includes('\0') || file.includes('\\') || /^[A-Za-z]:/.test(file) || path.posix.isAbsolute(file) || file.split('/').includes('..'))error('outside_root');
  const normalized=path.posix.normalize(file),parts=normalized.split('/');
  if(parts.some(part=>!part || part==='.' || part.startsWith('.') || SECRET_NAME.test(part)))error('blocked_path');
  const name=parts.at(-1);
  if(parts.slice(0,-1).some(part=>BLOCKED_DIR.test(part)) || LOCK_NAME.test(name) || GENERATED_NAME.test(name) || !EXTENSIONS.has(path.posix.extname(name).toLowerCase()))error('blocked_path');
  return normalized;
}
async function readSource(root,file){
  const relative=relativeFile(file),target=path.join(root,...relative.split('/'));
  let handle;
  try{
    let current=root;
    for(const part of relative.split('/')){
      current=path.join(current,part);
      if((await lstat(current)).isSymbolicLink())error('symlink');
    }
    const before=await lstat(target),resolved=await realpath(target);
    if(!resolved.startsWith(root+path.sep))error('outside_root');
    if(!before.isFile())error('invalid_source');
    if(before.size>LIMIT)error('file_too_large');
    handle=await open(target,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened=await handle.stat();
    if(!opened.isFile() || opened.size>LIMIT)error(opened.size>LIMIT?'file_too_large':'invalid_source');
    if(opened.ino!==before.ino || opened.dev!==before.dev || await realpath(target)!==resolved)error('source_changed');
    const buffer=Buffer.alloc(LIMIT+1);let length=0;
    while(length<buffer.length){
      const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);
      if(!bytesRead)break;length+=bytesRead;
    }
    if(length>LIMIT)error('file_too_large');
    const after=await handle.stat();
    if(after.size!==opened.size || after.mtimeMs!==opened.mtimeMs || after.ctimeMs!==opened.ctimeMs || length!==after.size)error('source_changed');
    const source=buffer.subarray(0,length),text=source.toString('utf8');
    if(text.includes('\0') || !Buffer.from(text,'utf8').equals(source))error('invalid_text');
    if(sourceHasSecrets(text))error('source_withheld');
    if(/(?:@generated\b|\bauto[- ]generated\b|\bgenerated (?:file|code)\b|\bDO NOT EDIT\b)/i.test(text))error('generated_source');
    return {file:relative,text,sha256:hash(source)};
  }catch(cause){
    const known=new Set(['symlink','outside_root','invalid_source','file_too_large','source_changed','invalid_text','source_withheld','generated_source']);
    error(known.has(cause.message)?cause.message:'source_unavailable');
  }finally{await handle?.close().catch(()=>{});}
}

export async function sourceFingerprint(root,relative){
  const directory=await rootDirectory(root,process.cwd());
  return (await readSource(directory,relative)).sha256;
}

function lineStarts(text){
  const starts=text.length?[0]:[];
  for(let offset=text.indexOf('\n');offset!==-1;offset=text.indexOf('\n',offset+1))if(offset+1<text.length)starts.push(offset+1);
  return starts;
}
function lineAt(starts,offset){
  let low=0,high=starts.length;
  while(low<high){const mid=(low+high)>>>1;if(starts[mid]<=offset)low=mid+1;else high=mid;}
  return low;
}
function spansFor(source,symbol,contextLines){
  const starts=lineStarts(source.text),ranges=[],seen=new Set();
  for(let at=source.text.indexOf(symbol);at!==-1;at=source.text.indexOf(symbol,at+1)){
    const start=Math.max(1,lineAt(starts,at)-contextLines),end=Math.min(starts.length,lineAt(starts,at+symbol.length-1)+contextLines);
    const key=`${start}:${end}`;if(seen.has(key))continue;seen.add(key);
    ranges.push({start_line:start,end_line:end,start:starts[start-1],end:end<starts.length?starts[end]:source.text.length});
  }
  return ranges;
}

export async function collectEvidence(spec,{cwd=process.cwd()}={}){
  const {contextLines,maxPairs,filesConsidered}=validate(spec);
  const root=await rootDirectory(spec.root ?? '.',cwd),spans=[],pairs=[],issues=[],seenIssues=new Set(),sources=new Map();
  let omitted=0;
  const issue=(code,group,file)=>{
    const value=code==='source_withheld'?{code}:{code,...(group?{group}:{}),...(file?{file}:{})};
    const key=JSON.stringify(value);if(!seenIssues.has(key)){seenIssues.add(key);issues.push(value);}
  };
  for(const group of [...spec.groups].sort((a,b)=>compare(a.id,b.id))){
    if(sourceHasSecrets(group.id) || sourceHasSecrets(group.symbol)){issue('source_withheld');continue;}
    const groupSpans=[],files=new Set();
    for(const requested of group.files){
      try{files.add(relativeFile(requested));}catch(cause){issue(cause.message,group.id);}
    }
    let validSpans=0;
    for(const file of [...files].sort(compare)){
      if(!sources.has(file)){
        try{sources.set(file,{source:await readSource(root,file)});}
        catch(cause){sources.set(file,{code:cause.message});}
      }
      const {source,code}=sources.get(file);
      if(!source){issue(code,group.id,file);continue;}
      const ranges=spansFor(source,group.symbol,contextLines);
      if(!ranges.length)issue('symbol_not_found',group.id,file);
      for(const range of ranges){
        const text=source.text.slice(range.start,range.end);
        if(bytes(text)>SNIPPET_LIMIT){issue('snippet_too_large',group.id,file);continue;}
        validSpans++;
        if(groupSpans.length>=6)continue;
        const sha256=hash(text),identity=[group.id,file,range.start_line,range.end_line,sha256,source.sha256];
        groupSpans.push({id:`s_${hash(JSON.stringify(identity)).slice(0,24)}`,group:group.id,file,
          start_line:range.start_line,end_line:range.end_line,text,sha256,file_sha256:source.sha256});
      }
    }
    if(validSpans>6){issue('span_limit',group.id);omitted+=validSpans*(validSpans-1)/2-15;}
    if(groupSpans.length<2)issue('insufficient_spans',group.id);
    spans.push(...groupSpans);
    for(let left=0;left<groupSpans.length;left++)for(let right=left+1;right<groupSpans.length;right++){
      const a=groupSpans[left].id,b=groupSpans[right].id;
      pairs.push({id:`p_${hash(JSON.stringify([group.id,a,b])).slice(0,24)}`,group:group.id,symbol:group.symbol,context:group.context ?? '',left:a,right:b});
    }
  }
  if(pairs.length>maxPairs){omitted+=pairs.length-maxPairs;issue('pair_limit');pairs.length=maxPairs;}
  return {schema:1,root,question:spec.question,spans,pairs,issues,scope:{complete:false,files_considered:filesConsidered,pairs_omitted:omitted}};
}
