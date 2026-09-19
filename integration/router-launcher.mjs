import {enabled,settings} from './features.mjs';
import {externalEntry,launch} from './external.mjs';

const args = process.argv.slice(2), env = {...process.env};
for (const [tier,model] of Object.entries(settings().routing_models || {})) {
  if (['fast','balanced','strong','long'].includes(tier) && typeof model === 'string' && /^[a-zA-Z0-9._/-]+$/.test(model))
    env[`JEV_CODEX_${tier.toUpperCase()}_MODEL`] ??= model;
}
try {
  if (enabled('routing')) launch(process.execPath, [externalEntry('JEV_ROUTER_ENTRY'), ...args], env);
  else launch(process.env.JEV_CODEX_BIN || 'codex', args, env);
} catch (error) { console.error(error.message); process.exitCode = 2; }
