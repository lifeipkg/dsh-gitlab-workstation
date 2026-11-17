import assert from 'node:assert/strict';
import test from 'node:test';
import { GitlabTodoRuntime, apply, inject as requiredInject } from '../index.js';
import { initialState, initialLeaderState, normalizeIssue } from '../core.js';
import { createLeaderUiCaller } from '../host/leader.js';

function rpcFixture() {
  const browserPeer = { principal: { kind: 'owner' }, signal: new AbortController().signal };
  const runtime = Object.create(GitlabTodoRuntime.prototype);
  const calls = [];
  Object.assign(runtime, { ctx: { connection: { browserPeer } }, stopping: false,
    leaderOperation: async (operation, payload) => { calls.push({ operation, payload }); return { ok: true }; },
    leaderProjection: () => ({ sessionId: null, phase: 'not-created' }), snapshot: () => ({ version: 6 }) });
  return { runtime, browserPeer, calls };
}

test('Leader UI operations require the real browser Peer, not another owner, an Agent or JSON identity', async () => {
  const { runtime, browserPeer, calls } = rpcFixture();
  const payload = { sessionId: 'worker', principal: { kind: 'owner' }, caller: { kind: 'ui' } };
  for (const peer of [undefined, { ...browserPeer }, { principal: { kind: 'agent', agentId: 'leader' }, signal: browserPeer.signal }]) {
    const result = await runtime.handleLeaderUiRpc('create', payload, new AbortController().signal, peer);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'leader/forbidden');
  }
  assert.equal(calls.length, 0);
  const result = await runtime.handleLeaderUiRpc('create', payload, new AbortController().signal, browserPeer);
  assert.equal(result.ok, true); assert.equal(result.value.result.ok, true); assert.equal(calls.length, 1);
  // Every v3 UI operation is reachable; the removed v2 grants are not.
  for (const operation of ['snapshot', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery']) {
    assert.equal((await runtime.handleLeaderUiRpc(operation, {}, undefined, browserPeer)).ok, true, operation);
  }
  for (const removed of ['enroll', 'unenroll', 'start', 'pause', 'pauseIssue', 'resumeIssue', 'advanceManaged', 'handoff', 'cancelQueued', 'board', 'session', 'workerReport']) {
    const denied = await runtime.handleLeaderUiRpc(removed, {}, undefined, browserPeer);
    assert.equal(denied.ok, false, removed); assert.equal(denied.error.code, 'leader/invalid-request');
  }
});

test('Leader native UI RPC rejects aborts, unknown endpoints and oversized payloads', async () => {
  const { runtime, browserPeer, calls } = rpcFixture();
  const controller = new AbortController(); controller.abort();
  assert.equal((await runtime.handleLeaderUiRpc('create', {}, controller.signal, browserPeer)).ok, false);
  assert.equal((await runtime.handleLeaderUiRpc('nothing', {}, undefined, browserPeer)).ok, false);
  assert.equal((await runtime.handleLeaderUiRpc('create', [], undefined, browserPeer)).ok, false);
  assert.equal((await runtime.handleLeaderUiRpc('configure', { data: 'x'.repeat(3_000_000) }, undefined, browserPeer)).ok, false);
  assert.equal(calls.length, 0);
});

test('the UI RPC runs operations with the Host-minted UI caller', async () => {
  const { runtime, browserPeer } = rpcFixture();
  let seen;
  runtime.leaderOperation = async (operation, payload, caller) => { seen = { operation, payload, caller }; return { ok: true }; };
  await runtime.handleLeaderUiRpc('configure', { settings: { model: null }, caller: { kind: 'agent' } }, undefined, browserPeer);
  assert.equal(seen.operation, 'configure');
  assert.deepEqual(Object.keys(seen.caller), []);
  assert.equal(createLeaderUiCaller().constructor, seen.caller.constructor);
});

test('HTTP Leader bridge is snapshot-only even with self-reported human confirmation', async () => {
  const { runtime, calls } = rpcFixture();
  for (const operation of ['create', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery', 'session', 'board']) {
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
  assert.equal(response.status, 200); assert.equal((await response.json()).projection.sessionId, null);
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
  try { await runtime.start(); assert.equal(loads, 1); assert.equal(runtime.leaderState.phase, 'not-created'); }
  finally { await runtime.stop(); }
});

function dispatchFixture() {
  const runtime = new GitlabTodoRuntime({ workspaceRegistry: { archivedSessionIds: [] }, logger: {} });
  const issue = normalizeIssue({ id: 70, iid: 7, project_id: 42, title: 'Issue task', web_url: 'https://gitlab.example/group/repo/-/issues/7' });
  const calls = { creates: 0, prompts: 0 };
  runtime.state = initialState(); runtime.state.issues = [issue]; runtime.gitlabUserId = '1'; runtime.gitlabUsername = 'owner';
  runtime.leaderState = initialLeaderState(); runtime.resolveWorkspaceId = () => 'workspace';
  runtime.persist = async () => {};
  runtime.host = { createSession: async () => { calls.creates += 1; return 'worker'; },
    renameSession: async (_id, title) => ({ title, seq: 1 }), selectModel: async () => {},
    prompt: async () => { calls.prompts += 1; return { accepted: true }; },
    invoke: async () => ({ kind: 'sequenced', asOfSeq: 1, values: { title: 'Original title' } }), dispose: async () => {} };
  return { runtime, issue, calls };
}

test('a plain Issue dispatch makes its session manageable by the Leader without any enrollment or policy stamp', async () => {
  const { runtime, issue, calls } = dispatchFixture();
  try {
    assert.equal((await runtime.dispatch(issue)).ok, true);
    const record = runtime.state.handled[issue.id];
    assert.equal(record.sessionId, 'worker'); assert.equal(record.automatic, false);
    for (const field of ['leaderCreatedSession', 'leaderCreatedPolicyEpoch', 'leaderTaskId']) assert.equal(Object.hasOwn(record, field), false, field);
    assert.equal(calls.creates, 1); assert.equal(calls.prompts, 1);
    assert.equal(runtime.isLeaderManagedSession('worker'), true);
    assert.equal(runtime.isLeaderManagedSession('outside'), false);
    assert.deepEqual([...runtime.leaderManagedSessionIds()], ['worker']);
    assert.equal(runtime.leaderTaskForSession('worker'), issue.id);
  } finally { await runtime.stop(); }
});

test('the Leader session itself is never reported as managed even if a record points at it', async () => {
  const { runtime, issue } = dispatchFixture();
  try {
    await runtime.dispatch(issue);
    runtime.leaderState.sessionId = 'worker';
    assert.equal(runtime.isLeaderManagedSession('worker'), false);
    assert.deepEqual([...runtime.leaderManagedSessionIds()], []);
  } finally { await runtime.stop(); }
});