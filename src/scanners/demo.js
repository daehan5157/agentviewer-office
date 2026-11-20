// Simulated agents for trying the office without real sessions (--demo).
const S = (state, detail, path, ms, extra = {}) => ({ state, detail, path, ms, ...extra });

const PERSONAS = [
  {
    id: 'demo:api', name: 'api-server', client: 'Claude Code', vendor: 'anthropic', channel: 'CLI', door: 'cli', model: 'claude-opus', branch: 'feat/refresh-token',
    tasks: ['로그인 API에 리프레시 토큰 추가해줘', 'rate limit 미들웨어 테스트 보강'],
    script: [
      S('thinking', '요청 분석 중', '사용자 › 요청', 2500),
      S('reading', 'Read src/routes/auth.ts', '도구 › Read', 2500),
      S('reading', 'Grep "refreshToken"', '도구 › Grep', 2000),
      S('delegating', 'Agent: Explore · 토큰 저장소 구조 조사', '하위 에이전트 › Explore', 9000, { spawn: 'Explore' }),
      S('typing', 'Edit src/routes/auth.ts', '도구 › Edit', 4500),
      S('typing', 'Write src/auth/refresh.ts', '도구 › Write', 3500),
      S('running', '$ npm test -- auth', 'CLI › npm test', 5000),
      S('mcp', 'github › create_pull_request (feat/refresh-token)', 'MCP › github › create_pull_request', 3000, { mcp: 'github' }),
      S('done', '완료 · 다음 요청 대기', '', 12000),
    ],
  },
  {
    id: 'demo:web', name: 'web-app', client: 'Claude Code', vendor: 'anthropic', channel: 'VS Code', door: 'ide', model: 'claude-sonnet', branch: 'main',
    tasks: ['대시보드 카드 컴포넌트 다크모드 지원', '차트 툴팁 겹치는 버그 수정'],
    script: [
      S('thinking', '요청 분석 중', '사용자 › 요청', 2000),
      S('planning', '할 일: 컴포넌트 구조 파악', '계획 › TodoWrite', 2000),
      S('reading', 'Glob src/components/**/*.tsx', '도구 › Glob', 2500),
      S('mcp', 'figma › get_design_context (Dashboard)', 'MCP › figma › get_design_context', 3500, { mcp: 'figma' }),
      S('typing', 'Edit src/components/Card.tsx', '도구 › Edit', 5000),
      S('running', '$ pnpm lint', 'CLI › pnpm lint', 3500),
      S('waiting', '승인 대기? $ pnpm add @radix-ui/react-tooltip', 'CLI › pnpm add', 7000),
      S('running', '$ pnpm add @radix-ui/react-tooltip', 'CLI › pnpm add', 3000),
      S('done', '완료 · 다음 요청 대기', '', 15000),
    ],
  },
  {
    id: 'demo:pay', name: 'payments', client: 'Codex', vendor: 'openai', channel: 'CLI', door: 'cli', model: 'gpt-5-codex', branch: 'fix/webhook-retry',
    tasks: ['웹훅 재시도 로직 버그 찾아서 고쳐줘'],
    script: [
      S('thinking', '작업 시작', '사용자 › 요청', 2500),
      S('reading', '$ rg "retry" -n src/webhooks', 'CLI › rg', 3000),
      S('reading', '$ sed -n 1,120p src/webhooks/handler.py', 'CLI › sed', 2500),
      S('typing', 'Patch handler.py 외 1개', '도구 › apply_patch', 4500),
      S('running', '$ pytest tests/webhooks -q', 'CLI › python -m pytest', 6000),
      S('mcp', 'postgres › query (failed_webhooks)', 'MCP › postgres › query', 2500, { mcp: 'postgres' }),
      S('done', '완료 · 다음 요청 대기', '', 10000),
    ],
  },
  {
    id: 'demo:docs', name: 'docs-site', client: 'Gemini CLI', vendor: 'google', channel: 'CLI', door: 'cli', model: 'gemini-2.5-pro',
    tasks: ['v2 마이그레이션 가이드 문서 작성'],
    script: [
      S('thinking', '요청 분석 중', '사용자 › 요청', 2500),
      S('web', 'Search "breaking changes v2 migration"', 'Web › 검색', 4000),
      S('web', 'Fetch docs.example.com', 'Web › docs.example.com', 3000),
      S('reading', 'Read CHANGELOG.md', '도구 › read_file', 2500),
      S('typing', 'Write docs/migration-v2.md', '도구 › write_file', 6000),
      S('done', '완료 · 다음 요청 대기', '', 12000),
      S('idle', '휴식 중', '', 14000),
    ],
  },
  {
    id: 'demo:cursor', name: 'Cursor', client: 'Cursor', vendor: 'other', channel: 'MCP', door: 'mcp', via: 'mcp',
    tasks: ['이번 스프린트 이슈 정리'],
    script: [
      S('mcp', 'linear › list_issues (Sprint 42)', 'MCP › linear › list_issues', 3500, { mcp: 'linear' }),
      S('thinking', '우선순위 정리 중', '', 3000),
      S('mcp', 'linear › update_issue (ENG-311)', 'MCP › linear › update_issue', 3000, { mcp: 'linear' }),
      S('mcp', 'slack › post_message (#eng)', 'MCP › slack › post_message', 2500, { mcp: 'slack' }),
      S('done', '보고 완료', '', 14000),
    ],
  },
  {
    id: 'demo:crawler', name: 'crawler-bot', client: 'LangGraph', vendor: 'other', channel: 'HTTP API', door: 'api', via: 'api',
    tasks: ['경쟁사 가격 페이지 수집'],
    script: [
      S('web', 'Fetch pricing.competitor.io', 'Web › pricing.competitor.io', 4000),
      S('thinking', '표 파싱 중', '', 3000),
      S('mcp', 'postgres › insert (prices)', 'MCP › postgres › insert', 2500, { mcp: 'postgres' }),
      S('running', '$ python normalize.py', 'CLI › python', 4000),
      S('done', '배치 완료', '', 9000),
    ],
  },
  {
    id: 'demo:infra', name: 'infra', client: 'Claude Code', vendor: 'anthropic', channel: '클라우드', door: 'cloud', model: 'claude-opus', branch: 'ops/staging',
    tasks: ['스테이징 DB 인스턴스 크기 올려줘'],
    script: [
      S('reading', 'Read terraform/staging/db.tf', '도구 › Read', 3000),
      S('typing', 'Edit terraform/staging/db.tf', '도구 › Edit', 3500),
      S('running', '$ terraform plan', 'CLI › terraform plan', 5000),
      S('waiting', '질문: plan 결과대로 apply 할까요?', '사용자 › 질문', 12000),
      S('running', '$ terraform apply -auto-approve', 'CLI › terraform apply', 6000),
      S('done', '완료 · 다음 요청 대기', '', 16000),
    ],
  },
  {
    id: 'demo:orca-lead', name: 'nautilus', client: 'Claude Code', vendor: 'anthropic', channel: 'Orca', door: 'app', model: 'claude-opus', branch: 'feat/checkout-v2',
    orchestrator: 'Orca', orca: { worktree: 'nautilus', worktreeStatus: 'working', pr: 128 },
    tasks: ['결제 플로우 v2 — 작업을 나눠 워커들에게 맡기고 결과 병합'],
    script: [
      S('planning', '작업 분해: API · UI · 테스트', '계획 › TodoWrite', 3500),
      S('running', '$ orca orchestration worker-start --agent codex --worktree new-child', 'CLI › orca orchestration', 3000),
      S('delegating', '워커 2명 진행 상황 확인 중', '하위 에이전트 › orca worker', 9000),
      S('reading', '$ orca orchestration inbox --terminal run:42', 'CLI › orca orchestration', 3000),
      S('typing', 'Edit src/checkout/index.ts', '도구 › Edit', 4000),
      S('done', '워커 결과 병합 완료', '', 10000),
    ],
  },
  {
    id: 'demo:orca-w1', name: 'seahorse', client: 'Codex', vendor: 'openai', channel: 'Orca', door: 'app', model: 'gpt-5-codex', branch: 'checkout-v2-api',
    orchestrator: 'Orca', orca: { worktree: 'seahorse', worktreeStatus: 'working' }, leadId: 'demo:orca-lead',
    tasks: ['[워커] 결제 API 엔드포인트 구현'],
    script: [
      S('reading', '$ rg "PaymentIntent" src', 'CLI › rg', 2500),
      S('typing', 'Patch payments.ts 외 2개', '도구 › apply_patch', 5000),
      S('running', '$ pnpm vitest payments', 'CLI › pnpm vitest', 5000),
      S('waiting', '승인 대기: $ pnpm add stripe', 'CLI › pnpm add', 7000),
      S('running', '$ orca orchestration send --type worker_done', 'CLI › orca orchestration', 2500),
      S('done', '완료 · 리드에게 보고', '', 9000),
    ],
  },
  {
    id: 'demo:orca-w2', name: 'octopus', client: 'Grok CLI', vendor: 'other', channel: 'Orca', door: 'app', branch: 'checkout-v2-ui',
    orchestrator: 'Orca', orca: { worktree: 'octopus', worktreeStatus: 'working' }, leadId: 'demo:orca-lead',
    tasks: ['[워커] 결제 화면 UI'],
    script: [
      S('thinking', '디자인 시안 확인 중', '', 2500),
      S('mcp', 'figma › get_design_context (Checkout)', 'MCP › figma › get_design_context', 3500, { mcp: 'figma' }),
      S('typing', 'Edit src/ui/CheckoutForm.tsx', '도구 › Edit', 6000),
      S('running', '$ pnpm storybook --ci', 'CLI › pnpm storybook', 4000),
      S('done', '완료 · 리드에게 보고', '', 10000),
    ],
  },
  {
    id: 'demo:pipe-collect', name: '수집 워커', client: '내 파이프라인', vendor: 'other', channel: '데이터 파이프라인', door: 'api', via: 'api',
    tasks: ['피드 수집 · 요약 생성 (poll_feed)'],
    script: [
      S('web', '피드 수집 중 · 마지막 확인 2초 전', 'Web › RSS 피드', 5000),
      S('typing', '요약 생성: 신제품 출시 발표 (샘플)', '파이프라인 › 요약', 3000),
      S('web', '피드 수집 중 · 마지막 확인 1초 전', 'Web › RSS 피드', 6000),
      S('typing', '요약 생성: 분기 실적 공개 (샘플)', '파이프라인 › 요약', 3000),
      S('done', '다음 항목 대기', '', 6000),
    ],
  },
  {
    id: 'demo:pipe-review', name: '검토', client: '내 파이프라인', vendor: 'other', channel: '데이터 파이프라인', door: 'api', via: 'api', leadId: 'demo:pipe-collect',
    tasks: ['검토 큐 — 대기 2 · 보류 1'],
    script: [
      S('waiting', '검토 대기 3건 · 최신: 신제품 출시 발표 (샘플)', '파이프라인 › 검토', 9000),
      S('reading', '검토: 승인 · 신제품 출시 발표', '파이프라인 › 검토', 3000),
      S('done', '검토할 항목 없음', '', 7000),
    ],
  },
  {
    id: 'demo:pipe-publish', name: '배포 워커', client: '내 파이프라인', vendor: 'other', channel: '데이터 파이프라인', door: 'api', via: 'api', leadId: 'demo:pipe-collect',
    tasks: ['오늘 배포 14 · 실패 0 · 보류 3'],
    script: [
      S('done', '배포 대기', '', 8000),
      S('running', '배포: 신제품 출시 발표 (샘플)', '파이프라인 › 배포', 3500),
      S('done', '배포 대기', '', 9000),
    ],
  },
  {
    id: 'demo:desk', name: 'Claude 앱', client: 'Claude 앱', vendor: 'anthropic', channel: 'Desktop 앱', door: 'app', via: 'process',
    tasks: ['Claude 앱 실행 중'],
    script: [
      S('idle', 'MCP 연결: slack, github', 'MCP › slack', 25000),
      S('mcp', 'slack › search_messages (배포)', 'MCP › slack › search_messages', 3000, { mcp: 'slack' }),
      S('done', '답변 완료', '', 8000),
    ],
  },
];

const SUB_SCRIPTS = {
  Explore: [
    S('reading', 'Grep "TokenStore"', '도구 › Grep', 2000),
    S('reading', 'Read src/auth/store.ts', '도구 › Read', 2500),
    S('reading', 'Read src/db/schema.sql', '도구 › Read', 2000),
    S('done', '조사 결과 보고', '', 1500),
  ],
};

export class DemoScanner {
  constructor(store) {
    this.store = store;
    this.timers = [];
    store.setScanner('demo', { name: '데모', root: '시뮬레이션', enabled: true, lastScan: Date.now(), error: null });
  }

  start() {
    const s = this.store;
    for (const m of ['github', 'figma', 'linear', 'postgres', 'slack']) s.touchMcp(m, { via: '데모' });
    PERSONAS.forEach((p, i) => {
      const now = Date.now();
      s.upsert(p.id, {
        name: p.name, client: p.client, vendor: p.vendor, channel: p.channel, door: p.door, via: p.via || 'demo',
        model: p.model || '', branch: p.branch || '', project: p.name, sessionShort: p.id.slice(5, 9),
        cwd: p.orchestrator ? `~/orca/workspaces/shop/${p.name}` : `~/work/${p.name}`,
        orchestrator: p.orchestrator, orca: p.orca, leadId: p.leadId, links: p.links,
        task: p.tasks[0], state: 'thinking', detail: '준비 중', startedAt: now - (5 + i * 7) * 60e3, lastActivity: now, ttlMs: 24 * 3600e3,
      });
      this.run(p, (i * 3) % p.script.length, 0);
    });
    this.timers.push(setInterval(() => s.setScanner('demo', { lastScan: Date.now() }), 2000));
  }

  run(p, step, taskIdx) {
    const s = this.store;
    if (!s.get(p.id)) return;
    const st = p.script[step];
    const now = Date.now();
    if (step === 0) {
      const task = p.tasks[taskIdx % p.tasks.length];
      s.upsert(p.id, { task });
      s.activity(p.id, { t: now, text: `요청: ${task}`, path: p.door === 'mcp' ? 'MCP › agentviewer_report' : p.door === 'api' ? 'HTTP › /api/report' : '사용자 › 요청', state: 'thinking' });
    }
    s.upsert(p.id, { state: st.state, detail: st.detail, path: st.path, lastActivity: now });
    if (st.state !== 'idle') s.activity(p.id, { t: now, text: st.detail, path: st.path, state: st.state });
    if (st.mcp) s.pulse(p.id, st.mcp, st.path.split(' › ').pop(), now);
    if (st.spawn) this.spawnSub(p, st.spawn, st.ms);
    const jitter = 0.75 + Math.random() * 0.5;
    const next = (step + 1) % p.script.length;
    const t = setTimeout(() => this.run(p, next, next === 0 ? taskIdx + 1 : taskIdx), st.ms * jitter);
    t.unref?.();
    this.timers.push(t);
  }

  spawnSub(parent, type, budget) {
    const s = this.store;
    const id = `${parent.id}:sub${Date.now() % 100000}`;
    s.upsert(id, {
      name: type, client: parent.client, vendor: parent.vendor, channel: parent.channel, door: parent.door, via: 'demo',
      parentId: parent.id, project: parent.name, task: '토큰 저장소 구조 조사', state: 'thinking', detail: '위임 받음', sessionShort: id.slice(-4),
    });
    s.activity(id, { text: '요청: 토큰 저장소 구조 조사', path: '상위 에이전트 › 위임', state: 'thinking' });
    const steps = SUB_SCRIPTS[type] || [];
    let at = 900;
    for (const st of steps) {
      const t = setTimeout(() => {
        if (!s.get(id)) return;
        s.upsert(id, { state: st.state, detail: st.detail, path: st.path, lastActivity: Date.now() });
        s.activity(id, { text: st.detail, path: st.path, state: st.state });
      }, at);
      t.unref?.();
      this.timers.push(t);
      at += Math.min(st.ms, budget / (steps.length + 1));
    }
    const done = setTimeout(() => s.finish(id), budget - 300);
    done.unref?.();
    this.timers.push(done);
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
  }
}
