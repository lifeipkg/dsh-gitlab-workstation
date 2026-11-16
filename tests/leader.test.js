import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, initialLeaderState, normalizeLeaderState, buildLeaderProjection, validateLeaderSettings, normalizeState } from '../core.js';
import { leaderMethods, createLeaderUiCaller, createLeaderAgentCaller } from '../host/leader.js';

const sessionState = (patch = {}) => ({ cursor: 10, active: true, running: false, queue: [], pendingInput: [], ...patch });
const missing = (sessionId) => Object.assign(new Error('not found'), { isDSHRemoteError: true, code: 'session/not-found', details: { sessionId } });
const copy = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
  const calls = { create: [], rename: [], model: [], observe: [], deliver: [], notify: [], persist: [], prepare: [] };
  const sessions = new Map([['leader', sessionState()], ['worker-a', sessionState()], ['worker-b', sessionState()], ['outside', sessionState()]]);
  const logs = new Map([['worker-a', [{ seq: 3, type: 'assistant/message', data: { text: 'HISTORICAL SECRET' } }]], ['worker-b', []]]);
  const ui = createLeaderUiCaller();
  const runtime = Object.assign({}, leaderMethods, {
    state: initialState(), leaderState: initialLeaderState(), config: {}, stopping: false,
    ctx: { workspaceRegistry: { archivedSessionIds: [] } },
    storageDirectory() { throw new Error('fixture uses in-memory persistence'); },
    ensureLeaderTimer() {}, targetBusy() { return false; }, resolveWorkspaceId(cwd) { return cwd || 'issue-workspace'; },
    host: {
      async sessionState(id) { if (!sessions.has(id)) throw missing(id); return copy(sessions.get(id)); },
      async createSession(request) { calls.create.push(copy(request)); return 'leader'; },
      async renameSession(...args) { calls.rename.push(copy(args)); },
      async selectModel(request) { calls.model.push(copy(request)); },
      async prompt() { throw new Error('Leader must never impersonate human with prompt'); },
    },
    async persistLeader() { calls.persist.push(copy(this.leaderState)); },
  });
  runtime.leaderAdapter = {
    capabilities: { atomicIdleDelivery: true, nonHumanSource: true },
    async prepare(sessionId) { calls.prepare.push(sessionId); return { ok: true, status: 'prepared', sessionId }; },
    async refreshBindings() { return true; },
    async observe(sessionId, cursor) {
      calls.observe.push([sessionId, cursor]);
      const highWater = sessions.get(sessionId)?.cursor ?? 0;
      return { cursor: highWater, highWater, events: (logs.get(sessionId) ?? []).filter((event) => event.seq > (cursor ?? -1)), truncated: false, epoch: 'live-log' };
    },
    async deliver(request) {
      assert.equal(Object.isFrozen(request), true); assert.equal(runtime.validateLeaderAdmission(request), true);
      assert.ok(calls.persist.some((state) => state.outbox.some((entry) => entry.requestId === request.requestId && entry.status === 'sending')));
      calls.deliver.push(copy(request)); return { ok: true, status: 'delivered', requestId: request.requestId };
    },
    async notify(request) {
      assert.equal(Object.isFrozen(request), true); assert.equal(runtime.validateLeaderAdmission(request), true);
      calls.notify.push(copy(request)); return { ok: true, status: 'delivered', requestId: request.requestId };
    },
  };
  for (const suffix of ['a', 'b']) {
    const item = { id: `issue-1-${suffix}`, title: `Issue ${suffix}`, source: 'issue', url: `https://gitlab.test/project/-/issues/${suffix}`, project: 'project', iid: suffix, projectId: '1' };
    runtime.state.issues.push(item);
    runtime.state.handled[item.id] = { id: item.id, sessionId: `worker-${suffix}`, item, automatic: false,
      acceptedAt: Date.now(), outcome: 'session-accepted', title: item.title, url: item.url, executionStatus: 'completed' };
  }
  const invoke = (operation, request = {}, caller = ui) => runtime.leaderOperation(operation, request, caller);
  const issue = (suffix = 'a') => ({ taskId: `issue-1-${suffix}`, sessionId: `worker-${suffix}` });
  const agent = () => createLeaderAgentCaller({ sessionId: 'leader', agentId: 'verified-agent' });
  const setup = async (count = 1) => {
    assert.equal((await invoke('create')).ok, true);
    assert.equal((await invoke('enroll', issue('a'))).ok, true);
    if (count === 2) assert.equal((await invoke('enroll', issue('b'))).ok, true);
    assert.equal((await invoke('start')).ok, true);
  };
  const advance = async (extra = {}, suffix = 'a') => {
    const read = await invoke('readIssue', issue(suffix), agent());
    if (!read.ok) return read;
    return invoke('continueIssue', { ...issue(suffix), evidenceToken: read.result.evidenceToken, body: '继续核查原 Issue 的 CI 结果，不扩大任务。', reason: '刚收到 CI 新结果。', ...extra }, agent());
  };
  // Request IDs are Host-derived now; tests locate the latest advance entry instead of naming one.
  const lastAdvance = () => runtime.leaderState.outbox.filter((entry) => entry.kind === 'advance').at(-1);
  return { runtime, calls, sessions, logs, ui, invoke, issue, agent, setup, advance, lastAdvance };
}

test('default Leader is off with no existing enrollment and independent settings', () => {
  const { runtime } = fixture();
  assert.deepEqual(runtime.leaderProjection(), { enabled: false, sessionId: null, phase: 'not-created', runState: 'not-created',
    settings: { model: null, autoEnrollNew: false }, creation: null, run: { expiresAt: null, wakeups: 0, maxWakeups: 100, lastStartedAt: null },
    items: [], deliveries: [], audit: [], events: [], error: '' });
  assert.equal(runtime.state.settings.enabled, false);
  assert.equal(Object.keys(runtime.state.handled).length, 2);
  assert.equal(runtime.leaderState.items.length, 0);
});

test('settings validate model independently and reject permission/budget expansion', () => {
  assert.deepEqual(validateLeaderSettings({ model: { provider: ' p ', model: ' m ', reasoningEffort: ' high ' }, autoEnrollNew: true }),
    { model: { provider: 'p', model: 'm', reasoningEffort: 'high' }, autoEnrollNew: true });
  for (const settings of [{ model: {} }, { model: 'm' }, { autoEnrollNew: 1 }, { maxActions: 100 }, { enabled: true }, { model: { provider: 'p', model: 'm', reasoningEffort: '' } }]) assert.throws(() => validateLeaderSettings(settings));
});

test('unbranded identity, self-reported session/human and wrong live Agent fail before any host call', async () => {
  const { runtime, calls, invoke, issue } = fixture();
  for (const caller of [undefined, null, {}, { kind: 'ui' }, { kind: 'human', sessionId: 'leader' }, { kind: 'agent', sessionId: 'leader', agentId: 'claimed' }]) {
    assert.equal((await runtime.leaderOperation('create', {}, caller)).ok, false);
  }
  assert.equal((await invoke('snapshot', {}, createLeaderAgentCaller({ sessionId: 'outside', agentId: 'real' }))).ok, false);
  assert.equal((await invoke('enroll', issue(), createLeaderAgentCaller({ sessionId: 'outside', agentId: 'real' }))).ok, false);
  assert.equal(calls.create.length, 0); assert.equal(calls.persist.length, 0);
});

test('Leader Agent scoped methods cannot grant, configure, start or resume any Issue', async () => {
  const { invoke, issue, agent, setup, calls } = fixture(); await setup();
  for (const operation of ['create', 'configure', 'enroll', 'unenroll', 'start', 'pause', 'pauseIssue', 'resumeIssue', 'grant', 'answer', 'humanReply']) {
    assert.equal((await invoke(operation, { ...issue(), settings: { autoEnrollNew: true }, human: true }, agent())).ok, false, operation);
  }
  assert.equal(calls.deliver.length, 0);
});

test('create is blank, uses independent model, persists known ID before rename/model and never prompt', async () => {
  const { runtime, invoke, calls } = fixture();
  runtime.state.settings.issueSessionModel = { provider: 'worker', model: 'worker-model' };
  const model = { provider: 'leader', model: 'leader-model', reasoningEffort: 'high' };
  assert.equal((await invoke('create', { settings: { model } })).ok, true);
  assert.deepEqual(calls.create, [{ workspaceId: 'issue-workspace' }]);
  assert.deepEqual(calls.model, [{ sessionId: 'leader', ...model }]);
  assert.equal(calls.persist[0].creation.status, 'creating');
  assert.equal(calls.persist[1].sessionId, 'leader');
  assert.equal(calls.notify.length, 0); assert.equal(calls.deliver.length, 0);
  assert.equal(runtime.leaderState.enabled, false);
});

test('cold blank Leader can be created without waking a model', async () => {
  const { invoke, sessions, calls } = fixture(); sessions.set('leader', sessionState({ active: false, queue: null }));
  assert.equal((await invoke('create')).ok, true); assert.equal(calls.notify.length, 0); assert.equal(calls.prepare.length, 0);
});

test('create partial model failure retains known ID and reuses after restart', async () => {
  const { runtime, calls, invoke } = fixture(); const select = runtime.host.selectModel;
  runtime.host.selectModel = async () => { throw new Error('model unavailable'); };
  const failed = await invoke('create', { settings: { model: { provider: 'p', model: 'm' } } });
  assert.equal(failed.ok, false); assert.equal(failed.result.sessionId, 'leader');
  runtime.leaderState = normalizeLeaderState(calls.persist.at(-1)); runtime.host.selectModel = select;
  assert.equal((await invoke('create')).ok, true); assert.equal(calls.create.length, 1);
});

test('creation throws or persisted creating prevents duplicate creation across restart', async () => {
  const { runtime, calls, invoke } = fixture();
  runtime.host.createSession = async (request) => { calls.create.push(request); throw new Error('timeout'); };
  assert.equal((await invoke('create')).ok, false);
  runtime.leaderState = normalizeLeaderState(calls.persist.at(-1));
  assert.equal((await invoke('create', { requestId: 'new' })).ok, false); assert.equal(calls.create.length, 1);
  assert.equal(runtime.leaderProjection().phase, 'uncertain');
});

test('failed reservation write prevents create and failed enrollment is rolled back', async () => {
  const { runtime, calls, invoke, issue } = fixture(); const persist = runtime.persistLeader;
  runtime.persistLeader = async () => { throw new Error('disk unavailable'); };
  assert.equal((await invoke('create')).ok, false); assert.equal(calls.create.length, 0);
  runtime.persistLeader = persist; assert.equal((await invoke('create')).ok, true);
  runtime.persistLeader = async () => { throw new Error('disk unavailable'); };
  assert.equal((await invoke('enroll', issue())).ok, false); assert.equal(runtime.leaderState.items.length, 0);
  runtime.persistLeader = persist; assert.equal((await invoke('start')).ok, false); // storage/settings error cannot silently grant.
});

test('post-create persistent write failure retains ID in memory and creating tombstone on disk', async () => {
  const { runtime, invoke, calls } = fixture(); const persist = runtime.persistLeader; let count = 0;
  runtime.persistLeader = async function () { if (++count >= 2) throw new Error('disk stopped'); return persist.call(this); };
  assert.equal((await invoke('create')).ok, false); assert.equal(runtime.leaderState.sessionId, 'leader'); assert.equal(calls.create.length, 1);
  runtime.leaderState = normalizeLeaderState(calls.persist.at(-1)); runtime.persistLeader = persist;
  assert.equal((await invoke('create')).ok, false); assert.equal(calls.create.length, 1);
});

test('explicit mapping rejects mismatched, malformed, Todo, routed, historic and Leader IDs', async () => {
  const { runtime, invoke, issue, calls } = fixture(); await invoke('create');
  for (const request of [{ taskId: 'wrong', sessionId: 'worker-a' }, { ...issue(), sessionId: 'outside' }, { ...issue(), sessionId: 'leader' },
    { ...issue(), taskId: ' issue-1-a' }, { ...issue(), sessionId: 2 }, { ...issue(), sessionId: 'a\0b' }]) assert.equal((await invoke('enroll', request)).ok, false);
  runtime.state.handled['issue-1-a'].history = [{ sessionId: 'outside' }];
  assert.equal((await invoke('enroll', { taskId: 'issue-1-a', sessionId: 'outside' })).ok, false);
  runtime.state.handled['issue-1-a'].routed = true; assert.equal((await invoke('enroll', issue())).ok, false);
  runtime.state.handled['issue-1-a'].routed = false; runtime.state.handled['issue-1-a'].item.source = '';
  runtime.state.issues = []; assert.equal((await invoke('enroll', issue())).ok, false);
  assert.equal(calls.deliver.length, 0);
});

test('autoEnrollNew setting alone never retroactively enrolls any existing session', async () => {
  const { runtime, invoke } = fixture(); assert.equal((await invoke('configure', { settings: { autoEnrollNew: true } })).ok, true);
  assert.equal(runtime.leaderState.items.length, 0); assert.equal(runtime.state.handled['issue-1-a'].automatic, false);
});

test('unavailable unsafe adapter never falls back to human prompt', async () => {
  const { runtime, invoke, calls } = fixture(); await invoke('create');
  runtime.leaderAdapter.capabilities.atomicIdleDelivery = false;
  const result = await invoke('start'); assert.equal(result.ok, false); assert.match(result.error, /unavailable/);
  assert.equal(calls.deliver.length, 0); assert.equal(calls.notify.length, 0);
});

test('start baseline gives one concise bootstrap without historical replay; idle/stable does not loop', async () => {
  const { runtime, calls, setup } = fixture(); await setup();
  assert.equal(calls.notify.length, 1); assert.match(calls.notify[0].body, /启动简报/); assert.doesNotMatch(calls.notify[0].body, /HISTORICAL SECRET/);
  for (let i = 0; i < 3; i += 1) await runtime.reconcileLeader();
  assert.equal(calls.notify.length, 1); assert.equal(calls.deliver.length, 0); assert.equal(runtime.leaderState.events.length, 0);
  assert.equal(runtime.state.handled['issue-1-a'].automatic, false);
});

test('new bounded events notify once, neither idle nor turn/end claims Issue closed', async () => {
  const { runtime, calls, logs, sessions, setup } = fixture(); await setup();
  sessions.set('worker-a', sessionState({ cursor: 11 })); logs.get('worker-a').push({ seq: 11, type: 'turn/end', data: { reason: 'completed' } });
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, 2);
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, 2);
  assert.equal(runtime.leaderState.items[0].status, 'watching'); assert.equal(calls.deliver.length, 0);
});

test('read and advance refuse non-enrolled or stale mapped IDs', async () => {
  const { runtime, invoke, agent, issue, setup, calls } = fixture(); await setup();
  for (const request of [issue('b'), { ...issue(), sessionId: 'outside' }]) {
    assert.equal((await invoke('readIssue', request, agent())).ok, false);
    assert.equal((await invoke('continueIssue', { ...request, evidenceToken: 'forged', body: 'continue', reason: 'new fact' }, agent())).ok, false);
    for (const operation of ['renameSession', 'archiveSession', 'selectSessionModel', 'relayReply', 'updateIssue']) {
      assert.equal((await invoke(operation, { ...request, title: '#a x', reason: 'r', model: { provider: 'p', model: 'm' }, text: 't', stage: 's' }, agent())).ok, false, operation);
    }
  }
  runtime.state.handled['issue-1-a'].sessionId = 'outside';
  assert.equal((await invoke('readIssue', issue(), agent())).ok, false);
  assert.equal((await invoke('pauseIssue', issue())).ok, true); assert.equal((await invoke('unenroll', issue())).ok, true);
  assert.equal(calls.deliver.length, 0);
});

test('advance requires fresh exact evidence and strictly persisted frozen outbox', async () => {
  const { runtime, advance, calls, setup, lastAdvance } = fixture(); await setup();
  const result = await advance(); assert.equal(result.ok, true); assert.equal(calls.deliver.length, 1);
  assert.match(calls.deliver[0].body, /不是人类输入/); assert.match(calls.deliver[0].body, /仅限原 Issue/);
  const outbox = lastAdvance(); assert.equal(outbox.status, 'sent'); assert.match(outbox.requestId, /^leader-continue-/);
  assert.equal(runtime.validateLeaderAdmission(calls.deliver[0]), false); // receipt consumed admission.
  assert.equal((await advance()).ok, true); assert.equal(calls.deliver.length, 1);
});

test('missing, expired, wrong epoch/cursor and truncated evidence fail closed', async () => {
  const { runtime, invoke, issue, agent, setup, calls } = fixture(); await setup();
  const read = await invoke('readIssue', issue(), agent());
  assert.match(read.result.evidenceToken, /^[0-9a-f]{32}$/u);
  const request = { ...issue(), body: 'continue', reason: 'new fact', evidenceToken: read.result.evidenceToken };
  for (const evidenceToken of [undefined, '', 'forged', read.result.evidenceToken.replace(/.$/u, 'x')]) {
    assert.equal((await invoke('continueIssue', { ...request, evidenceToken }, agent())).ok, false);
  }
  // Any Leader epoch change (a new grant/pause/enrollment) invalidates the old token.
  runtime.leaderState.epoch += 1;
  assert.equal((await invoke('continueIssue', request, agent())).ok, false);
  const fresh = (await invoke('readIssue', issue(), agent())).result.evidenceToken;
  runtime.leaderState.items[0].observation.observedAt = Date.now() - 120001;
  assert.equal((await invoke('continueIssue', { ...request, evidenceToken: fresh }, agent())).ok, false);
  runtime.leaderState.items[0].observation.observedAt = Date.now(); runtime.leaderState.items[0].observation.truncated = true;
  assert.equal((await invoke('continueIssue', { ...request, evidenceToken: fresh }, agent())).ok, false); assert.equal(calls.deliver.length, 0);
});

test('busy, queue, pending native approval/question and cold sessions never advance', async () => {
  for (const patch of [{ running: true }, { queue: [{}] }, { pendingInput: ['approval'] }, { pendingInput: ['question'] }, { active: false, queue: null }]) {
    const { sessions, advance, setup, calls } = fixture(); await setup(); sessions.set('worker-a', sessionState(patch));
    assert.equal((await advance()).ok, false); assert.equal(calls.deliver.length, 0);
  }
});

test('unknown, missing, archived state fail closed; no restoration/delete side effect', async () => {
  for (const type of ['unknown', 'missing', 'archived']) {
    const { runtime, invoke, issue, setup, calls } = fixture(); await setup();
    if (type === 'unknown') runtime.host.sessionState = async () => { throw new Error('network'); };
    else if (type === 'missing') runtime.host.sessionState = async (id) => { if (id === 'worker-a') throw missing(id); return sessionState(); };
    else runtime.ctx.workspaceRegistry.archivedSessionIds = ['worker-a'];
    await runtime.reconcileLeader(); assert.equal((await invoke('resumeIssue', issue())).ok, false); assert.equal(calls.deliver.length, 0);
  }
});

test('fake not-found code or wrong session details remain unknown rather than missing', async () => {
  const { runtime } = fixture();
  for (const error of [new Error('session/not-found'), missing('other'), { code: 'session/not-found', details: { sessionId: 'worker-a' } }]) {
    runtime.host.sessionState = async () => { throw error; }; assert.equal((await runtime.inspectLeaderSession('worker-a')).status, 'unknown');
  }
});

test('outbox write failure prevents delivery and pauses the Leader', async () => {
  const { runtime, advance, setup, calls } = fixture(); await setup();
  const persist = runtime.persistLeader;
  runtime.persistLeader = async function () { if (this.leaderState.outbox.some((entry) => entry.kind === 'advance')) throw new Error('outbox disk failure'); return persist.call(this); };
  assert.equal((await advance()).ok, false); assert.equal(calls.deliver.length, 0); assert.equal(runtime.leaderState.enabled, false);
});

test('mapping changes during preparing persist cancels outbox before any delivery', async () => {
  const { runtime, advance, setup, calls } = fixture(); await setup(); const persist = runtime.persistLeader;
  runtime.persistLeader = async function () {
    await persist.call(this);
    if (this.leaderState.outbox.some((entry) => entry.kind === 'advance' && entry.status === 'prepared')) this.state.handled['issue-1-a'].sessionId = 'outside';
  };
  assert.equal((await advance()).ok, false); assert.equal(calls.deliver.length, 0);
});

test('native idle admission race rejection never queues or retries', async () => {
  const { runtime, advance, setup, calls, sessions } = fixture(); await setup();
  runtime.leaderAdapter.deliver = async (request) => {
    calls.deliver.push(request); sessions.set('worker-a', sessionState({ cursor: 11, running: true }));
    return { ok: false, status: 'rejected', error: 'busy after atomic native guard' };
  };
  assert.equal((await advance()).ok, false); assert.equal(runtime.leaderState.outbox.at(-1).status, 'rejected');
  assert.equal((await advance()).ok, false); assert.equal(calls.deliver.length, 1);
});

test('uncertain delivery freezes only its Issue and new IDs/unenroll-reenroll cannot bypass tombstone', async () => {
  const { runtime, advance, setup, calls, invoke, issue } = fixture(); await setup(2);
  const deliver = runtime.leaderAdapter.deliver;
  runtime.leaderAdapter.deliver = async (request) => { calls.deliver.push(request); throw new Error('receipt lost'); };
  assert.equal((await advance()).ok, false); assert.equal(runtime.leaderState.outbox.at(-1).status, 'uncertain');
  runtime.leaderAdapter.deliver = deliver;
  assert.equal((await invoke('resumeIssue', issue())).ok, false);
  assert.equal((await invoke('unenroll', issue())).ok, true); assert.equal((await invoke('enroll', issue())).ok, true);
  assert.equal((await advance({ body: '换一种措辞的续办建议，试图生成新 requestId。' })).ok, false);
  assert.equal((await advance({}, 'b')).ok, true); assert.equal(runtime.leaderState.enabled, true);
});

test('restart preserves sending uncertainty without replay and permits other Issues after explicit start', async () => {
  const { runtime, advance, setup, invoke, calls } = fixture(); await setup(2);
  runtime.leaderAdapter.deliver = async (request) => { calls.deliver.push(request); throw new Error('lost'); };
  assert.equal((await advance()).ok, false); runtime.leaderState = normalizeLeaderState(calls.persist.at(-1));
  assert.equal(runtime.leaderState.enabled, false); assert.equal(runtime.leaderState.outbox.at(-1).status, 'uncertain');
  assert.equal((await invoke('start')).ok, true); assert.equal(calls.deliver.length, 1);
});

test('blocker pauses only one Issue, alerts deduplicate, formal input cannot be answered by tools', async () => {
  const { runtime, invoke, issue, agent, setup, advance, calls } = fixture(); await setup(2);
  const blocker = { ...issue(), needsHuman: '是否采用方案 A？', stage: '业务方案需人类选择' };
  assert.equal((await invoke('updateIssue', blocker, agent())).ok, true);
  assert.equal((await invoke('updateIssue', blocker, agent())).ok, true);
  assert.equal(runtime.leaderState.items[0].alerts.length, 1);
  assert.equal(runtime.leaderState.items[0].status, 'needs-human'); assert.equal(runtime.leaderState.enabled, true);
  assert.equal((await advance({}, 'b')).ok, true);
  assert.equal((await invoke('answer', { ...issue(), human: true, alertId: runtime.leaderState.items[0].alerts[0].id }, agent())).ok, false);
  await runtime.reconcileLeader(); const count = calls.notify.length; await runtime.reconcileLeader(); assert.equal(calls.notify.length, count);
});

test('Leader pause stops automatic observation and advancement but permits exact read-only inspection', async () => {
  const { runtime, invoke, setup, calls, issue, agent, advance } = fixture(); await setup(); await invoke('pause');
  const count = calls.observe.length; await runtime.reconcileLeader(); assert.equal(calls.observe.length, count);
  assert.equal((await invoke('readIssue', issue(), agent())).ok, true);
  assert.equal((await advance()).ok, false); assert.equal(calls.deliver.length, 0); assert.equal(calls.notify.length, 1);
  assert.equal(runtime.state.handled['issue-1-a'].automatic, false);
});

test('truncated increment or cursor/epoch rollback never authorize continuation', async () => {
  for (const patch of [{ cursor: 9, highWater: 10, events: [], truncated: false, epoch: 'live-log' },
    { cursor: 10, highWater: 10, events: [], truncated: false, epoch: 'replacement-log' },
    { cursor: 10, highWater: 10, events: [], truncated: true, epoch: 'live-log' }]) {
    const { runtime, invoke, issue, agent, setup, calls } = fixture(); await setup();
    runtime.leaderAdapter.observe = async () => patch;
    const read = await invoke('readIssue', issue(), agent()); assert.equal(read.ok, true);
    const request = { ...issue(), body: 'continue', reason: 'new fact', evidenceToken: read.result.evidenceToken ?? 'none' };
    assert.equal((await invoke('continueIssue', request, agent())).ok, false); assert.equal(calls.deliver.length, 0);
  }
});

test('run expiry and bounded wake/action budgets do not loop forever', async () => {
  const { runtime, setup, calls, advance } = fixture(); await setup();
  runtime.leaderState.items[0].actions = 20; assert.equal((await advance()).ok, false);
  Object.assign(runtime.leaderState.items[0], { actions: 0, paused: false, alerts: [] });
  runtime.leaderState.expiresAt = Date.now() - 1; await runtime.reconcileLeader();
  // Bootstrap plus exactly one stop note telling the human why automation paused.
  assert.equal(runtime.leaderState.enabled, false); assert.equal(calls.notify.length, 2);
  assert.match(calls.notify[1].body, /自动托管即将暂停/); assert.match(calls.notify[1].body, /24 小时/);
  assert.equal(runtime.leaderState.items[0].status, 'standby');
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, 2);
});

test('separate journal normalization does not change Todo/Issue normalization semantics', () => {
  const state = initialState(); state.handled.task = { id: 'task', sessionId: 'worker', acceptedAt: 1, automatic: false,
    outcome: 'session-accepted', item: { id: 'task', source: 'issue', title: 'Title' } };
  const normalized = normalizeState(state); assert.equal(normalized.handled.task.automatic, false); assert.equal(normalized.version, 6);
  const leader = normalizeLeaderState(initialLeaderState()); assert.equal(leader.enabled, false); assert.equal(leader.phase, 'not-created');
  assert.deepEqual(buildLeaderProjection(leader).items, []);
});

test('concurrent create requests serialize and never create two Leader sessions', async () => {
  const { invoke, calls } = fixture();
  const results = await Promise.all([invoke('create', { requestId: 'first' }), invoke('create', { requestId: 'second' })]);
  assert.equal(results.every((result) => result.ok), true); assert.equal(calls.create.length, 1);
});

test('explicit create retry cannot silently claim default model reset after native reset failed', async () => {
  const { runtime, invoke, calls } = fixture();
  assert.equal((await invoke('create', { settings: { model: { provider: 'p', model: 'm' } } })).ok, true);
  assert.equal((await invoke('configure', { settings: { model: null } })).ok, false);
  assert.equal((await invoke('create')).ok, false); assert.equal(runtime.leaderState.configuredModel.model, 'm');
  runtime.leaderAdapter.resetModel = async () => {};
  assert.equal((await invoke('create')).ok, true); assert.equal(runtime.leaderState.configuredModel, null); assert.equal(calls.create.length, 1);
});

test('UI start grant is invisible to native admission until strict write resolves', async () => {
  const { runtime, invoke } = fixture(); await invoke('create');
  const persist = runtime.persistLeader; let checked = false;
  runtime.persistLeader = async function () {
    if (this.leaderState.enabled && this.leaderDurableEpoch !== this.leaderState.epoch) {
      checked = true; assert.equal(this.validateLeaderAdmission({ epoch: this.leaderState.epoch, leaderSessionId: 'leader' }), false);
    }
    await persist.call(this);
  };
  assert.equal((await invoke('start')).ok, true); assert.equal(checked, true);
});

test('new auto-enrollment requires actual persisted policy proof and current durable admission epoch', async () => {
  const { runtime, invoke, issue } = fixture();
  assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, false);
  await invoke('configure', { settings: { autoEnrollNew: true } });
  assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, false);
  runtime.state.handled['issue-1-a'].leaderCreatedSession = 'worker-a';
  assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, false);
  runtime.state.handled['issue-1-a'].leaderCreatedPolicyEpoch = runtime.leaderState.creationPolicyEpoch;
  assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, true);
  // Leader is paused: the new Issue waits as standby (not individually paused) and is watched on the next start.
  const item = runtime.leaderState.items[0]; assert.equal(item.paused, false); assert.equal(item.status, 'standby'); assert.equal(item.provenance.kind, 'created');
  assert.equal(runtime.state.handled['issue-1-a'].automatic, false);
  await invoke('unenroll', issue());
  runtime.state.handled['issue-1-a'].leaderCreatedPolicyEpoch = runtime.leaderState.creationPolicyEpoch;
  assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, true);
  assert.equal(runtime.leaderState.items.length, 0); // consumed tuple is a durable tombstone, not a fresh grant.
});

test('later enabling auto policy cannot retrospectively enroll stale pending proof', async () => {
  const { runtime, invoke } = fixture();
  runtime.state.handled['issue-1-a'].leaderCreatedSession = 'worker-a'; runtime.state.handled['issue-1-a'].leaderCreatedPolicyEpoch = 0;
  await invoke('configure', { settings: { autoEnrollNew: true } });
  assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, false);
  assert.equal(runtime.leaderState.items.length, 0);
});

test('parallel new Issue proofs share policy epoch despite each enrollment advancing admission epoch', async () => {
  const { runtime, invoke } = fixture(); await invoke('configure', { settings: { autoEnrollNew: true } });
  const policyEpoch = runtime.leaderState.creationPolicyEpoch; const admissionEpoch = runtime.leaderState.epoch;
  for (const suffix of ['a', 'b']) Object.assign(runtime.state.handled[`issue-1-${suffix}`], {
    leaderCreatedSession: `worker-${suffix}`, leaderCreatedPolicyEpoch: policyEpoch,
  });
  const results = await Promise.all(['a', 'b'].map((suffix) => runtime.autoEnrollLeaderCreated(`issue-1-${suffix}`, `worker-${suffix}`)));
  assert.ok(results.every((result) => result.ok)); assert.equal(runtime.leaderState.items.length, 2);
  assert.equal(runtime.leaderState.epoch, admissionEpoch + 2); assert.equal(runtime.leaderState.creationPolicyEpoch, policyEpoch);
  assert.equal(runtime.leaderDurableEpoch, runtime.leaderState.epoch);
  await invoke('configure', { settings: { model: { provider: 'p', model: 'm' } } });
  await invoke('create'); await invoke('start'); await invoke('pause');
  assert.equal(runtime.leaderState.creationPolicyEpoch, policyEpoch); // model/mapping/run changes are not policy revocations.
});

test('policy toggle or restart revokes old pending policy proof without retrospective enrollment', async () => {
  for (const revoke of ['toggle', 'restart']) {
    const { runtime, invoke, calls } = fixture(); await invoke('configure', { settings: { autoEnrollNew: true } });
    const oldPolicy = runtime.leaderState.creationPolicyEpoch;
    const record = runtime.state.handled['issue-1-a']; delete runtime.state.handled['issue-1-a'];
    runtime.state.pending['issue-1-a'] = { ...record, leaderCreatedSession: 'worker-a', leaderCreatedPolicyEpoch: oldPolicy };
    if (revoke === 'toggle') {
      await invoke('configure', { settings: { autoEnrollNew: false } }); await invoke('configure', { settings: { autoEnrollNew: true } });
      assert.equal(runtime.leaderState.creationPolicyEpoch, oldPolicy + 2);
    } else {
      runtime.leaderState = normalizeLeaderState(calls.persist.at(-1)); await runtime.saveLeaderStrict();
      assert.equal(runtime.leaderState.creationPolicyEpoch, oldPolicy + 1);
    }
    assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, false);
    assert.equal(runtime.leaderState.items.length, 0);
  }
});

test('create settings policy changes use the same revocation counter and strict durable grant', async () => {
  const { runtime, invoke } = fixture(); assert.equal((await invoke('create', { settings: { autoEnrollNew: true } })).ok, true);
  const policy = runtime.leaderState.creationPolicyEpoch; assert.equal(policy, 1);
  Object.assign(runtime.state.handled['issue-1-a'], { leaderCreatedSession: 'worker-a', leaderCreatedPolicyEpoch: policy });
  await invoke('create', { settings: { autoEnrollNew: false } }); await invoke('create', { settings: { autoEnrollNew: true } });
  assert.equal(runtime.leaderState.creationPolicyEpoch, policy + 2);
  assert.equal(runtime.leaderDurableEpoch, runtime.leaderState.epoch);
  assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, false);
});

test('legacy proof domain is ignored and malformed policy counters cannot admit an undefined proof', async () => {
  const { runtime, invoke } = fixture(); await invoke('configure', { settings: { autoEnrollNew: true } });
  Object.assign(runtime.state.handled['issue-1-a'], { leaderCreatedSession: 'worker-a', leaderCreatedEpoch: runtime.leaderState.creationPolicyEpoch });
  const normalized = normalizeState(runtime.state); assert.equal('leaderCreatedPolicyEpoch' in normalized.handled['issue-1-a'], false);
  assert.equal('leaderCreatedEpoch' in normalized.handled['issue-1-a'], false);
  assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, false);
  delete runtime.leaderState.creationPolicyEpoch;
  assert.equal((await runtime.autoEnrollLeaderCreated('issue-1-a', 'worker-a')).ok, false);
  for (const invalid of [null, -1, '1', 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => normalizeLeaderState({ ...initialLeaderState(), creationPolicyEpoch: invalid }));
  const legacy = initialLeaderState(); delete legacy.creationPolicyEpoch;
  assert.equal(normalizeLeaderState(legacy).creationPolicyEpoch, 1);
});

test('known partial creation remains explicitly retryable after pause and successful model configuration', async () => {
  const { runtime, invoke, calls } = fixture(); const rename = runtime.host.renameSession;
  runtime.host.renameSession = async () => { throw new Error('rename unavailable'); };
  assert.equal((await invoke('create')).ok, false); assert.equal(runtime.leaderState.creation.status, 'created');
  await invoke('pause'); assert.equal((await invoke('configure', { settings: { model: { provider: 'p', model: 'm' } } })).ok, true);
  assert.equal(runtime.leaderState.phase, 'paused'); assert.match(runtime.leaderState.error, /设置尚未完成.*重试设置/);
  assert.equal(runtime.leaderState.creation.status, 'created'); assert.equal((await invoke('start')).ok, false);
  runtime.host.renameSession = rename; assert.equal((await invoke('create')).ok, true);
  assert.equal(runtime.leaderState.creation.status, 'ready'); assert.equal(runtime.leaderState.error, ''); assert.equal(calls.create.length, 1);
});

test('creation proof normalization preserves only exact current IDs and never invents historical provenance', () => {
  const { runtime } = fixture(); const state = runtime.state;
  state.handled['issue-1-a'].leaderCreatedSession = 'worker-a'; state.handled['issue-1-a'].leaderCreatedPolicyEpoch = 2;
  state.handled['issue-1-b'].leaderCreatedSession = 'outside'; state.handled['issue-1-b'].leaderCreatedPolicyEpoch = 2;
  state.pending.pending = { sessionId: 'pending-worker', item: { id: 'pending', source: 'issue' }, automatic: false, leaderCreatedSession: 'pending-worker', leaderCreatedPolicyEpoch: 3 };
  const normalized = normalizeState(state);
  assert.equal(normalized.handled['issue-1-a'].leaderCreatedSession, 'worker-a'); assert.equal(normalized.handled['issue-1-a'].leaderCreatedPolicyEpoch, 2);
  assert.equal('leaderCreatedSession' in normalized.handled['issue-1-b'], false);
  assert.equal(normalized.pending.pending.leaderCreatedPolicyEpoch, 3);
  delete state.handled['issue-1-a'].leaderCreatedSession;
  assert.equal('leaderCreatedPolicyEpoch' in normalizeState(state).handled['issue-1-a'], false);
});

test('cold Leader start prepares and binds before evaluating dynamic native capabilities', async () => {
  const { runtime, invoke, sessions, calls } = fixture(); let bound = false;
  sessions.set('leader', sessionState({ active: false, queue: null }));
  Object.defineProperty(runtime.leaderAdapter, 'capabilities', { get: () => ({ atomicIdleDelivery: bound, nonHumanSource: bound }) });
  runtime.leaderAdapter.prepare = async (sessionId) => {
    assert.equal(runtime.leaderState.enabled, false);
    assert.equal(calls.persist.at(-1).sessionId, sessionId); calls.prepare.push(sessionId);
    sessions.set(sessionId, sessionState()); bound = true; return { ok: true, status: 'prepared', sessionId };
  };
  assert.equal((await invoke('create')).ok, true); assert.equal(runtime.leaderAdapterAvailable(), false);
  assert.equal((await invoke('start')).ok, true); assert.deepEqual(calls.prepare, ['leader']); assert.equal(calls.notify.length, 1);
});

test('supervisor consumption never loses the report inspected by the next Leader read', async () => {
  const { runtime, setup, sessions, logs, issue, agent, calls, invoke } = fixture(); await setup();
  sessions.set('worker-a', sessionState({ cursor: 11 }));
  logs.get('worker-a').push({ seq: 11, type: 'assistant/message', data: { text: 'Current Issue report after CI' } });
  await runtime.reconcileLeader(); assert.equal(runtime.leaderState.items[0].cursor, 11);
  const read = await invoke('readIssue', issue(), agent()); assert.equal(read.ok, true);
  assert.ok(read.result.events.some((event) => event.seq === 11 && event.data.includes('Current Issue report after CI')));
  assert.equal(read.result.sessionId, 'worker-a'); assert.equal(read.result.untrusted, true); assert.ok(read.result.evidenceToken);
  assert.equal(read.result.eventsTruncated, false); assert.ok(read.result.events.every((event) => event.sourceSessionId === 'worker-a' && event.untrusted));
  assert.doesNotMatch(JSON.stringify(read.result.events), /HISTORICAL SECRET/); assert.equal(calls.deliver.length, 0);
  const restored = normalizeLeaderState(calls.persist.at(-1));
  assert.ok(restored.items[0].recentEvents.some((event) => event.data.includes('Current Issue report after CI')));
  assert.equal(restored.items[0].observation, null); // cached context never restores advancement authority.
});

test('needs-human and explicitly paused Issues remain readable without continuation authority', async () => {
  const { runtime, setup, sessions, logs, issue, agent, advance, calls, invoke } = fixture(); await setup();
  sessions.set('worker-a', sessionState({ cursor: 11, pendingInput: ['question'] }));
  logs.get('worker-a').push({ seq: 11, type: 'assistant/message', data: { text: 'Need a business decision' } });
  await runtime.reconcileLeader(); assert.equal(runtime.leaderState.items[0].status, 'needs-human');
  const read = await invoke('readIssue', issue(), agent()); assert.equal(read.ok, true);
  assert.ok(read.result.events.some((event) => event.data.includes('Need a business decision')));
  assert.equal((await advance()).ok, false); assert.equal(calls.deliver.length, 0);
  assert.equal((await invoke('readIssue', { ...issue(), sessionId: 'outside' }, agent())).ok, false);
});

test('continued native questions fence start and advancement despite an empty raw pending queue', async () => {
  const { runtime, setup, sessions, issue, agent, advance, calls, invoke } = fixture(); await setup();
  runtime.leaderAdapter.state = async (id) => ({ ...copy(sessions.get(id)), pendingInput: id === 'worker-a' ? ['question'] : [] });
  const read = await invoke('readIssue', issue(), agent()); assert.equal(read.ok, true);
  assert.equal(read.result.status, 'needs-human'); assert.equal((await advance()).ok, false); assert.equal(calls.deliver.length, 0);
  await invoke('pause');
  runtime.leaderAdapter.state = async (id) => ({ ...copy(sessions.get(id)), pendingInput: id === 'leader' ? ['question'] : [] });
  assert.equal((await invoke('start')).ok, false); assert.equal(runtime.leaderState.enabled, false);
});

test('recent report cache is bounded and marks context truncation independently of admission evidence', async () => {
  const { runtime, setup, sessions, logs, issue, agent, invoke } = fixture(); await setup();
  sessions.set('worker-a', sessionState({ cursor: 71 }));
  logs.set('worker-a', Array.from({ length: 60 }, (_, index) => ({ seq: index + 11, type: 'assistant/message', data: { text: 'x'.repeat(1000) } })));
  await runtime.reconcileLeader(); const item = runtime.leaderState.items[0];
  assert.ok(item.recentEvents.length <= 40); assert.ok(JSON.stringify(item.recentEvents).length <= 20100);
  const read = await invoke('readIssue', issue(), agent()); assert.equal(read.result.eventsTruncated, true);
  // Cache trimming is context-only: the admission observation itself is complete, so the token stays valid.
  assert.equal(runtime.leaderState.items[0].observation.truncated, false); assert.ok(read.result.evidenceToken);
  assert.doesNotThrow(() => normalizeLeaderState(runtime.leaderState));
});

test('malformed/unknown journal is Leader-only read-only failure and never overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workstation-leader-'));
  try {
    for (const source of ['{broken', JSON.stringify({ ...initialLeaderState(), version: 900 }), JSON.stringify({ ...initialLeaderState(), sessionId: '' })]) {
      await writeFile(join(directory, 'leader.json'), source);
      const { runtime, invoke, issue, calls } = fixture(); runtime.storageDirectory = () => directory; runtime.persistLeader = leaderMethods.persistLeader;
      const projection = await runtime.loadLeader(); assert.equal(projection.enabled, false); assert.equal(projection.phase, 'error');
      assert.equal((await invoke('snapshot')).ok, true);
      for (const operation of ['create', 'configure', 'start', 'enroll']) assert.equal((await invoke(operation, issue())).ok, false);
      assert.equal(await readFile(join(directory, 'leader.json'), 'utf8'), source); assert.equal(calls.create.length, 0);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('atomic standalone journal survives disk roundtrip, reload is off and no duplicate create', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workstation-leader-'));
  try {
    const { runtime, invoke, calls, issue } = fixture(); runtime.storageDirectory = () => directory; runtime.persistLeader = leaderMethods.persistLeader;
    await runtime.loadLeader(); assert.equal((await invoke('create')).ok, true); assert.equal((await invoke('enroll', issue())).ok, true);
    assert.equal((await invoke('start')).ok, true); await runtime.loadLeader(); assert.equal(runtime.leaderState.enabled, false);
    assert.equal(runtime.leaderState.items.length, 1); assert.equal((await invoke('create')).ok, true); assert.equal(calls.create.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// ---- Leader hardening (outbox compaction, triage, rollback, cold workers, budgets, recovery) ----

test('terminal outbox is compacted so a long-running Leader never wedges at the old 500 cap', async () => {
  const { runtime, setup, advance } = fixture(); await setup();
  runtime.leaderState.outbox.push(...Array.from({ length: 600 }, (_, index) => ({ kind: 'notify', requestId: `old-${index}`, sessionId: 'leader',
    status: 'sent', body: 'x'.repeat(100), fingerprint: 'f', createdAt: index, epoch: 0, expectedCursor: 0, error: '' })));
  const advanced = await advance(); assert.equal(advanced.ok, true, advanced.error);
  const outbox = runtime.leaderState.outbox;
  assert.ok(outbox.length <= 202, `outbox ${outbox.length}`);
  assert.ok(outbox.filter((entry) => entry.compacted === true && entry.body === '').length > 0);
  assert.equal(outbox.at(-1).kind, 'advance'); assert.equal(outbox.at(-1).status, 'sent');
  assert.doesNotThrow(() => normalizeLeaderState(runtime.leaderState));
});

test('unresolved deliveries still hard-stop new outbox entries', async () => {
  const { runtime, setup, advance } = fixture(); await setup();
  runtime.leaderState.outbox.push(...Array.from({ length: 100 }, (_, index) => ({ kind: 'advance', requestId: `open-${index}`, taskId: `other-${index}`,
    sessionId: `other-${index}`, status: 'uncertain', body: 'x', fingerprint: 'f', createdAt: index, epoch: 0, expectedCursor: 0, error: '' })));
  assert.equal((await advance()).ok, false);
});

test('stale-policy created-enrollment tombstones are pruned on load', () => {
  const state = { ...initialLeaderState(), creationPolicyEpoch: 3,
    createdEnrollments: [{ taskId: 't', sessionId: 's', epoch: 1, creationPolicyEpoch: 3, createdAt: 1 }] };
  // Reload bumps creationPolicyEpoch, so proofs stamped under the old policy can never match again.
  const normalized = normalizeLeaderState(JSON.parse(JSON.stringify(state)));
  assert.equal(normalized.creationPolicyEpoch, 4); assert.equal(normalized.createdEnrollments.length, 0);
});

test('worker log chatter does not wake the Leader; turn/end does, once', async () => {
  const { runtime, setup, sessions, logs, calls } = fixture(); await setup();
  assert.equal(calls.notify.length, 1);
  sessions.set('worker-a', sessionState({ cursor: 11 })); logs.set('worker-a', [{ seq: 11, type: 'assistant/message', data: { text: 'progress' } }]);
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, 1);
  sessions.set('worker-a', sessionState({ cursor: 12 })); logs.set('worker-a', [...logs.get('worker-a'), { seq: 12, type: 'turn/end', data: {} }]);
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, 2);
  assert.match(calls.notify[1].body, /turn-end/); assert.match(calls.notify[1].body, /人类只看本会话/);
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, 2);
});

test('a busy Leader keeps the wake reason durable and is notified when idle', async () => {
  const { runtime, setup, sessions, logs, calls } = fixture(); await setup();
  sessions.set('leader', sessionState({ running: true }));
  sessions.set('worker-a', sessionState({ cursor: 11 })); logs.set('worker-a', [{ seq: 11, type: 'turn/end', data: {} }]);
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, 1);
  assert.deepEqual(runtime.leaderState.items[0].pendingWake, ['turn-end']);
  sessions.set('leader', sessionState());
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, 2); assert.deepEqual(runtime.leaderState.items[0].pendingWake, []);
});

test('rejected bootstrap rolls start back to paused instead of a silent enabled Leader', async () => {
  const { runtime, invoke, issue, calls } = fixture();
  assert.equal((await invoke('create')).ok, true); assert.equal((await invoke('enroll', issue())).ok, true);
  const notify = runtime.leaderAdapter.notify;
  runtime.leaderAdapter.notify = async (request) => ({ ok: false, status: 'rejected', error: 'busy', requestId: request.requestId });
  const started = await invoke('start'); assert.equal(started.ok, false);
  assert.equal(runtime.leaderState.enabled, false); assert.equal(runtime.leaderState.phase, 'paused');
  assert.equal(runtime.leaderState.items[0].status, 'standby'); assert.match(runtime.leaderState.error, /启动简报未送达/);
  runtime.leaderAdapter.notify = notify;
  assert.equal((await invoke('start')).ok, true); assert.equal(calls.notify.length, 1); assert.equal(runtime.leaderState.error, '');
});

test('explicit start and a guarded advance activate quiet cold workers', async () => {
  const { runtime, invoke, issue, sessions, advance, calls } = fixture();
  const prepared = [];
  runtime.leaderAdapter.prepareWorker = async (sessionId) => { prepared.push(sessionId); sessions.set(sessionId, { ...sessions.get(sessionId), active: true }); return { ok: true, status: 'prepared', sessionId }; };
  assert.equal((await invoke('create')).ok, true); assert.equal((await invoke('enroll', issue())).ok, true);
  sessions.set('worker-a', sessionState({ active: false }));
  assert.equal((await invoke('start')).ok, true); assert.deepEqual(prepared, ['worker-a']);
  sessions.set('worker-a', sessionState({ active: false }));
  const result = await advance(); assert.equal(result.ok, true, result.error); assert.deepEqual(prepared, ['worker-a', 'worker-a']);
  assert.equal(calls.deliver.length, 1);
});

test('cold worker without an activation path is shown as cold, not as an error', async () => {
  const { runtime, setup, sessions } = fixture(); await setup();
  sessions.set('worker-a', sessionState({ active: false }));
  await runtime.reconcileLeader();
  assert.equal(runtime.leaderState.items[0].status, 'cold'); assert.equal(runtime.leaderState.items[0].error, '');
});

test('Leader is created with the built-in tool-less preset; explicit bad preset fails without latching', async () => {
  const { runtime, invoke, calls } = fixture();
  runtime.leaderServicesContext = { agentPresets: { async resolve(id) { if (id !== 'gitlab-issue-leader') throw new Error('unknown preset'); return { id }; } } };
  runtime.config.leaderAgentPreset = 'missing-preset';
  assert.equal((await invoke('create')).ok, false); assert.equal(calls.create.length, 0); assert.equal(runtime.leaderState.creation, null);
  delete runtime.config.leaderAgentPreset;
  assert.equal((await invoke('create')).ok, true);
  assert.equal(calls.create[0].agentPreset, 'gitlab-issue-leader'); assert.equal(runtime.leaderProjection().creation.agentPreset, 'gitlab-issue-leader');
});

test('empty leaderAgentPreset and a broken default fall back to the host default preset', async () => {
  for (const variant of ['empty', 'broken']) {
    const { runtime, invoke, calls } = fixture();
    runtime.leaderServicesContext = { agentPresets: { async resolve(id) { return { id, broken: 'missing plugin' }; } } };
    if (variant === 'empty') runtime.config.leaderAgentPreset = '';
    assert.equal((await invoke('create')).ok, true); assert.equal('agentPreset' in calls.create[0], false);
  }
});

test('unenroll + re-enroll keeps the spent budget; only an explicit reset grants a new one', async () => {
  const { runtime, setup, invoke, issue, advance } = fixture(); await setup();
  runtime.leaderState.items[0].actions = 20;
  assert.equal((await invoke('unenroll', issue())).ok, true); assert.equal((await invoke('enroll', issue())).ok, true);
  assert.equal(runtime.leaderState.items[0].actions, 20); assert.equal((await advance()).ok, false);
  // Observation already parked the exhausted Issue as needs-human; resume is refused until an explicit reset.
  assert.equal(runtime.leaderState.items[0].paused, true); assert.equal((await invoke('resumeIssue', issue())).ok, false);
  assert.equal((await invoke('resetIssueBudget', issue())).ok, true); assert.equal(runtime.leaderState.items[0].actions, 0);
  assert.equal(runtime.leaderState.items[0].paused, true); assert.equal((await invoke('resumeIssue', issue())).ok, true);
  const result = await advance(); assert.equal(result.ok, true, result.error);
  assert.equal((await invoke('resetIssueBudget', issue(), createLeaderAgentCaller({ sessionId: 'leader', agentId: 'verified-agent' }))).ok, false);
});

test('human can resolve an uncertain advance; nothing is resent automatically', async () => {
  const { runtime, setup, invoke, issue, advance, calls, lastAdvance } = fixture(); await setup();
  runtime.leaderAdapter.deliver = async () => { throw new Error('socket closed'); };
  assert.equal((await advance()).ok, false);
  const requestId = lastAdvance().requestId;
  assert.equal(runtime.leaderState.outbox.at(-1).status, 'uncertain'); assert.equal(runtime.leaderState.items[0].status, 'unknown');
  assert.equal((await invoke('resolveDelivery', { requestId: 'nope', resolution: 'delivered' })).ok, false);
  assert.equal((await invoke('resolveDelivery', { requestId, resolution: 'maybe' })).ok, false);
  assert.equal((await invoke('resolveDelivery', { requestId, resolution: 'not-delivered' })).ok, true);
  assert.equal(runtime.leaderState.outbox.find((entry) => entry.requestId === requestId).status, 'rejected');
  assert.equal((await invoke('resolveDelivery', { requestId, resolution: 'delivered' })).ok, false);
  assert.equal((await invoke('resumeIssue', issue())).ok, true);
  runtime.leaderAdapter.deliver = async (request) => { calls.deliver.push(copy(request)); return { ok: true, status: 'delivered', requestId: request.requestId }; };
  const result = await advance({ body: '重新核查后再次续办，措辞不同。' }); assert.equal(result.ok, true, result.error);
  assert.equal(calls.deliver.length, 1);
});

test('uncertain Leader notify can be resolved by the human and start is allowed again', async () => {
  const { runtime, invoke, issue } = fixture();
  assert.equal((await invoke('create')).ok, true); assert.equal((await invoke('enroll', issue())).ok, true);
  const notify = runtime.leaderAdapter.notify;
  runtime.leaderAdapter.notify = async () => { throw new Error('lost receipt'); };
  assert.equal((await invoke('start')).ok, false); assert.equal(runtime.leaderProjection().runState, 'delivery-uncertain');
  assert.equal((await invoke('start')).ok, false);
  const pending = runtime.leaderProjection().deliveries; assert.equal(pending.length, 1); assert.equal(pending[0].kind, 'notify');
  assert.equal((await invoke('resolveDelivery', { requestId: pending[0].requestId, resolution: 'delivered' })).ok, true);
  assert.equal(runtime.leaderState.phase, 'paused');
  runtime.leaderAdapter.notify = notify; assert.equal((await invoke('start')).ok, true);
});

test('uncertain Leader creation can be abandoned or claimed, never silently recreated', async () => {
  for (const resolution of ['abandon', 'claim']) {
    const { runtime, invoke, calls } = fixture();
    const create = runtime.host.createSession;
    runtime.host.createSession = async () => { throw new Error('timeout'); };
    assert.equal((await invoke('create')).ok, false); assert.equal(runtime.leaderProjection().runState, 'creation-uncertain');
    assert.equal((await invoke('create')).ok, false);
    runtime.host.createSession = create;
    if (resolution === 'abandon') {
      assert.equal((await invoke('resolveCreation', { resolution: 'abandon' })).ok, true);
      assert.equal(runtime.leaderState.abandonedCreations.length, 1); assert.equal(runtime.leaderState.phase, 'not-created');
      assert.equal((await invoke('create')).ok, true); assert.equal(calls.create.length, 1);
    } else {
      assert.equal((await invoke('resolveCreation', { resolution: 'claim', sessionId: 'worker-a' })).ok, false);
      assert.equal((await invoke('resolveCreation', { resolution: 'claim', sessionId: 'ghost' })).ok, false);
      const claimed = await invoke('resolveCreation', { resolution: 'claim', sessionId: 'outside' }); assert.equal(claimed.ok, true, claimed.error);
      assert.equal(runtime.leaderState.sessionId, 'outside'); assert.equal(runtime.leaderState.creation.status, 'ready');
      assert.equal(calls.create.length, 0); assert.deepEqual(calls.rename.at(-1), ['outside', 'GitLab Issue Leader']);
    }
  }
});

test('projection exposes run state, budgets and standby items while the Leader is paused', async () => {
  const { runtime, invoke, issue, setup } = fixture();
  assert.equal((await invoke('create')).ok, true); assert.equal(runtime.leaderProjection().runState, 'never-started');
  assert.equal((await invoke('enroll', issue())).ok, true); assert.equal(runtime.leaderProjection().items[0].status, 'standby');
  assert.equal((await invoke('start')).ok, true);
  let projection = runtime.leaderProjection();
  assert.equal(projection.runState, 'running'); assert.equal(projection.items[0].status, 'watching');
  assert.equal(projection.items[0].maxActions, 20); assert.equal(typeof projection.run.expiresAt, 'number'); assert.equal(projection.run.wakeups, 1);
  assert.equal((await invoke('pause')).ok, true); projection = runtime.leaderProjection();
  assert.equal(projection.runState, 'paused'); assert.equal(projection.items[0].status, 'standby'); assert.equal(projection.run.expiresAt, null);
  const reloaded = normalizeLeaderState(JSON.parse(JSON.stringify({ ...runtime.leaderState, enabled: true })));
  assert.equal(reloaded.items[0].status, 'standby'); void setup;
});

test('snapshot gives the Leader a read-only overview of every Issue session', async () => {
  const { setup, invoke, agent } = fixture(); await setup();
  const snapshot = await invoke('snapshot', {}, agent()); assert.equal(snapshot.ok, true);
  const issues = snapshot.result.issues; assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((item) => [item.taskId, item.sessionId, item.enrolled]), [['issue-1-a', 'worker-a', true], ['issue-1-b', 'worker-b', false]]);
  assert.equal(issues.every((item) => item.untrusted === true), true);
});

test('paused Issues are observed by state only and items are observed concurrently', async () => {
  const { runtime, setup, invoke, issue, calls } = fixture(); await setup(2);
  let active = 0; let peak = 0; const observe = runtime.leaderAdapter.observe;
  runtime.leaderAdapter.observe = async (...args) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); try { return await observe(...args); } finally { active -= 1; } };
  await runtime.reconcileLeader(); assert.equal(peak, 2);
  assert.equal((await invoke('pauseIssue', issue('b'))).ok, true);
  calls.observe.length = 0; await runtime.reconcileLeader();
  assert.deepEqual(calls.observe.map(([sessionId]) => sessionId), ['worker-a']);
});

test('unchanged Leader journal is not rewritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workstation-leader-'));
  try {
    const { runtime, invoke } = fixture(); runtime.storageDirectory = () => directory; runtime.persistLeader = leaderMethods.persistLeader;
    await runtime.loadLeader(); assert.equal((await invoke('create')).ok, true);
    const file = join(directory, 'leader.json'); await rm(file);
    await runtime.persistLeader(); await assert.rejects(readFile(file, 'utf8'));
    runtime.leaderState.settings = { ...runtime.leaderState.settings }; runtime.leaderState.epoch += 1;
    await runtime.persistLeader(); assert.equal(JSON.parse(await readFile(file, 'utf8')).epoch, runtime.leaderState.epoch);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// ---- Leader capabilities (v2.36: session management, evidence token, relay, notes, stall) ----

const withIssueLookup = (runtime) => { runtime.itemById = (id) => runtime.state.issues.find((item) => item.id === id) ?? null; };

test('Leader-only capability operations are rejected for UI callers and for non-Leader agents', async () => {
  const { setup, invoke, issue } = fixture(); await setup();
  const stranger = createLeaderAgentCaller({ sessionId: 'worker-a', agentId: 'verified-agent' });
  for (const operation of ['createSession', 'renameSession', 'archiveSession', 'selectSessionModel', 'continueIssue', 'relayReply', 'updateIssue', 'readIssue']) {
    assert.equal((await invoke(operation, issue())).ok, false, `ui ${operation}`);
    assert.equal((await invoke(operation, issue(), stranger)).ok, false, `stranger ${operation}`);
  }
});

test('session_create enrolls an existing live worker instead of creating a duplicate', async () => {
  const { runtime, setup, invoke, agent } = fixture(); await setup();
  let dispatched = 0; runtime.dispatch = async () => { dispatched += 1; return { ok: true, sessionId: 'never' }; };
  const result = await invoke('createSession', { taskId: 'issue-1-b' }, agent()); assert.equal(result.ok, true, result.error);
  assert.equal(result.result.existing, true); assert.equal(result.result.sessionId, 'worker-b'); assert.equal(dispatched, 0);
  const item = runtime.leaderState.items.find((entry) => entry.taskId === 'issue-1-b');
  assert.equal(item.provenance.kind, 'leader'); assert.equal(runtime.leaderProjection().audit.at(-1).action, 'session-enroll');
  assert.equal((await invoke('createSession', { taskId: 'not-listed' }, agent())).ok, false);
  assert.equal((await invoke('createSession', { taskId: '' }, agent())).ok, false);
});

test('session_create dispatches through the Issue path once the old worker is archived and replaces the roster entry', async () => {
  const { runtime, setup, invoke, agent, sessions } = fixture(); await setup();
  runtime.ctx.workspaceRegistry.archivedSessionIds = ['worker-a'];
  const forced = [];
  runtime.dispatch = async (todo, force) => {
    forced.push([todo.id, force]); sessions.set('worker-new', sessionState());
    runtime.state.handled[todo.id] = { ...runtime.state.handled[todo.id], sessionId: 'worker-new', acceptedAt: Date.now() };
    return { ok: true, sessionId: 'worker-new', duplicate: false };
  };
  const result = await invoke('createSession', { taskId: 'issue-1-a' }, agent()); assert.equal(result.ok, true, result.error);
  assert.deepEqual(forced, [['issue-1-a', true]]); assert.equal(result.result.existing, false);
  const items = runtime.leaderState.items.filter((entry) => entry.taskId === 'issue-1-a');
  assert.deepEqual(items.map((entry) => entry.sessionId), ['worker-new']); assert.equal(items[0].status, 'watching');
  assert.equal(runtime.leaderProjection().audit.at(-1).action, 'session-create');
  runtime.dispatch = async () => ({ ok: false, error: 'GitLab unavailable' });
  runtime.ctx.workspaceRegistry.archivedSessionIds = ['worker-a', 'worker-b'];
  const failed = await invoke('createSession', { taskId: 'issue-1-b' }, agent()); assert.equal(failed.ok, false); assert.match(failed.error, /GitLab unavailable/);
});

test('session_rename keeps the Issue prefix, updates the Issue record and is audited', async () => {
  const { runtime, setup, invoke, issue, agent, calls } = fixture(); await setup(); withIssueLookup(runtime);
  for (const title of ['修复 CI', '#b 错误 Issue', `#a ${'x'.repeat(80)}`, '']) assert.equal((await invoke('renameSession', { ...issue(), title }, agent())).ok, false, title);
  assert.equal((await invoke('renameSession', { taskId: 'issue-1-a', sessionId: 'leader', title: '#a x' }, agent())).ok, false);
  const result = await invoke('renameSession', { ...issue(), title: '#a 修复 CI 流水线' }, agent()); assert.equal(result.ok, true, result.error);
  assert.deepEqual(calls.rename.at(-1), ['worker-a', '#a 修复 CI 流水线']);
  assert.equal(runtime.state.handled['issue-1-a'].sessionTitle, '#a 修复 CI 流水线');
  assert.equal(runtime.leaderProjection().audit.at(-1).action, 'session-rename');
});

test('session_archive requires a reason, refuses busy workers and unenrolls the archived one', async () => {
  const { runtime, setup, invoke, issue, agent, sessions } = fixture(); await setup();
  const archived = []; runtime.setSessionArchived = async (sessionId, value) => { archived.push([sessionId, value]); return { ok: true }; };
  assert.equal((await invoke('archiveSession', { ...issue(), reason: '' }, agent())).ok, false);
  for (const patch of [{ running: true }, { queue: [{}] }, { pendingInput: ['approval'] }]) {
    sessions.set('worker-a', sessionState(patch));
    assert.equal((await invoke('archiveSession', { ...issue(), reason: '任务已完成' }, agent())).ok, false);
  }
  assert.equal(archived.length, 0); sessions.set('worker-a', sessionState());
  const result = await invoke('archiveSession', { ...issue(), reason: '任务已完成，MR 已合并' }, agent()); assert.equal(result.ok, true, result.error);
  assert.deepEqual(archived, [['worker-a', true]]); assert.equal(runtime.leaderState.items.length, 0);
  const audit = runtime.leaderProjection().audit.at(-1); assert.equal(audit.action, 'session-archive'); assert.match(audit.detail, /MR 已合并/);
  assert.equal((await invoke('archiveSession', { ...issue(), reason: 'again' }, agent())).ok, false);
});

test('session_select_model only accepts catalog models on a quiet worker and lists choices on refusal', async () => {
  const { runtime, setup, invoke, issue, agent, calls, sessions } = fixture(); await setup();
  runtime.host.modelCatalog = async () => ({ groups: [{ id: 'kiro', models: [{ id: 'fast' }, { id: 'deep' }] }] });
  const unknown = await invoke('selectSessionModel', { ...issue(), model: { provider: 'kiro', model: 'ghost' } }, agent());
  assert.equal(unknown.ok, false); assert.deepEqual(unknown.result.available, [{ provider: 'kiro', model: 'fast' }, { provider: 'kiro', model: 'deep' }]);
  sessions.set('worker-a', sessionState({ running: true }));
  assert.equal((await invoke('selectSessionModel', { ...issue(), model: { provider: 'kiro', model: 'deep' } }, agent())).ok, false);
  sessions.set('worker-a', sessionState());
  const result = await invoke('selectSessionModel', { ...issue(), model: { provider: 'kiro', model: 'deep' } }, agent()); assert.equal(result.ok, true, result.error);
  assert.equal(calls.model.at(-1).sessionId, 'worker-a'); assert.equal(calls.model.at(-1).model, 'deep');
  assert.equal(runtime.leaderProjection().audit.at(-1).action, 'session-model');
});

test('update_issue stores structured notes; needsHuman pauses only that Issue', async () => {
  const { runtime, setup, invoke, issue, agent, advance } = fixture(); await setup(2);
  assert.equal((await invoke('updateIssue', { ...issue(), stage: 'x'.repeat(201) }, agent())).ok, false);
  const updated = await invoke('updateIssue', { ...issue(), stage: '修复中', next: '等 CI', decisions: ['采用方案 B'] }, agent());
  assert.equal(updated.ok, true, updated.error); assert.equal(updated.result.alertId, null);
  const item = runtime.leaderProjection().items[0];
  assert.equal(item.notes.stage, '修复中'); assert.deepEqual(item.notes.decisions, ['采用方案 B']); assert.match(item.summary, /下一步：等 CI/);
  const merged = await invoke('updateIssue', { ...issue(), waitingOn: '人类确认' }, agent());
  assert.equal(merged.result.notes.stage, '修复中'); assert.equal(merged.result.notes.waitingOn, '人类确认');
  const asked = await invoke('updateIssue', { ...issue(), needsHuman: '是否发布到生产？' }, agent()); assert.ok(asked.result.alertId);
  assert.equal(runtime.leaderState.items[0].status, 'needs-human'); assert.equal(runtime.leaderState.items[0].paused, true);
  assert.equal((await advance()).ok, false); assert.equal((await advance({}, 'b')).ok, true);
});

test('relay_reply forwards only verified human text, unpauses the asked Issue and works while paused', async () => {
  const { runtime, setup, invoke, issue, agent } = fixture(); await setup();
  const relayed = [];
  runtime.leaderAdapter.humanMessages = async () => [{ seq: 40, text: '关于 #a：请采用方案 A，然后继续。' }];
  runtime.leaderAdapter.relay = async (request) => {
    assert.equal(Object.isFrozen(request), true); assert.equal(runtime.validateLeaderAdmission(request), true);
    relayed.push(copy(request)); return { ok: true, status: 'delivered', requestId: request.requestId };
  };
  await invoke('updateIssue', { ...issue(), needsHuman: '采用方案 A 还是 B？' }, agent());
  assert.equal((await invoke('relayReply', { ...issue(), text: '请采用方案 B' }, agent())).ok, false); assert.equal(relayed.length, 0);
  const result = await invoke('relayReply', { ...issue(), text: '请采用方案 A，然后继续。' }, agent()); assert.equal(result.ok, true, result.error);
  assert.equal(relayed.length, 1); assert.match(relayed[0].body, /人类原话/); assert.match(relayed[0].body, /请采用方案 A/);
  assert.equal(runtime.leaderState.items[0].paused, false); assert.equal(runtime.leaderState.items[0].alerts[0].status, 'acknowledged');
  assert.equal(runtime.leaderState.items[0].actions, 0); // relays never spend the continuation budget.
  assert.equal((await invoke('relayReply', { ...issue(), text: '请采用方案 A，然后继续。' }, agent())).ok, true); assert.equal(relayed.length, 1);
  assert.equal(runtime.leaderProjection().audit.at(-1).action, 'relay-reply');
  assert.equal((await invoke('pause')).ok, true);
  runtime.leaderAdapter.humanMessages = async () => [{ seq: 41, text: '先别合并' }];
  assert.equal((await invoke('relayReply', { ...issue(), text: '先别合并' }, agent())).ok, true); assert.equal(relayed.length, 2);
});

test('relay_reply never answers native questions and waits for an idle worker', async () => {
  const { runtime, setup, invoke, issue, agent, sessions } = fixture(); await setup();
  const relayed = []; runtime.leaderAdapter.humanMessages = async () => [{ seq: 40, text: '选 A' }];
  runtime.leaderAdapter.relay = async (request) => { relayed.push(request); return { ok: true, status: 'delivered', requestId: request.requestId }; };
  for (const patch of [{ pendingInput: ['question'] }, { running: true }, { queue: [{}] }]) {
    sessions.set('worker-a', sessionState(patch));
    assert.equal((await invoke('relayReply', { ...issue(), text: '选 A' }, agent())).ok, false);
  }
  assert.equal(relayed.length, 0);
});

test('read_issue exposes pending native question text for the human, and wake lines stay short', async () => {
  const { runtime, setup, invoke, issue, agent, sessions, logs, calls } = fixture(); await setup();
  runtime.leaderAdapter.questions = async () => ['要不要删除旧分支？ 选项：是 / 否'];
  sessions.set('worker-a', sessionState({ cursor: 11, pendingInput: ['question'] }));
  logs.get('worker-a').push({ seq: 11, type: 'assistant/message', data: { text: 'x'.repeat(5000) } });
  const read = await invoke('readIssue', issue(), agent()); assert.deepEqual(read.result.pendingQuestions, ['要不要删除旧分支？ 选项：是 / 否']);
  await runtime.reconcileLeader(); const body = calls.notify.at(-1).body;
  assert.ok(body.length < 2000, `wake body ${body.length}`); assert.doesNotMatch(body, /xxxxxxxxxx/); assert.match(body, /taskId=issue-1-a/);
});

test('a running worker silent for 20 minutes wakes the Leader once per stall', async () => {
  const { runtime, setup, sessions, calls } = fixture(); await setup();
  sessions.set('worker-a', sessionState({ running: true })); await runtime.reconcileLeader();
  const count = calls.notify.length;
  runtime.leaderState.items[0].lastActivityAt = Date.now() - 21 * 60 * 1000; await runtime.reconcileLeader();
  assert.equal(calls.notify.length, count + 1); assert.match(calls.notify.at(-1).body, /stalled/);
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, count + 1);
});
