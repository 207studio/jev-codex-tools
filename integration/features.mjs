import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {configHome} from './paths.mjs';

export const featuresPath = path.resolve(process.env.JEV_FEATURES_FILE || path.join(configHome, 'features.json'));
export const defaults = Object.freeze({judge:false,context:false,prune:false,routing:false,instant_compaction:false,progress_compaction:false,early_compaction:false,compaction_audit:false,tool_gate:false,browser_selector:false,browser_fanout:false,computer_selector:false,ios_selector:false,decision_metrics:false,unknown_diagnostics:false,session_reader:false,tool_routing_gateway:false,control_loop:false,subagent_contract:false,verification_gate:false,verification_assessment:false,verification_enforcement:false,decision_enforcement:false,decision_recovery_fastpath:false,data_collection:false,collection_enforcement:false,visual_review:false,visual_enforcement:false,code_contradictions:false});
export function settings() {
  try {
    const value = JSON.parse(readFileSync(featuresPath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? {...defaults, ...value} : {...defaults};
  } catch { return {...defaults}; }
}
export function enabled(name) {
  if (!Object.hasOwn(defaults, name)) return false;
  const value = process.env[`JEV_${name.toUpperCase()}_ENABLED`];
  if (value !== undefined) return value === '1';
  return settings()[name] === true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action = 'status', name, ...extra] = process.argv.slice(2);
    if (action === '--help') {
      console.log('jev-features status | enable NAME | disable NAME|all\nAll features default to off. Enable only the features you intend to use. JEV_NAME_ENABLED=1 overrides the saved setting; 0 disables it.');
    } else {
      if (extra.length || (action === 'status' && name !== undefined)) throw Error('Invalid command');
      if (action !== 'status') {
        if (!['enable', 'disable'].includes(action) || !(name === 'all' || Object.hasOwn(defaults, name))) throw Error('Invalid command');
        // Enabling every network/action feature together is deliberately unsupported.
        if (action === 'enable' && name === 'all') throw Error('Enable one feature at a time');
        let current = {...defaults};
        try {
          const value = JSON.parse(readFileSync(featuresPath, 'utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid settings');
          current = {...defaults, ...value};
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        for (const key of name === 'all' ? Object.keys(defaults) : [name]) current[key] = action === 'enable';
        mkdirSync(path.dirname(featuresPath), {recursive:true, mode:0o700});
        const temporary = `${featuresPath}.${randomUUID()}.tmp`;
        writeFileSync(temporary, JSON.stringify(current, null, 2) + '\n', {mode:0o600, flag:'wx'});
        renameSync(temporary, featuresPath);
      }
      console.log(JSON.stringify(Object.fromEntries(Object.keys(defaults).map(key => [key, enabled(key)]))));
    }
  } catch { console.error('Use: jev-features status | enable NAME | disable NAME|all. Settings must contain valid JSON; enable features individually.'); process.exitCode = 2; }
}
