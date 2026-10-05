import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {buildMcpLaunch, runMcpLauncher} from '../integration/mcp-launcher.mjs';

const ENTRY = '/synthetic/pinned-jev-mcp/dist/index.js';
const KEY = 'synthetic-test-credential';

function fixture(overrides = {}) {
  const calls = {spawn: [], stat: [], killed: [], stderr: []};
  const signals = new EventEmitter();
  const child = new EventEmitter();
  child.kill = signal => { calls.killed.push(signal); return true; };
  const options = {
    argv: ['--entry', ENTRY], env: {JEV_API_KEY: KEY}, signalSource: signals,
    stderr: {write: text => calls.stderr.push(text)},
    statEntry: async entry => { calls.stat.push(entry); return {isFile: () => true}; },
    spawnProcess: (...args) => {
      calls.spawn.push(args);
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    },
    ...overrides,
  };
  return {calls, signals, child, options};
}

test('launch plan forwards only required runtime settings and forces the direct TypeSafe configuration', () => {
  const source = {
    HOME: '/synthetic/home', PATH: '/synthetic/bin', TMPDIR: '/synthetic/tmp', LANG: 'C',
    JEV_API_KEY: KEY, NODE_OPTIONS: '--import /synthetic/preload.mjs', NODE_PATH: '/synthetic/modules',
    OPENROUTER_API_KEY: KEY, OPENAI_API_KEY: KEY, CLOUDFLARE_API_TOKEN: KEY, AI_GATEWAY_API_KEY: KEY,
    TYPESAFE_BASE_URL: 'https://untrusted.invalid', JEV_PROVIDER: 'openrouter',
    JEV_MCP_MODEL: 'untrusted-model', JEV_MCP_MOCK: '1', JEV_MCP_TIMEOUT_MS: '999999999',
    HTTPS_PROXY: 'https://untrusted.invalid', NODE_EXTRA_CA_CERTS: '/synthetic/untrusted.pem',
    CODEX_HOME: '/synthetic/codex', SSH_AUTH_SOCK: '/synthetic/socket',
  };
  const original = {...source};
  const launch = buildMcpLaunch({entry: ENTRY, env: source});
  assert.equal(launch.command, process.execPath);
  assert.deepEqual(launch.args, [ENTRY]);
  assert.deepEqual(launch.env, {
    HOME: source.HOME, PATH: source.PATH, TMPDIR: source.TMPDIR, LANG: 'C',
    TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: 'https://api.typesafe.ai',
    JEV_MCP_MODEL: 'jev-latest', JEV_MCP_MOCK: '0', JEV_MCP_TIMEOUT_MS: '30000',
  });
  assert.deepEqual(source, original);
});

test('an explicit TypeSafe credential takes precedence and a blank value falls back to JEV_API_KEY', () => {
  assert.equal(buildMcpLaunch({entry: ENTRY, env: {TYPESAFE_API_KEY: ' synthetic-typesafe ', JEV_API_KEY: KEY}}).env.TYPESAFE_API_KEY, 'synthetic-typesafe');
  assert.equal(buildMcpLaunch({entry: ENTRY, env: {TYPESAFE_API_KEY: ' ', JEV_API_KEY: KEY}}).env.TYPESAFE_API_KEY, KEY);
  assert.throws(() => buildMcpLaunch({entry: ENTRY, env: {}}), /configured TypeSafe API credential/);
  const inherited = Object.create({TYPESAFE_API_KEY: KEY, HOME: '/synthetic/inherited'});
  assert.throws(() => buildMcpLaunch({entry: ENTRY, env: inherited}), /configured TypeSafe API credential/);
});

test('entry is explicit and absolute without inspecting the filesystem in the pure builder', () => {
  for (const entry of [undefined, '', 'dist/index.js', '/synthetic/\0/index.js']) {
    assert.throws(() => buildMcpLaunch({entry, env: {JEV_API_KEY: KEY}}), /explicit absolute file path/);
  }
  assert.equal(buildMcpLaunch({entry: ENTRY, env: {JEV_API_KEY: KEY}}).args[0], ENTRY);
});

test('disabled launcher does not inspect files or spawn even when credentials and entry are absent', async () => {
  const f = fixture({argv: [], env: {JEV_MCP_ENABLED: '0'}});
  assert.deepEqual(await runMcpLauncher(f.options), {code: 0, signal: null, disabled: true});
  assert.equal(f.calls.spawn.length, 0);
  assert.equal(f.calls.stat.length, 0);
  assert.deepEqual(f.calls.stderr, ['[jev-mcp] Disabled.\n']);
});

test('CLI rejects implicit entry discovery, extra arguments and env-file arguments before launch', async () => {
  for (const argv of [[], ['--entry', ENTRY, '--extra'], ['--env-file', '/synthetic/.env'], ['--entry', 'relative.js']]) {
    const f = fixture({argv, env: {JEV_API_KEY: KEY, JEV_MCP_ENTRY: ENTRY}});
    assert.equal((await runMcpLauncher(f.options)).code, 2);
    assert.equal(f.calls.spawn.length, 0);
    assert.equal(f.calls.stat.length, 0);
    assert.ok(!f.calls.stderr.join('').includes(KEY));
  }
  const f = fixture({env: {}});
  assert.equal((await runMcpLauncher(f.options)).code, 2);
  assert.equal(f.calls.spawn.length, 0);
});

test('CLI requires an accessible regular entry file and suppresses filesystem error details', async () => {
  for (const statEntry of [async () => ({isFile: () => false}), async () => { throw new Error(KEY); }]) {
    const f = fixture({statEntry});
    assert.equal((await runMcpLauncher(f.options)).code, 2);
    assert.equal(f.calls.spawn.length, 0);
    assert.ok(!f.calls.stderr.join('').includes(KEY));
  }
});

test('child inherits stdio for MCP, has no shell, and preserves its actual exit code', async () => {
  const f = fixture();
  f.options.spawnProcess = (...args) => {
    f.calls.spawn.push(args);
    queueMicrotask(() => f.child.emit('close', 7, null));
    return f.child;
  };
  assert.deepEqual(await runMcpLauncher(f.options), {code: 7, signal: null, disabled: false});
  const [command, args, options] = f.calls.spawn[0];
  assert.equal(command, process.execPath);
  assert.deepEqual(args, [ENTRY]);
  assert.equal(options.stdio, 'inherit');
  assert.equal(options.shell, false);
  assert.equal(options.cwd, '/synthetic/pinned-jev-mcp/dist');
  assert.equal(options.env.TYPESAFE_API_KEY, KEY);
  assert.deepEqual(f.calls.stderr, []);
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});

test('spawn failures report a fixed stderr message without disclosing exception content', async () => {
  const sync = fixture({spawnProcess: () => { throw new Error(KEY); }});
  assert.equal((await runMcpLauncher(sync.options)).code, 1);
  const asyncFailure = fixture();
  asyncFailure.options.spawnProcess = () => {
    queueMicrotask(() => asyncFailure.child.emit('error', new Error(KEY)));
    return asyncFailure.child;
  };
  assert.equal((await runMcpLauncher(asyncFailure.options)).code, 1);
  for (const f of [sync, asyncFailure]) {
    assert.deepEqual(f.calls.stderr, ['[jev-mcp] MCP child failed to start.\n']);
    assert.equal(f.signals.listenerCount('SIGINT'), 0);
    assert.equal(f.signals.listenerCount('SIGTERM'), 0);
  }
});

test('termination signals are forwarded and child signal termination is preserved', async () => {
  const f = fixture();
  f.options.spawnProcess = () => {
    queueMicrotask(() => {
      f.signals.emit('SIGTERM');
      f.child.emit('close', null, 'SIGTERM');
    });
    return f.child;
  };
  assert.deepEqual(await runMcpLauncher(f.options), {code: null, signal: 'SIGTERM', disabled: false});
  assert.deepEqual(f.calls.killed, ['SIGTERM']);
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});
