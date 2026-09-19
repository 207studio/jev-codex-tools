import {createReadStream} from 'node:fs';
import {enabled} from './features.mjs';
import path from 'node:path';
import {stateHome} from './paths.mjs';
import {externalEntry,launch} from './external.mjs';

const args = process.argv.slice(2);
try {
  if (enabled('prune')) launch(process.execPath, [externalEntry('JEV_PRUNE_ENTRY'), ...args], {...process.env, JEVPRUNE_HOME:process.env.JEVPRUNE_HOME || path.join(stateHome, 'prune')});
  else if (args[0] === 'run' && args.includes('--')) {
    const command = args.slice(args.indexOf('--') + 1);
    if (!command.length) throw Error('A command after -- is required.');
    launch(command[0], command.slice(1));
  } else if (args[0] === 'select') {
    const at = args.indexOf('--file');
    if (at >= 0 && (!args[at + 1] || args[at + 1].startsWith('--'))) throw Error('--file requires a path.');
    const stream = at < 0 ? process.stdin : createReadStream(args[at + 1]);
    stream.on('error', () => { console.error('Input unavailable.'); process.exitCode = 2; });
    stream.pipe(process.stdout);
  } else if (args[0] === '--help' || !args.length) {
    console.log('jevprune select [--file FILE] | run -- COMMAND [ARGS]\nDisabled: preserves the complete input or runs the explicit command unchanged. Enable prune and set JEV_PRUNE_ENTRY to use your separately installed adapter.');
  } else throw Error('Prune is disabled. Enable prune and set JEV_PRUNE_ENTRY for other commands.');
} catch (error) { console.error(error.message); process.exitCode = 2; }
