import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { initialState, initialLeaderState, normalizeLeaderState, buildLeaderProjection, validateLeaderSettings,
  DEFAULT_LEADER_COMMENT_SIGNATURE } from '../core.js';
import { leaderMethods, createLeaderUiCaller, createLeaderAgentCaller } from '../host/leader.js';
import { gitlabMethods } from '../host/gitlab.js';
import { LEADER_TOOLS } from '../host/leader-agent.js';

const sessionState = (patch = {}) => ({ cursor: 10, active: true, running: false, queue: [], pendingInput: [], ...patch });
const remote = (message, code = 'session/rejected') => Object.assign(new Error(message), { isDSHRemoteError: true, code });
const missing = (sessionId) => Object.assign(remote('not found', 'session/not-found'), { details: { sessionId } });
const copy = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const calls = { create: [], rename: [], prompt: [], notify: [], archive: [], glab: [], inputs: [], refresh: 0, humanReads: [] };
  const sessions = new Map([['leader', sessionState()], ['worker-a', sessionState()], ['worker-b', sessionState()]]);
  const ui = createLeaderUiCaller();
  let created = 0;
  const behaviour = { prompt: null, glab: null, create: null, archive: null, humans: [{ seq: 1, text: '人类：先做 a 再做 b' }] };
  const runtime = Object.assign({}, leaderMethods, {
    state: initialState(), leaderState: initialLeaderState(), config: {}, stopping: false,
    ctx: { workspaceRegistry: { archivedSessionIds: [] } },
    storageDirectory() { throw new Error('fixture uses in-memory persistence'); },
    ensureLeaderTimer() {}, targetBusy() { return false; }, resolveWorkspaceId(cwd) { return cwd || 'issue-workspace'; },
    itemById(id) { return this.state.issues.find((item) => item.id === id) ?? null; },
    host: {
      async sessionState(id) { if (!sessions.has(id)) throw missing(id); return copy(sessions.get(id)); },
      async createSession(request) {
        calls.create.push(copy(request));
        if (behaviour.create) return behaviour.create(request);
        const id = created === 0 ? 'leader' : `leader-${created + 1}`; created += 1;
        sessions.set(id, sessionState({ cursor: 1 })); return id;
      },
      async renameSession(...args) { calls.rename.push(copy(args)); },
      async selectModel() {},
      async prompt(request) { calls.prompt.push(copy(request)); if (behaviour.prompt) return behaviour.prompt(request); return { ok: true }; },
      async archiveSession(id) { calls.archive.push(id); if (behaviour.archive) return behaviour.archive(id); },
    },
    async persistLeader() {},
    async runGlab(args) {
      calls.glab.push(args);
      const file = args.includes('--input') ? args[args.indexOf('--input') + 1] : null;
      const input = file ? JSON.parse(await readFile(file, 'utf8')) : null;
      calls.inputs.push(input);
      if (behaviour.glab) return behaviour.glab(args, input?.body ?? null, input);
      return JSON.stringify({ id: 900 + calls.glab.length, body: input?.body ?? null });
    },
  }, { apiRequest: gitlabMethods.apiRequest });
  runtime.leaderAdapter = {
    capabilities: { atomicIdleDelivery: true, nonHumanSource: true },
    async prepare(sessionId) { return { ok: true, status: 'prepared', sessionId }; },
    async refreshBindings() { calls.refresh += 1; return true; },
    async observe(sessionId) { const highWater = sessions.get(sessionId)?.cursor ?? 0; return { cursor: highWater, highWater, events: [], truncated: false, epoch: 'live-log' }; },
    async deliver(request) { return { ok: true, status: 'delivered', requestId: request.requestId }; },
    async notify(request) { calls.notify.push(copy(request)); return { ok: true, status: 'delivered', requestId: request.requestId }; },
    async humanMessages(limit) { calls.humanReads.push([runtime.leaderState.sessionId, limit]); if (behaviour.humans instanceof Error) throw behaviour.humans; return behaviour.humans; },
  };
  for (const [suffix, iid] of [['a', 7], ['b', 8]]) {
    const item = { id: `issue-1-${suffix}`, title: `Issue ${suffix}`, source: 'issue', url: `https://gitlab.test/group/project/-/issues/${iid}`,
      project: 'group/project', iid, projectId: '1' };
    runtime.state.issues.push(item);
    runtime.state.handled[item.id] = { id: item.id, sessionId: `worker-${suffix}`, item, automatic: false,
      acceptedAt: Date.now(), outcome: 'session-accepted', title: item.title, url: item.url, executionStatus: 'completed' };
  }
  const invoke = (operation, request = {}, caller = ui) => runtime.leaderOperation(operation, request, caller);
  const issue = (suffix = 'a') => ({ taskId: `issue-1-${suffix}`, sessionId: `worker-${suffix}` });
  const agent = (sessionId = runtime.leaderState.sessionId) => createLeaderAgentCaller({ sessionId, agentId: 'verified-agent' });
  const setup = async ({ start = true, write = false } = {}) => {
    assert.equal((await invoke('create')).ok, true);
    if (write) assert.equal((await invoke('configure', { settings: { gitlabWrite: true } })).ok, true);
    assert.equal((await invoke('enroll', issue('a'))).ok, true);
    assert.equal((await invoke('enroll', issue('b'))).ok, true);
    if (start) { const started = await invoke('start'); assert.equal(started.ok, true, started.error); }
  };
  const item = (suffix = 'a') => runtime.leaderState.items.find((entry) => entry.taskId === `issue-1-${suffix}`);
  const steer = (extra = {}, suffix = 'a') => invoke('session', { action: 'steer', ...issue(suffix), text: '先修复失败的单测，不要再改文档。', reason: 'worker 在改无关文件。', ...extra }, agent());
  const api = (request, caller = agent()) => invoke('gitlabApi', request, caller);
  return { runtime, calls, sessions, ui, invoke, issue, agent, setup, item, steer, api, behaviour };
}

const withClock = async (offsetMs, body) => {
  const realNow = Date.now; Date.now = () => realNow() + offsetMs;
  try { return await body(); } finally { Date.now = realNow; }
};

// ------------------------------------------------------------------ registration

test('the seven Leader tools are registered as Leader-only and handoff/cancelQueued as UI-only', async () => {
  assert.deepEqual(LEADER_TOOLS.map(([name, operation]) => [name, operation]), [
    ['gitlab_leader_overview', 'overview'], ['gitlab_leader_inbox', 'inbox'], ['gitlab_leader_read', 'read'], ['gitlab_leader_session', 'session'],
    ['gitlab_leader_note', 'note'], ['gitlab_leader_gitlab_api', 'gitlabApi'], ['gitlab_leader_run', 'run']]);
  const { invoke, setup, issue, agent } = fixture();
  await setup({ write: true });
  for (const [operation, request] of [['session', { action: 'steer', ...issue(), text: 'x' }], ['gitlabApi', { method: 'GET', path: 'projects/1/issues/7' }]]) {
    const result = await invoke(operation, request);
    assert.equal(result.ok, false); assert.match(result.error, /仅限 Leader Agent/u);
  }
  const handoff = await invoke('handoff', {}, agent());
  assert.equal(handoff.ok, false); assert.match(handoff.error, /不能修改 Leader 设置、创建 Leader 或交接/u);
  const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(index, /LEADER_UI_OPERATIONS = new Set\([^)]*'handoff'/su);
  assert.match(index, /LEADER_UI_OPERATIONS = new Set\([^)]*'cancelQueued'/su);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.check, /node --check host\/leader-ops\.js/u);
  assert.match(pkg.scripts.check, /node --check host\/leader-tools\.js/u);
  assert.doesNotMatch(pkg.scripts.check, /leader-autonomy/u);
});

test('gitlabWrite defaults off, validates strictly, migrates issueComments and survives normalization/projection', () => {
  const initial = initialLeaderState();
  assert.equal(initial.settings.gitlabWrite, false); assert.equal('issueComments' in initial.settings, false);
  assert.equal(initial.settings.commentSignature, DEFAULT_LEADER_COMMENT_SIGNATURE);
  assert.deepEqual(initial.previousSessions, []);
  const next = validateLeaderSettings({ gitlabWrite: true, commentSignature: '—— Leader' }, initial.settings);
  assert.equal(next.gitlabWrite, true); assert.equal(next.commentSignature, '—— Leader');
  assert.throws(() => validateLeaderSettings({ gitlabWrite: 'yes' }, initial.settings), /gitlabWrite/u);
  assert.throws(() => validateLeaderSettings({ issueComments: true }, initial.settings), /未知 Leader 设置/u);
  assert.throws(() => validateLeaderSettings({ commentSignature: 'x'.repeat(101) }, initial.settings), /commentSignature/u);
  assert.throws(() => validateLeaderSettings({ commentSignature: 'a\nb' }, initial.settings), /commentSignature/u);
  for (const [old, expected] of [[true, true], [false, false]]) {
    const legacy = copy(initial); delete legacy.settings.gitlabWrite; legacy.settings.issueComments = old;
    const migrated = normalizeLeaderState(legacy);
    assert.equal(migrated.settings.gitlabWrite, expected); assert.equal('issueComments' in migrated.settings, false);
  }
  const bare = copy(initial); delete bare.settings.gitlabWrite; delete bare.settings.commentSignature; delete bare.previousSessions; delete bare.comments;
  const normalized = normalizeLeaderState(bare);
  assert.equal(normalized.settings.gitlabWrite, false); assert.deepEqual(normalized.previousSessions, []);
  const withHistory = { ...copy(initial), previousSessions: [{ sessionId: 'old', handedOffAt: 5, archived: true }],
    comments: [{ requestId: 'leader-api-x', taskId: 'issue-1-a', method: 'POST', path: 'projects/1/issues/7/notes', status: 'pending', noteId: null, url: '', at: 9, error: '' }] };
  const reloaded = normalizeLeaderState(withHistory);
  assert.equal(reloaded.comments[0].status, 'uncertain', 'a pending write at restart is uncertain, never resent');
  const projection = buildLeaderProjection(reloaded);
  assert.deepEqual(projection.previousSessions, [{ sessionId: 'old', handedOffAt: 5, archived: true }]);
  assert.equal(projection.settings.gitlabWrite, false); assert.equal(projection.comments[0].method, 'POST');
});

// ------------------------------------------------------------------ steer

test('steer is delivered only to a running worker, with mode steer and a non-human header, and is audited', async () => {
  const { setup, sessions, steer, calls, item, runtime } = fixture();
  await setup();
  const idleResult = await steer();
  assert.equal(idleResult.ok, false); assert.match(idleResult.error, /gitlab_leader_session send/u);
  assert.equal(calls.prompt.length, 0);
  sessions.set('worker-a', sessionState({ running: true, pendingInput: ['question'] }));
  const asking = await steer();
  assert.equal(asking.ok, false); assert.match(asking.error, /审批\/问答/u);
  sessions.set('worker-a', sessionState({ running: true }));
  const sent = await steer();
  assert.equal(sent.ok, true, sent.error);
  assert.equal(calls.prompt.length, 1);
  const [request] = calls.prompt;
  assert.equal(request.mode, 'steer'); assert.equal(request.sessionId, 'worker-a');
  assert.match(request.requestId, /^leader-steer-[0-9a-f]{40}$/u);
  assert.match(request.content[0].text, /^\[来自 WorkStation Leader 的纠偏引导；不是人类输入，不授予新权限\]/u);
  assert.match(request.content[0].text, /理由：worker 在改无关文件。/u);
  assert.equal(item().lastSteerStatus, 'sent');
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'session-steer' && entry.taskId === 'issue-1-a'));
});

test('steer retries are idempotent and a new steer is never rate limited', async () => {
  const { setup, sessions, steer, calls } = fixture();
  await setup();
  sessions.set('worker-a', sessionState({ running: true }));
  assert.equal((await steer()).ok, true);
  const again = await steer();
  assert.equal(again.ok, true); assert.equal(again.result.duplicate, true);
  assert.equal(calls.prompt.length, 1, 'same parameters never re-inject');
  const other = await steer({ text: '换一个方向：先跑 lint。' });
  assert.equal(other.ok, true, other.error);
  assert.equal(calls.prompt.length, 2); assert.notEqual(calls.prompt[0].requestId, calls.prompt[1].requestId);
});

test('steer retry after a restart (journal reload) is still deduplicated', async () => {
  const { setup, sessions, steer, calls, item, runtime } = fixture();
  await setup();
  sessions.set('worker-a', sessionState({ running: true }));
  assert.equal((await steer()).ok, true);
  runtime.leaderState = normalizeLeaderState(JSON.parse(JSON.stringify(runtime.leaderState)));
  assert.equal(item().lastSteerStatus, 'sent'); assert.match(item().lastSteerRequestId, /^leader-steer-/u);
  const again = await steer();
  assert.equal(again.ok, true, again.error); assert.equal(again.result.duplicate, true);
  assert.equal(calls.prompt.length, 1, 'the reloaded journal never re-injects the same steer');
});

test('steer rolls back a clear Host rejection and latches an uncertain send without retry', async () => {
  const { setup, sessions, steer, calls, item, behaviour, runtime } = fixture();
  await setup();
  sessions.set('worker-a', sessionState({ running: true }));
  behaviour.prompt = () => { throw remote('session busy with approval'); };
  const rejected = await steer();
  assert.equal(rejected.ok, false); assert.match(rejected.error, /宿主拒绝/u);
  assert.equal(item().lastSteerStatus ?? null, null);
  behaviour.prompt = () => { throw new Error('timeout'); };
  const uncertain = await steer();
  assert.equal(uncertain.ok, false); assert.match(uncertain.error, /不会自动重发/u);
  assert.equal(item().lastSteerStatus, 'uncertain');
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'session-steer' && /uncertain/u.test(entry.detail)));
  behaviour.prompt = null;
  const retry = await steer();
  assert.equal(retry.ok, false, 'the same uncertain request is never re-sent'); assert.match(retry.error, /不确定/u);
  assert.equal(calls.prompt.length, 2);
});

test('steer works while the Leader is paused and never targets the Leader or human sessions', async () => {
  const { setup, sessions, steer, invoke, agent, calls } = fixture();
  await setup();
  sessions.set('worker-a', sessionState({ running: true }));
  assert.equal((await invoke('pause')).ok, true);
  assert.equal((await steer()).ok, true, 'a paused Leader only stops automatic wakes');
  sessions.set('outside', sessionState({ running: true }));
  for (const sessionId of ['leader', 'outside']) assert.equal((await invoke('session', { action: 'steer', taskId: 'issue-1-a', sessionId, text: 'x' }, agent())).ok, false, sessionId);
  assert.equal(calls.prompt.length, 1);
});
// ------------------------------------------------------------------ handoff

test('handoff of a running Leader switches sessions, keeps the journal, archives the old one and sends a handoff brief', async () => {
  const { setup, invoke, runtime, calls, agent, item, behaviour } = fixture();
  await setup();
  item().notes = { stage: '实现中', next: '补测试', waitingOn: 'CI', decisions: [], deliverables: [] };
  behaviour.humans = [{ seq: 1, text: '人类：先做 a 再做 b' }, { seq: 2, text: '人类：b 不急' }];
  const notifyBefore = calls.notify.length;
  const before = copy(runtime.leaderState.items);
  const result = await invoke('handoff');
  assert.equal(result.ok, true, result.error);
  assert.equal(runtime.leaderState.sessionId, 'leader-2');
  assert.equal(result.result.handoff.from, 'leader'); assert.equal(result.result.handoff.resumed, true);
  assert.equal(runtime.leaderState.enabled, true);
  assert.deepEqual(runtime.leaderState.items.map((entry) => [entry.taskId, entry.sessionId, entry.notes?.stage]),
    before.map((entry) => [entry.taskId, entry.sessionId, entry.notes?.stage]));
  assert.equal(runtime.leaderState.previousSessions.length, 1);
  assert.equal(runtime.leaderState.previousSessions[0].sessionId, 'leader');
  assert.equal(runtime.leaderState.previousSessions[0].archived, true);
  assert.deepEqual(calls.archive, ['leader']);
  assert.deepEqual(calls.humanReads.at(-1), ['leader', 5], 'human messages are read from the OLD Leader before switching');
  const brief = calls.notify.slice(notifyBefore).at(-1);
  assert.equal(brief.sessionId, 'leader-2');
  assert.match(brief.body, /非人类交接简报/u);
  assert.match(brief.body, /issue-1-a \| Issue a .*阶段 实现中 \| 下一步 补测试 \| 等待 CI/u);
  assert.match(brief.body, /人类：b 不急/u);
  assert.match(brief.body, /gitlab_leader_overview/u);
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'handoff' && /switched/u.test(entry.detail)));
  assert.deepEqual(buildLeaderProjection(runtime.leaderState).previousSessions.map((entry) => entry.sessionId), ['leader']);
  // The retired Leader can no longer use Leader tools; the new one can.
  const stale = await invoke('overview', {}, agent('leader'));
  assert.equal(stale.ok, false); assert.match(stale.error, /不属于当前 Leader/u);
  assert.equal((await invoke('overview', {}, agent('leader-2'))).ok, true);
});

test('handoff of a paused Leader stays paused and sends no brief; archive failure does not roll back', async () => {
  const { setup, invoke, runtime, calls, behaviour } = fixture();
  await setup({ start: false });
  behaviour.archive = () => { throw remote('workspace/session-active'); };
  const result = await invoke('handoff');
  assert.equal(result.ok, true, result.error);
  assert.equal(runtime.leaderState.sessionId, 'leader-2');
  assert.equal(runtime.leaderState.enabled, false);
  assert.equal(result.result.handoff.resumed, false);
  assert.match(result.result.handoff.notice, /归档失败/u);
  assert.equal(calls.notify.length, 0); assert.equal(calls.humanReads.length, 0);
  assert.equal(runtime.leaderState.previousSessions[0].archived, false);
  assert.equal(runtime.leaderState.items.length, 2);
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'handoff' && /archiveError/u.test(entry.detail)));
  assert.equal(calls.create.length, 2); assert.deepEqual(calls.create[1], calls.create[0], 'same workspace/preset as the original create');
});

test('handoff preconditions: created Leader, quiet session, no open delivery, no uncertain creation', async () => {
  const empty = fixture();
  assert.equal((await empty.invoke('handoff')).ok, false);
  const { setup, invoke, sessions, runtime, calls } = fixture();
  await setup({ start: false });
  sessions.set('leader', sessionState({ running: true }));
  const busy = await invoke('handoff');
  assert.equal(busy.ok, false); assert.match(busy.error, /静默/u);
  sessions.set('leader', sessionState({ queue: [{ id: 'q' }] }));
  assert.equal((await invoke('handoff')).ok, false);
  sessions.set('leader', sessionState());
  runtime.leaderState.outbox.push({ requestId: 'r1', kind: 'notify', sessionId: 'leader', status: 'uncertain', epoch: 1, body: 'x', fingerprint: 'f', createdAt: 1, error: '' });
  const open = await invoke('handoff');
  assert.equal(open.ok, false); assert.match(open.error, /resolve_delivery/u);
  runtime.leaderState.outbox = [];
  assert.equal((await invoke('handoff', { foo: 1 })).ok, false);
  assert.equal(calls.create.length, 1); assert.equal(runtime.leaderState.sessionId, 'leader');
});

test('an uncertain handoff creation latches and is never retried automatically', async () => {
  const { setup, invoke, runtime, calls, behaviour } = fixture();
  await setup({ start: false });
  behaviour.create = () => { throw new Error('transport timeout'); };
  const result = await invoke('handoff');
  assert.equal(result.ok, false); assert.match(result.error, /交接未完成/u);
  assert.equal(runtime.leaderState.sessionId, null);
  assert.equal(runtime.leaderState.creation.status, 'uncertain');
  assert.equal(runtime.leaderState.previousSessions[0].sessionId, 'leader');
  assert.equal(calls.archive.length, 0, 'the old session is kept until a new one exists');
  behaviour.create = null;
  const again = await invoke('handoff');
  assert.equal(again.ok, false); assert.match(again.error, /不确定/u);
  assert.equal((await invoke('create')).ok, false, 'create is latched too');
  assert.equal(calls.create.length, 2);
  assert.equal(runtime.leaderState.items.length, 2);
});

test('handoff brief ignores human-message read failures', async () => {
  const { setup, invoke, calls, behaviour } = fixture();
  await setup();
  behaviour.humans = new Error('log unavailable');
  const result = await invoke('handoff');
  assert.equal(result.ok, true, result.error);
  assert.match(calls.notify.at(-1).body, /非人类交接简报/u);
  assert.doesNotMatch(calls.notify.at(-1).body, /最近的人类消息/u);
});


// ------------------------------------------------------------------ GitLab REST API

test('GET runs through glab api without gitlabWrite and the response is untrusted', async () => {
  const { setup, api, calls, behaviour, runtime } = fixture();
  await setup();
  behaviour.glab = () => JSON.stringify([{ iid: 3, title: 'MR' }]);
  const result = await api({ method: 'GET', path: '/api/v4/projects/1/merge_requests?state=opened' });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(calls.glab[0], ['api', '-X', 'GET', 'projects/1/merge_requests?state=opened']);
  assert.deepEqual(result.result.response, [{ iid: 3, title: 'MR' }]); assert.equal(result.result.untrusted, true);
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'gitlab-api' && /GET/u.test(entry.detail)));
  for (const bad of [{ method: 'PATCH', path: 'x' }, { method: 'GET', path: '../etc' }, { method: 'GET', path: '-X' }, { method: 'GET', path: 'a b' },
    { method: 'GET', path: 'projects/1', body: {} }, { method: 'GET', path: 'projects/1', extra: 1 }]) {
    assert.equal((await api(bad)).ok, false, JSON.stringify(bad));
  }
  assert.equal(calls.glab.length, 1);
});

test('non-GET calls are refused without gitlabWrite before any request', async () => {
  const { setup, api, calls } = fixture();
  await setup();
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const result = await api({ method, path: 'projects/1/issues/7/notes', body: { body: 'x' } });
    assert.equal(result.ok, false); assert.match(result.error, /gitlabWrite/u);
  }
  assert.equal(calls.glab.length, 0);
});

test('with gitlabWrite a note POST is signed, sent once via --input JSON, recorded and audited', async () => {
  const { setup, api, calls, runtime, invoke } = fixture();
  await setup({ write: true });
  const result = await api({ method: 'POST', path: 'projects/1/issues/7/notes', body: { body: '进度：单测已修复，等待 CI。' } });
  assert.equal(result.ok, true, result.error);
  assert.equal(calls.glab.length, 1);
  assert.deepEqual(calls.glab[0].slice(0, 5), ['api', '-X', 'POST', 'projects/1/issues/7/notes', '--input']);
  assert.equal(calls.inputs[0].body, `进度：单测已修复，等待 CI。\n\n${DEFAULT_LEADER_COMMENT_SIGNATURE}`);
  assert.equal(result.result.url, 'https://gitlab.test/group/project/-/issues/7#note_901');
  const ledger = runtime.leaderState.comments.at(-1);
  assert.equal(ledger.status, 'posted'); assert.equal(ledger.noteId, 901); assert.equal(ledger.taskId, 'issue-1-a');
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'gitlab-api' && entry.taskId === 'issue-1-a' && /done/u.test(entry.detail)));
  // A custom signature; a body already carrying the signature is not signed twice; non-note writes are unsigned.
  assert.equal((await invoke('configure', { settings: { commentSignature: '—— Leader 机器人' } })).ok, true);
  assert.equal((await api({ method: 'POST', path: 'projects/1/issues/8/notes', body: { body: '进度 2' } })).ok, true);
  assert.equal(calls.inputs[1].body, '进度 2\n\n—— Leader 机器人');
  assert.equal((await api({ method: 'POST', path: 'projects/1/issues/8/notes', body: { body: '已签 —— Leader 机器人' } })).ok, true);
  assert.equal(calls.inputs[2].body, '已签 —— Leader 机器人');
  assert.equal((await api({ method: 'PUT', path: 'projects/1/issues/8', body: { labels: 'doing' } })).ok, true);
  assert.deepEqual(calls.inputs[3], { labels: 'doing' });
  // No count or interval limit.
  for (let index = 0; index < 12; index += 1) assert.equal((await api({ method: 'POST', path: 'projects/1/issues/7/notes', body: { body: `进度 ${index}` } })).ok, true);
});

test('an uncertain write is never re-sent automatically; a GitLab rejection is reported as not applied', async () => {
  const { setup, api, calls, behaviour, runtime } = fixture();
  await setup({ write: true });
  behaviour.glab = () => { throw new Error('GitLab 请求超过 90000ms，已终止。'); };
  const uncertain = await api({ method: 'POST', path: 'projects/1/issues/7/notes', body: { body: '进度 A' } });
  assert.equal(uncertain.ok, false); assert.match(uncertain.error, /不会自动重发/u);
  assert.equal(runtime.leaderState.comments.at(-1).status, 'uncertain');
  assert.equal(calls.glab.length, 1);
  behaviour.glab = () => { throw new Error('glab 退出码 1：HTTP 403 Forbidden'); };
  const rejected = await api({ method: 'DELETE', path: 'projects/1/issues/8/notes/5' });
  assert.equal(rejected.ok, false); assert.match(rejected.error, /拒绝/u);
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'gitlab-api' && /rejected/u.test(entry.detail)));
});

test('apiRequest rejects bad input before any request', async () => {
  const calls = [];
  const runtime = { ...gitlabMethods, async runGlab(args) { calls.push(args); return '{}'; } };
  await assert.rejects(runtime.apiRequest('PATCH', 'projects/1'), (error) => error.beforeRequest === true);
  await assert.rejects(runtime.apiRequest('GET', '../x'), (error) => error.beforeRequest === true);
  await assert.rejects(runtime.apiRequest('GET', '-X'), (error) => error.beforeRequest === true);
  assert.equal(calls.length, 0);
  assert.deepEqual(await runtime.apiRequest('GET', 'projects/1'), {});
});

// ------------------------------------------------------------------ WorkStation Leader: Todo sessions + inbox
const addTodo = (runtime, id, patch = {}) => {
  const todo = { id, title: `Todo ${id}`, url: `https://gitlab.test/group/project/-/merge_requests/3#note_${id}`, project: 'group/project',
    targetType: 'MergeRequest', action: 'mentioned', author: 'alice', body: '@me 帮忙看下这个 MR', state: 'pending', createdAt: '2026-11-16T00:00:00Z' };
  runtime.state.todos.push(todo);
  if (patch.handled !== false) runtime.state.handled[id] = { id, sessionId: `todo-${id}`, item: todo, automatic: true, acceptedAt: Date.now(),
    outcome: 'session-accepted', title: todo.title, url: todo.url, executionStatus: 'completed', routed: false, ...patch.handled };
  return todo;
};

test('gitlab_leader_inbox lists the Todo inbox with processing state and the needs-human list', async () => {
  const { runtime, invoke, setup, agent, sessions } = fixture();
  await setup({ start: false });
  addTodo(runtime, '501', { handled: { closure: 'needs-human', closureNote: '需要人类确认合并', completedAt: Date.now() } });
  addTodo(runtime, '502', { handled: false });
  sessions.set('todo-501', sessionState());
  let polls = 0; runtime.poll = async (source) => { polls += 1; assert.equal(source, 'leader'); };
  const ui = await invoke('inbox', {});
  assert.equal(ui.ok, false);
  const plain = await invoke('inbox', {}, agent());
  assert.equal(plain.ok, true, plain.error); assert.equal(polls, 0);
  const byId = Object.fromEntries(plain.result.todos.map((todo) => [todo.taskId, todo]));
  assert.equal(byId['501'].status, 'handled'); assert.equal(byId['501'].sessionId, 'todo-501'); assert.equal(byId['501'].managed, false);
  assert.equal(byId['502'].status, 'new'); assert.equal(byId['502'].sessionId, null);
  assert.deepEqual(plain.result.needsHuman.map((entry) => entry.todoId), ['501']);
  assert.equal(plain.result.untrusted, true);
  assert.equal((await invoke('inbox', { refresh: true }, agent())).ok, true); assert.equal(polls, 1);
  runtime.poll = async () => { throw new Error('glab down'); };
  const failed = await invoke('inbox', { refresh: true }, agent());
  assert.equal(failed.ok, true); assert.match(failed.result.refreshError, /glab down/u);
});

test('Leader manages plugin-created Todo sessions: enroll, read, rename, overview, wake prefix, archive', async () => {
  const { runtime, invoke, setup, agent, sessions, calls } = fixture();
  await setup({ start: false });
  addTodo(runtime, '601');
  sessions.set('todo-601', sessionState());
  const archived = []; runtime.setSessionArchived = async (id, value) => { archived.push([id, value]); return { ok: true }; };
  const forged = await invoke('session', { action: 'enroll', taskId: '601', sessionId: 'worker-a' }, agent());
  assert.equal(forged.ok, false);
  const enrolled = await invoke('session', { action: 'enroll', taskId: '601' }, agent());
  assert.equal(enrolled.ok, true, enrolled.error);
  const item = runtime.leaderState.items.find((entry) => entry.taskId === '601');
  assert.equal(item.kind, 'todo'); assert.equal(item.sessionId, 'todo-601');
  const read = await invoke('read', { taskId: '601' }, agent());
  assert.equal(read.ok, true, read.error); assert.equal(read.result.kind, 'todo');
  assert.equal(read.result.gitlab, undefined); assert.equal(read.result.todo.author, 'alice');
  const renamed = await invoke('session', { action: 'rename', taskId: '601', title: 'MR !3 评审' }, agent());
  assert.equal(renamed.ok, true, renamed.error);
  assert.deepEqual(calls.rename.at(-1), ['todo-601', 'MR !3 评审']);
  assert.equal(runtime.state.handled['601'].sessionTitle, 'MR !3 评审');
  const overview = await invoke('overview', {}, agent());
  assert.deepEqual(overview.result.todos.map((todo) => todo.taskId), ['601']);
  assert.equal(runtime.leaderProjection().items.find((entry) => entry.taskId === '601').kind, 'todo');
  item.pendingWake = ['turn-end'];
  assert.match(runtime.leaderWakeLine(item), /^- \[Todo\] /u);
  const gone = await invoke('session', { action: 'archive', taskId: '601', reason: '已处理' }, agent());
  assert.equal(gone.ok, true, gone.error);
  assert.deepEqual(archived, [['todo-601', true]]);
  assert.equal(runtime.leaderState.items.some((entry) => entry.taskId === '601'), false);
});

test('Leader create for an inbox Todo dispatches it; a routed result is reported, not enrolled', async () => {
  const { runtime, invoke, setup, agent, sessions } = fixture();
  await setup({ start: false });
  addTodo(runtime, '701', { handled: false });
  addTodo(runtime, '702', { handled: false });
  const dispatched = [];
  runtime.dispatch = async (todo, force) => {
    dispatched.push([todo.id, force]);
    if (todo.id === '702') { runtime.state.handled[todo.id] = { id: todo.id, sessionId: 'worker-b', routed: true, title: todo.title, url: todo.url };
      return { ok: true, sessionId: 'worker-b', duplicate: false, routed: true, routeMode: 'reuse' }; }
    runtime.state.handled[todo.id] = { id: todo.id, sessionId: 'todo-701', routed: false, title: todo.title, url: todo.url, outcome: 'session-accepted' };
    sessions.set('todo-701', sessionState());
    return { ok: true, sessionId: 'todo-701', duplicate: false, routed: false };
  };
  const created = await invoke('session', { action: 'create', taskId: '701' }, agent());
  assert.equal(created.ok, true, created.error);
  assert.deepEqual(dispatched[0], ['701', false]);
  assert.equal(runtime.leaderState.items.find((entry) => entry.taskId === '701')?.kind, 'todo');
  const routed = await invoke('session', { action: 'create', taskId: '702' }, agent());
  assert.equal(routed.ok, true, routed.error); assert.equal(routed.result.routed, true);
  assert.equal(runtime.leaderState.items.some((entry) => entry.taskId === '702'), false);
  const unknown = await invoke('session', { action: 'create', taskId: '799' }, agent());
  assert.equal(unknown.ok, false); assert.match(unknown.error, /gitlab_leader_inbox/u);
});