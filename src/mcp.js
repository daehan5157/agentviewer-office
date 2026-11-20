// `agentviewer mcp` — a tiny stdio MCP server. Add it to any MCP client
// (Claude Desktop, Cursor, Windsurf, VS Code, ChatGPT dev mode, other agents)
// and the client shows up in the office through the MCP door, reporting what
// it is doing via the `agentviewer_report` tool.
import readline from 'node:readline';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const STATES = ['thinking', 'typing', 'reading', 'running', 'web', 'mcp', 'delegating', 'planning', 'waiting', 'done', 'idle'];

const TOOLS = [
  {
    name: 'agentviewer_report',
    title: 'Report current activity',
    description:
      'Report what you are doing right now to the Agentviewer office dashboard. Call it when you start a task, when you switch activity ' +
      '(reading files, writing code, running commands, calling tools, searching the web, waiting for the user) and when you finish.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: STATES, description: 'Current activity category.' },
        task: { type: 'string', description: 'The overall task you are working on (one line).' },
        detail: { type: 'string', description: 'What exactly you are doing at this moment, e.g. "Edit src/app.ts".' },
        tool: { type: 'string', description: 'Tool or command being used, if any.' },
        mcp_server: { type: 'string', description: 'If the action goes through another MCP server, its name.' },
        agent_name: { type: 'string', description: 'Optional display name for this agent.' },
      },
      required: ['state'],
    },
  },
  {
    name: 'agentviewer_list_agents',
    title: 'List agents in the office',
    description: 'List every agent Agentviewer currently sees (any client, CLI, MCP or API) with its state and current task.',
    inputSchema: { type: 'object', properties: {} },
  },
];

export async function runMcpBridge({ url = 'http://127.0.0.1:4747', token = process.env.AGENTVIEWER_TOKEN, name } = {}) {
  let client = { name: 'mcp-client', version: '' };
  const agentId = () => `mcp-${client.name}-${process.ppid}`;
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };

  const post = async (body) => {
    const r = await fetch(`${url}/api/report`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Agentviewer responded ${r.status}`);
    return r.json();
  };
  const report = (extra) =>
    post({
      id: agentId(), name: extra.agent_name || name || client.name, client: client.name, channel: 'MCP', door: 'mcp', via: 'mcp', ttl_seconds: 1800, ...extra,
    });

  const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const reply = (id, result) => out({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => out({ jsonrpc: '2.0', id, error: { code, message } });

  const handle = async (msg) => {
    const { id, method, params } = msg;
    if (method === 'initialize') {
      client = { name: params?.clientInfo?.name || 'mcp-client', version: params?.clientInfo?.version || '' };
      const v = SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
      return reply(id, {
        protocolVersion: v,
        capabilities: { tools: {} },
        serverInfo: { name: 'agentviewer', version: '0.1.0' },
        instructions: 'Use agentviewer_report to tell the Agentviewer office what you are doing whenever your activity changes.',
      });
    }
    if (method === 'notifications/initialized') {
      report({ state: 'done', detail: `MCP 연결됨 (${client.name}${client.version ? ` ${client.version}` : ''})` }).catch(() => {});
      return;
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const args = params?.arguments || {};
      try {
        if (params?.name === 'agentviewer_report') {
          await report(args);
          return reply(id, { content: [{ type: 'text', text: 'reported' }] });
        }
        if (params?.name === 'agentviewer_list_agents') {
          const r = await fetch(`${url}/api/state`, { headers });
          const snap = await r.json();
          const lines = snap.agents.map((a) => `- ${a.name} [${a.client} · ${a.channel}] ${a.state}: ${a.detail || ''}${a.task ? ` | 작업: ${a.task}` : ''}`);
          return reply(id, { content: [{ type: 'text', text: lines.join('\n') || '(no agents)' }] });
        }
        return fail(id, -32602, `unknown tool: ${params?.name}`);
      } catch (err) {
        return reply(id, { isError: true, content: [{ type: 'text', text: `Agentviewer is not reachable at ${url}: ${err.message}` }] });
      }
    }
    if (id !== undefined && id !== null) return fail(id, -32601, `method not found: ${method}`);
  };

  const rl = readline.createInterface({ input: process.stdin });
  const inflight = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      const p = handle(m).catch((e) => process.stderr.write(`agentviewer mcp: ${e.message}\n`));
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }
  });
  await new Promise((resolve) => rl.on('close', resolve));
  await Promise.allSettled([...inflight]);
  await fetch(`${url}/api/agents/${encodeURIComponent(agentId())}`, { method: 'DELETE', headers }).catch(() => {});
}
