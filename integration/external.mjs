import {spawn} from 'node:child_process';
import path from 'node:path';

export function externalEntry(variable) {
  const value = process.env[variable];
  if (!value || !path.isAbsolute(value)) throw Error(`${variable} must name an absolute, separately installed JavaScript entry point.`);
  return value;
}
export function launch(command, args, env = process.env) {
  const child = spawn(command, args, {env, stdio:'inherit'});
  child.on('error', () => { console.error('Command launch failed; check the explicitly configured executable.'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
  return child;
}
