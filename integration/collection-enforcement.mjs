import path from 'node:path';
import {parseShellCommand} from './verification-enforcement.mjs';

const TARGETS = new Set(['Bash','exec_command','shell','shell_command']);
const BULK_READERS = new Set(['cat','rg','grep','find','sed','ls','head','tail']);
const GIT_BULK_READERS = new Set(['diff','log','show','ls-files']);
const deny = () => ({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'대량 조회는 각 명령의 출력을 head/tail -c N(1~4000바이트)으로 좁히거나 등록된 절대 경로의 jev-collect --spec을 사용하세요. 원문·출처·UNKNOWN을 보존하고 차단을 우회하지 마세요.'}});

function systemName(command) {
  if (typeof command !== 'string') return null;
  if (!command.includes('/')) return command;
  const name = path.basename(command);
  return command === `/bin/${name}` || command === `/usr/bin/${name}` ? name : null;
}
function gitSubcommand(words) {
  let index = 1;
  while (index < words.length && words[index].startsWith('-')) {
    if (['--no-pager','--no-optional-locks','--literal-pathspecs','--no-replace-objects'].includes(words[index])) { index++; continue; }
    if (words[index] === '-C' && words[index + 1] && !words[index + 1].startsWith('-')) { index += 2; continue; }
    return null; // Unsupported Git syntax remains the existing verification guard's responsibility.
  }
  return words[index];
}
function isBulk(words) {
  const name = systemName(words[0]);
  return BULK_READERS.has(name) || name === 'git' && GIT_BULK_READERS.has(gitSubcommand(words));
}

// A single file avoids per-file byte limits multiplying the output. Following a file,
// line-count options, verbose headers and repeated counts cannot provide this bound.
function isByteBound(words) {
  if (!['head','tail'].includes(systemName(words[0]))) return false;
  let count = null, files = 0, filenamesOnly = false;
  for (let index = 1; index < words.length; index++) {
    const word = words[index];
    if (filenamesOnly) { if (!word || ++files > 1) return false; continue; }
    if (word === '--') { filenamesOnly = true; continue; }
    if (['-q','--quiet','--silent'].includes(word)) continue;
    if (word === '-c' || /^-c\d+$/.test(word)) {
      if (count !== null) return false;
      const value = word === '-c' ? words[++index] : word.slice(2);
      if (typeof value !== 'string' || !/^\d{1,4}$/.test(value)) return false;
      count = Number(value);
      if (count < 1 || count > 4000) return false;
      continue;
    }
    if (!word || word.startsWith('-') || ++files > 1) return false;
  }
  return count !== null;
}
function downstreamBound(commands,links,index) {
  for (let next = index + 1; next < commands.length && links[next - 1] === '|'; next++)
    if (isByteBound(commands[next].words)) return true;
  return false;
}

export function collectionEnforcement(event,options = {}) {
  try {
    const {active = false,trustedExecutables = []} = options ?? {};
    if (!active || event?.hook_event_name !== 'PreToolUse' || !TARGETS.has(event?.tool_name)) return null;
    const input = event.tool_input;
    const source = typeof input?.command === 'string' ? input.command : input?.cmd;
    if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 32768) return null;
    const trusted = new Set(Array.isArray(trustedExecutables) ? trustedExecutables.filter(value => typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value) : []);
    const {commands,links} = parseShellCommand(source);
    for (let index = 0; index < commands.length; index++) {
      const words = commands[index].words;
      // Exact registered helpers own their bounded output; this is not an approval.
      if (trusted.has(words[0])) continue;
      if (isBulk(words) && !isByteBound(words) && !downstreamBound(commands,links,index)) return deny();
    }
    return null;
  } catch {
    // Do not create a second shell interpreter or an alternate execution path.
    return null;
  }
}
