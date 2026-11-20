// Optional user config: ~/.agentviewer/config.json (or --config <file>)
//
// {
//   "processes": [
//     { "name": "MyApp", "match": "orca.*\\bmyapp\\b", "client": "Orca", "channel": "Orca", "door": "cli" }
//   ]
// }
//
// Every process whose command line matches `match` (case-insensitive regex)
// shows up as its own agent, so systems Agentviewer has no built-in adapter
// for (in-house orchestrators, bots, workers) still appear in the office.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { doorFor } from './channels.js';

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.agentviewer', 'config.json');

export async function loadConfig(file) {
  const p = file || process.env.AGENTVIEWER_CONFIG || DEFAULT_CONFIG_PATH;
  let raw;
  try {
    raw = await fsp.readFile(p, 'utf8');
  } catch {
    return { path: p, loaded: false, processes: [] };
  }
  const cfg = JSON.parse(raw);
  return { path: p, loaded: true, ...cfg, processes: compileProcesses(cfg.processes) };
}

/** Turn config entries into process definitions understood by ProcessScanner. */
export function compileProcesses(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && e.match)
    .map((e, i) => ({
      key: `custom-${i}-${String(e.name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: e.name || null,
      client: e.client || e.name || 'Custom',
      vendor: e.vendor || 'other',
      channel: e.channel || e.client || 'CLI',
      door: doorFor(e.door || e.channel, 'cli'),
      re: new RegExp(e.match, 'i'),
      custom: true,
    }));
}
