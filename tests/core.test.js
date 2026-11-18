import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assessClosure,
  buildIssueProjection,
  buildIssuePrompt,
  createLogBuffer,
  buildSessionTitle,
  buildWorkspaceOverview,
  discussionsApiPath,
  isIssueItem,
  issueApiPath,
  normalizeIssue,
  normalizeStoredIssue,
  parseClosureReport,
  pruneHandled,
  defaultSettings,
  initialState,
  normalizeState,
  publicState,
  validateSettings,
  initialLeaderState,
} from '../core.js';
import { defaultStorageDirectory, GitlabTodoRuntime, resolveDshHome } from '../index.js';

test('state normalization migrates the legacy shared session cwd to issue sessions', () => {
  const base = initialState();
  base.settings.sessionCwd = 'D:\\legacy\\workspace';
  delete base.settings.issueSessionCwd;
  delete base.settings.issueSessionModel;
  const state = normalizeState(JSON.parse(JSON.stringify(base)));
  assert.equal(state.settings.issueSessionCwd, 'D:\\legacy\\workspace');
  assert.equal(state.settings.issueSessionModel, null);
});

test('buildWorkspaceOverview groups roster sessions by cwd with prefix fallback and unassigned bucket', () => {
  const overview = buildWorkspaceOverview(
    [
      { id: 'w1', path: 'D:\\agent-workspace', title: 'Agent', sessionIds: ['s1', 's3', 's9'], updatedAt: '2026-01-02T00:00:00Z' },
      { id: 'w2', path: 'D:\\work\\repo', sessionIds: [] },
    ],
    [
      // 精确命中工作区根。
      { sessionId: 's1', running: true, updatedAt: 300, cwd: 'D:\\agent-workspace' },
      // 工作区子目录：最长前缀归入 w1。
      { sessionId: 's2', running: false, updatedAt: 500, cwd: 'D:\\agent-workspace\\sub\\repo' },
      // 不属于任何工作区 → 未归属桶。
      { sessionId: 's5', running: false, updatedAt: 700, cwd: 'E:\\elsewhere' },
      // 无 cwd → 未归属桶。
      { sessionId: 's6', running: false, updatedAt: 900, cwd: '' },
      // 空白草稿不展示。
      { sessionId: 's7', running: false, updatedAt: 800, blank: true },
    ],
    [{ sessionId: 's2', sessionTitle: '[协助]-issue-1', automatic: true, archived: true, url: 'https://gitlab.local/i/1' }],
    'd:/agent-workspace/',
  );
  assert.equal(overview.length, 3);
  const [w1, w2, unassigned] = overview;
  assert.equal(w1.workspaceId, 'w1');
  assert.equal(w1.title, 'Agent');
  // 配置路径比较忽略大小写、正反斜杠与结尾分隔符。
  assert.equal(w1.configured, true);
  assert.equal(w2.configured, false);
  // 名册（s1、s2）+ 注册表补充（s3、s9，known=false）；按 updatedAt 倒序。
  assert.equal(w1.sessionCount, 4);
  assert.deepEqual(w1.sessions.map((s) => s.sessionId), ['s2', 's1', 's3', 's9']);
  assert.equal(w1.sessions[0].plugin, true);
  assert.equal(w1.sessions[0].sessionTitle, '[协助]-issue-1');
  assert.equal(w1.sessions[0].archived, true);
  assert.equal(w1.sessions[0].cwd, 'D:\\agent-workspace\\sub\\repo');
  assert.equal(w1.sessions[1].running, true);
  assert.equal(w1.sessions[2].known, false);
  assert.equal(w1.sessions[2].updatedAt, null);
  assert.equal(w2.sessionCount, 0);
  // 未归属桶：无 cwd 的 s6 与 cwd 命不中任何工作区的 s5；空白草稿 s7 被过滤。
  assert.equal(unassigned.unassigned, true);
  assert.equal(unassigned.sessionCount, 2);
  assert.deepEqual(unassigned.sessions.map((s) => s.sessionId), ['s6', 's5']);
});

function runtimeWithPrompt(prompt, options = {}) {
  const sessions = new Map();
  const calls = {
    create: 0,
    prompt: 0,
    createRequests: [],
    modelSelections: [],
    renames: [],
    invocations: [],
    archives: [],
    unarchives: [],
    failArchive: false,
    failUnarchive: false,
    sessions,
    failList: false,
    listRequests: [],
    listResponses: null,
  };
  const autoComplete = options.autoComplete !== false;
  // finalText：回合最后一条助手消息（可带 [TODO-CLOSURE] 结案报告）。
  const complete = (sessionId, kind = 'completed', finalText = '') => {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.running = false;
    if (finalText) {
      session.events.push({
        type: 'assistant/message',
        seq: session.events.length + 1,
        time: Date.now(),
        data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: finalText }] } },
      });
    }
    session.events.push({
      type: 'turn/end',
      seq: session.events.length + 1,
      time: Date.now(),
      data: { reason: { kind } },
    });
  };
  calls.complete = complete;
  const catalog = {
    default: { provider: 'deepseek', model: 'deepseek-chat' },
    routableProviders: ['deepseek'],
    groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
    failures: [],
  };
  const gateway = {
    async invoke(call) {
      calls.invocations.push(call);
      assert.equal(call.peer.principal.kind, 'owner');
      if (call.namespace === 'workspace') {
        assert.ok(['archiveSession', 'unarchiveSession'].includes(call.method));
        assert.deepEqual(call.args, { request: { sessionId: call.args.request.sessionId } });
        if (call.method === 'unarchiveSession') {
          if (calls.failUnarchive) throw new Error('unarchive unavailable');
          calls.unarchives.push(call.args.request.sessionId);
          return { archivedSessionIds: [] };
        }
        if (calls.failArchive) throw new Error('workspace/session-active');
        calls.archives.push(call.args.request.sessionId);
        return { archivedSessionIds: [call.args.request.sessionId] };
      }
      assert.equal(call.namespace, 'session');
      const { method, args } = call;
      if (method === 'modelCatalog') {
        assert.deepEqual(args, {});
        return catalog;
      }
      if (method === 'list') {
        calls.listRequests.push(args._request ?? {});
        if (Array.isArray(calls.listResponses) && calls.listResponses.length > 0) {
          return calls.listResponses.shift();
        }
        if (calls.failList) throw new Error('roster unavailable');
        return {
          items: [...sessions.entries()].map(([sessionId, session]) => ({
            sessionId,
            running: session.running,
            title: undefined,
            projections: { values: { title: session.title } },
            origin: session.origin,
            cwd: session.cwd,
            updatedAt: session.updatedAt,
            blank: session.blank,
            parentSessionId: session.parentSessionId,
            isSubagent: session.isSubagent,
            archived: session.archived,
          })),
        };
      }
      const request = args.request;
      if (method === 'create') {
        calls.create += 1;
        calls.createRequests.push(request);
        const sessionId = `session-${calls.create}`;
        sessions.set(sessionId, { running: false, events: [] });
        return { sessionId };
      }
      if (method === 'projections') {
        if (calls.failProjections) throw new Error('projection unavailable');
        if (calls.projectionResponse !== undefined) return calls.projectionResponse;
        const session = sessions.get(request.sessionId);
        return session ? { kind: 'sequenced', asOfSeq: session.events.length, values: { title: session.title } } : null;
      }
      if (method === 'rename') {
        calls.renames.push(request);
        sessions.get(request.sessionId).title = request.title;
        return { title: request.title, seq: 1 };
      }
      if (method === 'selectModel') {
        calls.modelSelections.push(request);
        return { selected: request };
      }
      if (method === 'prompt') {
        calls.prompt += 1;
        const session = sessions.get(request.sessionId);
        // 真实 Host 会把 prompt requestId 持久化为 user/message.source.rpcId；
        // 插件据此在多 Todo 共用会话时定位各自回合。
        session.events.push({
          type: 'user/message',
          seq: session.events.length + 1,
          time: Date.now(),
          data: { source: { kind: 'user', rpcId: request.requestId }, message: { role: 'user', content: request.content } },
        });
        session.running = true;
        try {
          const result = await prompt(request, call.signal);
          if (autoComplete) complete(request.sessionId);
          return result;
        } catch (error) {
          session.running = false;
          throw error;
        }
      }
      if (method === 'page') {
        const session = sessions.get(request.address.sessionId);
        return {
          records: (session?.events ?? []).map((event) => ({ type: 'event', event })),
          hasMore: false,
        };
      }
      throw new Error(`unexpected session method: ${method}`);
    },
    async stream(call) {
      assert.equal(call.peer.principal.kind, 'owner');
      assert.equal(call.method, 'follow');
      const session = sessions.get(call.args.request.address.sessionId);
      const events = session?.events ?? [];
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'snapshot',
            cursor: events.at(-1)?.seq ?? 0,
            records: events.map((event) => ({ type: 'event', event })),
            hasMore: false,
          };
        },
      };
    },
  };
  const ctx = {
    typertGateway: gateway,
    workspaceRegistry: {
      list: () => [
        { id: 'workspace-default', path: 'D:\\agent-workspace', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'workspace-work', path: 'D:\\work\\repo', updatedAt: '2026-01-02T00:00:00Z' },
      ],
    },
    logger: { warn() {} },
  };
  const runtime = new GitlabTodoRuntime(ctx);
  runtime.state = initialState();
  // 旧用例验证“一新 Todo 一新会话”的基线行为；路由专项用例自行开启。
  runtime.state.settings.autoRoute = false;
  // 预检默认引擎是 auto（Jev 优先）：测试环境可能真的装了 jev CLI，
  // 不锁死为 llm 会让依赖真实环境的结果不确定；Jev 路径由专项用例自行指定。
  runtime.state.settings.precheckEngine = 'llm';
  runtime.gitlabUserId = '106';
  runtime.gitlabUsername = 'me';
  runtime.persistQuietly = async () => {};
  // 测试里绝不调用真实 glab：需要 GitLab 数据的用例各自覆盖 runGlab / fetchTodos。
  runtime.runGlab = async () => { throw new Error('glab is disabled in tests'); };
  return { runtime, calls };
}

test('bridge no longer serves the handled tab while archive toggling remains', async () => {
  const { runtime, calls } = runtimeWithPrompt(async () => ({ accepted: true }), { autoComplete: false });
  // Todo 会话由台账管理；归档切换只作用于 handled 里的 Issue 会话，这里直接播种一条已归档的 Issue 记录。
  const issue = normalizeIssue(gitlabIssue);
  runtime.state.handled[issue.id] = {
    id: issue.id, sessionId: 'session-1', acceptedAt: 1, executionStatus: 'completed', archived: true,
    automatic: false, title: issue.title, url: issue.url, project: '',
  };
  calls.sessions.set('session-1', { running: false, events: [] });
  for (let index = 0; index < 31; index += 1) {
    runtime.state.handled[`hist-${index}`] = {
      id: `hist-${index}`, sessionId: `hist-session-${index}`, acceptedAt: 100 + index,
      executionStatus: 'completed', automatic: true, title: `H${index}`, url: '', project: '',
    };
  }
  const post = (payload) => runtime.handleFetch(new Request('http://127.0.0.1/api/gitlab-todo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  // v2.41：已处理 Tab 及其 bridge action 已移除；handled 账本仍保留用于 Issue 映射。
  const removed = await post({ action: 'handled', offset: 0, limit: 30 });
  assert.equal(removed.status, 400);
  assert.equal(Object.keys(runtime.state.handled).length, 32);

  // 归档切换：完成态会话可归档、可取消归档；状态随持久化记录保留。
  const restore = await (await post({ action: 'setSessionArchived', sessionId: 'session-1', archived: false })).json();
  assert.equal(restore.ok, true);
  assert.deepEqual(calls.unarchives, ['session-1']);
  assert.equal(runtime.state.handled[issue.id].archived, false);
  const rearchive = await (await post({ action: 'setSessionArchived', sessionId: 'session-1', archived: true })).json();
  assert.equal(rearchive.ok, true);
  assert.equal(runtime.state.handled[issue.id].archived, true);
  // 非插件会话拒绝；执行中的插件会话拒绝归档。
  const foreign = await (await post({ action: 'setSessionArchived', sessionId: 'not-mine', archived: true })).json();
  assert.equal(foreign.ok, true);
  assert.equal(foreign.result.ok, false);
  const busy = runtimeWithPrompt(async () => ({ accepted: true }), { autoComplete: false });
  busy.runtime.state.issues = [issue];
  await busy.runtime.dispatchById(issue.id);
  const busyResponse = await busy.runtime.handleFetch(new Request('http://127.0.0.1/api/gitlab-todo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'setSessionArchived', sessionId: 'session-1', archived: true }),
  }));
  const running = await busyResponse.json();
  assert.equal(running.result.ok, false);
  assert.match(running.result.error, /仍在执行/);
  await runtime.stop();
  await busy.runtime.stop();
});

test('fetch handler returns state and validates settings updates', async () => {
  const { runtime } = runtimeWithPrompt(async () => ({ accepted: true }));
  const stateResponse = await runtime.handleFetch(new Request('http://127.0.0.1/api/gitlab-todo-agent?action=state'));
  assert.equal(stateResponse.status, 200);
  const stateBody = await stateResponse.json();
  assert.equal(stateBody.ok, true);
  assert.equal('scriptPath' in stateBody.state.storage, false);

  const modelsResponse = await runtime.handleFetch(new Request('http://127.0.0.1/api/gitlab-todo-agent?action=models'));
  const modelsBody = await modelsResponse.json();
  assert.equal(modelsResponse.status, 200);
  assert.equal(modelsBody.catalog.groups[0].models[0].id, 'deepseek-chat');

  const modelsPostResponse = await runtime.handleFetch(new Request('http://127.0.0.1/api/gitlab-todo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'models' }),
  }));
  assert.equal(modelsPostResponse.status, 200);
  assert.equal((await modelsPostResponse.json()).catalog.groups[0].models[0].id, 'deepseek-chat');

  const workspacesResponse = await runtime.handleFetch(new Request('http://127.0.0.1/api/gitlab-todo-agent?action=workspaces'));
  assert.equal(workspacesResponse.status, 200);
  const workspacesBody = await workspacesResponse.json();
  assert.equal(workspacesBody.ok, true);
  assert.equal(workspacesBody.workspaces.length, 2);
  assert.equal(workspacesBody.workspaces[0].workspaceId, 'workspace-default');
  assert.equal(workspacesBody.workspaces[0].sessionCount, 0);
  assert.equal(workspacesBody.workspaces[1].workspaceId, 'workspace-work');

  const workspacesPostResponse = await runtime.handleFetch(new Request('http://127.0.0.1/api/gitlab-todo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'workspaces' }),
  }));
  assert.equal(workspacesPostResponse.status, 200);
  assert.equal((await workspacesPostResponse.json()).workspaces.length, 2);

  const updateResponse = await runtime.handleFetch(new Request('http://127.0.0.1/api/gitlab-todo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'updateSettings', settings: { maxConcurrentSessions: 3 } }),
  }));
  const updateBody = await updateResponse.json();
  assert.equal(updateBody.state.settings.maxConcurrentSessions, 3);

  const badResponse = await runtime.handleFetch(new Request('http://127.0.0.1/api/gitlab-todo-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'updateSettings', settings: { maxConcurrentSessions: 0 } }),
  }));
  assert.equal(badResponse.status, 400);
});

test('workspace overview survives roster failures and tags plugin sessions', async () => {
  const { runtime, calls } = runtimeWithPrompt(async () => ({ accepted: true }));
  const result = await runtime.dispatch(normalizeIssue(gitlabIssue));
  assert.equal(result.ok, true);
  runtime.ctx.workspaceRegistry.list = () => [
    { id: 'w1', path: 'D:\\agent-workspace', title: 'Agent', sessionIds: ['session-1', 'other-1'] },
  ];
  // 名册带 cwd：插件会话与非插件会话都应出现在对应工作区下。
  runtime.host.listSessions = async () => ({
    items: [
      { sessionId: 'session-1', running: false, updatedAt: 5, cwd: 'D:\\agent-workspace' },
      { sessionId: 'other-1', running: false, updatedAt: 9, cwd: 'D:\\agent-workspace\\repo' },
    ],
  });
  const overview = await runtime.workspaceOverview();
  assert.equal(overview.length, 1);
  assert.equal(overview[0].configured, false);
  assert.equal(overview[0].sessionCount, 2);
  const [otherSession, pluginSession] = overview[0].sessions;
  assert.equal(otherSession.sessionId, 'other-1');
  assert.equal(otherSession.plugin, false);
  assert.equal(pluginSession.sessionId, 'session-1');
  assert.equal(pluginSession.plugin, true);
  assert.equal(pluginSession.sessionTitle, 'ISSUE-project #42');

  // 名册整体不可用：降级为注册表补充（known=false），插件标记保留。
  runtime.host.listSessions = async () => { throw new Error('roster unavailable'); };
  const degraded = await runtime.workspaceOverview();
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0].sessionCount, 2);
  assert.equal(degraded[0].sessions.every((session) => session.known === false), true);
  assert.equal(degraded[0].sessions.some((session) => session.plugin), true);
  assert.equal(calls.create, 1);
  await runtime.stop();
});

test('listSessions follows pagination cursors to enumerate all stored sessions', async () => {
  const { runtime, calls } = runtimeWithPrompt(async () => ({ accepted: true }));
  calls.listResponses = [
    { items: [{ sessionId: 'a', running: false }], cursor: 'page-2' },
    { items: [{ sessionId: 'b', running: true }], cursor: 'page-3' },
    { items: [{ sessionId: 'c', running: false }] },
  ];
  const roster = await runtime.host.listSessions();
  assert.deepEqual(roster.items.map((item) => item.sessionId), ['a', 'b', 'c']);
  assert.deepEqual(calls.listRequests, [{}, { cursor: 'page-2' }, { cursor: 'page-3' }]);
  await runtime.stop();
});

// ---- 闭环机制 ----

test('settings validation covers the follow-up controls', () => {
  const next = validateSettings({ followUpEnabled: false, maxFollowUps: 0, followUpDelayMinutes: 60 });
  assert.equal(next.followUpEnabled, false);
  assert.equal(next.maxFollowUps, 0);
  assert.equal(next.followUpDelayMinutes, 60);
  assert.equal(defaultSettings().followUpEnabled, true);
  assert.equal(defaultSettings().maxFollowUps, 3);
  assert.throws(() => validateSettings({ maxFollowUps: 11 }), /自动续办轮数上限/);
  assert.throws(() => validateSettings({ followUpDelayMinutes: 0 }), /续办等待时间/);
  assert.throws(() => validateSettings({ followUpEnabled: 'yes' }), /必须是布尔值/);
});

test('default storage follows DSH_HOME/storages like other DSH plugins', () => {
  assert.equal(defaultStorageDirectory({}), join(homedir(), '.dsh', 'storages', 'gitlab-workstation'));
  assert.equal(defaultStorageDirectory({ DSH_HOME: '   ' }), join(homedir(), '.dsh', 'storages', 'gitlab-workstation'));
  assert.equal(defaultStorageDirectory({ DSH_HOME: '~/custom-dsh' }), join(homedir(), 'custom-dsh', 'storages', 'gitlab-workstation'));
  const absolute = join(tmpdir(), 'dsh-home');
  assert.equal(defaultStorageDirectory({ DSH_HOME: ` ${absolute} ` }), join(absolute, 'storages', 'gitlab-workstation'));
  assert.equal(resolveDshHome({ DSH_HOME: absolute }), absolute);
});

function migrationRuntime(target, legacy, config = {}) {
  const logs = [];
  const runtime = new GitlabTodoRuntime({ logger: { info: (message) => logs.push(message), warn() {} } }, config);
  runtime.defaultStorage = target;
  runtime.legacyStorageDirectory = () => legacy;
  return { runtime, logs };
}

test('first start copies legacy data into the new directory and keeps the legacy files', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-migrate-'));
  const legacy = join(root, 'legacy'); const target = join(root, 'dsh', 'storages', 'gitlab-workstation');
  try {
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'state.json'), '{"old":"state"}', 'utf8');
    await writeFile(join(legacy, 'leader.json'), '{"old":"leader"}', 'utf8');
    const { runtime, logs } = migrationRuntime(target, legacy);
    await runtime.ensureStorage();
    assert.equal(await readFile(join(target, 'state.json'), 'utf8'), '{"old":"state"}');
    assert.equal(await readFile(join(target, 'leader.json'), 'utf8'), '{"old":"leader"}');
    assert.equal(await readFile(join(legacy, 'state.json'), 'utf8'), '{"old":"state"}');
    assert.equal(await readFile(join(legacy, 'leader.json'), 'utf8'), '{"old":"leader"}');
    assert.equal(logs.length, 1); assert.match(logs[0], /state\.json、leader\.json/); assert.match(logs[0], /旧目录保留/);
    assert.deepEqual((await readdir(target)).sort(), ['leader.json', 'state.json']);
    // Memoized: a second call does no more work.
    await runtime.ensureStorage(); assert.equal(logs.length, 1);
    // A later runtime never overwrites data already in the new directory.
    await writeFile(join(target, 'state.json'), '{"new":"state"}', 'utf8');
    await writeFile(join(legacy, 'state.json'), '{"stale":"state"}', 'utf8');
    const later = migrationRuntime(target, legacy);
    await later.runtime.ensureStorage();
    assert.equal(await readFile(join(target, 'state.json'), 'utf8'), '{"new":"state"}');
    assert.equal(later.logs.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('migration copies only missing files and skips absent legacy data', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-migrate-'));
  const legacy = join(root, 'legacy'); const target = join(root, 'target');
  try {
    await mkdir(legacy, { recursive: true }); await mkdir(target, { recursive: true });
    await writeFile(join(legacy, 'state.json'), '{"old":"state"}', 'utf8');
    await writeFile(join(target, 'leader.json'), '{"current":"leader"}', 'utf8');
    const { runtime, logs } = migrationRuntime(target, legacy);
    await runtime.ensureStorage();
    assert.equal(await readFile(join(target, 'state.json'), 'utf8'), '{"old":"state"}');
    assert.equal(await readFile(join(target, 'leader.json'), 'utf8'), '{"current":"leader"}');
    assert.equal(logs.length, 1); assert.doesNotMatch(logs[0], /leader\.json/);
    const fresh = migrationRuntime(join(root, 'fresh'), join(root, 'missing-legacy'));
    await fresh.runtime.ensureStorage();
    assert.deepEqual(await readdir(join(root, 'fresh')), []);
    assert.equal(fresh.logs.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an explicit storageDirectory is used as-is and never receives legacy data', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-migrate-'));
  const legacy = join(root, 'legacy'); const configured = join(root, 'configured');
  try {
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'state.json'), '{"old":"state"}', 'utf8');
    const { runtime, logs } = migrationRuntime(join(root, 'unused'), legacy, { storageDirectory: configured });
    assert.equal(runtime.storageDirectory(), configured);
    await runtime.ensureStorage();
    assert.deepEqual(await readdir(configured), []);
    assert.equal(logs.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed migration leaves legacy data untouched and retries on the next call', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-migrate-'));
  const legacy = join(root, 'legacy'); const target = join(root, 'target');
  try {
    // A directory named state.json makes copyFile fail with a non-ENOENT error.
    await mkdir(join(legacy, 'state.json'), { recursive: true });
    const { runtime } = migrationRuntime(target, legacy);
    await assert.rejects(runtime.ensureStorage(), /迁移插件数据 state\.json 失败（旧文件未改动）/);
    assert.deepEqual(await readdir(target), []);
    await rm(join(legacy, 'state.json'), { recursive: true, force: true });
    await writeFile(join(legacy, 'state.json'), '{"old":"state"}', 'utf8');
    await runtime.ensureStorage();
    assert.equal(await readFile(join(target, 'state.json'), 'utf8'), '{"old":"state"}');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Leader journal load migrates storage first even before runtime start', async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-migrate-'));
  const legacy = join(root, 'legacy'); const target = join(root, 'target');
  try {
    await mkdir(legacy, { recursive: true });
    const journal = initialLeaderState(); journal.sessionId = 'session-leader'; journal.phase = 'paused';
    await writeFile(join(legacy, 'leader.json'), JSON.stringify(journal), 'utf8');
    const { runtime } = migrationRuntime(target, legacy);
    runtime.workspaceRegistry = { archivedSessionIds: [] };
    await runtime.loadLeader();
    assert.equal(runtime.leaderState.sessionId, 'session-leader');
    assert.equal(JSON.parse(await readFile(join(legacy, 'leader.json'), 'utf8')).sessionId, 'session-leader');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('v5 states migrate to v8 and Issue record fields survive round-trips', () => {
  const base = initialState();
  base.version = 5;
  const mrUrl = 'https://gitlab.local/g/p/-/merge_requests/3';
  base.handled['issue-1-1'] = {
    id: 'issue-1-1', sessionId: 's1', acceptedAt: 10, url: 'https://gitlab.local/g/p/-/issues/1',
    lastReply: { id: '99', body: '已处理，见 MR', url: 'https://gitlab.local/g/p/-/issues/1#note_99', createdAt: 20 },
    watch: { mrs: [mrUrl], lastStates: { [mrUrl]: 'running' } },
    acknowledgedAt: 30,
  };
  // v7 起 Todo 记录由台账接管：非 Issue 的 handled 记录迁移后被丢弃。
  base.handled.todoX = { id: 'todoX', sessionId: 's2', acceptedAt: 10, url: 'https://gitlab.local/g/p/-/issues/2#note_1' };
  const migrated = normalizeState(JSON.parse(JSON.stringify(base)));
  assert.equal(migrated.version, 8);
  assert.equal(migrated.handled.todoX, undefined);
  assert.equal(migrated.handled['issue-1-1'].taskType, undefined);
  assert.equal(migrated.handled['issue-1-1'].lastReply.body, '已处理，见 MR');
  assert.equal(migrated.handled['issue-1-1'].watch.mrs[0], mrUrl);
  assert.equal(migrated.handled['issue-1-1'].watch.lastStates[mrUrl], 'running');
  assert.equal(migrated.handled['issue-1-1'].acknowledgedAt, 30);
  // 坏字段归位：空 watch / 空回复归 null；旧记录的 taskType 字段在新版本中被丢弃。
  const dirty = normalizeState(JSON.parse(JSON.stringify({
    ...migrated,
    handled: { ...migrated.handled, y: { ...migrated.handled['issue-1-1'], id: 'y', taskType: 'bogus', watch: { mrs: [] }, lastReply: { body: '' } } },
  })));
  assert.equal(dirty.handled.y.watch, null);
  assert.equal(dirty.handled.y.lastReply, null);
});

test('handled GC drops settled records past retention and caps the survivors', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const mk = (over = {}) => ({
    id: 'x', sessionId: 's', outcome: 'session-accepted',
    acceptedAt: now - 10 * day, completedAt: now - 5 * day,
    closure: 'closed', ...over,
  });
  const handled = {
    // 过期 closed（completedAt 91 天）→ 删
    oldClosed: mk({ id: 'oldClosed', completedAt: now - 91 * day }),
    // 未过期 closed → 保留
    freshClosed: mk({ id: 'freshClosed', completedAt: now - 10 * day }),
    // 过期 rule-skipped（acceptedAt 31 天，无 completedAt 时按 acceptedAt）→ 删
    oldSkipped: mk({ id: 'oldSkipped', outcome: 'rule-skipped', completedAt: null, acceptedAt: now - 91 * day, closure: 'closed' }),
    // 活跃记录永不删：follow-up 哪怕很旧也留
    activeFollowUp: mk({ id: 'activeFollowUp', closure: 'follow-up', completedAt: null, nextAttemptAt: now + day, acceptedAt: now - 200 * day }),
    // 未确认的 needs-human 永不删（哪怕 completedAt 很旧）
    openNeedsHuman: mk({ id: 'openNeedsHuman', closure: 'needs-human', acknowledgedAt: null, completedAt: now - 200 * day }),
    // 已确认 needs-human 过期（acknowledgedAt 91 天）→ 删
    ackedNeedsHuman: mk({ id: 'ackedNeedsHuman', closure: 'needs-human', acknowledgedAt: now - 91 * day, completedAt: now - 200 * day }),
    // pendingUnconfirmed 永不删
    pendingOld: mk({ id: 'pendingOld', pendingUnconfirmed: true, closure: 'needs-human', acknowledgedAt: now - 200 * day }),
  };
  const first = pruneHandled(handled);
  assert.deepEqual(first.deleted.sort(), ['ackedNeedsHuman', 'oldClosed', 'oldSkipped'].sort());
  for (const id of first.deleted) delete handled[id];
  assert.equal(handled.freshClosed.closure, 'closed');
  assert.equal(handled.activeFollowUp.closure, 'follow-up');
  assert.equal(handled.openNeedsHuman.closure, 'needs-human');
  assert.equal(handled.pendingOld.pendingUnconfirmed, true);

  // 上限：再补 505 条新鲜 closed，已结算总数 507 > 500，按结算时间删最旧 7 条。
  const many = {};
  for (let i = 0; i < 505; i += 1) {
    many[`c${i}`] = mk({ id: `c${i}`, completedAt: now - i * 1000 });
  }
  const capped = pruneHandled({ ...handled, ...many });
  // HANDLED_SETTLED_MAX=500 只约束已结算记录，活跃记录不占名额。\n  assert.equal(505 + 1 - capped.deleted.length, 500);
});

test('settings validation accepts the follow-up reuse switch', () => {
  assert.equal(defaultSettings().followUpReuseSession, true);
  const next = validateSettings({ followUpReuseSession: false }, defaultSettings());
  assert.equal(next.followUpReuseSession, false);
  assert.throws(() => validateSettings({ followUpReuseSession: 'yes' }, defaultSettings()), /布尔/);
});

// ---- Jev/System One 预检 ----

const gitlabIssue = {
  id: 555001,
  iid: 42,
  project_id: 555,
  title: 'Implement the feature flag',
  description: 'Please wire the flag into the pipeline.',
  state: 'opened',
  web_url: 'https://gitlab.local/group/project/-/issues/42',
  references: { short: '#42', relative: 'group/project#42', full: 'group/project#42' },
  author: { id: 77, username: 'manager' },
  labels: ['backend', 'priority:high'],
  created_at: '2026-11-10T08:00:00.000Z',
  updated_at: '2026-11-12T09:30:00.000Z',
};

test('normalizeIssue maps REST issue fields into an Issue item', () => {
  const issue = normalizeIssue(gitlabIssue);
  assert.equal(issue.id, 'issue-555-42');
  assert.equal(issue.title, 'Implement the feature flag');
  assert.equal(issue.url, gitlabIssue.web_url);
  assert.equal(issue.project, 'group/project');
  assert.equal(issue.targetType, 'issue');
  assert.equal(issue.action, 'issue-processing');
  assert.equal(issue.iid, 42);
  assert.equal(issue.projectId, '555');
  assert.deepEqual(issue.labels, ['backend', 'priority:high']);
  assert.equal(isIssueItem(issue), true);
  // 项目路径回退到 web_url 解析；坏行返回 null 而不是抛错。
  const fallback = normalizeIssue({ ...gitlabIssue, references: {} });
  assert.equal(fallback.project, 'group/project');
  assert.equal(normalizeIssue({ iid: 1 }), null);
  assert.equal(normalizeIssue({ iid: 'x', project_id: 1 }), null);
  // 归一化后的 Issue 条目经 normalizeTodo 回读不丢来源字段（状态文件往返）。
  const reread = normalizeStoredIssue(issue);
  assert.equal(isIssueItem(reread), true);
  assert.equal(reread.iid, 42);
  assert.equal(reread.projectId, '555');
});

test('issueApiPath prefers projectId/iid and falls back to web_url parsing', () => {
  assert.equal(issueApiPath(normalizeIssue(gitlabIssue)), 'projects/555/issues/42');
  assert.equal(
    issueApiPath({ url: 'https://gitlab.local/group/sub/proj/-/issues/9' }),
    'projects/group%2Fsub%2Fproj/issues/9');
  assert.equal(issueApiPath({ url: 'https://gitlab.local/groups/team/-/epics/2' }), '');
  assert.equal(issueApiPath(null), '');
});

test('issue prompt and title stay minimal', () => {
  const issue = normalizeIssue(gitlabIssue);
  assert.equal(buildIssuePrompt(issue, { customRules: 'ignored', signature: 'ignored' }), `${issue.url}\n开始处理`);
  assert.equal(buildSessionTitle(issue, 1), 'ISSUE-project #42');
  assert.equal(buildSessionTitle(issue, 3), 'ISSUE-project #42');

});

test('issue dispatch sends only the link and start command with a repository title', async () => {
  const { runtime, calls } = runtimeWithPrompt(async (request) => {
    const text = request.content.map((part) => part.text).join('');
    assert.equal(text, `${gitlabIssue.web_url}\n开始处理`);
    return { accepted: true };
  });
  const issue = normalizeIssue(gitlabIssue);
  runtime.state.issues = [issue];
  const result = await runtime.dispatchById(issue.id);
  assert.equal(result.ok, true);
  assert.equal(calls.create, 1);
  // 会话仍在执行时重发派发必须被拒绝（不能同一对象并行两个会话）。
  const busy = await runtime.dispatchById(issue.id);
  assert.equal(busy.ok, false);
  assert.equal(calls.create, 1);
  // 结算（核对 Issue 状态 → 未关则转需人工）后，再点“处理”走 force 重开一轮新会话，round+1。
  runtime.runGlab = async () => JSON.stringify({ state: 'opened' });
  await runtime.reconcileSessions();
  const again = await runtime.dispatchById(issue.id);
  assert.equal(again.ok, true);
  assert.equal(calls.create, 2);
  const record = runtime.state.handled[issue.id];
  assert.equal(record.round, 2);
  assert.equal(record.sessionTitle, 'ISSUE-project #42');
  assert.deepEqual(calls.renames.map((entry) => entry.title), ['ISSUE-project #42', 'ISSUE-project #42']);
  assert.equal(publicState(runtime.state).issueCount, 1);
  await runtime.stop();
});


test('issue closure verdict closes only on the issue being closed', async () => {
  // Issue 记录：todoPending 槽位表示的是“Issue 仍开放”。自述 done 不算数。
  const open = assessClosure({
    itemOpen: true, turnOk: true, unit: 'issue',
    report: { status: 'done', summary: 'work finished' }, followUpBlocked: 'manual',
  });
  assert.equal(open.closure, 'needs-human');
  assert.match(open.note, /Issue 仍未关闭/);
  const closed = assessClosure({ itemOpen: false, turnOk: true, unit: 'issue' });
  assert.equal(closed.closure, 'closed');
  assert.match(closed.note, /Issue 已关闭/);
});

test('issue closure without an embedded report uses factual diagnostics only', () => {
  const open = assessClosure({
    itemOpen: true, turnOk: true, unit: 'issue', replied: null,
    followUpBlocked: '手动派发的会话不自动续办',
  });
  assert.equal(open.closure, 'needs-human');
  assert.equal(open.note, 'Issue 仍未关闭；手动派发的会话不自动续办');

  const closed = assessClosure({ itemOpen: false, turnOk: true, unit: 'issue', replied: null });
  assert.equal(closed.closure, 'closed');
  assert.equal(closed.note, 'Issue 已关闭');

  // Todo 仍保留结案报告和回复核对诊断，不能被 Issue 极简契约影响。
});

test('assessClosures checks the issue state instead of the todo list', async () => {
  const { runtime } = runtimeWithPrompt(async () => ({ accepted: true }));
  const issue = normalizeIssue(gitlabIssue);
  runtime.state.issues = [issue];
  runtime.runGlab = async () => JSON.stringify({ state: 'closed' });
  runtime.state.handled[issue.id] = {
    id: issue.id, sessionId: 'session-x', item: issue, automatic: false,
    executionStatus: 'completed', completedAt: Date.now() - 1000,
    closure: 'verifying', acceptedAt: Date.now() - 2000, firstAcceptedAt: Date.now() - 2000,
  };
  const changed = await runtime.assessClosures(Date.now());
  assert.equal(changed, true);
  const record = runtime.state.handled[issue.id];
  assert.equal(record.closure, 'closed');
  assert.match(record.closureNote, /Issue 已关闭/);
  await runtime.stop();
});

test('assessClosures keeps verifying when the issue state cannot be determined', async () => {
  const { runtime } = runtimeWithPrompt(async () => ({ accepted: true }));
  const issue = normalizeIssue(gitlabIssue);
  runtime.state.issues = [issue];
  runtime.runGlab = async () => { throw new Error('glab down'); };
  runtime.state.handled[issue.id] = {
    id: issue.id, sessionId: 'session-x', item: issue, automatic: false,
    executionStatus: 'completed', completedAt: Date.now() - 1000,
    closure: 'verifying', acceptedAt: Date.now() - 2000, firstAcceptedAt: Date.now() - 2000,
  };
  await runtime.assessClosures(Date.now());
  // 接口不可判定时不下结论：记录仍停在 verifying，等下一轮核对。
  assert.equal(runtime.state.handled[issue.id].closure, 'verifying');
  await runtime.stop();
});

test('assessClosures leaves an open issue for a human instead of closing it', async () => {
  const { runtime } = runtimeWithPrompt(async () => ({ accepted: true }));
  const issue = normalizeIssue(gitlabIssue);
  runtime.state.issues = [issue];
  runtime.runGlab = async () => JSON.stringify({ state: 'opened' });
  runtime.state.handled[issue.id] = {
    id: issue.id, sessionId: 'session-x', item: issue, automatic: false,
    executionStatus: 'completed', completedAt: Date.now() - 1000,
    reportStatus: 'done', reportSummary: 'work finished but kept open',
    closure: 'verifying', acceptedAt: Date.now() - 2000, firstAcceptedAt: Date.now() - 2000,
  };
  await runtime.assessClosures(Date.now());
  const record = runtime.state.handled[issue.id];
  // 会话自述 done 但 Issue 未关：手动链路不续办，转需人工。
  assert.equal(record.closure, 'needs-human');
  assert.match(record.closureNote, /Issue 仍未关闭/);
  await runtime.stop();
});

test('issue needs-human still closes and archives only after the issue actually closes', async () => {
  const { runtime, calls } = runtimeWithPrompt(async () => ({ accepted: true }));
  const issue = normalizeIssue(gitlabIssue);
  runtime.state.issues = [issue];
  runtime.state.handled[issue.id] = {
    id: issue.id, sessionId: 'session-1', item: issue, automatic: false,
    executionStatus: 'completed', completedAt: Date.now() - 1000,
    closure: 'verifying', acceptedAt: Date.now() - 2000, firstAcceptedAt: Date.now() - 2000,
    reportStatus: 'needs-human', reportSummary: '需要人工确认', archived: false,
  };
  runtime.runGlab = async () => JSON.stringify({ state: 'opened' });
  await runtime.assessClosures(Date.now());
  const record = runtime.state.handled[issue.id];
  assert.equal(record.closure, 'needs-human');
  assert.equal(record.archived, false);
  assert.deepEqual(calls.archives, []);

  runtime.runGlab = async () => JSON.stringify({ state: 'closed' });
  await runtime.assessClosures(Date.now());
  assert.equal(record.closure, 'closed');
  assert.equal(record.archived, true);
  assert.deepEqual(calls.archives, ['session-1']);
  await runtime.stop();
});

test('issue projection joins open issues with handled records and lists orphans', () => {
  const state = initialState();
  const issue = normalizeIssue(gitlabIssue);
  const gone = normalizeIssue({ ...gitlabIssue, iid: 77, project_id: 555, web_url: 'https://gitlab.local/group/project/-/issues/77' });
  state.issues = [issue];
  state.handled[gone.id] = {
    id: gone.id, sessionId: 'session-old', item: gone, executionStatus: 'completed',
    closure: 'needs-human', acceptedAt: Date.now(),
  };
  const view = buildIssueProjection(state);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].handled, false);
  assert.equal(view.items[0].missing, false);
  assert.equal(view.orphans.length, 1);
  assert.equal(view.orphans[0].id, 'issue-555-77');
  assert.equal(view.orphans[0].missing, true);
  assert.equal(view.orphans[0].sessionId, 'session-old');
});

test('normalizeState preserves issue cache and issue-shaped handled items', () => {
  const issue = normalizeIssue(gitlabIssue);
  const state = normalizeState({
    version: 6,
    issues: [issue, { iid: 3 }],
    handled: {
      [issue.id]: {
        id: issue.id, sessionId: 'session-x', item: issue, title: issue.title,
        url: issue.url, outcome: 'session-accepted', acceptedAt: Date.now(),
      },
    },
  });
  assert.equal(state.issues.length, 1);
  assert.equal(isIssueItem(state.issues[0]), true);
  assert.equal(isIssueItem(state.handled[issue.id].item), true);
  assert.equal(state.handled[issue.id].item.projectId, '555');
});

test('issue session settings validate independently', () => {
  const configured = validateSettings({
    issueSessionCwd: ' D:\\issue-workspace ',
    issueSessionModel: { provider: ' issue-provider ', model: ' issue-model ', reasoningEffort: ' high ' },
  }, defaultSettings());
  assert.equal(configured.issueSessionCwd, 'D:\\issue-workspace');
  assert.deepEqual(configured.issueSessionModel, {
    provider: 'issue-provider', model: 'issue-model', reasoningEffort: 'high',
  });

  const next = validateSettings({ issueSessionModel: { provider: 'issue-provider', model: 'issue-model', reasoningEffort: undefined } }, configured);
  assert.deepEqual(next.issueSessionModel, { provider: 'issue-provider', model: 'issue-model' });
  assert.equal(validateSettings({ issueSessionModel: null, issueSessionCwd: '' }, configured).issueSessionModel, null);
  assert.throws(() => validateSettings({ issueSessionModel: { provider: 'issue-provider' } }, configured), /Issue Session 模型/);
  assert.throws(() => validateSettings({ issueSessionModel: {
    provider: 'issue-provider', model: 'issue-model', reasoningEffort: '',
  } }, configured), /思考强度/);
  assert.throws(() => validateSettings({ issueSessionModel: {
    provider: 'issue-provider', model: 'issue-model', reasoningEffort: 3,
  } }, configured), /思考强度/);
  assert.throws(() => validateSettings({ issueSessionCwd: 42 }, configured), /Issue Session 工作区文件夹/);
});

test('legacy shared session values copy to issue settings once and then diverge', () => {
  const legacy = initialState();
  legacy.settings.sessionCwd = 'D:\\shared-workspace';
  legacy.settings.sessionModel = { provider: 'shared-provider', model: 'shared-model' };
  delete legacy.settings.issueSessionCwd;
  delete legacy.settings.issueSessionModel;
  const migrated = normalizeState(JSON.parse(JSON.stringify(legacy)));
  assert.equal(migrated.settings.issueSessionCwd, 'D:\\shared-workspace');
  assert.deepEqual(migrated.settings.issueSessionModel, { provider: 'shared-provider', model: 'shared-model' });

  const independent = validateSettings({
    issueSessionCwd: 'D:\\issue-only',
    issueSessionModel: { provider: 'issue-only', model: 'reasoning-model', reasoningEffort: 'maximum' },
  }, migrated.settings);
  const restored = normalizeState(JSON.parse(JSON.stringify({ ...migrated, settings: independent })));
  assert.equal(restored.settings.issueSessionCwd, 'D:\\issue-only');
  assert.deepEqual(restored.settings.issueSessionModel, {
    provider: 'issue-only', model: 'reasoning-model', reasoningEffort: 'maximum',
  });
  assert.deepEqual(publicState(restored).settings.issueSessionModel, restored.settings.issueSessionModel);
});

test('issue dispatch uses its own workspace model and reasoning effort', async () => {
  const prompts = [];
  const { runtime, calls } = runtimeWithPrompt(async (request) => {
    prompts.push(request.content.map((part) => part.text).join(''));
    return { accepted: true };
  });
  runtime.state.settings.issueSessionCwd = 'D:\\work\\repo';
  runtime.state.settings.issueSessionModel = {
    provider: 'issue-provider', model: 'reasoning-model', reasoningEffort: 'high',
  };
  const issue = normalizeIssue(gitlabIssue);
  assert.equal((await runtime.dispatch(issue)).ok, true);
  assert.deepEqual(calls.createRequests, [{ workspaceId: 'workspace-work' }]);
  assert.deepEqual(calls.modelSelections, [
    {
      sessionId: 'session-1', provider: 'issue-provider', model: 'reasoning-model', reasoningEffort: 'high',
    },
  ]);
  assert.equal(prompts[0], `${issue.url}\n开始处理`);
  await runtime.stop();
});

test('issue dispatch omits reasoning effort when the provider default is selected', async () => {
  const { runtime, calls } = runtimeWithPrompt(async () => ({ accepted: true }));
  runtime.state.settings.issueSessionModel = { provider: 'issue-provider', model: 'reasoning-model' };
  const issue = normalizeIssue(gitlabIssue);
  assert.equal((await runtime.dispatch(issue)).ok, true);
  assert.deepEqual(calls.modelSelections, [
    { sessionId: 'session-1', provider: 'issue-provider', model: 'reasoning-model' },
  ]);
  assert.equal(Object.hasOwn(calls.modelSelections[0], 'reasoningEffort'), false);
  await runtime.stop();
});

test('issue pending retry reuses session and workspace while applying the latest issue model', async () => {
  const promptRequests = [];
  const { runtime, calls } = runtimeWithPrompt(async (request) => {
    promptRequests.push(request);
    if (calls.prompt === 1) throw new Error('temporary prompt failure');
    return { accepted: true };
  });
  runtime.state.settings.issueSessionCwd = 'D:\\work\\repo';
  runtime.state.settings.issueSessionModel = { provider: 'issue-provider', model: 'old-model', reasoningEffort: 'low' };
  const originalResolve = runtime.resolveWorkspaceId.bind(runtime);
  let workspaceCalls = 0;
  runtime.resolveWorkspaceId = (...args) => {
    workspaceCalls += 1;
    return originalResolve(...args);
  };
  const issue = normalizeIssue(gitlabIssue);
  runtime.state.issues = [issue];
  const failed = await runtime.dispatchById(issue.id);
  assert.equal(failed.ok, false);
  const requestId = runtime.state.pending[issue.id].requestId;
  assert.ok(requestId);

  // pending 复用原工作区；即使之后配置了未注册路径也不会重新解析，但模型按 Issue 最新设置重放。
  runtime.state.settings.issueSessionCwd = 'D:\\not-registered-after-pending';
  runtime.state.settings.issueSessionModel = { provider: 'issue-provider', model: 'new-model', reasoningEffort: 'maximum' };
  const retried = await runtime.dispatchById(issue.id);
  assert.equal(retried.ok, true);
  assert.equal(retried.sessionId, failed.sessionId);
  assert.equal(calls.create, 1);
  assert.equal(workspaceCalls, 1);
  assert.deepEqual(calls.createRequests, [{ workspaceId: 'workspace-work' }]);
  assert.equal(promptRequests.length, 2);
  assert.equal(promptRequests[0].requestId, requestId);
  assert.equal(promptRequests[1].requestId, requestId);
  assert.equal(runtime.state.handled[issue.id].requestId, requestId);
  assert.equal(runtime.state.pending[issue.id], undefined);
  assert.deepEqual(calls.modelSelections, [
    { sessionId: 'session-1', provider: 'issue-provider', model: 'old-model', reasoningEffort: 'low' },
  ]);
  await runtime.stop();
});

test('log buffer normalizes lines, truncates, and enforces entry/char caps', () => {
  const logs = createLogBuffer({ maxEntries: 3, maxChars: 1024, maxLineChars: 12 });
  logs.push('info', 'first');
  logs.push('warn', '  warn   two ');
  logs.push('error', 'this message is far too long for the cap');
  const items = logs.list();
  assert.equal(items.length, 3);
  // 新→旧；单行归一化；超长单条截断并标注。
  assert.equal(items[0].level, 'error');
  assert.ok(items[0].message.includes('截断'));
  assert.equal(items[1].message, 'warn two');
  assert.equal(items[1].level, 'warn');
  // 条数封顶：第四进一最旧淘汰，dropped 计数。
  logs.push('info', 'fourth');
  assert.equal(logs.size, 3);
  assert.equal(logs.dropped, 1);
  assert.equal(logs.list()[0].message, 'fourth');
  // 总字符封顶：条数没到也按字数淘汰最旧。
  const tight = createLogBuffer({ maxEntries: 100, maxChars: 25, maxLineChars: 10 });
  tight.push('info', 'aaaaaaaaaa');
  tight.push('info', 'bbbbbbbbbb');
  tight.push('info', 'cccccccccc');
  assert.equal(tight.size, 2);
  assert.ok(tight.dropped >= 1);
  // 清空：现有条目计入 dropped，缓冲归零。
  const droppedBefore = tight.dropped;
  tight.reset();
  assert.equal(tight.size, 0);
  assert.equal(tight.dropped, droppedBefore + 2);
});

test('runtime logger feeds the in-memory buffer and logProjection/clearLogEntries expose it', async () => {
  const { runtime } = runtimeWithPrompt(async () => ({ accepted: true }));
  runtime.logger.warn('测试警告消息');
  runtime.logger.info('  [gitlab-todo-agent] 旧调用点自带前缀 ');
  const view = runtime.logProjection();
  // 新→旧；前缀被剥掉（透传宿主时才补回），级别保留。
  assert.equal(view.items[0].message, '旧调用点自带前缀');
  assert.equal(view.items[0].level, 'info');
  assert.equal(view.items[1].message, '测试警告消息');
  assert.equal(view.items[1].level, 'warn');
  assert.ok(view.capacity.maxEntries > 0);
  assert.ok(view.capacity.maxChars > 0);
  // 清空：缓冲归零并留一条审计行，先前条目计入 dropped。
  runtime.clearLogEntries();
  const after = runtime.logProjection();
  assert.equal(after.items.length, 1);
  assert.match(after.items[0].message, /清空/);
  assert.ok(after.dropped >= 2);
  await runtime.stop();
});

// ---- 同对象合并派发（v3 起不再有 Leader 托管转交）----
