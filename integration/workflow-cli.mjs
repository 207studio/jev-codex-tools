import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {chooseDetailed} from './choice.mjs';
import {enabled} from './features.mjs';
import {POLICY_VERSION,DEFAULT_MODELS,validateSpec,validateModels,formatPlan,planWorkflow} from './workflow-policy.mjs';

const fail = code => { throw Object.assign(new Error(code), {safeCode:code}); };

async function readJson(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('ABSOLUTE_PATH_REQUIRED');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096) fail('INPUT_LIMIT');
    const buffer = Buffer.alloc(4097);
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) fail('INPUT_LIMIT');
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(buffer.subarray(0, bytesRead)));
  } finally { await handle.close(); }
}

// Advice is saved before it is shown. A caller must update context_id when its
// evidence changes; a plan is never evidence of a passing test or permission.
export async function persistedPlan({specFile,outFile,modelsFile}, {decide=chooseDetailed,isEnabled=enabled}={}) {
  if (!path.isAbsolute(outFile || '')) fail('ABSOLUTE_PATH_REQUIRED');
  const spec = validateSpec(await readJson(specFile));
  const models = validateModels(modelsFile ? await readJson(modelsFile) : DEFAULT_MODELS);
  const active = isEnabled('workflow_advisor') === true;
  const digest = createHash('sha256').update(JSON.stringify([POLICY_VERSION,spec,models,active])).digest('hex');
  let output;
  try { output = await open(outFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let record;
    try { record = await readJson(outFile); } catch { fail('INVALID_WORKFLOW_CACHE'); }
    if (!record || Object.keys(record).sort().join(',') !== 'digest,plan,version') fail('INVALID_WORKFLOW_CACHE');
    if (record.version !== POLICY_VERSION || record.digest !== digest) fail('WORKFLOW_PLAN_STALE');
    let plan;
    try {
      const old = record.plan;
      plan = formatPlan(spec,old.strategy,{source:old.source,confidence:old.confidence,reason:old.reason,api_calls:old.api_calls},models);
      if (JSON.stringify(plan) !== JSON.stringify(old)) fail('INVALID_WORKFLOW_CACHE');
    } catch { fail('INVALID_WORKFLOW_CACHE'); }
    return {...plan,api_calls:0,cache_hit:true};
  }
  try {
    const plan = await planWorkflow(spec,{decide,enabled:active,models});
    await output.writeFile(JSON.stringify({version:POLICY_VERSION,digest,plan})+'\n');
    return {...plan,cache_hit:false};
  } finally { await output.close(); }
}

export async function main(argv=process.argv.slice(2)) {
  const {values} = parseArgs({args:argv,options:{spec:{type:'string'},out:{type:'string'},models:{type:'string'},help:{type:'boolean'}}});
  if (values.help) {
    console.log('jev-workflow --spec ABSOLUTE_JSON --out NEW_PLAN_JSON [--models MODEL_MAP_JSON]\nKnown work uses code; opt-in mixed work may ask Jev once. Plans are advisory and preserve native checks. Reuse requires an identical spec/context; stale or corrupt plans are never overwritten.');
    return;
  }
  const result = await persistedPlan({specFile:values.spec,outFile:values.out,modelsFile:values.models});
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized)>1000) fail('OUTPUT_LIMIT');
  console.log(serialized);
  if (result.strategy==='UNKNOWN') process.exitCode=3;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    const code = /^[A-Z_]{1,40}$/.test(error.safeCode || '') ? error.safeCode : 'WORKFLOW_INPUT_OR_IO_ERROR';
    console.error(JSON.stringify({status:'UNKNOWN',code,advisory_only:true}));
    process.exitCode=2;
  }
}
