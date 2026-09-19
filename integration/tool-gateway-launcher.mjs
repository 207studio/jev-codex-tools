import path from 'node:path';
import {enabled,featuresPath} from './features.mjs';
import {stateHome} from './paths.mjs';
import {externalEntry,launch} from './external.mjs';

const args = process.argv.slice(2);
const management = new Set(['--status','--start','--stop','--routing','--dashboard','--logs','--print-config','--gateway-help']);
try {
  if (!enabled('tool_routing_gateway')) {
    if (management.has(args[0])) {
      console.log(JSON.stringify({status:'disabled',message:'Enable tool_routing_gateway and set JEV_GATEWAY_ENTRY to a separately installed gateway CLI.'}));
      if (args[0] !== '--status' && args[0] !== '--gateway-help') process.exitCode = 2;
    } else launch(process.env.JEV_CODEX_BIN || 'codex', args);
  } else {
    process.umask(0o077);
    // The external entry is trusted user-installed code, not bundled or imported here.
    const env = {...process.env, HOST:'127.0.0.1', JEV_DEBUG_DUMP_DIR:'', BROWSER:'none',
      JEV_FEATURES_FILE:featuresPath, JEV_ROUTING:'on',
      JEV_GATEWAY_HOME:process.env.JEV_GATEWAY_HOME || path.join(stateHome, 'gateway'),
      JEV_CODEX_PORT:process.env.JEV_CODEX_PORT || '8790',
      JEV_MIN_CONFIDENCE:process.env.JEV_MIN_CONFIDENCE || '0.9',
      JEV_ARG_MIN_CERTAINTY:process.env.JEV_ARG_MIN_CERTAINTY || '0.95',
      JEV_ON_NONE:process.env.JEV_ON_NONE || 'passthrough',
      JEV_DIRECT_CALLS:process.env.JEV_DIRECT_CALLS || 'true'};
    launch(process.execPath, [externalEntry('JEV_GATEWAY_ENTRY'), ...args], env);
  }
} catch (error) { console.error(error.message); process.exitCode = 2; }
