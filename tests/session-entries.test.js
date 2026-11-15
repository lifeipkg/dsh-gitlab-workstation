import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, normalizeState } from '../core.js';
import { DshHostClient } from '../dsh-host.js';
import { GitlabTodoRuntime } from '../index.js';

const stateResponse = () => ({ cursor: 0, active: false, running: false, queue: null, pendingInput: [] });
const missing = (sessionId) => Object.assign(new Error('not found'), { isDSHRemoteError: true, code: 'session/not-found', details: { sessionId } });
function fixture(issue = false) {
  const calls = { create: [], rename: [], model: [], persist: [] };
  const runtime = Object.assign(Object.create(GitlabTodoRuntime.prototype), {
    state: initialState(), ctx: { workspaceRegistry: { archivedSessionIds: [] } }, config: { agentPreset: 'manual-preset' },
    host: {
      async sessionState(id) { if (id === 'old') throw missing(id); return stateResponse(); },
      async createSession(request) { calls.create.push(request); return 'new'; },
      async renameSession(...args) { calls.rename.push(args); },
      async selectModel(request) { calls.model.push(request); },
      async prompt() { throw new Error('manual handoff must never prompt'); },
    },
    async persist() { calls.persist.push(JSON.parse(JSON.stringify(this.state))); },
    resolveWorkspaceId(cwd) { return cwd === 'issue-dir' ? 'issue-workspace' : 'todo-workspace'; },
    snapshot() { return {}; },
  });
  runtime.state.settings.sessionCwd = 'todo-dir';
  runtime.state.settings.issueSessionCwd = 'issue-dir';
  runtime.state.settings.sessionModel = { provider: 'p', model: 'todo', reasoning: 'low' };
  runtime.state.settings.issueSessionModel = { provider: 'q', model: 'issue', reasoning: 'high' };
  runtime.state.handled.task = { id: 'task', sessionId: 'old', closure: 'needs-human', archived: true,
    title: 'A task', reportSummary: 'Historical summary', item: { id: 'task', ...(issue ? { source: 'issue', kind: 'issue' } : {}) } };
  return { runtime, calls };
}
const post = (runtime, body) => runtime.handleFetch(new Request('http://local/api/gitlab-todo-agent', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

test('passive host lookup uses session/state request envelope without list/create', async () => {
  const calls = [];
  const host = new DshHostClient({ typertGateway: { async invoke(call) { calls.push(call); return stateResponse(); } } });
  await host.sessionState('cold');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].namespace, 'session'); assert.equal(calls[0].method, 'state');
  assert.deepEqual(calls[0].args, { request: { sessionId: 'cold' } });
  await host.peer.dispose();
});

test('authoritative lookup separates active/archived/missing/unknown, not cached archive or list omission', async () => {
  const { runtime } = fixture();
  assert.equal((await runtime.inspectSession('old')).status, 'missing');
  assert.equal((await runtime.inspectSession('existing')).status, 'active');
  runtime.ctx.workspaceRegistry.archivedSessionIds = ['existing'];
  assert.equal((await runtime.inspectSession('existing')).status, 'archived');
  runtime.ctx.workspaceRegistry.archivedSessionIds = undefined;
  assert.equal((await runtime.inspectSession('existing')).status, 'unknown');
  for (const error of [new Error('session/not-found'), Object.assign(missing('other'), { details: { sessionId: 'other' } }),
    { code: 'session/not-found', details: { sessionId: 'old' } }, { isDSHRemoteError: true, code: 'permission-denied' }]) {
    runtime.host.sessionState = async () => { throw error; };
    assert.equal((await runtime.inspectSession('old')).status, 'unknown');
  }
  runtime.ctx.workspaceRegistry.archivedSessionIds = [];
  for (const state of [null, {}, { ...stateResponse(), cursor: -1 }, { ...stateResponse(), pendingInput: ['invalid'] }, { ...stateResponse(), queue: {} }]) {
    runtime.host.sessionState = async () => state;
    assert.equal((await runtime.inspectSession('old')).status, 'unknown');
  }
});

test('invalid inspect bridge IDs rejected without invoking host', async () => {
  const { runtime } = fixture(); runtime.host.sessionState = () => { throw new Error('must not invoke'); };
  for (const sessionId of ['', ' old', 1, null, 'a\u0000b', 'a'.repeat(201)]) {
    assert.equal((await post(runtime, { action: 'inspectSession', sessionId })).status, 400);
  }
});

test('attached bridge returns inspect result and explicit handoff state contract', async () => {
  const { runtime, calls } = fixture();
  const inspection = await (await post(runtime, { action: 'inspectSession', sessionId: 'old' })).json();
  assert.equal(inspection.ok, true); assert.equal(inspection.result.status, 'missing');
  const response = await (await post(runtime, { action: 'createHandoff', taskId: 'task', sessionId: 'old', requestId: 'r' })).json();
  assert.equal(response.ok, true); assert.equal(response.result.ok, true); assert.equal(response.result.sessionId, 'new');
  assert.deepEqual(response.state, {}); assert.equal(calls.create.length, 1);
  assert.equal(typeof GitlabTodoRuntime.prototype.inspectSession, 'function');
});

test('manual handoff creates blank session with separate Issue route and preserves original closure/session', async () => {
  for (const issue of [false, true]) {
    const { runtime, calls } = fixture(issue);
    const result = await runtime.createHandoff('task', 'old', 'r');
    assert.equal(result.ok, true); assert.match(result.handoffText, /Historical summary/);
    assert.deepEqual(calls.create, [{ workspaceId: issue ? 'issue-workspace' : 'todo-workspace', agentPreset: 'manual-preset' }]);
    assert.equal(calls.model[0].model, issue ? 'issue' : 'todo');
    assert.equal(calls.model[0].reasoning, issue ? 'high' : 'low');
    assert.equal(runtime.state.handled.task.sessionId, 'old'); assert.equal(runtime.state.handled.task.closure, 'needs-human');
    assert.deepEqual(runtime.state.pending, {}); assert.equal(runtime.slots, undefined);
    assert.equal(runtime.state.manualHandoffs[0].status, 'ready');
    assert.equal((await runtime.inspectSession('old')).manualHandoffs[0].sessionId, 'new');
  }
});

test('same request and new modal request reuse existing handoff after normalization/reload', async () => {
  const { runtime, calls } = fixture();
  await runtime.createHandoff('task', 'old', 'r');
  runtime.state = normalizeState(runtime.state);
  assert.equal((await runtime.createHandoff('task', 'old', 'r')).sessionId, 'new');
  assert.equal((await runtime.createHandoff('task', 'old', 'another-modal')).sessionId, 'new');
  assert.equal(calls.create.length, 1);
  assert.equal((await runtime.inspectSession('old')).manualHandoffs[0].handoffText.includes('Historical summary'), true);
  assert.equal(runtime.state.handled.task.manualHandoffs[0].sessionId, 'new');
});

test('handoff rejects mismatched task/source and active/archived/unknown originals', async () => {
  const { runtime, calls } = fixture();
  assert.equal((await runtime.createHandoff('wrong', 'old', 'r')).ok, false);
  assert.equal((await runtime.createHandoff('task', 'other', 'r')).ok, false);
  assert.equal((await runtime.createHandoff('task', 'old', '')).ok, false);
  for (const status of ['active', 'archived', 'unknown']) {
    runtime.inspectSession = async (sessionId) => ({ sessionId, status });
    assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, false);
  }
  assert.equal(calls.create.length, 0);
});

test('concurrent same request joins single operation and other request is rejected', async () => {
  const { runtime, calls } = fixture(); let release;
  const gate = new Promise((resolve) => { release = resolve; });
  runtime.host.createSession = async (request) => { calls.create.push(request); await gate; return 'new'; };
  const first = runtime.createHandoff('task', 'old', 'r');
  const second = runtime.createHandoff('task', 'old', 'r');
  assert.equal((await runtime.createHandoff('task', 'old', 'other')).ok, false);
  release(); const results = await Promise.all([first, second]);
  assert.equal(results[0].sessionId, 'new'); assert.deepEqual(results[0], results[1]); assert.equal(calls.create.length, 1);
});

test('uncertain create and persisted creating journal fail closed across restart/new requests', async () => {
  const { runtime, calls } = fixture();
  runtime.host.createSession = async (request) => { calls.create.push(request); throw new Error('timeout'); };
  assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, false);
  assert.equal(runtime.state.manualHandoffs[0].status, 'creation-unknown');
  runtime.state = normalizeState(runtime.state);
  assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, false);
  assert.equal((await runtime.createHandoff('task', 'old', 'new-request')).ok, false); assert.equal(calls.create.length, 1);
  runtime.state.manualHandoffs[0].status = 'creating'; runtime.state = normalizeState(runtime.state);
  assert.equal((await runtime.createHandoff('task', 'old', 'other')).ok, false); assert.equal(calls.create.length, 1);
});

test('reservation persist failure prevents create and explicit retry can recover', async () => {
  const { runtime, calls } = fixture(); const persist = runtime.persist;
  runtime.persist = async () => { throw new Error('disk unavailable'); };
  assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, false); assert.equal(calls.create.length, 0);
  runtime.persist = persist;
  assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, true); assert.equal(calls.create.length, 1);
});

test('model/rename failures preserve new ID/summary after reload and retry clears errors without creating again', async () => {
  for (const method of ['renameSession', 'selectModel']) {
    const { runtime, calls } = fixture(); const original = runtime.host[method];
    runtime.host[method] = async () => { throw new Error('settings unavailable'); };
    const failure = await runtime.createHandoff('task', 'old', 'r');
    assert.equal(failure.ok, false); assert.equal(failure.sessionId, 'new'); assert.ok(failure.handoffText);
    assert.equal(failure.requestId, 'r'); assert.equal(failure.sourceSessionId, 'old');
    runtime.state = normalizeState(calls.persist.at(-1));
    assert.equal((await runtime.inspectSession('old')).manualHandoffs[0].sessionId, 'new');
    assert.match(runtime.state.manualHandoffs[0].error, /settings unavailable/);
    runtime.host[method] = original;
    assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, true);
    assert.equal(runtime.state.manualHandoffs[0].error, ''); assert.equal(calls.create.length, 1);
  }
});

test('known handoff archived or unknown is returned rather than duplicated; deleted same request stays idempotent', async () => {
  const { runtime, calls } = fixture(); await runtime.createHandoff('task', 'old', 'r');
  runtime.ctx.workspaceRegistry.archivedSessionIds = ['new'];
  const archived = await runtime.createHandoff('task', 'old', 'other');
  assert.equal(archived.status, 'archived'); assert.equal(archived.sessionId, 'new'); assert.equal(calls.create.length, 1);
  runtime.host.sessionState = async () => { throw new Error('network'); };
  assert.equal((await runtime.createHandoff('task', 'old', 'third')).sessionId, 'new'); assert.equal(calls.create.length, 1);
  runtime.host.sessionState = async (id) => { throw missing(id); };
  assert.equal((await runtime.createHandoff('task', 'old', 'r')).status, 'missing'); assert.equal(calls.create.length, 1);
  assert.equal(runtime.state.handled.task.closure, 'needs-human');
});

test('record replacement and whole-state replacement during create keep created journal IDs reachable', async () => {
  for (const wholeState of [false, true]) {
    const { runtime, calls } = fixture();
    runtime.host.createSession = async (request) => {
      calls.create.push(request);
      if (wholeState) runtime.state = normalizeState(runtime.state);
      runtime.state.handled.task = { ...runtime.state.handled.task, manualHandoffs: [] };
      return 'new';
    };
    assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, true);
    assert.equal(runtime.state.handled.task.manualHandoffs[0].sessionId, 'new');
    assert.equal(normalizeState(calls.persist.at(-1)).manualHandoffs[0].sessionId, 'new');
    assert.equal((await runtime.createHandoff('task', 'old', 'another')).sessionId, 'new'); assert.equal(calls.create.length, 1);
  }
});

test('post-create and ready persistence failures retain known ID, retry clears persisted errors', async () => {
  for (const failAt of [2, 4]) {
    const { runtime, calls } = fixture(); const persist = runtime.persist; let count = 0;
    runtime.persist = async function () { if (++count === failAt) throw new Error('transient disk failure'); await persist.call(this); };
    const result = await runtime.createHandoff('task', 'old', 'r');
    assert.equal(result.ok, false); assert.equal(result.sessionId, 'new'); assert.ok(result.handoffText);
    assert.equal(result.requestId, 'r'); assert.equal(result.sourceSessionId, 'old');
    assert.equal(calls.persist.at(-1).manualHandoffs[0].sessionId, 'new');
    runtime.state = normalizeState(calls.persist.at(-1));
    assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, true);
    assert.equal(calls.create.length, 1); assert.equal(calls.persist.at(-1).manualHandoffs[0].error, '');
  }
});

test('whole-state replacement while create fails preserves uncertain journal and prevents another create', async () => {
  const { runtime, calls } = fixture();
  runtime.host.createSession = async (request) => { calls.create.push(request); runtime.state = normalizeState(runtime.state); throw new Error('creation interrupted'); };
  assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, false);
  assert.equal(runtime.state.manualHandoffs[0].status, 'creation-unknown');
  runtime.state = normalizeState(calls.persist.at(-1));
  assert.equal((await runtime.createHandoff('task', 'old', 'another')).ok, false); assert.equal(calls.create.length, 1);
});

test('pending handoff journal/record snapshots round-trip without changing original pending identity', async () => {
  const { runtime } = fixture(); runtime.state.pending.task = runtime.state.handled.task; delete runtime.state.handled.task;
  assert.equal((await runtime.createHandoff('task', 'old', 'r')).ok, true);
  runtime.state = normalizeState(runtime.state);
  assert.equal(runtime.state.pending.task.sessionId, 'old'); assert.equal(runtime.state.pending.task.manualHandoffs[0].sessionId, 'new');
  assert.equal((await runtime.inspectSession('old')).manualHandoffs[0].taskId, 'task');
});

test('task removal before create stops it; task removal after create preserves ID in independent journal', async () => {
  const before = fixture(); const persist = before.runtime.persist;
  before.runtime.persist = async function () { await persist.call(this); delete this.state.handled.task; };
  assert.equal((await before.runtime.createHandoff('task', 'old', 'r')).ok, false); assert.equal(before.calls.create.length, 0);
  const after = fixture();
  after.runtime.host.createSession = async (request) => { after.calls.create.push(request); delete after.runtime.state.handled.task; return 'new'; };
  const result = await after.runtime.createHandoff('task', 'old', 'r');
  assert.equal(result.ok, false); assert.equal(result.sessionId, 'new');
  assert.equal(normalizeState(after.calls.persist.at(-1)).manualHandoffs[0].sessionId, 'new');
  assert.equal((await after.runtime.inspectSession('old')).manualHandoffs[0].sessionId, 'new');
});
