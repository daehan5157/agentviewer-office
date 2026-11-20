import { ClaudeScanner } from './claude.js';
import { CodexScanner } from './codex.js';
import { GeminiScanner } from './gemini.js';
import { ProcessScanner } from './processes.js';
import { OrcaScanner, orcaTranscriptRoots } from './orca.js';
import { DemoScanner } from './demo.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Build every scanner from CLI flags + config.json.
 * Orca-managed Claude/Codex accounts keep transcripts inside Orca's data
 * folder, so those folders are added to the Claude and Codex scanners.
 */
export function createScanners(store, args = {}, config = {}) {
  const windowMs = Number(args.window || 60) * 60e3;
  const orcaCfg = config.orca || {};
  const orca = args.orca !== false && orcaCfg.enabled !== false
    ? new OrcaScanner(store, {
        orcaBin: args['orca-bin'] || orcaCfg.bin, userData: orcaCfg.userData, workspaceDir: orcaCfg.workspaceDir,
        leadsFile: path.join(os.homedir(), '.agentviewer', 'orca-leads.json'),
      })
    : null;
  const roots = (kind) => (orca ? async () => (await orcaTranscriptRoots(orca.userData))[kind] : null);
  const s = {
    claude: args.claude !== false ? new ClaudeScanner(store, { windowMs, extraRoots: roots('claude') }) : null,
    codex: args.codex !== false ? new CodexScanner(store, { windowMs, extraRoots: roots('codex') }) : null,
    gemini: args.gemini !== false ? new GeminiScanner(store, { windowMs }) : null,
    proc: args.proc !== false ? new ProcessScanner(store, { customProcesses: config.processes || [] }) : null,
    orca,
    demo: args.demo ? new DemoScanner(store) : null,
  };
  s.list = Object.values(s).filter(Boolean);
  return s;
}
