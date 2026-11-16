import assert from 'node:assert/strict';
import test from 'node:test';
import { GitlabTodoRuntime, apply, inject as requiredInject } from '../index.js';
import { initialState, initialLeaderState, normalizeIssue } from '../core.js';

function rpcFixture() {
  const browserPeer = { principal: { kind: 'owner' }, signal: new AbortController().signal };
  const runtime = Object.create(GitlabTodoRuntime.prototype);
  const calls = [];
  Object.assign(runtime, { ctx: { connection: { browserPeer } }, stopping: false,
    leaderOperation: async (operation, payload) => { calls.push({ operation, payload }); return { ok: true }; },
    leaderProjection: () => ({ enabled: false, sessionId: null, items: [] }), snapshot: () => ({ version: 6 }) });
  return { runtime, browserPeer, calls };
}

test('Leader grants require the real browser Peer, not another owner, an Agent or JSON identity', async () => {
  const { runtime, browserPeer, calls } = rpcFixture();
  const payload = { taskId: 'issue-42-7', sessionId: 'worker', principal: { kind: 'owner' }, caller: { kind: 'ui' } };
  for (const peer of [undefined, { ...browserPeer }, { principal: { kind: 'agent', agentId: 'leader' }, signal: browserPeer.signal }]) {
    const result = await runtime.handleLeaderUiRpc('enroll', payload, new AbortController().signal, peer);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'leader/forbidden');
  }
  assert.equal(calls.length, 0);
  const result = await runtime.handleLeaderUiRpc('enroll', payload, new AbortController().signal, browserPeer);
  assert.equal(result.ok, true); assert.equal(result.value.result.ok, true); assert.equal(calls.length, 1);
});

test('Leader native UI RPC rejects aborts, unknown endpoints and oversized payloads without granting', async () => {
  const { runtime, browserPeer, calls } = rpcFixture();
  const controller = new AbortController(); controller.abort();
  assert.equal((await runtime.handleLeaderUiRpc('start', {}, controller.signal, browserPeer)).ok, false);
  assert.equal((await runtime.handleLeaderUiRpc('advanceManaged', {}, undefined, browserPeer)).ok, false);
  assert.equal((await runtime.handleLeaderUiRpc('start', [], undefined, browserPeer)).ok, false);
  assert.equal((await runtime.handleLeaderUiRpc('configure', { data: 'x'.repeat(3_000_000) }, undefined, browserPeer)).ok, false);
  assert.equal(calls.length, 0);
});

test('HTTP Leader bridge is snapshot-only even with self-reported human confirmation', async () => {
  const { runtime, calls } = rpcFixture();
  for (const operation of ['create', 'configure', 'start', 'pause', 'enroll', 'unenroll', 'pauseIssue', 'resumeIssue', 'advanceManaged']) {
    const response = await runtime.handleFetch(new Request('http://localhost/api/gitlab-todo-agent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'leader', operation, humanConfirmed: true, caller: { kind: 'ui' } }),
    }));
    assert.equal(response.status, 403); assert.equal((await response.json()).ok, false);
  }
  assert.equal(calls.length, 0);
  const response = await runtime.handleFetch(new Request('http://localhost/api/gitlab-todo-agent', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'leader', operation: 'snapshot' }),
  }));
  assert.equal(response.status, 200); assert.equal((await response.json()).projection.enabled, false);
  assert.deepEqual(calls.map((call) => call.operation), ['snapshot']);
});

test('an old optional-service cleanup cannot erase a newly loaded Leader service context', async () => {
  let injectCallback; let runtime;
  const effects = new Map(); let unregistered = 0;
  const originalStart = GitlabTodoRuntime.prototype.start;
  GitlabTodoRuntime.prototype.start = async function () { runtime = this; this.leaderState = initialLeaderState(); this.saveLeaderStrict = async () => {}; };
  try {
    apply({ logger: {}, connection: { rpc: { handle: () => async () => { unregistered += 1; } } },
      inject: (_keys, callback) => { injectCallback = callback; }, effect: (callback, label) => { effects.set(label, callback); } });
    const unregisterLeader = effects.get('gitlab-todo-agent: Leader RPC')();
    await effects.get('gitlab-todo-agent: runtime')();
    const firstContext = {}; const secondContext = {};
    const cleanupFirst = injectCallback(firstContext);
    const firstAdapter = runtime.leaderAdapter;
    let finishDispose;
    firstAdapter.dispose = async () => new Promise((resolve) => { finishDispose = resolve; });
    const oldCleanup = cleanupFirst();
    assert.equal(runtime.leaderAdapter, null);
    const cleanupSecond = injectCallback(secondContext);
    const secondAdapter = runtime.leaderAdapter;
    assert.ok(secondAdapter); assert.notEqual(secondAdapter, firstAdapter);
    finishDispose(); await oldCleanup;
    assert.equal(runtime.leaderServicesContext, secondContext);
    assert.equal(runtime.leaderAdapter, secondAdapter);
    await cleanupSecond();
    await unregisterLeader(); assert.equal(unregistered, 1);
  } finally { GitlabTodoRuntime.prototype.start = originalStart; }
});

test('Leader RPC registers during plugin setup and rejects a Host without native RPC', () => {
  assert.ok(requiredInject.includes('webServer'));
  let handler; let unregister = 0;
  const effects = new Map();
  const ctx = { logger: {}, connection: { rpc: { handle(channel, callback) {
    assert.equal(channel, '/gitlab-workstation-leader'); handler = callback;
    return async () => { unregister += 1; };
  } } }, inject() {}, effect(callback, label) { effects.set(label, callback); } };
  apply(ctx);
  const dispose = effects.get('gitlab-todo-agent: Leader RPC')();
  assert.equal(typeof handler, 'function'); assert.equal(unregister, 0);
  return dispose().then(() => {
    assert.equal(unregister, 1);
    const missing = { logger: {}, connection: { rpc: {} }, inject() {}, effect(callback) { callback(); } };
    assert.throws(() => apply(missing), /原生 Connection RPC/);
  });
});

test('Leader RPC works around the rc.3 Connection webServer inject defect without changing its handler', async () => {
  const effects = new Map(); let handler; let unregister = 0;
  const ctx = { logger: {}, inject() {}, effect(callback, label) { effects.set(label, callback); } };
  ctx.connection = {
    rpc: { handle() { throw new Error('cannot get property "webServer" without inject'); } },
    register(owner, channel, callback) {
      assert.equal(owner, ctx); assert.equal(channel, '/gitlab-workstation-leader'); handler = callback;
      return async () => { unregister += 1; };
    },
  };
  apply(ctx);
  const dispose = effects.get('gitlab-todo-agent: Leader RPC')();
  assert.equal(typeof handler, 'function'); await dispose(); assert.equal(unregister, 1);
  const other = { ...ctx, connection: { rpc: { handle() { throw new Error('duplicate route'); } } } };
  apply(other);
  assert.throws(() => effects.get('gitlab-todo-agent: Leader RPC')(), /duplicate route/);
});

test('runtime startup reuses the shared early Leader journal load rather than loading twice', async () => {
  const runtime = new GitlabTodoRuntime({ logger: {}, workspaceRegistry: { archivedSessionIds: [] },
    connection: { fetch: { register: () => async () => {} }, rpc: { handle: () => async () => {} } } });
  let loads = 0;
  runtime.ensureStorage = async () => {};
  runtime.stateFile = () => { throw Object.assign(new Error('fixture missing state'), { code: 'ENOENT' }); };
  runtime.legacyStateFiles = () => [];
  runtime.loadLeader = async () => { loads += 1; runtime.leaderState = initialLeaderState(); };
  runtime.leaderLoadPromise = runtime.loadLeader();
  runtime.reconcileSessions = async () => {}; runtime.resetTimer = () => {};
  runtime.host = { dispose: async () => {} };
  try { await runtime.start(); assert.equal(loads, 1); assert.equal(runtime.leaderState.enabled, false); }
  finally { await runtime.stop(); }
});

function dispatchFixture(autoEnrollNew = true) {
  const runtime = new GitlabTodoRuntime({ workspaceRegistry: { archivedSessionIds: [] }, logger: {} });
  const issue = normalizeIssue({ id: 70, iid: 7, project_id: 42, title: 'Issue task', web_url: 'https://gitlab.example/group/repo/-/issues/7' });
  const calls = { trace: [], enrolled: [], creates: 0, prompts: 0 };
  runtime.state = initialState(); runtime.state.issues = [issue]; runtime.gitlabUserId = '1'; runtime.gitlabUsername = 'owner';
  runtime.leaderState = initialLeaderState(); runtime.leaderState.epoch = 2; runtime.leaderState.creationPolicyEpoch = 2; runtime.leaderState.settings.autoEnrollNew = autoEnrollNew;
  runtime.leaderDurableEpoch = 2; runtime.resolveWorkspaceId = () => 'workspace';
  runtime.persist = async () => { calls.trace.push('persist'); };
  runtime.autoEnrollLeaderCreated = async (taskId, sessionId) => {
    calls.trace.push('enroll');
    const record = runtime.state.handled[taskId];
    if (record.leaderCreatedPolicyEpoch !== runtime.leaderState.creationPolicyEpoch) return { ok: false, error: 'stale creation policy' };
    calls.enrolled.push({ taskId, sessionId }); return { ok: true };
  };
  runtime.host = { createSession: async () => { calls.creates += 1; return 'worker'; },
    renameSession: async (_id, title) => ({ title, seq: 1 }), selectModel: async () => {},
    prompt: async () => { calls.prompts += 1; return { accepted: true }; },
    invoke: async () => ({ kind: 'sequenced', asOfSeq: 1, values: { title: 'Original title' } }), dispose: async () => {} };
  return { runtime, issue, calls };
}

test('new Issue creation commits its stamped proof before optional enrollment without changing manual semantics', async () => {
  const { runtime, issue, calls } = dispatchFixture();
  try {
    assert.equal((await runtime.dispatch(issue)).ok, true);
    const record = runtime.state.handled[issue.id];
    assert.equal(record.automatic, false); assert.equal(record.leaderCreatedSession, 'worker'); assert.equal(record.leaderCreatedPolicyEpoch, 2);
    assert.deepEqual(calls.enrolled, [{ taskId: issue.id, sessionId: 'worker' }]);
    assert.equal(calls.trace.at(-2), 'persist'); assert.equal(calls.trace.at(-1), 'enroll');
    assert.equal(calls.creates, 1); assert.equal(calls.prompts, 1);
  } finally { await runtime.stop(); }
});

test('a future-enrollment switch changed during create does not retrospectively stamp that Issue', async () => {
  const { runtime, issue, calls } = dispatchFixture(false);
  runtime.host.createSession = async () => { calls.creates += 1; runtime.leaderState.settings.autoEnrollNew = true; runtime.leaderState.creationPolicyEpoch = 3; runtime.leaderState.epoch = 3; runtime.leaderDurableEpoch = 3; return 'worker'; };
  try {
    assert.equal((await runtime.dispatch(issue)).ok, true);
    assert.equal(Object.hasOwn(runtime.state.handled[issue.id], 'leaderCreatedPolicyEpoch'), false);
    assert.equal(calls.enrolled.length, 0); assert.equal(calls.prompts, 1);
  } finally { await runtime.stop(); }
});

test('enrollment proof write failure does not misreport an already accepted Issue as a failed dispatch', async () => {
  const { runtime, issue, calls } = dispatchFixture();
  runtime.persist = async () => { if (runtime.state.handled[issue.id]) throw new Error('simulated storage failure'); };
  try {
    assert.equal((await runtime.dispatch(issue)).ok, true);
    assert.equal(calls.enrolled.length, 0); assert.equal(calls.prompts, 1);
    assert.equal(runtime.state.handled[issue.id].executionStatus, 'running');
  } finally { await runtime.stop(); }
});
