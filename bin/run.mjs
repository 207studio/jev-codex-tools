import {fileURLToPath} from 'node:url';

export async function run(relativeEntry) {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    console.error('Jev Codex Tools requires Node.js 24 or newer.');
    process.exitCode = 2;
    return;
  }
  const entry = new URL(relativeEntry, import.meta.url);
  process.argv[1] = fileURLToPath(entry);
  await import(entry.href);
}
