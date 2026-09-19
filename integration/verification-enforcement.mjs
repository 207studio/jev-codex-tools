import path from 'node:path';

const TARGETS = new Set(['Bash', 'exec_command', 'shell', 'shell_command']);
const READERS = new Set(['pwd','true','false','ls','cat','head','tail','wc','stat','uname','whoami','echo']);
const GIT_READERS = new Set(['status','log','show','diff','ls-files','rev-parse']);
const REASON = '검증·임의 실행은 jev-verify 경유가 필수입니다. 등록된 절대 경로의 run --spec FILE --execute를 사용하고 필수 검증은 생략하지 마세요.';
const deny = () => ({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:REASON}});
const invalid = () => { throw Error('unsupported_shell_syntax'); };

// A deliberately small shell grammar. Quoted text is data; expansions are never evaluated.
function lex(source) {
  const tokens = []; let word = '', started = false, quote = null;
  const flush = () => { if (started) tokens.push({type:'word',value:word}); word = ''; started = false; };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '\0' || (char.charCodeAt(0) < 32 && !['\n','\t'].includes(char))) invalid();
    if (quote === "'") {
      if (char === "'") quote = null; else word += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') { quote = null; continue; }
      if (char === '$' || char === '`') invalid();
      if (char === '\\') {
        const next = source[++index];
        if (next === undefined) invalid();
        if (next === '\n') continue;
        word += ['$', '`', '"', '\\'].includes(next) ? next : '\\' + next;
      } else word += char;
      continue;
    }
    if (char === "'" || char === '"') { started = true; quote = char; continue; }
    if (char === '\\') {
      const next = source[++index];
      if (next === undefined) invalid();
      if (next === '\n') continue;
      started = true; word += next; continue;
    }
    if (' \t'.includes(char)) { flush(); continue; }
    if (source.startsWith('2>&1', index) && !started && (index + 4 === source.length || /[ \t\n|;&]/.test(source[index + 4]))) {
      tokens.push({type:'redirect',value:'2>&1'}); index += 3; continue;
    }
    if (char === '\n' || char === ';' || char === '|' || char === '&') {
      flush();
      if (char === '&') {
        if (source[index + 1] !== '&') invalid();
        tokens.push({type:'operator',value:'&&'}); index++; continue;
      }
      if (char === '|' && source[index + 1] === '|') invalid();
      tokens.push({type:'operator',value:char}); continue;
    }
    // No substitutions, redirects, comments, glob/brace/tilde expansion, grouping or process substitution.
    if ('$`<>(){}[]*?~!'.includes(char) || char === '>' || (char === '#' && !started)) invalid();
    started = true; word += char;
  }
  if (quote) invalid();
  flush(); return tokens;
}
export {parse as parseShellCommand};
function parse(source) {
  const commands = [], links = []; let words = [], redirects = 0;
  const finish = () => {
    if (!words.length) invalid();
    commands.push({words, redirects}); words = []; redirects = 0;
  };
  for (const token of lex(source)) {
    if (token.type === 'word') { words.push(token.value); continue; }
    if (token.type === 'redirect') { redirects++; if (redirects > 1) invalid(); continue; }
    if (!words.length) { if (token.value === '\n' && !redirects) continue; invalid(); }
    finish(); links.push(token.value);
  }
  if (words.length || redirects) finish();
  else if (links.length) {
    if (![';', '\n'].includes(links.at(-1))) invalid();
    links.pop();
  }
  if (!commands.length || links.length !== commands.length - 1) invalid();
  return {commands,links};
}
function systemName(command) {
  if (!command.includes('/')) return command;
  const name = path.basename(command);
  return command === `/bin/${name}` || command === `/usr/bin/${name}` ? name : null;
}
function wrapperCommand(args) {
  if (args.length === 1 && args[0] === '--help') return true;
  const [action, ...rest] = args;
  if (!['plan','run','assess'].includes(action)) return false;
  const values = {};
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (!['--spec','--execute','--log','--exit-code'].includes(flag) || Object.hasOwn(values,flag)) return false;
    if (flag === '--execute') { values[flag] = true; continue; }
    const value = rest[++index];
    if (typeof value !== 'string' || !value.length || value.startsWith('--') || /[\r\n]/.test(value)) return false;
    values[flag] = value;
  }
  if (!values['--spec']) return false;
  if (action === 'plan') return Object.keys(values).length === 1;
  if (action === 'run') return values['--execute'] === true && Object.keys(values).length === 2;
  return Object.keys(values).length === 3 && Boolean(values['--log']) && /^\d{1,3}$/.test(values['--exit-code'] || '') && Number(values['--exit-code']) <= 255;
}
function safeGit(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    if (['--no-pager','--no-optional-locks','--literal-pathspecs','--no-replace-objects'].includes(args[index])) { index++; continue; }
    if (args[index] === '-C' && args[index + 1] && !args[index + 1].startsWith('-')) { index += 2; continue; }
    return false;
  }
  const action = args[index++];
  if (!GIT_READERS.has(action)) return false;
  for (const argument of args.slice(index)) {
    if (/^(?:-c|--config-env(?:=|$)|--exec-path(?:=|$)|--ext-diff(?:=|$)|--textconv(?:=|$)|--output(?:=|$)|--paginate$|--open-files-in-pager(?:=|$))/.test(argument)) return false;
    if (action === 'diff' && argument === '--check') return false;
  }
  return true;
}
function safeDate(args) {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument.startsWith('+') || ['-u','--utc','--universal','-R','--rfc-email'].includes(argument)) continue;
    if (argument === '-r' && args[index + 1] && !args[index + 1].startsWith('-')) { index++; continue; }
    return false;
  }
  return true;
}
function safeReader(words) {
  const name = systemName(words[0]), args = words.slice(1);
  if (READERS.has(name)) return true;
  if (name === 'date') return safeDate(args);
  if (name === 'rg') return !args.some(arg => /^--(?:pre|hostname-bin)(?:=|$)/.test(arg));
  if (name === 'sed') return args.length >= 2 && args[0] === '-n' && /^\d+(?:,\d+)?p$/.test(args[1]) && args.slice(2).every(arg => arg.length > 0 && !arg.startsWith('-'));
  if (name === 'git') return safeGit(args);
  if (name === 'printf') {
    const format = args[0] === '--' ? args[1] : args[0];
    return typeof format === 'string' && !format.startsWith('-') && !/%(?:[0-9$.*+-]*)n/.test(format);
  }
  return false;
}

export function verificationEnforcement(event, options = {}) {
  try {
    const {active = false, trustedExecutables = [], trustedDecisionExecutables = []} = options ?? {};
    if (!active || event?.hook_event_name !== 'PreToolUse' || !TARGETS.has(event?.tool_name)) return null;
    const input = event.tool_input;
    const source = typeof input?.command === 'string' ? input.command : input?.cmd;
    if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 32768) return deny();
    const trusted = new Set(Array.isArray(trustedExecutables) ? trustedExecutables.filter(item => typeof item === 'string' && path.isAbsolute(item) && path.normalize(item) === item) : []);
    const decisionRunners = new Set(Array.isArray(trustedDecisionExecutables) ? trustedDecisionExecutables.filter(item => typeof item === 'string' && path.isAbsolute(item) && path.normalize(item) === item) : []);
    const {commands,links} = parse(source); const wrappers = [];
    for (let index = 0; index < commands.length; index++) {
      const words = commands[index].words;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) return deny();
      if (trusted.has(words[0])) {
        if (!wrapperCommand(words.slice(1))) return deny();
        wrappers.push(index); continue;
      }
      // These are explicitly registered Jev adapters, never inferred from a filename.
      // Each adapter owns its argument validation, confidence and execution policy.
      if (decisionRunners.has(words[0])) {
        if (words.length > 128 || words.some(word => Buffer.byteLength(word) > 4000)) return deny();
        wrappers.push(index); continue;
      }
      if (words[0] === 'cd') {
        if (index !== 0 || words.length !== 2 || !words[1] || words[1].startsWith('-') || links[0] !== '&&') return deny();
        continue;
      }
      if (!safeReader(words)) return deny();
    }
    if (wrappers.length > 1) return deny();
    if (wrappers.length === 1) {
      const at = wrappers[0];
      if (at > 1 || (at === 1 && (commands[0].words[0] !== 'cd' || links[0] !== '&&'))) return deny();
      for (let index = at + 1; index < commands.length; index++) {
        if (links[index - 1] !== '|' || !['head','tail'].includes(systemName(commands[index].words[0]))) return deny();
      }
    }
    return null;
  } catch { return deny(); }
}

export function decisionRecovery(event, options = {}) {
  if (event?.hook_event_name !== 'PreToolUse' || !TARGETS.has(event?.tool_name)) return false;
  return verificationEnforcement(event,{...options,active:true}) === null;
}
