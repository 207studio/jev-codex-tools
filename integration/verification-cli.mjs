import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readSpec, planVerification, runVerification, assessVerification} from './verification.mjs';

const usage = 'jev-verify plan --spec FILE\njev-verify run --spec FILE [--execute]\njev-verify assess --spec FILE --log FILE --exit-code N\nPlan never executes. Run requires --execute. Features verification_gate and verification_assessment default off. All commands must already be supplied in the JSON spec; Jev only selects labels.';
export async function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') return {usage};
  const [action, ...rest] = argv, options = {};
  if (!['plan','run','assess'].includes(action)) throw Error('invalid_action');
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (!['--spec','--execute','--log','--exit-code'].includes(flag) || Object.hasOwn(options, flag)) throw Error('invalid_arguments');
    if (flag === '--execute') { options[flag] = true; continue; }
    if (!rest[index + 1] || rest[index + 1].startsWith('--')) throw Error('missing_argument');
    options[flag] = rest[++index];
  }
  if (!options['--spec'] || (action !== 'run' && options['--execute']) || (action !== 'assess' && (options['--log'] || options['--exit-code'] !== undefined))) throw Error('invalid_arguments');
  const spec = await readSpec(options['--spec']);
  if (action === 'plan') return planVerification(spec);
  if (action === 'run') return runVerification(spec, {execute:options['--execute'] === true});
  if (!options['--log'] || !/^\d{1,3}$/.test(options['--exit-code'] || '')) throw Error('log_and_exit_code_required');
  return assessVerification(spec, {log:options['--log'], exitCode:Number(options['--exit-code'])});
}
export function renderResult(result) {
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json) <= 3999) return json;
  const execution = result.execution || {};
  return JSON.stringify({status:'output_budget_exceeded', necessity:result.necessity, assessment:result.assessment,
    execution:{executed:execution.executed ?? null, exit_code:execution.exit_code ?? null,
      ...(typeof execution.log_path === 'string' && Buffer.byteLength(execution.log_path) < 2000 ? {log_path:execution.log_path} : {log_path_omitted:true})}});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(renderResult(result));
    if (result.execution?.executed !== false && result.execution?.exit_code !== undefined && result.execution.exit_code !== 0)
      process.exitCode = Number.isInteger(result.execution.exit_code) ? result.execution.exit_code : 3;
    else if (result.execution?.timed_out || result.execution?.error) process.exitCode = 3;
  } catch (error) {
    const reason = /^[a-z][a-z0-9_]{0,70}$/.test(error.message) ? error.message : 'verification_unavailable';
    console.log(JSON.stringify({status:'UNKNOWN', reason, execution:{executed:null, exit_code:null}, assessment:{choice:'INSUFFICIENT', confidence:0}}));
    process.exitCode = 2;
  }
}
