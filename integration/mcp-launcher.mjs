import {spawn} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import {constants} from 'node:os';
import {dirname, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const RUNTIME_ENV = ['HOME', 'PATH', 'TMPDIR', 'TMP', 'TEMP', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'];
const SIGNALS = ['SIGINT', 'SIGTERM'];

// The caller supplies an already pinned installation. This module never finds,
// downloads, builds, or updates the upstream package or reads an env file.
export function buildMcpLaunch({entry, env = {}} = {}) {
  if (typeof entry !== 'string' || !isAbsolute(entry) || entry.includes('\0')) {
    throw new Error('MCP entry must be an explicit absolute file path.');
  }
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new Error('MCP launch environment must be an object.');
  }
  const key = ['TYPESAFE_API_KEY', 'JEV_API_KEY']
    .map(name => Object.hasOwn(env, name) && typeof env[name] === 'string' ? env[name].trim() : '')
    .find(Boolean);
  if (!key) throw new Error('MCP requires a configured TypeSafe API credential.');

  const childEnv = {};
  for (const name of RUNTIME_ENV) {
    if (Object.hasOwn(env, name) && typeof env[name] === 'string') childEnv[name] = env[name];
  }
  Object.assign(childEnv, {
    TYPESAFE_API_KEY: key,
    TYPESAFE_BASE_URL: 'https://api.typesafe.ai',
    JEV_MCP_MODEL: 'jev-latest',
    JEV_MCP_MOCK: '0',
    JEV_MCP_TIMEOUT_MS: '30000',
  });
  return {command: process.execPath, args: [entry], env: childEnv};
}

function parseEntry(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--entry') {
    throw new Error('Expected exactly --entry followed by an absolute file path.');
  }
  return argv[1];
}

export async function runMcpLauncher({
  argv = process.argv.slice(2), env = process.env, spawnProcess = spawn,
  statEntry = stat, stderr = process.stderr, signalSource = process,
} = {}) {
  const report = message => stderr.write(`[jev-mcp] ${message}\n`);
  if (env?.JEV_MCP_ENABLED === '0') {
    report('Disabled.');
    return {code: 0, signal: null, disabled: true};
  }

  let launch;
  try {
    launch = buildMcpLaunch({entry: parseEntry(argv), env});
  } catch {
    report('Invalid launch configuration; supply --entry and a TypeSafe API credential.');
    return {code: 2, signal: null, disabled: false};
  }
  try {
    if (!(await statEntry(launch.args[0])).isFile()) throw new Error('Not a file');
  } catch {
    report('MCP entry is not an accessible regular file.');
    return {code: 2, signal: null, disabled: false};
  }

  return new Promise(resolveResult => {
    let child;
    const handlers = new Map();
    let finished = false;
    const finish = (code, signal = null) => {
      if (finished) return;
      finished = true;
      for (const [name, handler] of handlers) signalSource.removeListener(name, handler);
      resolveResult({code, signal, disabled: false});
    };
    const fail = () => {
      // Child/OS errors may contain env values or paths: never print them.
      report('MCP child failed to start.');
      finish(1);
    };
    try {
      child = spawnProcess(launch.command, launch.args, {
        env: launch.env, cwd: dirname(launch.args[0]), stdio: 'inherit', shell: false,
      });
      child.once('error', fail);
      child.once('close', (code, signal) => finish(code, signal ?? null));
      for (const name of SIGNALS) {
        const handler = () => {
          try { child.kill(name); }
          catch { report('Unable to forward termination signal to MCP child.'); }
        };
        handlers.set(name, handler);
        signalSource.on(name, handler);
      }
    } catch {
      fail();
    }
  });
}

function invokedAsCli() {
  try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
}

if (invokedAsCli()) {
  const result = await runMcpLauncher();
  process.exitCode = result.signal ? 128 + (constants.signals[result.signal] ?? 1) : (result.code ?? 1);
}
