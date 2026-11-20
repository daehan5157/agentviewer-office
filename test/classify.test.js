import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTool, classifyShell, shellBin } from '../src/classify.js';
import { cleanPrompt } from '../src/util.js';
import { claudeEntry, codexSource, doorFor } from '../src/channels.js';

test('Claude Code built-in tools map to states and paths', () => {
  assert.deepEqual(
    (({ state, path }) => ({ state, path }))(classifyTool('Edit', { file_path: '/repo/src/app.ts' })),
    { state: 'typing', path: '도구 › Edit' },
  );
  assert.equal(classifyTool('Edit', { file_path: '/repo/src/app.ts' }).detail, 'Edit app.ts');
  assert.equal(classifyTool('Read', { file_path: '/a/README.md' }).state, 'reading');
  assert.equal(classifyTool('Grep', { pattern: 'useState' }).detail, 'Grep "useState"');
  assert.equal(classifyTool('WebSearch', { query: 'pixel art' }).state, 'web');
  assert.equal(classifyTool('WebFetch', { url: 'https://docs.example.com/x' }).path, 'Web › docs.example.com');
  const agent = classifyTool('Agent', { description: 'find routes', subagent_type: 'Explore', prompt: '...' });
  assert.equal(agent.state, 'delegating');
  assert.equal(agent.path, '하위 에이전트 › Explore');
  assert.equal(classifyTool('AskUserQuestion', { questions: [{ question: 'Deploy now?' }] }).state, 'waiting');
});

test('MCP tools are recognised for every vendor naming style', () => {
  const c = classifyTool('mcp__github__create_issue', { title: 'Bug' });
  assert.equal(c.state, 'mcp');
  assert.equal(c.server, 'github');
  assert.equal(c.path, 'MCP › github › create_issue');
  assert.equal(classifyTool('mcp__plugin_pdf-viewer_pdf__display_pdf', {}).server, 'pdf');
  assert.equal(classifyTool('linear__list_issues', {}, 'codex').server, 'linear');
  // Claude Code built-ins never contain "__", but a plain name must not be treated as MCP
  assert.equal(classifyTool('TodoWrite', { todos: [] }).kind, 'plan');
});

test('shell commands: read-only vs running, with a readable CLI path', () => {
  assert.equal(classifyShell('rg "retry" -n src').state, 'reading');
  assert.equal(classifyShell('git status').state, 'reading');
  assert.equal(classifyShell('git push origin main').state, 'running');
  assert.equal(classifyShell('cd web && npm test -- auth').path, 'CLI › npm test');
  assert.equal(classifyShell('FOO=1 python -m pytest -q').path, 'CLI › python -m pytest');
  assert.equal(classifyShell('cat a.txt > b.txt').state, 'running');
  assert.equal(classifyShell(['bash', '-lc', 'sed -n 1,20p x.py']).state, 'reading');
  assert.deepEqual(shellBin('sudo docker compose up'), { bin: 'docker', sub: 'compose' });
});

test('Codex and Gemini tool names', () => {
  const patch = classifyTool('apply_patch', '*** Begin Patch\n*** Update File: src/a.py\n*** Add File: src/b.py\n*** End Patch', 'codex');
  assert.equal(patch.state, 'typing');
  assert.equal(patch.detail, 'Patch a.py 외 1개');
  assert.equal(classifyTool('shell', JSON.stringify({ command: ['bash', '-lc', 'pytest -q'] }), 'codex').path, 'CLI › pytest');
  assert.equal(classifyTool('run_shell_command', { command: 'ls -la' }, 'gemini').state, 'reading');
  assert.equal(classifyTool('write_file', { file_path: '/x/docs.md' }, 'gemini').state, 'typing');
  assert.equal(classifyTool('google_web_search', { query: 'x' }, 'gemini').state, 'web');
});

test('prompt cleaning drops wrappers and keeps slash commands', () => {
  assert.equal(cleanPrompt('<command-name>/review</command-name><command-args>PR 12</command-args>'), '/review PR 12');
  assert.equal(cleanPrompt('<local-command-stdout>ok</local-command-stdout>'), '');
  assert.equal(cleanPrompt('fix the bug <system-reminder>secret</system-reminder>'), 'fix the bug');
});

test('channels → doors', () => {
  assert.deepEqual(claudeEntry('cli'), { channel: 'CLI', door: 'cli' });
  assert.equal(claudeEntry('claude-vscode').door, 'ide');
  assert.equal(claudeEntry('sdk-py').door, 'api');
  assert.equal(claudeEntry('remote_desktop').door, 'cloud');
  assert.equal(codexSource('vscode', 'codex_vscode').door, 'ide');
  assert.equal(codexSource('exec').door, 'api');
  assert.equal(doorFor('Cursor'), 'ide');
  assert.equal(doorFor('MCP'), 'mcp');
  assert.equal(doorFor('LangGraph'), 'api');
});
