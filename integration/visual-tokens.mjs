import {lstat,readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {stateHome} from './paths.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const primitive=value=>value===null || typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value)) || (typeof value==='string' && Buffer.byteLength(value)<=512);

// This writes only selected, predeclared design tokens. It does not generate code.
export async function applyTokens(destination,tokens,{cwd=process.cwd(),backupRoot=path.join(stateHome,'visual','backups')}={}) {
  if (!destination || typeof destination.file!=='string' || !/^[a-f0-9]{64}$/.test(destination.expected_sha256) ||
      !Array.isArray(destination.keys) || !destination.keys.length || destination.keys.length>32 ||
      destination.keys.some(key=>typeof key!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)||['__proto__','prototype','constructor'].includes(key)) ||
      new Set(destination.keys).size!==destination.keys.length || !tokens || typeof tokens!=='object' || Array.isArray(tokens) ||
      !Object.keys(tokens).length || Object.keys(tokens).some(key=>!destination.keys.includes(key)||!primitive(tokens[key]))) throw Error('invalid_token_destination');
  const file=path.resolve(cwd,destination.file),relative=path.relative(cwd,file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(part=>part.startsWith('.')||part==='node_modules') ||
      !/^(?:design-tokens|[A-Za-z0-9_-]+\.tokens)\.json$/.test(path.basename(file))) throw Error('token_destination_outside_scope');
  // Reject symlink parents as well as symlink files before any target write.
  let parent=path.resolve(cwd);
  for (const part of relative.split(path.sep)) {
    parent=path.join(parent,part);
    if ((await lstat(parent)).isSymbolicLink()) throw Error('token_symlink');
  }
  const stat=await lstat(file);
  if (!stat.isFile() || stat.size>16384) throw Error('invalid_token_file');
  const original=await readFile(file);
  if (original.length>16384 || hash(original)!==destination.expected_sha256) throw Error('stale_token_file');
  const data=JSON.parse(original.toString('utf8'));
  if (!data || typeof data!=='object' || Array.isArray(data) || Object.keys(data).length>64 || Object.values(data).some(value=>!primitive(value)) ||
      Object.keys(tokens).some(key=>!Object.hasOwn(data,key))) throw Error('invalid_token_file');
  const updated=Buffer.from(JSON.stringify({...data,...tokens},null,2)+'\n');
  if (updated.length>16384) throw Error('token_file_too_large');
  await mkdir(backupRoot,{recursive:true,mode:0o700});
  const id=randomUUID(),backup=path.join(backupRoot,`${id}.json`),temporary=path.join(path.dirname(file),`.jev-visual-${id}.tmp`);
  await writeFile(backup,original,{flag:'wx',mode:0o600});
  try {
    await writeFile(temporary,updated,{flag:'wx',mode:stat.mode & 0o777});
    if ((await lstat(file)).isSymbolicLink() || hash(await readFile(file))!==destination.expected_sha256) throw Error('stale_token_file');
    await rename(temporary,file);
  } finally {await rm(temporary,{force:true}).catch(()=>{});}
  return {applied:true,file,sha256:hash(updated),backup,pixel_review:'NOT_PERFORMED'};
}
