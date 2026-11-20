import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { ClaudeScanner } from '../src/scanners/claude.js';
import { CodexScanner } from '../src/scanners/codex.js';
import { GeminiScanner } from '../src/scanners/gemini.js';

const iso = (dt) => new Date(Date.now() - dt).toISOString();
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

test('Claude Code: session + sub-agent, MCP pulse, turn end, live appends', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'av-claude-'));
  const proj = path.join(root, '-Users-me-work-shop');
  await fs.mkdir(path.join(proj, 'sess1', 'subagents'), { recursive: true });
  const base = { sessionId: 'sess1', cwd: '/Users/me/work/shop', gitBranch: 'main', entrypoint: 'claude-vscode', version: '2.1.0' };
  const subPrompt = 'Find where refresh tokens are stored and report back.';
  await fs.writeFile(
    path.join(proj, 'sess1.jsonl'),
    jl([
      { ...base, type: 'user', timestamp: iso(9000), message: { role: 'user', content: '리프레시 토큰 추가해줘' } },
      { ...base, type: 'assistant', timestamp: iso(8000), message: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/Users/me/work/shop/src/auth.ts' } }] } },
      { ...base, type: 'user', timestamp: iso(7500), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { ...base, type: 'assistant', timestamp: iso(7000), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'mcp__github__list_pull_requests', input: { repo: 'shop' } }] } },
      { ...base, type: 'user', timestamp: iso(6500), message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
      { ...base, type: 'assistant', timestamp: iso(6000), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't3', name: 'Agent', input: { description: '토큰 저장소 조사', subagent_type: 'Explore', prompt: subPrompt } }] } },
    ]),
  );
  await fs.writeFile(
    path.join(proj, 'sess1', 'subagents', 'agent-a1.jsonl'),
    jl([
      { ...base, isSidechain: true, type: 'user', timestamp: iso(5900), message: { role: 'user', content: subPrompt } },
      { ...base, isSidechain: true, type: 'assistant', timestamp: iso(5000), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 's1', name: 'Grep', input: { pattern: 'refreshToken' } }] } },
    ]),
  );

  const store = new Store();
  const sc = new ClaudeScanner(store, { root });
  await sc.discover();
  await sc.discover(); // second pass picks up sub-agents of now-tracked sessions

  const main = store.get('claude:sess1');
  assert.ok(main, 'main session tracked');
  assert.equal(main.name, 'shop');
  assert.equal(main.client, 'Claude Code');
  assert.equal(main.door, 'ide');
  assert.equal(main.channel, 'VS Code');
  assert.equal(main.branch, 'main');
  assert.equal(main.task, '리프레시 토큰 추가해줘');
  assert.equal(main.state, 'delegating');
  assert.equal(main.path, '하위 에이전트 › Explore');
  assert.equal(store.mcp.get('github').calls, 1);

  const sub = store.get('claude:sess1:a1');
  assert.ok(sub, 'sub-agent tracked');
  assert.equal(sub.parentId, 'claude:sess1');
  assert.equal(sub.name, 'Explore');
  assert.equal(sub.state, 'reading');

  // live append: sub-agent result comes back, then the turn ends
  await fs.appendFile(
    path.join(proj, 'sess1.jsonl'),
    jl([
      { ...base, type: 'user', timestamp: iso(1000), message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'done' }] } },
      { ...base, type: 'assistant', timestamp: iso(500), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '다 했어요' }] } },
    ]),
  );
  await sc.poll();
  assert.equal(store.get('claude:sess1').state, 'done');
  assert.ok(store.get('claude:sess1:a1').finishedAt, 'sub-agent finished when its Agent call returned');
  assert.ok(store.feed.some((f) => f.path === 'MCP › github › list_pull_requests'));
});

test('Claude Code: silent pending tool → waiting (likely permission prompt)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'av-claude-'));
  const proj = path.join(root, '-tmp-x');
  await fs.mkdir(proj, { recursive: true });
  const base = { sessionId: 's2', cwd: '/tmp/x', entrypoint: 'cli', permissionMode: 'default' };
  await fs.writeFile(
    path.join(proj, 's2.jsonl'),
    jl([
      { ...base, type: 'user', timestamp: iso(30000), message: { content: 'edit it' } },
      { ...base, type: 'assistant', timestamp: iso(20000), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/tmp/x/a.txt' } }] } },
    ]),
  );
  const last = new Date(Date.now() - 20000);
  await fs.utimes(path.join(proj, 's2.jsonl'), last, last); // nothing written since the tool call
  const store = new Store();
  const sc = new ClaudeScanner(store, { root });
  await sc.discover();
  const a = store.get('claude:s2');
  assert.equal(a.state, 'waiting');
  assert.match(a.detail, /승인 대기\? Write a\.txt/);
});

test('Codex rollout: meta, prompt, shell, patch, MCP, task_complete', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'av-codex-'));
  const d = new Date();
  const day = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  await fs.mkdir(day, { recursive: true });
  const file = path.join(day, 'rollout-2026-11-16T10-00-00-0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000.jsonl');
  await fs.writeFile(
    file,
    jl([
      { timestamp: iso(9000), type: 'session_meta', payload: { id: '0199aaaa', cwd: '/Users/me/pay', originator: 'codex_vscode', source: 'vscode', cli_version: '0.60.0', git: { branch: 'fix/retry' } } },
      { timestamp: iso(8900), type: 'turn_context', payload: { model: 'gpt-5-codex', approval_policy: 'on-request' } },
      { timestamp: iso(8800), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
      { timestamp: iso(8700), type: 'event_msg', payload: { type: 'user_message', message: '웹훅 재시도 버그 고쳐줘' } },
      { timestamp: iso(8000), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'rg retry'] }), call_id: 'c1' } },
      { timestamp: iso(7900), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: '...' } },
      { timestamp: iso(7000), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: src/hook.py\n*** End Patch', call_id: 'c2' } },
      { timestamp: iso(6900), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c2', output: 'ok' } },
      { timestamp: iso(6000), type: 'event_msg', payload: { type: 'mcp_tool_call_begin', call_id: 'c3', invocation: { server: 'postgres', tool: 'query', arguments: {} } } },
    ]),
  );
  const store = new Store();
  const sc = new CodexScanner(store, { root });
  await sc.discover();
  const id = [...store.agents.keys()].find((k) => k.startsWith('codex:'));
  const a = store.get(id);
  assert.equal(a.client, 'Codex');
  assert.equal(a.name, 'pay');
  assert.equal(a.door, 'ide');
  assert.equal(a.model, 'gpt-5-codex');
  assert.equal(a.task, '웹훅 재시도 버그 고쳐줘');
  assert.equal(a.state, 'mcp');
  assert.equal(store.mcp.get('postgres').calls, 1);
  assert.ok(a.log.some((l) => l.text === 'Patch hook.py'));
  assert.ok(a.log.some((l) => l.path === 'CLI › rg'));

  await fs.appendFile(file, jl([
    { timestamp: iso(1000), type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'c3' } },
    { timestamp: iso(500), type: 'event_msg', payload: { type: 'task_complete' } },
  ]));
  await sc.poll();
  assert.equal(store.get(id).state, 'done');
});

test('Gemini CLI chat file: running tool, approvals, completion', () => {
  const store = new Store();
  const sc = new GeminiScanner(store, { root: '/nonexistent' });
  const f = { id: 'gemini:abc123', seen: new Set(), first: true };
  const now = Date.now();
  const msgs = [
    { id: 'm1', type: 'user', timestamp: new Date(now - 5000).toISOString(), content: 'v2 마이그레이션 문서 써줘' },
    { id: 'm2', type: 'gemini', timestamp: new Date(now - 3000).toISOString(), content: '', model: 'gemini-2.5-pro', toolCalls: [{ id: 'tc1', name: 'google_web_search', args: { query: 'v2 breaking changes' }, status: 'executing' }] },
  ];
  sc.apply(f, { sessionId: 'abc123', messages: msgs }, { cwd: '/Users/me/docs-site' });
  let a = store.get('gemini:abc123');
  assert.equal(a.name, 'docs-site');
  assert.equal(a.state, 'web');
  assert.equal(a.task, 'v2 마이그레이션 문서 써줘');
  assert.equal(a.model, 'gemini-2.5-pro');

  msgs[1].toolCalls[0].status = 'success';
  msgs.push({ id: 'm3', type: 'gemini', timestamp: new Date().toISOString(), content: '', toolCalls: [{ id: 'tc2', name: 'write_file', args: { file_path: 'docs/v2.md' }, status: 'awaiting_approval' }] });
  sc.apply(f, { sessionId: 'abc123', messages: msgs }, { cwd: '/Users/me/docs-site' });
  a = store.get('gemini:abc123');
  assert.equal(a.state, 'waiting');

  msgs[2].toolCalls[0].status = 'success';
  msgs.push({ id: 'm4', type: 'gemini', timestamp: new Date().toISOString(), content: '문서를 작성했어요.' });
  sc.apply(f, { sessionId: 'abc123', messages: msgs }, { cwd: '/Users/me/docs-site' });
  assert.equal(store.get('gemini:abc123').state, 'done');
});
