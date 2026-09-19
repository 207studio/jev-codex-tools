import {homedir} from 'node:os';
import path from 'node:path';

// No credentials or env files are loaded. All overrides come from the process.
const root = process.env.JEV_TOOLS_HOME ? path.resolve(process.env.JEV_TOOLS_HOME) : null;
const xdg = (name, fallback) => path.resolve(process.env[name] || path.join(homedir(), fallback));
export const toolsHome = root || path.join(xdg('XDG_DATA_HOME', '.local/share'), 'jev-codex-tools');
export const configHome = root ? path.join(root, 'config') : path.join(xdg('XDG_CONFIG_HOME', '.config'), 'jev-codex-tools');
export const stateHome = root ? path.join(root, 'state') : path.join(xdg('XDG_STATE_HOME', '.local/state'), 'jev-codex-tools');
export const cacheHome = root ? path.join(root, 'cache') : path.join(xdg('XDG_CACHE_HOME', '.cache'), 'jev-codex-tools');
export const helperPath = process.env.JEV_MACOS_HELPER ? path.resolve(process.env.JEV_MACOS_HELPER) : path.join(toolsHome, 'bin', 'macos-ax');
