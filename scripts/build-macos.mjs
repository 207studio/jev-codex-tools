import {mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {helperPath} from '../integration/paths.mjs';

// Explicit opt-in build; there is no install/postinstall/prepare hook.
if (process.platform !== 'darwin') {
  console.error('The accessibility helper can only be built on macOS.');
  process.exitCode = 2;
} else {
  await mkdir(path.dirname(helperPath), {recursive:true, mode:0o700});
  const source = fileURLToPath(new URL('../integration/macos-ax.swift', import.meta.url));
  const child = spawn('/usr/bin/xcrun', ['swiftc', '-O', source, '-o', helperPath], {stdio:'inherit'});
  child.on('error', () => {console.error('Swift compiler unavailable. Install the Xcode Command Line Tools before building.'); process.exitCode = 2;});
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
    if (code === 0) console.log(`Built macOS helper: ${helperPath}`);
  });
}
