import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, initialLeaderState, normalizeLeaderState, LEADER_LIMITS } from '../core.js';
import { leaderMethods, createLeaderUiCaller, createLeaderAgentCaller, createLeaderWorkerCaller } from '../host/leader.js';
import { createLeaderAgentAdapter, LEADER_WORKER_TOOL, LEADER_TOOL_NAMES } from '../host/leader-agent.js';

const sessionState = (patch = {}) => ({ cursor: 10, active: true, running: false, queue: [], pendingInput: [], ...patch });
const copy = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const calls = { notify: [], deliver: [], persist: [], refreshWorkers: 0 };
  const sessions = new Map([['leader', sessionState()], ['worker-a', sessionState()], ['worker-b', sessionState()], ['outside', sessionState()]]);
  const ui = createLeaderUiCaller();
  const runtime = Object.assign({}, leaderMethods, {
    state: initialState(), leaderState: initialLeaderState(), config: {}, stopping: false,
    ctx: { workspaceRegistry: { archivedSessionIds: [] } },
    storageDirectory() { throw new Error('fixture uses in-memory persistence'); },
    ensureLeaderTimer() {}, targetBusy() { return false; }, resolveWorkspaceId(cwd) { return cwd || 'issue-workspace'; },
    host: {
      async sessionState(id) { if (!sessions.has(id)) throw new Error('not found'); return copy(sessions.get(id)); },
      async createSession() { return 'leader'; }, async renameSession() {}, async selectModel() {},
      async prompt() { throw new Error('never prompt'); },
    },
    async persistLeader() { calls.persist.push(copy(this.leaderState)); },
  });
  runtime.leaderAdapter = {
    capabilities: { atomicIdleDelivery: true, nonHumanSource: true },
    async prepare(sessionId) { return { ok: true, status: 'prepared', sessionId }; },
    async refreshBindings() { return true; },
    async refreshWorkerBindings() { calls.refreshWorkers += 1; return true; },
    async observe(sessionId, cursor) { const highWater = sessions.get(sessionId)?.cursor ?? 0; return { cursor: highWater, highWater, events: [], truncated: false, epoch: 'live-log' }; },
    async deliver(request) { calls.deliver.push(copy(request)); return { ok: true, status: 'delivered', requestId: request.requestId }; },
    async notify(request) { calls.notify.push(copy(request)); return { ok: true, status: 'delivered', requestId: request.requestId }; },
  };
  for (const suffix of ['a', 'b']) {
    const item = { id: `issue-1-${suffix}`, title: `Issue ${suffix}`, source: 'issue', url: `https://gitlab.test/project/-/issues/${suffix}`, project: 'project', iid: suffix, projectId: '1' };
    runtime.state.issues.push(item);
    runtime.state.handled[item.id] = { id: item.id, sessionId: `worker-${suffix}`, item, automatic: false,
      acceptedAt: Date.now(), outcome: 'session-accepted', title: item.title, url: item.url, executionStatus: 'completed' };
  }
  const invoke = (operation, request = {}, caller = ui) => runtime.leaderOperation(operation, request, caller);
  const issue = (suffix = 'a') => ({ taskId: `issue-1-${suffix}`, sessionId: `worker-${suffix}` });
  const agent = () => createLeaderAgentCaller({ sessionId: 'leader', agentId: 'leader' });
  const worker = (suffix = 'a') => createLeaderWorkerCaller({ sessionId: `worker-${suffix}`, agentId: `worker-${suffix}` });
  const report = (request, suffix = 'a') => invoke('workerReport', request, worker(suffix));
  const setup = async (count = 2) => {
    assert.equal((await invoke('create')).ok, true);
    assert.equal((await invoke('enroll', issue('a'))).ok, true);
    if (count === 2) assert.equal((await invoke('enroll', issue('b'))).ok, true);
    assert.equal((await invoke('start')).ok, true);
  };
  return { runtime, calls, sessions, ui, invoke, issue, agent, worker, report, setup };
}

test('workerReport authorization: only enrolled worker caller; worker cannot call Leader/UI operations', async () => {
  const { invoke, issue, agent, worker, report, setup } = fixture(); await setup();
  assert.equal((await report({ kind: 'progress', text: '完成第一步' })).ok, true);
  assert.match((await invoke('workerReport', { kind: 'progress', text: 'x' })).error, /仅限已纳管 worker/);
  assert.match((await invoke('workerReport', { kind: 'progress', text: 'x' }, agent())).error, /仅限已纳管 worker/);
  const outside = createLeaderWorkerCaller({ sessionId: 'outside', agentId: 'outside' });
  assert.match((await invoke('workerReport', { kind: 'progress', text: 'x' }, outside)).error, /不是当前已纳管的 worker/);
  const fakeLeader = createLeaderWorkerCaller({ sessionId: 'leader', agentId: 'leader' });
  assert.equal((await invoke('workerReport', { kind: 'progress', text: 'x' }, fakeLeader)).ok, false);
  for (const operation of ['continueIssue', 'readIssue', 'snapshot', 'enroll', 'resetIssueBudget', 'start']) {
    const result = await invoke(operation, issue('b'), worker());
    assert.equal(result.ok, false); assert.match(result.error, /只能向 Leader 报告/); assert.equal(result.result, null);
  }
  // Forged plain object without Host-issued identity is rejected.
  assert.equal((await invoke('workerReport', { kind: 'progress', text: 'x' }, { sessionId: 'worker-a' })).ok, false);
});

test('reports are recorded, rate-limited, deduplicated, capped per budget cycle and reset by resetIssueBudget', async () => {
  const { runtime, invoke, issue, report, setup } = fixture(); await setup();
  const first = await report({ kind: 'progress', text: '  第一阶段完成  ' });
  assert.equal(first.ok, true); assert.equal(first.result.recorded, true); assert.equal(first.result.remaining, LEADER_LIMITS.maxReportsPerItem - 1);
  assert.equal(first.result.projection, undefined);
  const entry = runtime.leaderState.reports.at(-1);
  assert.deepEqual(Object.keys(entry).sort(), ['at', 'id', 'kind', 'sessionId', 'taskId', 'text', 'toTaskId']);
  assert.equal(entry.text, '第一阶段完成'); assert.equal(entry.toTaskId, null); assert.equal(entry.taskId, 'issue-1-a');
  const tooFast = await report({ kind: 'progress', text: '第二阶段' });
  assert.equal(tooFast.ok, false); assert.match(tooFast.error, /过于频繁/); assert.equal(tooFast.result, null);
  // Urgent kinds bypass the interval but same kind + same text is deduplicated.
  assert.equal((await report({ kind: 'blocked', text: '需要数据库权限' })).result.recorded, true);
  const dup = await report({ kind: 'blocked', text: '需要数据库权限' });
  assert.equal(dup.ok, true); assert.equal(dup.result.duplicate, true); assert.equal(dup.result.recorded, false);
  assert.equal((await report({ kind: 'question', text: '用哪个分支？' })).ok, true);
  assert.equal(runtime.leaderState.reports.length, 3);
  // Validation.
  assert.match((await report({ kind: 'shout', text: 'x' })).error, /kind 必须/);
  assert.match((await report({ kind: 'done', text: '   ' })).error, /不能为空/);
  assert.match((await report({ kind: 'done', text: 'x'.repeat(2001) })).error, /2000/);
  assert.match((await report({ kind: 'done', text: 'x', sessionId: 'worker-b' })).error, /未知字段/);
  // Budget cap per item.
  const item = runtime.leaderState.items.find((candidate) => candidate.taskId === 'issue-1-a');
  item.reportCount = LEADER_LIMITS.maxReportsPerItem;
  const capped = await report({ kind: 'done', text: '交付完成' });
  assert.equal(capped.ok, false); assert.match(capped.error, /上限 30/);
  // Other items are unaffected.
  assert.equal((await report({ kind: 'done', text: 'b 完成' }, 'b')).ok, true);
  assert.equal((await invoke('resetIssueBudget', issue('a'))).ok, true);
  assert.equal(item.reportCount, 0);
  assert.equal((await report({ kind: 'done', text: '交付完成' })).ok, true);
  // Reports never spend Leader action budget.
  assert.equal(item.actions, 0);
});

test('toTaskId only for kind message and must be another enrolled task', async () => {
  const { runtime, report, setup } = fixture(); await setup();
  assert.match((await report({ kind: 'progress', text: 'x', toTaskId: 'issue-1-b' })).error, /仅 kind=message/);
  assert.match((await report({ kind: 'message', text: 'x', toTaskId: 'issue-1-a' })).error, /不能是自己/);
  assert.match((await report({ kind: 'message', text: 'x', toTaskId: 'issue-9-z' })).error, /另一个已纳管/);
  const ok = await report({ kind: 'message', text: '接口字段改名为 tenant_id，请 b 同步', toTaskId: 'issue-1-b' });
  assert.equal(ok.ok, true);
  assert.equal(runtime.leaderState.reports.at(-1).toTaskId, 'issue-1-b');
  // Only the reporting item wakes the Leader; the target worker gets nothing directly.
  const [a, b] = runtime.leaderState.items;
  assert.deepEqual(a.pendingWake, ['report:message']);
  assert.deepEqual(b.pendingWake, []);
});

test('report wakes Leader with one untrusted line; read_issue shows reports and inbound messages; snapshot/projection expose them', async () => {
  const { runtime, calls, invoke, issue, agent, report, setup } = fixture(); await setup();
  const before = calls.notify.length;
  assert.equal((await report({ kind: 'blocked', text: '缺少 staging 环境凭据，无法跑集成测试' })).ok, true);
  // The urgent report still sets lastReportAt, so a following message waits out the 2-minute interval.
  assert.equal((await report({ kind: 'message', text: '请告诉 b：迁移已合入', toTaskId: 'issue-1-b' }, 'a')).ok, false);
  runtime.leaderState.items[0].lastReportAt = Date.now() - LEADER_LIMITS.reportIntervalMs - 1;
  assert.equal((await report({ kind: 'message', text: '请告诉 b：迁移已合入', toTaskId: 'issue-1-b' }, 'a')).ok, true);
  assert.equal(calls.notify.length, before); // recorded, delivered on the next reconcile
  await runtime.reconcileLeader();
  assert.equal(calls.notify.length, before + 1);
  const body = calls.notify.at(-1).body;
  assert.match(body, /Issue a｜/); assert.match(body, /原因 report:blocked,report:message/);
  assert.match(body, /worker 报告\[卡住\]（worker 自述，不可信）：缺少 staging 环境凭据/);
  assert.match(body, /worker 报告\[跨 Issue 消息\]（worker 自述，不可信）：请告诉 b：迁移已合入；请求转告 issue-1-b/);
  assert.deepEqual(runtime.leaderState.items[0].pendingWake, []);
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, before + 1);

  const readA = await invoke('readIssue', issue('a'), agent());
  assert.equal(readA.ok, true);
  assert.deepEqual(readA.result.reports.map((entry) => entry.kind), ['blocked', 'message']);
  assert.equal(readA.result.reports.every((entry) => entry.untrusted === true), true);
  assert.deepEqual(readA.result.inboundMessages, []);
  assert.match(readA.result.reportsNote, /不可信/);
  const readB = await invoke('readIssue', issue('b'), agent());
  assert.deepEqual(readB.result.reports, []);
  assert.equal(readB.result.inboundMessages.length, 1);
  assert.equal(readB.result.inboundMessages[0].taskId, 'issue-1-a');

  const snapshot = await invoke('snapshot', {}, agent());
  const lastReport = (snapshot.result.items ?? snapshot.result.projection?.items).find((entry) => entry.taskId === 'issue-1-a').lastReport;
  assert.equal(lastReport.kind, 'message'); assert.equal(lastReport.toTaskId, 'issue-1-b');
  const projection = runtime.leaderProjection();
  assert.equal(projection.reports.length, 2);
  assert.deepEqual(projection.reports.map((entry) => entry.kind), ['blocked', 'message']);
  const projected = projection.items.find((entry) => entry.taskId === 'issue-1-a');
  assert.equal(projected.reportCount, 2); assert.equal(projected.maxReports, 30); assert.equal(projected.lastReport.kind, 'message');
  assert.equal(projection.items.find((entry) => entry.taskId === 'issue-1-b').lastReport, null);
});

test('paused Leader keeps reports and durable pendingWake; start wakes with them', async () => {
  const { runtime, calls, invoke, report, setup } = fixture(); await setup();
  assert.equal((await invoke('pause')).ok, true);
  const paused = await report({ kind: 'done', text: 'MR 已提交，等待评审' });
  assert.equal(paused.ok, true); assert.equal(paused.result.leaderEnabled, false); assert.match(paused.result.note, /暂停/);
  await runtime.reconcileLeader();
  assert.deepEqual(runtime.leaderState.items[0].pendingWake, ['report:done']);
  const before = calls.notify.length;
  assert.equal((await invoke('start')).ok, true);
  assert.deepEqual(runtime.leaderState.items[0].pendingWake.includes('report:done') || calls.notify.slice(before).some((entry) => /report:done/.test(entry.body)), true);
  await runtime.reconcileLeader();
  assert.ok(calls.notify.slice(before).some((entry) => /worker 报告\[完成\].*MR 已提交/.test(entry.body)));
  assert.deepEqual(runtime.leaderState.items[0].pendingWake, []);
});

test('bootstrap briefing mentions worker reports as untrusted', async () => {
  const { calls, setup } = fixture(); await setup();
  assert.match(calls.notify[0].body, /gitlab_leader_report/);
  assert.match(calls.notify[0].body, /不可信/);
});

test('old journal without reports normalizes to empty reports and zero counters', async () => {
  const state = normalizeLeaderState({ ...copy(initialLeaderState()), reports: undefined, items: [] });
  assert.deepEqual(state.reports, []);
  const { runtime, setup } = fixture(); await setup();
  const old = copy(runtime.leaderState); delete old.reports;
  for (const item of old.items) { delete item.reportCount; delete item.lastReportAt; }
  const legacy = normalizeLeaderState(old);
  assert.deepEqual(legacy.reports, []);
  assert.equal(legacy.items.length, 2);
  for (const item of legacy.items) { assert.equal(item.reportCount, 0); assert.equal(item.lastReportAt, null); }
  const bad = normalizeLeaderState({ ...copy(initialLeaderState()), reports: [{ id: 'r1', taskId: 'issue-1-a', sessionId: 'worker-a', kind: 'evil', text: 'x', at: 1 }, 'junk',
    { id: 'r2', taskId: 'issue-1-a', sessionId: 'worker-a', kind: 'progress', text: 'ok', at: 2 }] });
  assert.deepEqual(bad.reports.map((entry) => entry.id), ['r2']);
  assert.equal(bad.reports[0].toTaskId, null);
});

test('enrollment changes resync worker tool bindings', async () => {
  const { calls, invoke, issue, setup } = fixture(); await setup(1);
  const afterSetup = calls.refreshWorkers; assert.ok(afterSetup >= 1);
  assert.equal((await invoke('enroll', issue('b'))).ok, true); assert.ok(calls.refreshWorkers > afterSetup);
  const afterEnroll = calls.refreshWorkers;
  assert.equal((await invoke('pause')).ok, true); assert.equal(calls.refreshWorkers, afterEnroll); // same set: no resync
  assert.equal((await invoke('unenroll', issue('b'))).ok, true); assert.ok(calls.refreshWorkers > afterEnroll);
});

// ---- Adapter: tool binding on resident agents ----

function adapterSetup() {
  const residents = new Map();
  const listeners = new Map();
  const registered = new Map(); // agent id -> Map(name -> {definition, config})
  const operations = [];
  const effects = [];
  const toolsFor = new Map();
  const makeTools = (owner) => ({
    register(definition, config) {
      if (!registered.has(owner)) registered.set(owner, new Map());
      registered.get(owner).set(definition.name, { definition, config });
      return () => registered.get(owner).delete(definition.name);
    },
    restrict(filter) { if (owner !== 'leader') assert.fail('worker must never be restricted'); assert.deepEqual(filter, { allow: [] }); return () => {}; },
    guard() { if (owner !== 'leader') assert.fail('worker must never be guarded'); return () => {}; },
  });
  const makeAgent = (id) => {
    const scope = { effect: (fn, label) => effects.push([id, label]) };
    const agent = { id, session: { id, seq: 1, header: { cwd: 'D:/w' } }, status: 'idle', ctx: scope, inbox: { nextTurn: [], nextStep: [] } };
    toolsFor.set(agent, makeTools(id)); residents.set(id, agent); return agent;
  };
  const leader = makeAgent('leader');
  leader.cancel = () => {}; leader.whenIdle = async () => {};
  const worker = makeAgent('worker'); const outsider = makeAgent('outside');
  const ctx = { agents: { get: (id) => residents.get(id) }, workspaceRegistry: { archivedSessionIds: [] },
    agentPresets: { serviceFor(agent, name) { assert.equal(name, 'tools'); return toolsFor.get(agent); } },
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); }, effect: () => {} };
  const runtime = { ctx, leaderState: { sessionId: 'leader', items: [{ taskId: 'issue', sessionId: 'worker' }] },
    host: { sessionState: async () => ({ cursor: 1 }) },
    validateLeaderAdmission: () => true,
    isLeaderManagedSession(id) { return this.leaderState.items.some((item) => item.sessionId === id); },
    leaderOperation: async (operation, request, caller) => { operations.push({ operation, request, caller }); return { ok: true, result: { recorded: true } }; } };
  const dependencies = { getTraceable: (_context, value) => value, createUserMessage: (input) => ({ ...input, role: 'user' }) };
  const adapter = createLeaderAgentAdapter(runtime, { dependencies });
  const toolsOf = (id) => registered.get(id) ?? new Map();
  return { adapter, runtime, residents, listeners, leader, worker, outsider, operations, effects, toolsOf, makeAgent };
}

test('report tool binds only to enrolled resident workers, never Leader/unmanaged; no restriction on worker', async () => {
  const fixture = adapterSetup();
  assert.equal(await fixture.adapter.refreshBindings(), true);
  assert.equal(await fixture.adapter.refreshWorkerBindings(), true);
  assert.deepEqual([...fixture.toolsOf('worker').keys()], [LEADER_WORKER_TOOL]);
  assert.equal(fixture.toolsOf('outside').size, 0);
  assert.equal(fixture.toolsOf('leader').has(LEADER_WORKER_TOOL), false);
  assert.deepEqual([...fixture.toolsOf('leader').keys()], [...LEADER_TOOL_NAMES]);
  assert.ok(fixture.effects.some(([id, label]) => id === 'worker' && label === 'gitlab-workstation.leader-worker-report'));

  const { definition, config } = fixture.toolsOf('worker').get(LEADER_WORKER_TOOL);
  assert.equal(definition.parameters.additionalProperties, false);
  assert.deepEqual(definition.parameters.required, ['kind', 'text']);
  assert.deepEqual(definition.parameters.properties.kind.enum, ['progress', 'blocked', 'done', 'question', 'message']);
  assert.match(definition.description, /ask_user_question/);
  assert.equal(config.when({ agent: fixture.worker }), true);
  assert.equal(config.when({ agent: fixture.leader }), false);
  assert.equal(config.when({ agent: { ...fixture.worker } }), false);
  const exec = { agent: fixture.worker, signal: new AbortController().signal };
  assert.equal((await definition.execute({ kind: 'progress', text: 'hi' }, exec)).ok, true);
  assert.equal(fixture.operations[0].operation, 'workerReport');
  assert.equal(Object.keys(fixture.operations[0].caller).length, 0); // Host-branded opaque caller
  await assert.rejects(definition.execute({ kind: 'progress', text: 'hi', sessionId: 'x' }, exec), /未知字段/);
  await assert.rejects(definition.execute({ kind: 'progress', text: 'hi' }, { ...exec, agent: fixture.leader }), /不是已纳管 worker/);

  // Unenroll: `when` fails immediately (dynamic), and refresh removes the registration.
  fixture.runtime.leaderState.items = [];
  assert.equal(config.when({ agent: fixture.worker }), false);
  await assert.rejects(definition.execute({ kind: 'progress', text: 'hi' }, exec), /不是已纳管 worker/);
  await fixture.adapter.refreshWorkerBindings();
  assert.equal(fixture.toolsOf('worker').size, 0);

  // Re-enroll binds again; a worker agent created later is bound on agent/created.
  fixture.runtime.leaderState.items = [{ taskId: 'issue', sessionId: 'worker' }, { taskId: 'issue-2', sessionId: 'late' }];
  await fixture.adapter.refreshWorkerBindings();
  assert.equal(fixture.toolsOf('worker').has(LEADER_WORKER_TOOL), true);
  const late = fixture.makeAgent('late');
  await fixture.listeners.get('agent/created')({ agent: late });
  assert.equal(fixture.toolsOf('late').has(LEADER_WORKER_TOOL), true);
  fixture.listeners.get('agent/disposed')({ agent: late });
  assert.equal(fixture.toolsOf('late').size, 0);
});

test('worker binding failures never break Leader binding; agents without ctx are skipped', async () => {
  const fixture = adapterSetup();
  fixture.residents.set('worker', { id: 'worker', session: { id: 'worker' } });
  assert.equal(await fixture.adapter.refreshBindings(), true);
  assert.equal(await fixture.adapter.refreshWorkerBindings(), true);
  assert.equal(fixture.toolsOf('worker').size, 0);
});
