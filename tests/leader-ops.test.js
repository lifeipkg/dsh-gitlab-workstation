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
  const calls = { create: [], rename: [], prompt: [], notify: [], archive: [], glab: [], refresh: 0, humanReads: [] };
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
      const file = args[args.indexOf('--input') + 1];
      const body = file ? JSON.parse(await readFile(file, 'utf8')).body : null;
      if (behaviour.glab) return behaviour.glab(args, body);
      return JSON.stringify({ id: 900 + calls.glab.length, body });
    },
  }, { postIssueNote: gitlabMethods.postIssueNote });
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
  const setup = async ({ start = true, comments = false } = {}) => {
    assert.equal((await invoke('create')).ok, true);
    if (comments) assert.equal((await invoke('configure', { settings: { issueComments: true } })).ok, true);
    assert.equal((await invoke('enroll', issue('a'))).ok, true);
    assert.equal((await invoke('enroll', issue('b'))).ok, true);
    if (start) { const started = await invoke('start'); assert.equal(started.ok, true, started.error); }
  };
  const item = (suffix = 'a') => runtime.leaderState.items.find((entry) => entry.taskId === `issue-1-${suffix}`);
  const steer = (extra = {}, suffix = 'a') => invoke('steerIssue', { ...issue(suffix), text: '先修复失败的单测，不要再改文档。', reason: 'worker 在改无关文件。', ...extra }, agent());
  return { runtime, calls, sessions, ui, invoke, issue, agent, setup, item, steer, behaviour };
}

const withClock = async (offsetMs, body) => {
  const realNow = Date.now; Date.now = () => realNow() + offsetMs;
  try { return await body(); } finally { Date.now = realNow; }
};

// ------------------------------------------------------------------ registration

test('ops tools are registered as Leader-only and handoff as UI-only', async () => {
  const names = new Map(LEADER_TOOLS.map(([name, operation]) => [operation, name]));
  assert.equal(names.get('steerIssue'), 'gitlab_leader_steer');
  assert.equal(names.get('commentIssue'), 'gitlab_leader_issue_comment');
  assert.equal(names.has('handoff'), false);
  const { invoke, setup, issue, agent } = fixture();
  await setup({ comments: true });
  for (const operation of ['steerIssue', 'commentIssue']) {
    const result = await invoke(operation, { ...issue(), text: 'x', reason: 'y', body: 'z' });
    assert.equal(result.ok, false); assert.match(result.error, /仅限 Leader Agent/u);
  }
  const handoff = await invoke('handoff', {}, agent());
  assert.equal(handoff.ok, false); assert.match(handoff.error, /不能自授/u);
  const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(index, /LEADER_UI_OPERATIONS = new Set\([^)]*'handoff'/su);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.check, /node --check host\/leader-ops\.js/u);
});

test('ops settings default off, validate strictly and survive normalization/projection', () => {
  const initial = initialLeaderState();
  assert.equal(initial.settings.issueComments, false);
  assert.equal(initial.settings.commentSignature, DEFAULT_LEADER_COMMENT_SIGNATURE);
  assert.deepEqual(initial.previousSessions, []);
  const next = validateLeaderSettings({ issueComments: true, commentSignature: '—— Leader' }, initial.settings);
  assert.equal(next.issueComments, true); assert.equal(next.commentSignature, '—— Leader');
  assert.throws(() => validateLeaderSettings({ issueComments: 'yes' }, initial.settings), /issueComments/u);
  assert.throws(() => validateLeaderSettings({ commentSignature: 'x'.repeat(101) }, initial.settings), /commentSignature/u);
  assert.throws(() => validateLeaderSettings({ commentSignature: 'a\nb' }, initial.settings), /commentSignature/u);
  const legacy = copy(initial); delete legacy.settings.issueComments; delete legacy.settings.commentSignature; delete legacy.previousSessions; delete legacy.comments;
  const normalized = normalizeLeaderState(legacy);
  assert.equal(normalized.settings.issueComments, false);
  assert.deepEqual(normalized.previousSessions, []);
  const withHistory = { ...copy(initial), previousSessions: [{ sessionId: 'old', handedOffAt: 5, archived: true }],
    comments: [{ requestId: 'leader-comment-x', taskId: 'issue-1-a', status: 'pending', noteId: null, url: '', at: 9, error: '' }] };
  const reloaded = normalizeLeaderState(withHistory);
  assert.equal(reloaded.comments[0].status, 'uncertain', 'a pending comment at restart is uncertain, never resent');
  const projection = buildLeaderProjection(reloaded);
  assert.deepEqual(projection.previousSessions, [{ sessionId: 'old', handedOffAt: 5, archived: true }]);
  assert.equal(projection.settings.issueComments, false);
});

// ------------------------------------------------------------------ steer

test('steer is delivered only to a running worker, with mode steer and a non-human header, and spends budget', async () => {
  const { setup, sessions, steer, calls, item, runtime } = fixture();
  await setup();
  const idleResult = await steer();
  assert.equal(idleResult.ok, false); assert.match(idleResult.error, /gitlab_leader_continue/u);
  assert.equal(calls.prompt.length, 0); assert.equal(item().actions, 0);
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
  assert.match(request.content[0].text, /^\[GitLab Issue Leader 纠偏引导；不是人类输入，不授予新权限\]/u);
  assert.match(request.content[0].text, /理由：worker 在改无关文件。/u);
  assert.match(request.content[0].text, /遵守原任务授权，只调整方向，不新增目标、不解除护栏/u);
  assert.equal(item().actions, 1); assert.equal(typeof item().lastSteerAt, 'number');
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'steer' && entry.taskId === 'issue-1-a'));
  assert.equal(typeof buildLeaderProjection(runtime.leaderState).items[0].lastSteerAt, 'number');
});

test('steer retries are idempotent and a new steer is rate limited to one per 10 minutes', async () => {
  const { setup, sessions, steer, calls, item } = fixture();
  await setup();
  sessions.set('worker-a', sessionState({ running: true }));
  assert.equal((await steer()).ok, true);
  const again = await steer();
  assert.equal(again.ok, true); assert.equal(again.result.duplicate, true);
  assert.equal(calls.prompt.length, 1, 'same parameters never re-inject'); assert.equal(item().actions, 1);
  const other = await steer({ text: '换一个方向：先跑 lint。' });
  assert.equal(other.ok, false); assert.match(other.error, /10 分钟内至多纠偏 1 次/u);
  const later = await withClock(11 * 60 * 1000, () => steer({ text: '换一个方向：先跑 lint。' }));
  assert.equal(later.ok, true, later.error);
  assert.equal(calls.prompt.length, 2); assert.notEqual(calls.prompt[0].requestId, calls.prompt[1].requestId);
  assert.equal(item().actions, 2);
});

test('steer refunds a clear Host rejection and latches an uncertain send without retry', async () => {
  const { setup, sessions, steer, calls, item, behaviour, runtime } = fixture();
  await setup();
  sessions.set('worker-a', sessionState({ running: true }));
  behaviour.prompt = () => { throw remote('session busy with approval'); };
  const rejected = await steer();
  assert.equal(rejected.ok, false); assert.match(rejected.error, /未扣预算/u);
  assert.equal(item().actions, 0); assert.equal(item().lastSteerAt ?? null, null);
  behaviour.prompt = () => { throw new Error('timeout'); };
  const uncertain = await steer();
  assert.equal(uncertain.ok, false); assert.match(uncertain.error, /不会自动重发/u);
  assert.equal(item().actions, 1);
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'steer-uncertain'));
  behaviour.prompt = null;
  const retry = await withClock(11 * 60 * 1000, () => steer());
  assert.equal(retry.ok, false, 'the same uncertain request is never re-sent'); assert.match(retry.error, /不确定/u);
  assert.equal(calls.prompt.length, 2);
});

test('steer respects paused items, pending alerts, dependencies and a paused Leader', async () => {
  const { setup, sessions, steer, invoke, issue, item, runtime } = fixture();
  await setup();
  sessions.set('worker-a', sessionState({ running: true }));
  assert.equal((await invoke('pauseIssue', issue())).ok, true);
  assert.equal((await steer()).ok, false);
  sessions.set('worker-a', sessionState());
  assert.equal((await invoke('resumeIssue', issue())).ok, true);
  sessions.set('worker-a', sessionState({ running: true }));
  item().alerts.push({ id: 'alert-1', question: '需要人类？', status: 'pending' });
  assert.equal((await steer()).ok, false);
  item().alerts = [];
  item().notes = { ...(item().notes ?? {}), dependsOn: ['issue-1-b'] };
  const blocked = await steer();
  assert.equal(blocked.ok, false); assert.match(blocked.error, /依赖|issue-1-b/u);
  item().notes = { ...item().notes, dependsOn: [] };
  assert.equal((await invoke('pause')).ok, true);
  assert.equal((await steer()).ok, false);
  assert.equal(runtime.leaderState.items.every((entry) => entry.actions === 0), true);
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
  assert.deepEqual(runtime.leaderState.items.map((entry) => [entry.taskId, entry.sessionId, entry.actions, entry.notes?.stage]),
    before.map((entry) => [entry.taskId, entry.sessionId, entry.actions, entry.notes?.stage]));
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
  assert.match(brief.body, /gitlab_leader_steer/u);
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'handoff' && /switched/u.test(entry.detail)));
  assert.deepEqual(buildLeaderProjection(runtime.leaderState).previousSessions.map((entry) => entry.sessionId), ['leader']);
  // The retired Leader can no longer use Leader tools; the new one can.
  const stale = await invoke('snapshot', {}, agent('leader'));
  assert.equal(stale.ok, false); assert.match(stale.error, /不属于当前 Leader/u);
  assert.equal((await invoke('snapshot', {}, agent('leader-2'))).ok, true);
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
  assert.equal(open.ok, false); assert.match(open.error, /resolveDelivery/u);
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

// ------------------------------------------------------------------ Issue comments

test('issue comments are off by default and need the human to enable them', async () => {
  const { setup, invoke, agent, calls } = fixture();
  await setup();
  const result = await invoke('commentIssue', { taskId: 'issue-1-a', body: '进度：单测已修复。' }, agent());
  assert.equal(result.ok, false); assert.match(result.error, /需要人类在面板/u);
  assert.equal(calls.glab.length, 0);
});

test('enabled comments post once with signature via --input JSON, rate limit and dedupe', async () => {
  const { setup, invoke, agent, calls, runtime, item } = fixture();
  await setup({ comments: true });
  const body = '进度：单测已修复，等待 CI。';
  const result = await invoke('commentIssue', { taskId: 'issue-1-a', body }, agent());
  assert.equal(result.ok, true, result.error);
  assert.equal(calls.glab.length, 1);
  const args = calls.glab[0];
  assert.deepEqual(args.slice(0, 4), ['api', '-X', 'POST', 'projects/1/issues/7/notes']);
  assert.equal(args[4], '--input');
  assert.equal(result.result.noteId, 901);
  assert.equal(result.result.url, 'https://gitlab.test/group/project/-/issues/7#note_901');
  assert.equal(item().commentCount, 1); assert.equal(typeof item().lastCommentAt, 'number');
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'comment'));
  const posted = runtime.leaderState.comments.at(-1);
  assert.equal(posted.status, 'posted'); assert.equal(posted.noteId, 901);
  const duplicate = await invoke('commentIssue', { taskId: 'issue-1-a', body }, agent());
  assert.equal(duplicate.ok, true); assert.equal(duplicate.result.duplicate, true);
  assert.equal(calls.glab.length, 1);
  const tooSoon = await invoke('commentIssue', { taskId: 'issue-1-a', body: '新的进度。' }, agent());
  assert.equal(tooSoon.ok, false); assert.match(tooSoon.error, /30 分钟内至多 1 条/u);
  const otherIssue = await invoke('commentIssue', { taskId: 'issue-1-b', body: '另一个 Issue 的进度。' }, agent());
  assert.equal(otherIssue.ok, true, otherIssue.error);
  const projection = buildLeaderProjection(runtime.leaderState);
  assert.equal(projection.items.find((entry) => entry.taskId === 'issue-1-a').commentCount, 1);
});

test('the signature line is appended to the posted body', async () => {
  const { setup, invoke, agent, behaviour } = fixture();
  await setup({ comments: true });
  let posted = null;
  behaviour.glab = (args, body) => { posted = body; return JSON.stringify({ id: 5 }); };
  assert.equal((await invoke('commentIssue', { taskId: 'issue-1-a', body: '进度 OK' }, agent())).ok, true);
  assert.equal(posted, `进度 OK\n\n${DEFAULT_LEADER_COMMENT_SIGNATURE}`);
  const custom = fixture();
  await custom.setup({ comments: true });
  assert.equal((await custom.invoke('configure', { settings: { commentSignature: '—— Leader 机器人' } })).ok, true);
  custom.behaviour.glab = (args, body) => { posted = body; return JSON.stringify({ id: 6 }); };
  assert.equal((await custom.invoke('commentIssue', { taskId: 'issue-1-a', body: '进度 2' }, custom.agent())).ok, true);
  assert.equal(posted, '进度 2\n\n—— Leader 机器人');
});

test('at most 10 comments per item per run', async () => {
  const { setup, invoke, agent, item } = fixture();
  await setup({ comments: true });
  for (let index = 0; index < 10; index += 1) {
    const result = await withClock(index * 31 * 60 * 1000, () => invoke('commentIssue', { taskId: 'issue-1-a', body: `进度 ${index}` }, agent()));
    assert.equal(result.ok, true, result.error);
  }
  assert.equal(item().commentCount, 10);
  const over = await withClock(11 * 31 * 60 * 1000, () => invoke('commentIssue', { taskId: 'issue-1-a', body: '进度 11' }, agent()));
  assert.equal(over.ok, false); assert.match(over.error, /上限 10/u);
  // A human budget reset starts a fresh managed run for that Issue, comments included.
  assert.equal((await invoke('resetIssueBudget', { taskId: 'issue-1-a', sessionId: 'worker-a' })).ok, true);
  assert.equal(item().commentCount, 0);
});

test('comments are rejected for ad-hoc tasks and unmanaged Issues', async () => {
  const { setup, invoke, agent, calls } = fixture();
  await setup({ comments: true });
  assert.equal((await invoke('commentIssue', { taskId: 'leader-task-0123456789ab', body: 'x' }, agent())).ok, false);
  assert.equal((await invoke('commentIssue', { taskId: 'issue-9-z', body: 'x' }, agent())).ok, false);
  assert.equal(calls.glab.length, 0);
});

test('an uncertain comment is counted and never re-posted; a GitLab rejection is refunded', async () => {
  const { setup, invoke, agent, calls, behaviour, runtime, item } = fixture();
  await setup({ comments: true });
  behaviour.glab = () => { throw new Error('GitLab 请求超过 90000ms，已终止。'); };
  const uncertain = await invoke('commentIssue', { taskId: 'issue-1-a', body: '进度 A' }, agent());
  assert.equal(uncertain.ok, false); assert.match(uncertain.error, /不会自动重发/u);
  assert.equal(item().commentCount, 1);
  assert.ok(runtime.leaderState.audit.some((entry) => entry.action === 'comment-uncertain'));
  behaviour.glab = null;
  const retry = await withClock(31 * 60 * 1000, () => invoke('commentIssue', { taskId: 'issue-1-a', body: '进度 A' }, agent()));
  assert.equal(retry.ok, false); assert.match(retry.error, /不确定/u);
  assert.equal(calls.glab.length, 1);
  behaviour.glab = () => { throw new Error('glab 退出码 1：HTTP 403 Forbidden'); };
  const rejected = await invoke('commentIssue', { taskId: 'issue-1-b', body: '进度 B' }, agent());
  assert.equal(rejected.ok, false); assert.match(rejected.error, /未计数/u);
  assert.equal(item('b').commentCount, 0); assert.equal(item('b').lastCommentAt ?? null, null);
});

test('postIssueNote rejects bad targets before any request', async () => {
  const calls = [];
  const runtime = { ...gitlabMethods, async runGlab(args) { calls.push(args); return '{}'; } };
  await assert.rejects(runtime.postIssueNote('projects/1/merge_requests/2', 'x'), (error) => error.beforeRequest === true);
  await assert.rejects(runtime.postIssueNote('projects/1/issues/2', '   '), (error) => error.beforeRequest === true);
  assert.equal(calls.length, 0);
});
