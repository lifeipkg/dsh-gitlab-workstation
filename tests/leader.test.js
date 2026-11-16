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
    settings: { ...initialLeaderState().settings }, creation: null, run: { expiresAt: null, wakeups: 0, maxWakeups: 100, lastStartedAt: null },
    items: [], previousSessions: [], comments: [], queue: [], completed: [], deliveries: [], audit: [], tasks: [], reports: [], events: [], error: '' });
  assert.equal(runtime.leaderProjection().settings.maxRunningWorkers, 3);
  assert.equal(runtime.leaderProjection().settings.archiveOnComplete, true);
  assert.equal(runtime.state.settings.enabled, false);
  assert.equal(Object.keys(runtime.state.handled).length, 2);
  assert.equal(runtime.leaderState.items.length, 0);
});

test('settings validate model independently and reject permission/budget expansion', () => {
  assert.deepEqual(validateLeaderSettings({ model: { provider: ' p ', model: ' m ', reasoningEffort: ' high ' }, autoEnrollNew: true }),
    { ...initialLeaderState().settings, model: { provider: 'p', model: 'm', reasoningEffort: 'high' }, autoEnrollNew: true });
  assert.equal(validateLeaderSettings({ maxRunningWorkers: 10, archiveOnComplete: false }).maxRunningWorkers, 10);
  assert.equal(validateLeaderSettings({ archiveOnComplete: false }).archiveOnComplete, false);
  for (const settings of [{ maxRunningWorkers: 0 }, { maxRunningWorkers: 11 }, { maxRunningWorkers: 2.5 }, { maxRunningWorkers: '3' }, { archiveOnComplete: 'yes' }]) assert.throws(() => validateLeaderSettings(settings));
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

// ---- Leader ad-hoc task sessions (v2.38: work without a GitLab Issue) ----

const withTaskHost = (runtime, sessions, sessionId = 'task-s') => {
  const created = []; const prompts = []; const archived = [];
  runtime.host.createSession = async (request) => { created.push(copy(request)); sessions.set(sessionId, sessionState()); return sessionId; };
  runtime.host.prompt = async (request) => { prompts.push(copy(request)); };
  runtime.host.archiveSession = async (id) => { archived.push(id); };
  return { created, prompts, archived };
};

test('session_create without taskId opens an enrolled ad-hoc task session with its brief, even while paused', async () => {
  const { runtime, setup, invoke, agent, sessions, calls } = fixture(); await setup();
  const host = withTaskHost(runtime, sessions);
  for (const request of [{}, { title: '调查 IAM' }, { brief: '梳理' }, { title: 'x'.repeat(71), brief: '梳理' }, { title: '调查', brief: 'x'.repeat(8001) }]) {
    assert.equal((await invoke('createSession', request, agent())).ok, false, JSON.stringify(request).slice(0, 40));
  }
  assert.equal(host.created.length, 0);
  assert.equal((await invoke('pause')).ok, true);
  const result = await invoke('createSession', { title: '调查 IAM 架构', brief: '梳理 IAM 服务的模块边界与鉴权链路，输出结论。' }, agent());
  assert.equal(result.ok, true, result.error);
  const { taskId } = result.result;
  assert.match(taskId, /^leader-task-[0-9a-f]{12}$/u); assert.equal(result.result.kind, 'task'); assert.equal(result.result.briefDelivered, true);
  assert.deepEqual(host.created, [{ workspaceId: 'issue-workspace' }]);
  assert.deepEqual(calls.rename.at(-1), ['task-s', '[临时] 调查 IAM 架构']);
  assert.equal(host.prompts.length, 1); assert.equal(host.prompts[0].requestId, `${taskId}-brief`); assert.equal(host.prompts[0].mode, 'queue');
  assert.match(host.prompts[0].content[0].text, /临时任务/); assert.match(host.prompts[0].content[0].text, /梳理 IAM 服务的模块边界/);
  const projection = runtime.leaderProjection();
  const item = projection.items.find((entry) => entry.taskId === taskId);
  assert.equal(item.kind, 'task'); assert.equal(item.provenance, 'leader'); assert.equal(item.sessionId, 'task-s');
  assert.deepEqual(projection.tasks.map((task) => [task.taskId, task.status]), [[taskId, 'created']]);
  assert.equal(projection.audit.at(-1).action, 'task-create');
  // No count limit: a second task is just another session.
  withTaskHost(runtime, sessions, 'task-t');
  assert.equal((await invoke('createSession', { title: '第二个调查', brief: '另一个独立问题。' }, agent())).ok, true);
  assert.equal(runtime.leaderProjection().tasks.length, 2);
});

test('ad-hoc tasks are read, continued, renamed and archived like Issue workers', async () => {
  const { runtime, setup, invoke, agent, sessions, calls } = fixture(); await setup();
  const host = withTaskHost(runtime, sessions);
  const { taskId } = (await invoke('createSession', { title: '调查 IAM 架构', brief: '梳理 IAM 鉴权链路。' }, agent())).result;
  const target = { taskId, sessionId: 'task-s' };
  let gitlab = 0; runtime.leaderIssueGitlab = async () => { gitlab += 1; return {}; };
  const read = await invoke('readIssue', target, agent()); assert.equal(read.ok, true, read.error);
  assert.equal(read.result.kind, 'task'); assert.match(read.result.brief, /IAM 鉴权链路/); assert.equal(gitlab, 0); assert.equal(read.result.gitlab, undefined);
  const continued = await invoke('continueIssue', { ...target, evidenceToken: read.result.evidenceToken, body: '补充：只看 paas-iam 仓。', reason: '人类补充范围。' }, agent());
  assert.equal(continued.ok, true, continued.error); assert.match(calls.deliver.at(-1).body, /仅限原临时任务：调查 IAM 架构/);
  const renamed = await invoke('renameSession', { ...target, title: 'IAM 架构调查（已出结论）' }, agent()); assert.equal(renamed.ok, true, renamed.error);
  assert.deepEqual(calls.rename.at(-1), ['task-s', 'IAM 架构调查（已出结论）']);
  assert.equal(runtime.leaderProjection().tasks[0].title, 'IAM 架构调查（已出结论）');
  assert.equal((await invoke('archiveSession', { ...target, reason: '' }, agent())).ok, false);
  const archived = await invoke('archiveSession', { ...target, reason: '调查已完成并已汇报' }, agent()); assert.equal(archived.ok, true, archived.error);
  assert.deepEqual(host.archived, ['task-s']);
  assert.equal(runtime.leaderState.items.some((entry) => entry.taskId === taskId), false);
  assert.deepEqual(runtime.leaderProjection().tasks, []);
  assert.equal(runtime.leaderState.tasks[0].status, 'archived');
});

test('ad-hoc task workspace must be registered and failures list the available workspaces', async () => {
  const { runtime, setup, invoke, agent, sessions } = fixture(); await setup();
  const host = withTaskHost(runtime, sessions);
  runtime.resolveWorkspaceId = () => { throw new Error('配置的工作区文件夹未在 DSH 工作区中注册：D:\\nope'); };
  runtime.ctx.workspaceRegistry.list = () => [{ path: 'D:\\agent-workspace' }, { cwd: 'D:\\other' }];
  const result = await invoke('createSession', { title: '调查', brief: '说明', workingDirectory: 'D:\\nope' }, agent());
  assert.equal(result.ok, false); assert.deepEqual(result.result.available, ['D:\\agent-workspace', 'D:\\other']);
  assert.equal(host.created.length, 0); assert.deepEqual(runtime.leaderState.tasks, []);
});

test('uncertain ad-hoc creation is never retried and only the human can dismiss it', async () => {
  const { runtime, setup, invoke, agent } = fixture(); await setup();
  runtime.host.createSession = async () => { throw new Error('timeout'); };
  const failed = await invoke('createSession', { title: '调查 IAM', brief: '说明' }, agent());
  assert.equal(failed.ok, false); assert.match(failed.error, /timeout/);
  const { taskId } = failed.result;
  assert.equal(runtime.leaderProjection().tasks[0].status, 'uncertain');
  assert.equal(runtime.leaderState.items.some((entry) => entry.taskId === taskId), false);
  // A crash between reservation and Host create also latches as uncertain.
  const reloaded = normalizeLeaderState({ ...copy(runtime.leaderState), tasks: [{ taskId: 'leader-task-0123456789ab', sessionId: null, title: 't', brief: 'b', workspace: '', status: 'creating', createdAt: 1, error: '' }] });
  assert.equal(reloaded.tasks[0].status, 'uncertain'); assert.match(reloaded.tasks[0].error, /禁止自动重建/);
  assert.equal((await invoke('resolveTask', { taskId, action: 'dismiss' }, agent())).ok, false);
  assert.equal((await invoke('resolveTask', { taskId, action: 'retry' })).ok, false);
  const dismissed = await invoke('resolveTask', { taskId, action: 'dismiss' }); assert.equal(dismissed.ok, true, dismissed.error);
  assert.deepEqual(dismissed.result.tasks, []); assert.equal(runtime.leaderProjection().audit.at(-1).action, 'task-dismiss');
  assert.equal((await invoke('resolveTask', { taskId, action: 'dismiss' })).ok, false);
});

// ---- Leader orchestration (v2.39): running cap + queue, dependencies, completion, Todo routing ----

const gitlabFacts = (patch = {}) => ({ available: true, state: 'opened', mergeRequests: [], ...patch });
const auditActions = (runtime) => runtime.leaderState.audit.map((entry) => entry.action);

test('running-worker cap queues continue/create FIFO, dedupes, never dequeues while paused and lets the human cancel', async () => {
  const { runtime, setup, invoke, issue, agent, sessions, calls, advance } = fixture(); await setup(2);
  const host = withTaskHost(runtime, sessions);
  assert.equal((await invoke('configure', { settings: { maxRunningWorkers: 1 } })).ok, true);
  assert.equal(runtime.leaderProjection().settings.maxRunningWorkers, 1);
  sessions.set('worker-a', sessionState({ running: true })); await runtime.reconcileLeader();
  const queued = await advance({}, 'b');
  assert.equal(queued.ok, true, queued.error); assert.equal(queued.result.queued, true); assert.equal(queued.result.position, 1);
  assert.equal(calls.deliver.length, 0);
  const again = await advance({ body: '换个说法也算同一个续办请求' }, 'b');
  assert.equal(again.result.queueId, queued.result.queueId); assert.equal(again.result.duplicate, true);
  const create = await invoke('createSession', { title: '调查 IAM', brief: '梳理鉴权链路。' }, agent());
  assert.equal(create.ok, true, create.error); assert.equal(create.result.queued, true); assert.equal(create.result.position, 2);
  assert.equal(host.created.length, 0);
  assert.deepEqual(runtime.leaderProjection().queue.map((entry) => [entry.kind, entry.taskId, entry.position]), [['continue', 'issue-1-b', 1], ['create', null, 2]]);
  // Paused Leader never dequeues, even when slots are free.
  assert.equal((await invoke('pause')).ok, true);
  sessions.set('worker-a', sessionState()); await runtime.reconcileLeader();
  assert.equal(runtime.leaderState.queue.length, 2); assert.equal(calls.deliver.length, 0);
  assert.equal((await invoke('start')).ok, true);
  await runtime.reconcileLeader();
  // FIFO: the continue runs first and occupies the only slot; the create keeps waiting.
  assert.equal(calls.deliver.length, 1); assert.equal(calls.deliver[0].sessionId, 'worker-b');
  assert.match(calls.deliver[0].body, /继续核查原 Issue 的 CI 结果/);
  assert.equal(host.created.length, 0); assert.deepEqual(runtime.leaderState.queue.map((entry) => entry.kind), ['create']);
  assert.ok(auditActions(runtime).includes('queue')); assert.ok(auditActions(runtime).includes('dequeue'));
  const queueId = runtime.leaderState.queue[0].id;
  assert.equal((await invoke('cancelQueued', { queueId }, agent())).ok, false);
  assert.equal((await invoke('completeIssue', { ...issue('a'), summary: 'x' })).ok, false);
  assert.equal((await invoke('cancelQueued', { queueId: 'leader-queue-nope' })).ok, false);
  const cancelled = await invoke('cancelQueued', { queueId }); assert.equal(cancelled.ok, true, cancelled.error);
  assert.deepEqual(cancelled.result.queue, []); assert.equal(auditActions(runtime).at(-1), 'queue-drop');
});

test('queued create runs when a slot frees; queue is bounded at 50', async () => {
  const { runtime, setup, invoke, agent, sessions } = fixture(); await setup();
  const host = withTaskHost(runtime, sessions);
  assert.equal((await invoke('configure', { settings: { maxRunningWorkers: 1 } })).ok, true);
  sessions.set('worker-a', sessionState({ running: true })); await runtime.reconcileLeader();
  const create = await invoke('createSession', { title: '调查 IAM', brief: '梳理鉴权链路。' }, agent());
  assert.equal(create.result.queued, true);
  sessions.set('worker-a', sessionState()); await runtime.reconcileLeader();
  assert.equal(host.created.length, 1); assert.equal(host.prompts.length, 1); assert.deepEqual(runtime.leaderState.queue, []);
  assert.equal(runtime.leaderState.tasks.at(-1).status, 'created');
  // The new task counts as running until observed, so the next request queues again.
  const next = await invoke('createSession', { title: '另一个调查', brief: '独立问题。' }, agent());
  assert.equal(next.result.queued, true);
  runtime.leaderState.queue = Array.from({ length: 50 }, (_, index) => ({ id: `leader-queue-${index}`, kind: 'create', taskId: null, sessionId: null,
    request: { title: `t${index}`, brief: 'b', workingDirectory: '', taskId: null }, fingerprint: `f${index}`, queuedAt: Date.now(), requestedBy: 'leader' }));
  const full = await invoke('createSession', { title: '第 51 个', brief: '超出上限。' }, agent());
  assert.equal(full.ok, false); assert.match(full.error, /50/);
});

test('a queued continue that no longer validates is dropped with audit and a one-line wake notice', async () => {
  const { runtime, setup, sessions, calls, advance } = fixture(); await setup(2);
  assert.equal((await runtime.leaderOperation('configure', { settings: { maxRunningWorkers: 1 } }, createLeaderUiCaller())).ok, true);
  sessions.set('worker-a', sessionState({ running: true })); await runtime.reconcileLeader();
  assert.equal((await advance({}, 'b')).result.queued, true);
  sessions.set('worker-a', sessionState()); sessions.set('worker-b', sessionState({ pendingInput: ['approval'] }));
  await runtime.reconcileLeader();
  assert.equal(calls.deliver.length, 0); assert.deepEqual(runtime.leaderState.queue, []);
  const drop = runtime.leaderState.audit.at(-1); assert.equal(drop.action, 'queue-drop'); assert.match(drop.detail, /需人类处理|原生审批/);
  await runtime.reconcileLeader();
  assert.match(calls.notify.at(-1).body, /出队失败已丢弃/); assert.deepEqual(runtime.leaderState.queueNotices, []);
});

test('dependsOn rejects self, unknown and cyclic edges, blocks continue and wakes downstream on completion', async () => {
  const { runtime, setup, invoke, issue, agent, sessions, calls, advance } = fixture(); await setup(2);
  const host = withTaskHost(runtime, sessions);
  const { taskId } = (await invoke('createSession', { title: '前置调查', brief: '先调查依赖。' }, agent())).result;
  const archived = []; runtime.setSessionArchived = async (sessionId, value) => { archived.push([sessionId, value]); return { ok: true }; };
  runtime.leaderIssueGitlab = async () => gitlabFacts({ state: 'closed', mergeRequests: [{ iid: 5, state: 'merged', pipeline: null }] });
  assert.match((await invoke('updateIssue', { ...issue('a'), dependsOn: ['issue-1-a'] }, agent())).error, /不能依赖自己/);
  assert.match((await invoke('updateIssue', { ...issue('a'), dependsOn: ['issue-1-zzz'] }, agent())).error, /既未纳管也不在已完成记录中/);
  assert.equal((await invoke('updateIssue', { ...issue('a'), dependsOn: Array.from({ length: 11 }, (_, i) => `x${i}`) }, agent())).ok, false);
  const linked = await invoke('updateIssue', { ...issue('a'), dependsOn: ['issue-1-b', taskId] }, agent());
  assert.equal(linked.ok, true, linked.error); assert.deepEqual(linked.result.notes.dependsOn, ['issue-1-b', taskId]);
  assert.match((await invoke('updateIssue', { ...issue('b'), dependsOn: ['issue-1-a'] }, agent())).error, /依赖成环：issue-1-b → issue-1-a → issue-1-b/);
  assert.deepEqual(runtime.leaderProjection().items[0].blockedBy, ['issue-1-b', taskId]);
  const blocked = await advance(); assert.equal(blocked.ok, false); assert.match(blocked.error, /依赖 issue-1-b、leader-task-[0-9a-f]+ 未完成；如需绕过请先用 update_issue 调整 dependsOn/);
  await runtime.reconcileLeader(); const before = calls.notify.length;
  const doneB = await invoke('completeIssue', { ...issue('b'), summary: 'MR !5 已合并，验收通过。' }, agent());
  assert.equal(doneB.ok, true, doneB.error); assert.deepEqual(doneB.result.woken, [{ taskId: 'issue-1-a', reason: 'dependency:issue-1-b' }]);
  assert.deepEqual(runtime.leaderState.items.find((item) => item.taskId === 'issue-1-a').pendingWake, ['dependency:issue-1-b']);
  const doneTask = await invoke('completeIssue', { taskId, sessionId: 'task-s', summary: '调查结论已汇报。' }, agent());
  assert.equal(doneTask.ok, true, doneTask.error); assert.deepEqual(host.archived, ['task-s']);
  assert.equal(runtime.leaderState.tasks.find((task) => task.taskId === taskId).status, 'archived');
  const itemA = runtime.leaderProjection().items.find((item) => item.taskId === 'issue-1-a');
  assert.deepEqual(itemA.blockedBy, []); assert.deepEqual(itemA.pendingWake, ['dependency:issue-1-b', 'unblocked']);
  await runtime.reconcileLeader(); assert.equal(calls.notify.length, before + 1);
  assert.match(calls.notify.at(-1).body, /全部依赖已完成/); assert.match(calls.notify.at(-1).body, /原因 dependency:issue-1-b,unblocked/);
  assert.equal((await advance()).ok, true);
  // dependsOn may point at completed taskIds.
  assert.equal((await invoke('updateIssue', { ...issue('a'), dependsOn: ['issue-1-b'] }, agent())).ok, true);
});

test('complete verifies quiet worker and GitLab facts, archives, retires budget and records history', async () => {
  const { runtime, setup, invoke, issue, agent, sessions } = fixture(); await setup(2);
  const archived = []; runtime.setSessionArchived = async (sessionId, value) => { archived.push([sessionId, value]); return { ok: true }; };
  let facts = gitlabFacts(); let reads = 0;
  runtime.leaderIssueGitlab = async (id) => { reads += 1; assert.equal(id, 'issue-1-a'); return facts; };
  assert.equal((await invoke('completeIssue', { ...issue(), summary: '' }, agent())).ok, false);
  sessions.set('worker-a', sessionState({ running: true }));
  assert.match((await invoke('completeIssue', { ...issue(), summary: '完成' }, agent())).error, /静默/);
  sessions.set('worker-a', sessionState({ pendingInput: ['approval'] }));
  assert.match((await invoke('completeIssue', { ...issue(), summary: '完成' }, agent())).error, /原生审批/);
  assert.equal(reads, 0); sessions.set('worker-a', sessionState());
  assert.match((await invoke('completeIssue', { ...issue(), summary: '完成' }, agent())).error, /acceptWithoutMr/);
  assert.equal((await invoke('completeIssue', { ...issue(), summary: '完成', acceptWithoutMr: true }, agent())).ok, false);
  facts = gitlabFacts({ mergeRequests: [{ iid: 7, state: 'opened', pipeline: { status: 'failed', url: 'https://gitlab.test/p/-/pipelines/1' } }, { iid: 6, state: 'merged', pipeline: null }] });
  assert.match((await invoke('completeIssue', { ...issue(), summary: '完成', acceptWithoutMr: true, reason: '纯调查' }, agent())).error, /!7 仍 open 且最新流水线失败/);
  facts = gitlabFacts({ available: false, errors: ['glab timeout'] });
  assert.match((await invoke('completeIssue', { ...issue(), summary: '完成' }, agent())).error, /glab timeout/);
  assert.equal(archived.length, 0); assert.equal(runtime.leaderState.items.length, 2);
  facts = gitlabFacts();
  runtime.leaderState.queue.push({ id: 'leader-queue-x', kind: 'continue', taskId: 'issue-1-a', sessionId: 'worker-a', request: { body: 'b', reason: '' }, fingerprint: 'f', queuedAt: Date.now(), requestedBy: 'leader' });
  runtime.leaderState.items[0].actions = 4;
  const done = await invoke('completeIssue', { ...issue(), summary: '纯调查，结论已在 Issue 评论。', acceptWithoutMr: true, reason: '调查类 Issue，无需代码变更' }, agent());
  assert.equal(done.ok, true, done.error); assert.equal(done.result.archived, true);
  assert.deepEqual(archived, [['worker-a', true]]); assert.deepEqual(runtime.leaderState.queue, []);
  assert.equal(runtime.leaderState.items.some((item) => item.taskId === 'issue-1-a'), false);
  assert.equal(runtime.leaderState.budgetLedger.at(-1).taskId, 'issue-1-a'); assert.equal(runtime.leaderState.budgetLedger.at(-1).actions, 4);
  const record = runtime.leaderProjection().completed.at(-1);
  assert.equal(record.taskId, 'issue-1-a'); assert.equal(record.kind, 'issue'); assert.equal(record.acceptWithoutMr, true);
  assert.deepEqual(record.verification, { issueState: 'opened', mergedMrs: [], pipeline: null });
  assert.equal(auditActions(runtime).at(-1), 'complete');
  assert.equal((await invoke('completeIssue', { ...issue(), summary: '再来' }, agent())).ok, false);
  // archiveOnComplete=false keeps the worker; a failed archive never rolls back the completion.
  assert.equal((await invoke('configure', { settings: { archiveOnComplete: false } })).ok, true);
  runtime.leaderIssueGitlab = async () => gitlabFacts({ state: 'closed', mergeRequests: [{ iid: 9, state: 'merged', pipeline: null }] });
  const kept = await invoke('completeIssue', { ...issue('b'), summary: 'MR !9 已合并。' }, agent());
  assert.equal(kept.ok, true, kept.error); assert.equal(kept.result.archived, false); assert.equal(archived.length, 1);
  assert.deepEqual(runtime.leaderProjection().completed.at(-1).verification.mergedMrs, [9]);
});

test('a failed archive on completion is audited but the completion stands', async () => {
  const { runtime, setup, invoke, issue, agent } = fixture(); await setup();
  runtime.setSessionArchived = async () => ({ ok: false, error: '宿主拒绝' });
  runtime.leaderIssueGitlab = async () => gitlabFacts({ state: 'closed', mergeRequests: [{ iid: 3, state: 'merged', pipeline: null }] });
  const done = await invoke('completeIssue', { ...issue(), summary: '已合并。' }, agent());
  assert.equal(done.ok, true, done.error); assert.equal(done.result.archived, false); assert.match(done.result.archiveError, /宿主拒绝/);
  assert.deepEqual(auditActions(runtime).slice(-2), ['archive-failed', 'complete']); assert.equal(runtime.leaderState.items.length, 0);
});

test('leaderWorkerForTarget finds only healthy unblocked enrolled Issue workers; noteLeaderTodo wakes the Leader', async () => {
  const { runtime, setup, invoke, issue, agent, calls } = fixture(); await setup(2);
  const url = 'https://GITLAB.test/project/-/issues/a#note_9';
  assert.deepEqual(runtime.leaderWorkerForTarget(url), { taskId: 'issue-1-a', sessionId: 'worker-a' });
  assert.equal(runtime.leaderWorkerForTarget('https://gitlab.test/project/-/issues/zzz'), null);
  assert.equal(runtime.leaderWorkerForTarget('not a url'), null);
  assert.equal((await invoke('pauseIssue', issue())).ok, true); assert.equal(runtime.leaderWorkerForTarget(url), null);
  assert.equal((await invoke('resumeIssue', issue())).ok, true); assert.ok(runtime.leaderWorkerForTarget(url));
  assert.equal((await invoke('updateIssue', { ...issue(), dependsOn: ['issue-1-b'] }, agent())).ok, true);
  assert.equal(runtime.leaderWorkerForTarget(url), null);
  assert.equal((await invoke('updateIssue', { ...issue(), dependsOn: [] }, agent())).ok, true);
  assert.equal((await invoke('pause')).ok, true); assert.equal(runtime.leaderWorkerForTarget(url), null);
  assert.equal((await invoke('start')).ok, true); assert.ok(runtime.leaderWorkerForTarget(url));
  assert.equal((await runtime.noteLeaderTodo('issue-1-zzz', { todoId: 't0' })).ok, false);
  const noted = await runtime.noteLeaderTodo('issue-1-a', { todoId: 't1', title: '请看看 CI 为什么红', url: 'https://gitlab.test/project/-/issues/a#note_9', author: 'alice' });
  assert.equal(noted.ok, true, noted.error);
  const item = runtime.leaderProjection().items[0];
  assert.deepEqual(item.pendingWake, ['todo:t1']); assert.equal(item.lastTodo.title, '请看看 CI 为什么红'); assert.equal(item.lastTodo.author, 'alice');
  assert.equal(auditActions(runtime).at(-1), 'todo-routed');
  await runtime.reconcileLeader();
  assert.match(calls.notify.at(-1).body, /Issue a｜状态 watching｜原因 todo:t1｜有新的 @我 Todo，已排入该 worker：请看看 CI 为什么红/);
});

test('orchestration journal fields migrate from older journals and survive normalization', () => {
  const legacy = copy(initialLeaderState()); delete legacy.queue; delete legacy.completed; delete legacy.queueNotices;
  legacy.settings = { model: null, autoEnrollNew: true };
  const migrated = normalizeLeaderState(legacy);
  assert.deepEqual(migrated.queue, []); assert.deepEqual(migrated.completed, []);
  assert.equal(migrated.settings.maxRunningWorkers, 3); assert.equal(migrated.settings.archiveOnComplete, true); assert.equal(migrated.settings.autoEnrollNew, true);
  const restored = normalizeLeaderState({ ...copy(initialLeaderState()), settings: { ...initialLeaderState().settings, maxRunningWorkers: 5 },
    queue: [{ id: 'q1', kind: 'continue', taskId: 't', sessionId: 's', request: { body: 'b', reason: 'r' }, fingerprint: 'f', queuedAt: 1 }, { id: 'q2', kind: 'bogus', queuedAt: 1, request: {} }],
    completed: [{ taskId: 't0', completedAt: 2, summary: 'ok', verification: { issueState: 'closed', mergedMrs: [1, 'x'] } }] });
  assert.equal(restored.settings.maxRunningWorkers, 5);
  assert.deepEqual(restored.queue.map((entry) => entry.id), ['q1']);
  assert.deepEqual(restored.completed[0].verification, { issueState: 'closed', mergedMrs: [1], pipeline: null });
  const projection = buildLeaderProjection(restored);
  assert.deepEqual(projection.queue[0], { id: 'q1', kind: 'continue', taskId: 't', sessionId: 's', position: 1, title: '', reason: 'r', queuedAt: 1 });
});
// v2.42 Leader autonomy: list_issues + manage, and no UI-only human gates for truncation/native input.
test('list_issues shows every assigned Issue with enrollment state and optional refresh', async () => {
  const { runtime, setup, invoke, agent } = fixture(); await setup();
  runtime.state.issues.push({ id: 'issue-1-171', title: 'Fresh issue', source: 'issue', url: 'https://gitlab.test/project/-/issues/171', project: 'project', iid: '171', projectId: '1' });
  let refreshed = 0; runtime.refreshIssues = async () => { refreshed += 1; };
  const listed = await invoke('listIssues', { refresh: true }, agent()); assert.equal(listed.ok, true, listed.error);
  assert.equal(refreshed, 1); assert.equal(listed.result.refreshed, true);
  const byId = Object.fromEntries(listed.result.issues.map((entry) => [entry.taskId, entry]));
  assert.equal(byId['issue-1-a'].enrolled, true); assert.equal(byId['issue-1-b'].enrolled, false); assert.equal(byId['issue-1-b'].sessionId, 'worker-b');
  assert.equal(byId['issue-1-171'].sessionId, null); assert.equal(byId['issue-1-171'].iid, '171'); assert.match(byId['issue-1-171'].next, /新建/);
  runtime.refreshIssues = async () => { throw new Error('glab timeout'); };
  const failed = await invoke('listIssues', { refresh: true }, agent());
  assert.equal(failed.ok, true); assert.equal(failed.result.refreshed, false); assert.match(failed.result.refreshError, /glab timeout/);
  assert.equal((await invoke('listIssues', {}, createLeaderAgentCaller({ sessionId: 'outside', agentId: 'x' }))).ok, false);
  assert.equal((await invoke('listIssues', {})).ok, false); // UI caller has no reason to use the agent tool.
});

test('manage lets the Leader enroll, pause, resume, reset budget and unenroll with audit', async () => {
  const { runtime, setup, invoke, issue, agent } = fixture(); await setup();
  const manage = (action, extra = {}) => invoke('manage', { action, ...extra }, agent());
  const enrolled = await manage('enroll', { ...issue('b'), reason: '人类要求纳管' }); assert.equal(enrolled.ok, true, enrolled.error);
  const item = runtime.leaderState.items.find((entry) => entry.taskId === 'issue-1-b');
  assert.equal(item.provenance.kind, 'leader'); assert.equal(item.status, 'watching');
  assert.equal((await manage('pause', issue('b'))).ok, true); assert.equal(item.paused, true);
  item.actions = 20;
  assert.equal((await manage('resume', issue('b'))).ok, false);
  assert.equal((await manage('reset_budget', issue('b'))).ok, true); assert.equal(item.actions, 0);
  const resumed = await manage('resume', issue('b')); assert.equal(resumed.ok, true, resumed.error); assert.equal(item.paused, false);
  assert.match(resumed.result.note, /read_issue/);
  assert.equal((await manage('unenroll', issue('b'))).ok, true);
  assert.equal(runtime.leaderState.items.some((entry) => entry.taskId === 'issue-1-b'), false);
  assert.equal((await manage('grant')).ok, false);
  assert.deepEqual(auditActions(runtime).filter((action) => action.startsWith('manage-')), ['manage-enroll', 'manage-pause', 'manage-reset_budget', 'manage-resume', 'manage-unenroll']);
  assert.equal(runtime.leaderState.audit.find((entry) => entry.action === 'manage-enroll').detail.includes('人类要求纳管'), true);
});

test('manage start renews an expired run without a new bootstrap; pause_leader stops it', async () => {
  const { runtime, setup, invoke, agent, calls } = fixture(); await setup();
  runtime.leaderState.expiresAt = Date.now() - 1; await runtime.reconcileLeader();
  assert.equal(runtime.leaderState.enabled, false); assert.match(calls.notify.at(-1).body, /gitlab_leader_manage start|自动托管即将暂停/);
  const notices = calls.notify.length;
  const started = await invoke('manage', { action: 'start', reason: '人类让我继续' }, agent()); assert.equal(started.ok, true, started.error);
  assert.equal(runtime.leaderState.enabled, true); assert.ok(runtime.leaderState.expiresAt > Date.now() + 23 * 3600000);
  assert.equal(runtime.leaderState.wakeups, 0); assert.equal(runtime.leaderState.items[0].status, 'watching');
  assert.equal(calls.notify.length, notices); // the Leader is mid-turn: no bootstrap brief.
  const paused = await invoke('manage', { action: 'pause_leader' }, agent()); assert.equal(paused.ok, true);
  assert.equal(runtime.leaderState.enabled, false);
});

test('manage resolve_delivery is recorded as the Leader and never resends', async () => {
  const { runtime, setup, invoke, agent, calls, advance, lastAdvance } = fixture(); await setup();
  runtime.leaderAdapter.deliver = async (request) => { calls.deliver.push(copy(request)); throw new Error('socket closed'); };
  await advance(); const entry = lastAdvance(); assert.equal(entry.status, 'uncertain');
  const before = calls.deliver.length;
  const resolved = await invoke('manage', { action: 'resolve_delivery', requestId: entry.requestId, outcome: 'delivered' }, agent());
  assert.equal(resolved.ok, true, resolved.error);
  assert.equal(entry.status, 'sent'); assert.equal(entry.resolvedBy, 'leader'); assert.equal(calls.deliver.length, before);
  assert.equal((await invoke('manage', { action: 'resolve_delivery', requestId: entry.requestId, outcome: 'delivered' }, agent())).ok, false);
});

test('log truncation no longer pauses an Issue and clears after a clean observation', async () => {
  const { runtime, setup, invoke, issue, agent, sessions, advance } = fixture(); await setup();
  const normal = runtime.leaderAdapter.observe;
  runtime.leaderAdapter.observe = async () => ({ cursor: 10, highWater: 10, events: [], truncated: true, epoch: 'live-log' });
  sessions.set('worker-a', sessionState({ cursor: 10 }));
  await runtime.reconcileLeader();
  const item = runtime.leaderState.items[0];
  assert.equal(item.paused, false); assert.match(item.error, /自动清除/);
  runtime.leaderAdapter.observe = normal; sessions.set('worker-a', sessionState({ cursor: 12 }));
  await runtime.reconcileLeader(); assert.equal(item.error, ''); assert.equal(item.paused, false);
  const continued = await advance(); assert.equal(continued.ok, true, continued.error);
});

test('native question marks needs-human without pausing and recovers once answered', async () => {
  const { runtime, setup, sessions, advance } = fixture(); await setup();
  sessions.set('worker-a', sessionState({ cursor: 11, pendingInput: ['question'] }));
  await runtime.reconcileLeader();
  const item = runtime.leaderState.items[0];
  assert.equal(item.status, 'needs-human'); assert.equal(item.paused, false); assert.match(item.error, /worker 会话内回答/);
  assert.equal((await advance()).ok, false);
  sessions.set('worker-a', sessionState({ cursor: 12 }));
  await runtime.reconcileLeader(); assert.equal(item.status, 'watching'); assert.equal(item.error, '');
  assert.equal((await advance()).ok, true);
});

test('legacy UI-only human gates from older journals are lifted on load', async () => {
  const { runtime, setup } = fixture(); await setup(2);
  const [a, b] = runtime.leaderState.items;
  Object.assign(a, { paused: true, status: 'unknown', error: '日志增量超出有界补扫，证据已截断；停止推进，需 UI 人类核查后恢复。', cursor: 5 });
  Object.assign(b, { paused: true, status: 'paused', error: '托管时限/推进预算已耗尽。' });
  assert.equal(runtime.liftLegacyHumanGates(), true);
  assert.equal(a.paused, false); assert.equal(a.error, ''); assert.equal(a.cursor, null); assert.equal(a.status, 'watching');
  assert.equal(b.paused, true); // a real budget stop stays until manage reset_budget + resume.
});