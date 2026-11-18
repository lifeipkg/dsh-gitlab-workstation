import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialLeaderState, LEADER_LIMITS } from '../core.js';
import { leaderMethods, createLeaderUiCaller, createLeaderAgentCaller, createLeaderWorkerCaller } from '../host/leader.js';
import { copy, fixture, handledRecord, issueItem, missing, remote, sessionState } from './leader-fixture.js';

// ---------------------------------------------------------------------------------------------------------------
// Leader session lifecycle: create / configure / resolve / missing / journal migration
// ---------------------------------------------------------------------------------------------------------------

test('creating the Leader persists the creation tombstone before the Host side effect, then renames and briefs it once', async () => {
  const f = fixture();
  const result = await f.invoke('create', {});
  assert.equal(result.ok, true);
  assert.equal(result.result.sessionId, 'leader');
  assert.equal(result.result.phase, 'ready');
  assert.equal(result.result.runState, 'ready');
  // The journal on disk already said "creating / uncertain" at the moment the Host was called.
  const atCreate = f.calls.create[0].journal;
  assert.equal(atCreate.creation.status, 'creating');
  assert.equal(atCreate.phase, 'uncertain');
  assert.equal(atCreate.sessionId, null);
  assert.equal(f.calls.persist[0].creation.status, 'creating');
  assert.deepEqual(f.calls.create[0].request, { workspaceId: 'issue-workspace' });
  assert.deepEqual(f.calls.rename, [{ sessionId: 'leader', title: 'WorkStation Leader' }]);
  assert.equal(f.calls.prompt.length, 1);
  assert.equal(f.calls.prompt[0].sessionId, 'leader');
  assert.equal(f.calls.prompt[0].mode, 'queue');
  // Creating again reuses the session: no second Host session and no second briefing.
  const again = await f.invoke('create', {});
  assert.equal(again.ok, true);
  assert.equal(f.calls.create.length, 1);
  assert.equal(f.calls.prompt.length, 1);
});

test('the Leader session is created in the Issue workspace and carries the configured model and preset', async () => {
  const f = fixture();
  f.runtime.state.settings.issueSessionCwd = 'cwd-x';
  f.runtime.config.leaderAgentPreset = 'dsh-standard';
  const model = { provider: 'prov', model: 'm1', reasoningEffort: 'high' };
  const result = await f.invoke('create', { settings: { model } });
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls.create[0].request, { workspaceId: 'cwd-x', agentPreset: 'dsh-standard' });
  assert.deepEqual(f.calls.model, [{ sessionId: 'leader', ...model }]);
  assert.equal(f.runtime.leaderState.creation.agentPreset, 'dsh-standard');
  assert.deepEqual(f.runtime.leaderState.configuredModel, model);
});

test('an invalid leaderAgentPreset config stops creation before any tombstone or Host call', async () => {
  const f = fixture();
  f.runtime.config.leaderAgentPreset = ' padded ';
  const result = await f.invoke('create', {});
  assert.equal(result.ok, false);
  assert.match(result.error, /leaderAgentPreset 配置无效/u);
  assert.equal(f.calls.create.length, 0);
  assert.equal(f.runtime.leaderState.creation, null);
});

test('a registry that cannot resolve the Leader preset blocks creation instead of silently falling back', async () => {
  const f = fixture();
  f.runtime.config.leaderAgentPreset = 'dsh-standard';
  f.runtime.leaderServicesContext = { agentPresets: { resolve: async () => { throw new Error('no such preset'); } } };
  const result = await f.invoke('create', {});
  assert.equal(result.ok, false);
  assert.match(result.error, /Leader preset 不可用/u);
  assert.equal(f.calls.create.length, 0);
});

test('a failed journal write before the Host call prevents the Leader session from being created', async () => {
  const f = fixture({ persistFails: (n) => n === 1 });
  const result = await f.invoke('create', {});
  assert.equal(result.ok, false);
  assert.equal(f.calls.create.length, 0);
  assert.equal(f.runtime.leaderStorageFault, true);
});

test('an uncertain Host create result is recorded and never recreated automatically', async () => {
  const f = fixture({ createSession: () => { throw new Error('timeout talking to host'); } });
  const first = await f.invoke('create', {});
  assert.equal(first.ok, false);
  assert.match(first.error, /Leader 创建\/记录结果不确定，禁止自动重建/u);
  assert.equal(f.runtime.leaderState.creation.status, 'uncertain');
  assert.equal(f.runtime.leaderState.phase, 'uncertain');
  assert.equal(first.result.runState, 'creation-uncertain');
  const second = await f.invoke('create', {});
  assert.equal(second.ok, false);
  assert.match(second.error, /禁止重复创建/u);
  assert.equal(f.calls.create.length, 1);
});

test('an uncertain creation is resolved only by a human: abandon allows a new create, claim adopts a verified session', async () => {
  const f = fixture({ createSession: () => { throw new Error('lost'); } });
  await f.invoke('create', {});
  // The Leader Agent cannot touch creation records.
  assert.equal((await f.invoke('resolveCreation', { resolution: 'abandon' }, f.agent())).ok, false);
  const abandoned = await f.invoke('resolveCreation', { resolution: 'abandon' });
  assert.equal(abandoned.ok, true);
  assert.equal(f.runtime.leaderState.creation, null);
  assert.equal(f.runtime.leaderState.abandonedCreations.length, 1);
  assert.equal(f.runtime.leaderState.phase, 'not-created');

  const claim = fixture({ createSession: () => { throw new Error('lost'); } });
  await claim.invoke('create', {});
  const bad = await claim.invoke('resolveCreation', { resolution: 'claim' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /resolution 必须是 abandon，或 claim 并提供人类核实的 Leader 会话 ID/u);
  const adopted = await claim.invoke('resolveCreation', { resolution: 'claim', sessionId: 'leader' });
  assert.equal(adopted.ok, true);
  assert.equal(claim.runtime.leaderState.sessionId, 'leader');
  assert.equal(claim.runtime.leaderState.phase, 'ready');
  assert.equal(claim.calls.create.length, 1);
});

test('claiming a plugin worker session as the Leader is refused', async () => {
  const f = fixture({ createSession: () => { throw new Error('lost'); } });
  f.addIssue(1, 'worker-a');
  await f.invoke('create', {});
  const result = await f.invoke('resolveCreation', { resolution: 'claim', sessionId: 'worker-a' });
  assert.equal(result.ok, false);
  assert.equal(f.runtime.leaderState.sessionId, null);
});

test('resolveCreation without an uncertain record reports that there is nothing to resolve', async () => {
  const f = fixture();
  const result = await f.invoke('resolveCreation', { resolution: 'abandon' });
  assert.equal(result.ok, false);
  assert.match(result.error, /当前没有结果不确定的 Leader 创建记录/u);
});

test('a setup failure after creation keeps the known session ID and a retry reuses it', async () => {
  let fail = true;
  const f = fixture({ rename: () => { if (fail) throw new Error('rename refused'); } });
  const first = await f.invoke('create', {});
  assert.equal(first.ok, false);
  assert.match(first.error, /Leader 已创建；设置失败，重试复用已知 ID/u);
  assert.equal(f.runtime.leaderState.sessionId, 'leader');
  assert.equal(first.result.runState, 'error');
  fail = false;
  const retry = await f.invoke('create', {});
  assert.equal(retry.ok, true);
  assert.equal(f.calls.create.length, 1);
  assert.equal(f.runtime.leaderState.phase, 'ready');
});

test('a busy or archived Leader session is not reconfigured by a retried create', async () => {
  const f = fixture();
  await f.createLeader();
  f.sessions.set('leader', sessionState({ running: true }));
  const busy = await f.invoke('create', { settings: { model: { provider: 'prov', model: 'm1' } } });
  assert.equal(busy.ok, false);
  assert.equal(f.calls.model.length, 0);
});

test('configure changes the model of a quiet Leader and resets it with null; busy or unknown keys are refused', async () => {
  const f = fixture();
  await f.createLeader();
  const model = { provider: 'prov', model: 'm2' };
  const set = await f.invoke('configure', { settings: { model } });
  assert.equal(set.ok, true);
  assert.deepEqual(f.calls.model.at(-1), { sessionId: 'leader', ...model });
  assert.deepEqual(f.runtime.leaderState.configuredModel, model);
  // Unchanged model: no Host call.
  const same = await f.invoke('configure', { settings: { model } });
  assert.equal(same.ok, true);
  assert.equal(f.calls.model.length, 1);
  const reset = await f.invoke('configure', { settings: { model: null } });
  assert.equal(reset.ok, true);
  assert.deepEqual(f.calls.resetModel, ['leader']);
  assert.equal(f.runtime.leaderState.configuredModel, null);

  f.sessions.set('leader', sessionState({ running: true }));
  const busy = await f.invoke('configure', { settings: { model } });
  assert.equal(busy.ok, false);
  assert.match(busy.error, /Leader 状态不可验证\/忙碌，未更换模型/u);
  assert.deepEqual(f.runtime.leaderState.settings.model, null);

  const unknown = await f.invoke('configure', { settings: { budget: 3 } });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /未知 Leader 设置/u);
  const invalid = await f.invoke('configure', { settings: { model: { provider: '', model: 'x' } } });
  assert.equal(invalid.ok, false);
});

test('configure before the Leader exists only stores the model for the first create', async () => {
  const f = fixture();
  const model = { provider: 'prov', model: 'm1' };
  assert.equal((await f.invoke('configure', { settings: { model } })).ok, true);
  assert.equal(f.calls.model.length, 0);
  await f.invoke('create', {});
  assert.deepEqual(f.calls.model, [{ sessionId: 'leader', ...model }]);
});

test('a deleted Leader session resets the stored ID on the next UI snapshot and is never recreated automatically', async () => {
  const f = fixture();
  await f.createLeader();
  f.sessions.delete('leader');
  const board = await f.board();
  assert.equal(board.ok, true, 'agent tools do not probe or reset the stored Leader');
  assert.equal(f.runtime.leaderState.sessionId, 'leader');
  const snapshot = await f.invoke('snapshot', {});
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.result.sessionId, null);
  assert.equal(snapshot.result.phase, 'not-created');
  assert.equal(f.runtime.leaderState.creation, null);
  assert.equal(f.calls.create.length, 1);
});

test('an archived or unverifiable Leader session is not treated as missing', async () => {
  const f = fixture();
  await f.createLeader();
  f.archivedSessionIds.push('leader');
  const archived = await f.invoke('snapshot', {});
  assert.equal(archived.result.sessionId, 'leader');
  f.runtime.leaderMissingCheckAt = 0;
  f.archivedSessionIds.length = 0;
  f.runtime.host.sessionState = async () => { throw remote('host exploded', 'session/internal'); };
  const unknown = await f.invoke('snapshot', {});
  assert.equal(unknown.result.sessionId, 'leader');
  // A not-found for a different session ID is not proof that the Leader is gone.
  f.runtime.leaderMissingCheckAt = 0;
  f.runtime.host.sessionState = async () => { throw missing('someone-else'); };
  assert.equal((await f.invoke('snapshot', {})).result.sessionId, 'leader');
});

// ---- journal migration and persistence (real files) ----

async function withStorage(run) {
  const dir = await mkdtemp(join(tmpdir(), 'gta-leader-'));
  const f = fixture();
  f.runtime.storageDirectory = () => dir;
  delete f.runtime.persistLeader;
  f.runtime.persistLeader = leaderMethods.persistLeader;
  try { await run(f, dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const v1Journal = () => ({
  version: 1, enabled: true, phase: 'running', sessionId: 'leader-old',
  settings: { model: { provider: 'prov', model: 'm1' }, autoEnrollNew: true }, configuredModel: { provider: 'prov', model: 'm1' },
  creation: { requestId: 'leader-create-old', status: 'ready', createdAt: 1 },
  items: [{ taskId: 'issue-1', sessionId: 'worker-a', status: 'running', actions: 3 }],
  outbox: [{ requestId: 'r1', status: 'uncertain', sessionId: 'worker-a' }],
  queue: [{ queueId: 'q1', taskId: 'issue-2' }], audit: [{ action: 'x' }], notes: { 'issue-1': 'note' },
  tasks: [{ taskId: 'leader-task-0123456789ab', sessionId: 'task-s', title: 'IAM', brief: 'look', workspace: '', status: 'created', createdAt: 5, error: '' }],
  reports: [{ id: 'report-aaaaaaaa', taskId: 'issue-1', sessionId: 'worker-a', kind: 'progress', text: 'half done', at: 7, seen: false }],
});

test('a v1 journal migrates to v2: session, model, creation, tasks and reports survive; the old file is backed up once', async () => {
  await withStorage(async (f, dir) => {
    const original = JSON.stringify(v1Journal());
    await writeFile(join(dir, 'leader.json'), original, 'utf8');
    const projection = await f.runtime.loadLeader();
    assert.equal(projection.sessionId, 'leader-old');
    assert.equal(projection.phase, 'ready');
    assert.equal(projection.runState, 'ready');
    assert.deepEqual(projection.settings, { model: { provider: 'prov', model: 'm1' } });
    assert.equal(projection.tasks.length, 1);
    assert.equal(projection.tasks[0].taskId, 'leader-task-0123456789ab');
    assert.equal(projection.reports.length, 1);
    assert.equal(projection.reports[0].seen, true, 'migrated reports are not re-announced');
    assert.equal(projection.unseenReports, 0);
    assert.deepEqual(projection.deliveries, []);
    const state = f.runtime.leaderState;
    for (const dropped of ['enabled', 'items', 'outbox', 'queue', 'audit', 'notes', 'migratedFrom']) assert.equal(Object.hasOwn(state, dropped), false, dropped);
    assert.equal(await readFile(join(dir, 'leader.json.v1.bak'), 'utf8'), original);
    const written = JSON.parse(await readFile(join(dir, 'leader.json'), 'utf8'));
    assert.equal(written.version, 2);
    assert.equal(Object.hasOwn(written, 'items'), false);
    // A second load must not overwrite the backup with the v2 file.
    await f.runtime.loadLeader();
    assert.equal(await readFile(join(dir, 'leader.json.v1.bak'), 'utf8'), original);
  });
});

test('a v1 journal in the middle of creation migrates to an uncertain creation that is never recreated', async () => {
  await withStorage(async (f, dir) => {
    await writeFile(join(dir, 'leader.json'), JSON.stringify({ version: 1, sessionId: null, creation: { requestId: 'leader-create-x', status: 'creating', createdAt: 2 } }), 'utf8');
    const projection = await f.runtime.loadLeader();
    assert.equal(projection.phase, 'uncertain');
    assert.equal(projection.runState, 'creation-uncertain');
    const result = await f.invoke('create', {});
    assert.equal(result.ok, false);
    assert.equal(f.calls.create.length, 0);
  });
});

test('a missing journal starts empty; the first operation writes a v2 file atomically with no stray temp files', async () => {
  await withStorage(async (f, dir) => {
    const projection = await f.runtime.loadLeader();
    assert.equal(projection.phase, 'not-created');
    await f.createLeader();
    const written = JSON.parse(await readFile(join(dir, 'leader.json'), 'utf8'));
    assert.equal(written.version, 2);
    assert.equal(written.sessionId, 'leader');
    assert.equal(written.creation.status, 'ready');
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith('.tmp')), []);
  });
});

test('a v2 journal restart turns sending deliveries and creating tasks into uncertain records', async () => {
  await withStorage(async (f, dir) => {
    await writeFile(join(dir, 'leader.json'), JSON.stringify({ version: 2, sessionId: 'leader', phase: 'ready', settings: { model: null }, configuredModel: null,
      creation: { requestId: 'leader-create-1', status: 'ready', createdAt: 1 },
      tasks: [{ taskId: 'leader-task-aaaaaaaaaaaa', sessionId: null, title: 'T', brief: 'B', workspace: '', status: 'creating', createdAt: 1, error: '' }],
      deliveries: [{ requestId: 'leader-send-1', kind: 'send', taskId: 'issue-1', sessionId: 'worker-a', status: 'sending', at: 3, bodyDigest: 'd'.repeat(64), error: '' }] }), 'utf8');
    const projection = await f.runtime.loadLeader();
    assert.equal(projection.tasks[0].status, 'uncertain');
    assert.match(projection.tasks[0].error, /重启时临时任务创建结果不确定/u);
    assert.equal(projection.deliveries.length, 1);
    assert.equal(projection.deliveries[0].status, 'uncertain');
    assert.match(projection.deliveries[0].error, /重启时投递结果不确定/u);
  });
});

test('an unreadable or invalid journal freezes the Leader read-only and is never overwritten', async () => {
  await withStorage(async (f, dir) => {
    await writeFile(join(dir, 'leader.json'), '{ not json', 'utf8');
    const projection = await f.runtime.loadLeader();
    assert.equal(projection.phase, 'error');
    assert.match(projection.error, /读取 Leader journal 失败，未覆盖原文件/u);
    assert.equal(f.runtime.leaderJournalUnreadable, true);
    const create = await f.invoke('create', {});
    assert.equal(create.ok, false);
    assert.match(create.error, /只读冻结/u);
    assert.equal((await f.invoke('session', { action: 'send', taskId: 'x', text: 'y' }, f.agent())).ok, false);
    assert.equal((await f.invoke('snapshot', {})).ok, true);
    f.addIssue(1, 'worker-a');
    const report = await f.report({ kind: 'progress', text: 'hi' });
    assert.equal(report.ok, false);
    assert.match(report.error, /Leader journal 不可用，报告未记录/u);
    assert.equal(await readFile(join(dir, 'leader.json'), 'utf8'), '{ not json');
    assert.equal(f.calls.create.length, 0);

    await writeFile(join(dir, 'leader.json'), JSON.stringify({ version: 9 }), 'utf8');
    assert.equal((await f.runtime.loadLeader()).phase, 'error');
    await writeFile(join(dir, 'leader.json'), JSON.stringify({ version: 2, sessionId: 12 }), 'utf8');
    assert.equal((await f.runtime.loadLeader()).phase, 'error');
    assert.equal(await readFile(join(dir, 'leader.json'), 'utf8'), JSON.stringify({ version: 2, sessionId: 12 }));
  });
});

test('a journal write failure stops further Host side effects and reports the fault', async () => {
  const f = fixture();
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  f.runtime.persistLeader = async () => { throw new Error('disk full'); };
  const result = await f.session({ action: 'create', title: 'T', brief: 'B' });
  assert.equal(result.ok, false);
  assert.equal(f.runtime.leaderStorageFault, true);
  assert.equal(f.runtime.leaderState.phase, 'error');
  assert.match(f.runtime.leaderState.error, /Leader journal 落盘失败，已停止所有副作用/u);
  const before = f.calls.create.length;
  const next = await f.session({ action: 'create', title: 'T2', brief: 'B2' });
  assert.equal(next.ok, false);
  assert.match(next.error, /Leader journal 不可写，未创建会话/u);
  assert.equal(f.calls.create.length, before);
  const send = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello' });
  assert.equal(send.ok, false);
  assert.match(send.error, /Leader journal 不可写，未执行/u);
  assert.equal(f.calls.deliver.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------------------------------------------

test('callers are opaque Host-minted brands: forged objects and missing ids are rejected', async () => {
  const f = fixture();
  await f.createLeader();
  assert.throws(() => createLeaderAgentCaller({ sessionId: '', agentId: 'a' }));
  assert.throws(() => createLeaderWorkerCaller({ sessionId: 'w', agentId: '' }));
  for (const forged of [null, {}, { kind: 'ui' }, { kind: 'agent', sessionId: 'leader' }, Object.freeze({})]) {
    const result = await f.invoke('snapshot', {}, forged);
    assert.equal(result.ok, false, JSON.stringify(forged));
    assert.match(result.error, /拒绝无可信身份的 Leader 调用/u);
  }
  // A caller minted by one call cannot be reused as another kind.
  const ui = createLeaderUiCaller();
  assert.equal((await f.invoke('board', {}, ui)).ok, false);
});

test('the UI caller can manage the Leader record but cannot use the Leader tools or report as a worker', async () => {
  const f = fixture();
  await f.createLeader();
  for (const operation of ['board', 'session']) {
    const result = await f.invoke(operation, { action: 'send' }, f.ui);
    assert.equal(result.ok, false, operation);
    assert.match(result.error, /仅限 Leader Agent 工具调用/u);
  }
  const report = await f.invoke('workerReport', { kind: 'progress', text: 'x' }, f.ui);
  assert.equal(report.ok, false);
  assert.match(report.error, /workerReport 仅限插件创建的 worker 会话调用/u);
  for (const operation of ['snapshot', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery']) {
    const result = await f.invoke(operation, operation === 'configure' ? { settings: { model: null } } : {}, f.ui);
    assert.notEqual(result.error ?? '', '该操作仅限 Leader Agent 工具调用。', operation);
  }
});

test('the Leader Agent cannot create or configure the Leader, resolve creation, tasks or UI-only records', async () => {
  const f = fixture();
  await f.createLeader();
  for (const operation of ['create', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery']) {
    const result = await f.invoke(operation, { settings: { model: null } }, f.agent());
    assert.equal(result.ok, false, operation);
    assert.match(result.error, /Leader Agent 不能修改 Leader 设置、创建 Leader 或处理 Leader 创建记录/u);
  }
  // Snapshot is a UI operation; the Leader reads state through the board.
  assert.equal((await f.invoke('snapshot', {}, f.agent())).ok, false);
});

test('only the selected Leader session may call the Leader tools', async () => {
  const f = fixture();
  await f.createLeader();
  const stranger = await f.invoke('board', {}, f.agent('worker-a'));
  assert.equal(stranger.ok, false);
  assert.match(stranger.error, /调用 Agent 不属于当前 Leader 会话/u);
  assert.equal((await f.invoke('board', {}, f.agent('leader'))).ok, true);
});

test('worker callers may only report and only from plugin-created sessions', async () => {
  const f = fixture();
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  for (const operation of ['board', 'session', 'snapshot', 'create', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery']) {
    const result = await f.invoke(operation, { action: 'send' }, f.worker('worker-a'));
    assert.equal(result.ok, false, operation);
    assert.match(result.error, /worker 会话只能向 Leader 报告/u);
    assert.equal(Object.hasOwn(result, 'result') && result.result !== null && result.result !== undefined && 'sessionId' in (result.result ?? {}), false, 'no Leader projection leaks to workers');
  }
  const foreign = await f.invoke('workerReport', { kind: 'progress', text: 'hi' }, f.worker('human'));
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /调用会话不是当前插件创建的 worker/u);
  const leaderAsWorker = await f.invoke('workerReport', { kind: 'progress', text: 'hi' }, f.worker('leader'));
  assert.equal(leaderAsWorker.ok, false);
  assert.equal((await f.report({ kind: 'progress', text: 'hi' })).ok, true);
});

test('a stopping plugin rejects every Leader operation', async () => {
  const f = fixture();
  await f.createLeader();
  f.runtime.leaderStopping = true;
  for (const [operation, caller] of [['snapshot', f.ui], ['board', f.agent()], ['workerReport', f.worker('worker-a')]]) {
    const result = await f.invoke(operation, { kind: 'progress', text: 'x' }, caller);
    assert.equal(result.ok, false, operation);
  }
});

test('non-object arguments are rejected for every caller kind', async () => {
  const f = fixture();
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  assert.equal((await f.invoke('board', null, f.agent())).ok, false);
  assert.equal((await f.invoke('session', [], f.agent())).ok, false);
  assert.match((await f.report('text')).error, /报告参数必须是对象/u);
  assert.match((await f.invoke('session', 'x', f.agent())).error, /Leader 参数必须是对象/u);
});

test('unknown operations and unknown session actions fail without side effects', async () => {
  const f = fixture();
  await f.createLeader();
  const unknown = await f.invoke('enroll', {}, f.ui);
  assert.equal(unknown.ok, false);
  const action = await f.session({ action: 'delete' });
  assert.equal(action.ok, false);
  assert.match(action.error, /action 必须是/u);
  assert.equal(f.calls.deliver.length + f.calls.archive.length + f.calls.setArchived.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------------------------

test('the board lists Issues, ad-hoc tasks, reports and open deliveries without granting anything', async () => {
  const f = fixture();
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  f.addIssue(2);
  await f.session({ action: 'create', title: 'IAM 架构', brief: '看一下 IAM' });
  await f.report({ kind: 'done', text: '#1 完成' });
  const board = (await f.board()).result;
  const byId = Object.fromEntries(board.issues.map((entry) => [entry.taskId, entry]));
  assert.equal(byId['issue-1'].sessionId, 'worker-a');
  assert.equal('sessionId' in byId['issue-2'], false);
  assert.equal('untrusted' in byId['issue-1'], false);
  assert.deepEqual(board.untrusted, ['issues[].title', 'tasks[].title', 'reports[].text']);
  assert.equal(board.total, 2);
  assert.equal(board.nextOffset, null);
  assert.equal(board.tasks.length, 1);
  assert.equal(board.tasks[0].status, 'created');
  assert.equal(board.unreadReports, 1);
  assert.equal(board.reports.length, 1);
  assert.equal(board.managedSessions, 2);
  assert.equal('glossary' in board, false);
  assert.deepEqual(board.openDeliveries, []);
  assert.equal('detail' in board, false);
});

test('refresh=true refreshes the Issue list first and reports refresh problems', async () => {
  const f = fixture();
  await f.createLeader();
  const order = [];
  f.runtime.refreshIssues = async () => { order.push('issues'); };
  assert.equal((await f.board({ refresh: true })).ok, true);
  assert.deepEqual(order, ['issues']);
  f.runtime.refreshIssues = async () => { throw new Error('glab killed'); };
  const failed = await f.board({ refresh: true });
  assert.equal(failed.ok, true);
  assert.match(failed.result.refreshError, /Issue 列表刷新失败：glab killed/u);
  order.length = 0;
  await f.board({});
  assert.deepEqual(order, []);
});

test('board detail for a managed session shows state, events, pending questions and marks its reports seen', async () => {
  const f = fixture({ observe: () => ({ cursor: 11, truncated: true, events: [{ type: 'assistant', text: 'hello' }] }), questions: ['要不要继续？'] });
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  f.sessions.set('worker-a', sessionState({ pendingInput: ['question'] }));
  await f.report({ kind: 'question', text: '该选哪个分支？' });
  await f.report({ kind: 'progress', text: 'other', }, 'worker-a');
  assert.equal(f.runtime.leaderProjection().unseenReports, 2);
  const result = await f.board({ taskId: 'issue-1' });
  assert.equal(result.ok, true);
  const detail = result.result.detail;
  assert.equal(detail.kind, 'issue');
  assert.equal(detail.sessionId, 'worker-a');
  assert.equal(detail.session.status, 'active');
  assert.deepEqual(detail.session.pendingInput, ['question']);
  assert.equal('untrusted' in detail.events[0], false);
  assert.equal('sourceSessionId' in detail.events[0], false);
  assert.equal(result.result.untrusted.includes('detail.events'), true);
  assert.equal(detail.eventsTruncated, true);
  assert.deepEqual(detail.pendingQuestions, ['要不要继续？']);
  assert.match(detail.pendingNote, /只能由人类在会话内回答/u);
  assert.equal(detail.reports.length, 2);
  assert.equal(f.runtime.leaderProjection().unseenReports, 0);
  assert.equal(f.calls.persist.at(-1).reports.every((entry) => entry.seen === true), true, 'seen is persisted');
});

test('board detail survives an unreadable event log and a failing question read', async () => {
  const f = fixture({ observe: () => { throw new Error('page failed'); }, questions: undefined });
  f.runtime.leaderAdapter.questions = async () => { throw new Error('fence broken'); };
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  f.sessions.set('worker-a', sessionState({ pendingInput: ['question'] }));
  const detail = (await f.board({ taskId: 'issue-1' })).result.detail;
  assert.match(detail.eventsError, /page failed/u);
  assert.match(detail.pendingQuestions[0], /问题原文不可读取：fence broken/u);
});

test('board detail for an ad-hoc task carries its brief; for an unmanaged or invented taskId it fails', async () => {
  const f = fixture();
  await f.createLeader();
  const created = (await f.session({ action: 'create', title: 'T', brief: 'do the thing' })).result;
  const detail = (await f.board({ taskId: created.taskId })).result.detail;
  assert.equal(detail.kind, 'task');
  assert.equal(detail.brief, 'do the thing');
  for (const taskId of ['issue-404', 'leader-task-ffffffffffff', 'human', '']) {
    const result = await f.board({ taskId });
    assert.equal(result.ok, false, taskId);
  }
  // An explicit sessionId that does not match the record is refused (no arbitrary session IDs).
  const mismatch = await f.board({ taskId: created.taskId, sessionId: 'human' });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /拒绝任意\/历史会话 ID/u);
});

test('board detail reports archived, missing and unknown sessions without throwing', async () => {
  const f = fixture();
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  f.archivedSessionIds.push('worker-a');
  assert.equal((await f.board({ taskId: 'issue-1' })).result.detail.session.status, 'archived');
  f.archivedSessionIds.length = 0;
  f.sessions.delete('worker-a');
  assert.equal((await f.board({ taskId: 'issue-1' })).result.detail.session.status, 'missing');
});

// ---------------------------------------------------------------------------------------------------------------
// session create
// ---------------------------------------------------------------------------------------------------------------

test('session create for an Issue uses the normal dispatch and makes the worker manageable', async () => {
  const f = fixture();
  await f.createLeader();
  const item = f.addIssue(5);
  const result = await f.session({ action: 'create', taskId: item.id });
  assert.equal(result.ok, true);
  assert.equal(result.result.existing, false);
  assert.match(result.result.sessionId, /^worker-new-/u);
  assert.equal(f.calls.dispatch.length, 1);
  assert.equal(f.calls.dispatch[0].item.id, 'issue-5');
  assert.equal(f.calls.dispatch[0].retry, false);
  assert.equal(f.runtime.isLeaderManagedSession(result.result.sessionId), true);
  assert.equal(f.calls.refresh.length > 0, true, 'worker report tool bindings refreshed');
});

test('session create for an Issue that already has an active worker takes it over instead of creating another', async () => {
  const f = fixture();
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  const result = await f.session({ action: 'create', taskId: 'issue-1' });
  assert.equal(result.ok, true);
  assert.equal(result.result.sessionId, 'worker-a');
  assert.equal(result.result.existing, true);
  assert.equal(f.calls.dispatch.length, 0);
});

test('session create re-dispatches an Issue whose worker was archived, flagged as a retry', async () => {
  const f = fixture();
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  f.archivedSessionIds.push('worker-a');
  const result = await f.session({ action: 'create', taskId: 'issue-1' });
  assert.equal(result.ok, true);
  assert.equal(result.result.existing, false);
  assert.equal(f.calls.dispatch[0].retry, true);
});

test('session create refuses unknown taskIds, in-flight items and Host dispatch failures', async () => {
  const f = fixture();
  await f.createLeader();
  const unknown = await f.session({ action: 'create', taskId: 'issue-999' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /该 taskId 不在 Issue 列表当前列表中/u);
  assert.match(unknown.error, /title \+ brief/u);
  assert.equal((await f.session({ action: 'create', taskId: '' })).ok, false);

  f.addIssue(1);
  f.runtime.state.pending['issue-1'] = { sessionId: null };
  const inflight = await f.session({ action: 'create', taskId: 'issue-1' });
  assert.equal(inflight.ok, false);
  assert.match(inflight.error, /已有正在创建的会话/u);
  delete f.runtime.state.pending['issue-1'];
  f.runtime.dispatches = new Set(['issue-1']);
  assert.equal((await f.session({ action: 'create', taskId: 'issue-1' })).ok, false);
  f.runtime.dispatches = new Set();

  f.runtime.dispatch = async () => { throw new Error('host down'); };
  const thrown = await f.session({ action: 'create', taskId: 'issue-1' });
  assert.equal(thrown.ok, false);
  assert.match(thrown.error, /创建会话失败：host down/u);
  f.runtime.dispatch = async () => ({ ok: false, error: '并发槽已满' });
  assert.equal((await f.session({ action: 'create', taskId: 'issue-1' })).error, '并发槽已满');
  f.runtime.dispatch = async () => ({ ok: true, sessionId: null });
  assert.equal((await f.session({ action: 'create', taskId: 'issue-1' })).ok, false);
});

test('an ad-hoc task reserves its tombstone before the Host call, then renames, selects the model and queues the brief', async () => {
  const f = fixture();
  await f.createLeader();
  f.runtime.state.settings.issueSessionModel = { provider: 'prov', model: 'm2' };
  const result = await f.session({ action: 'create', title: '  查一下   IAM 架构 ', brief: '  阅读仓库并给出结论  ' });
  assert.equal(result.ok, true);
  const created = result.result;
  assert.match(created.taskId, /^leader-task-[0-9a-f]{12}$/u);
  assert.equal(created.kind, 'task');
  assert.equal(created.existing, false);
  assert.equal(created.briefDelivered, true);
  assert.deepEqual(created.warnings, []);
  // Host call #2 is the task session; the journal already held the tombstone.
  const call = f.calls.create[1];
  assert.deepEqual(call.request, { workspaceId: 'issue-workspace' });
  assert.equal(call.journal.tasks.length, 1);
  assert.equal(call.journal.tasks[0].status, 'creating');
  assert.equal(call.journal.tasks[0].sessionId, null);
  assert.equal(call.journal.tasks[0].taskId, created.taskId);
  const task = f.runtime.leaderState.tasks[0];
  assert.equal(task.status, 'created');
  assert.equal(task.sessionId, created.sessionId);
  assert.equal(task.title, '查一下 IAM 架构');
  assert.deepEqual(f.calls.rename.at(-1), { sessionId: created.sessionId, title: '[临时] 查一下 IAM 架构' });
  assert.deepEqual(f.calls.model.at(-1), { sessionId: created.sessionId, provider: 'prov', model: 'm2' });
  const prompt = f.calls.prompt.at(-1);
  assert.equal(prompt.requestId, `${created.taskId}-brief`);
  assert.equal(prompt.mode, 'queue');
  assert.match(prompt.content[0].text, /不对应 GitLab Issue，不授予新权限/u);
  assert.match(prompt.content[0].text, /gitlab_leader_report/u);
  assert.match(prompt.content[0].text, /阅读仓库并给出结论/u);
  assert.equal(f.runtime.isLeaderManagedSession(created.sessionId), true);
  assert.equal(f.runtime.leaderTaskForSession(created.sessionId), created.taskId);
  assert.equal(f.calls.refresh.length > 0, true);
});

test('an ad-hoc task passes the agent preset and a registered working directory to the Host', async () => {
  const f = fixture();
  await f.createLeader();
  f.runtime.config.agentPreset = 'worker-preset';
  const result = await f.session({ action: 'create', title: 'T', brief: 'B', workingDirectory: ' D:/repo ' });
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls.create[1].request, { workspaceId: 'D:/repo', agentPreset: 'worker-preset' });
  assert.equal(f.runtime.leaderState.tasks[0].workspace, 'D:/repo');
});

test('ad-hoc task arguments are validated before anything is reserved or created', async () => {
  const f = fixture();
  await f.createLeader();
  const cases = [
    [{ brief: 'B' }, /1..70 字符的 title/u], [{ title: '', brief: 'B' }, /title/u], [{ title: 'x'.repeat(71), brief: 'B' }, /title/u],
    [{ title: 'T' }, /1..8000 字符的 brief/u], [{ title: 'T', brief: '   ' }, /brief/u], [{ title: 'T', brief: 'x'.repeat(8001) }, /brief/u],
    [{ title: 'T', brief: 'B', workingDirectory: 7 }, /workingDirectory/u], [{ title: 'T', brief: 'B', workingDirectory: 'x'.repeat(501) }, /workingDirectory/u],
  ];
  for (const [args, pattern] of cases) {
    const result = await f.session({ action: 'create', ...args });
    assert.equal(result.ok, false, JSON.stringify(args).slice(0, 80));
    assert.match(result.error, pattern);
  }
  const badDir = await f.session({ action: 'create', title: 'T', brief: 'B', workingDirectory: 'bad' });
  assert.equal(badDir.ok, false);
  assert.match(badDir.error, /工作区不可用/u);
  assert.deepEqual(badDir.result, { available: [] });
  assert.equal(f.calls.create.length, 1, 'only the Leader session was ever created');
  assert.deepEqual(f.runtime.leaderState.tasks, []);
});

test('ad-hoc tasks need a created Leader', async () => {
  const f = fixture();
  const result = await f.invoke('session', { action: 'create', title: 'T', brief: 'B' }, f.agent());
  assert.equal(result.ok, false);
});

test('an uncertain ad-hoc creation is marked uncertain, never recreated, and only a human can dismiss it', async () => {
  let failing = true;
  const f = fixture({ createSession: (request, n) => {
    if (n === 1) return 'leader';
    if (failing) throw new Error('host timeout');
    return 'later-session';
  } });
  await f.createLeader();
  const failed = await f.session({ action: 'create', title: 'IAM', brief: 'B' });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /创建临时任务会话失败：host timeout/u);
  const taskId = failed.result.taskId;
  assert.match(taskId, /^leader-task-/u);
  const task = f.runtime.leaderState.tasks[0];
  assert.equal(task.status, 'uncertain');
  assert.match(task.error, /宿主创建会话报错，结果不确定/u);
  assert.equal(f.runtime.leaderState.tasks.length, 1);
  assert.equal(f.calls.create.length, 2);
  assert.equal(f.runtime.isLeaderManagedSession('later-session'), false);
  // The agent cannot dismiss it; the board shows it; the UI dismisses it.
  assert.equal((await f.invoke('resolveTask', { taskId, action: 'dismiss' }, f.agent())).ok, false);
  assert.equal((await f.board()).result.tasks[0].status, 'uncertain');
  const dismissed = await f.invoke('resolveTask', { taskId, action: 'dismiss' });
  assert.equal(dismissed.ok, true);
  assert.equal(f.runtime.leaderState.tasks[0].status, 'archived');
  assert.equal(f.calls.create.length, 2, 'dismissal does not create anything');
  // Only uncertain tasks can be dismissed.
  failing = false;
  const ok = await f.session({ action: 'create', title: 'again', brief: 'B' });
  assert.equal(ok.ok, true);
  assert.equal((await f.invoke('resolveTask', { taskId: ok.result.taskId, action: 'dismiss' })).ok, false);
});

test('an invalid session ID from the Host marks the ad-hoc task uncertain', async () => {
  const f = fixture({ createSession: (request, n) => (n === 1 ? 'leader' : '') });
  await f.createLeader();
  const result = await f.session({ action: 'create', title: 'T', brief: 'B' });
  assert.equal(result.ok, false);
  assert.match(result.error, /宿主未返回有效会话 ID；临时任务已标记为不确定/u);
  assert.equal(f.runtime.leaderState.tasks[0].status, 'uncertain');
});

test('ad-hoc setup problems after creation become warnings; the task stays created and the brief failure is explicit', async () => {
  const f = fixture({ rename: (id, title) => { if (title.startsWith('[临时]')) throw new Error('rename refused'); }, prompt: (request) => { if (request.mode === 'queue' && /-brief$/u.test(request.requestId)) throw new Error('queue full'); } });
  f.runtime.state.settings.issueSessionModel = { provider: 'prov', model: 'm1' };
  f.runtime.host.selectModel = async () => { throw new Error('model refused'); };
  await f.createLeader();
  const result = await f.session({ action: 'create', title: 'T', brief: 'B' });
  assert.equal(result.ok, true);
  assert.equal(result.result.briefDelivered, false);
  assert.equal(result.result.warnings.length, 3);
  assert.match(result.result.warnings.join('\n'), /改名失败：rename refused/u);
  assert.match(result.result.warnings.join('\n'), /选择模型失败：model refused/u);
  assert.match(result.result.warnings.join('\n'), /任务说明投递失败/u);
  assert.equal(f.runtime.leaderState.tasks[0].status, 'created');
});

test('the ad-hoc task registry is capped; archived records make room', async () => {
  const f = fixture();
  await f.createLeader();
  const make = (i, status) => ({ taskId: `leader-task-${String(i).padStart(12, '0')}`, sessionId: status === 'created' ? `s-${i}` : null, title: 't', brief: 'b', workspace: '', status, createdAt: i, error: '' });
  f.runtime.leaderState.tasks = Array.from({ length: LEADER_LIMITS.maxTasks }, (_, i) => make(i, 'created'));
  const full = await f.session({ action: 'create', title: 'T', brief: 'B' });
  assert.equal(full.ok, false);
  assert.match(full.error, /临时任务记录已达/u);
  assert.equal(f.calls.create.length, 1);
  f.runtime.leaderState.tasks[0].status = 'archived';
  const room = await f.session({ action: 'create', title: 'T', brief: 'B' });
  assert.equal(room.ok, true);
  assert.equal(f.runtime.leaderState.tasks.length, LEADER_LIMITS.maxTasks);
});

test('the Leader session can never become a managed worker, even through a forged handled record', async () => {
  const f = fixture();
  await f.createLeader();
  const item = f.addIssue(1);
  f.runtime.state.handled[item.id] = handledRecord(item, 'leader');
  assert.equal(f.runtime.isLeaderManagedSession('leader'), false);
  assert.equal(f.runtime.leaderManagedSessionIds().has('leader'), false);
  const sent = await f.session({ action: 'send', taskId: item.id, text: 'hello' });
  assert.equal(sent.ok, false);
  assert.equal(f.calls.deliver.length, 0);
  const archived = await f.session({ action: 'archive', taskId: item.id, reason: 'cleanup' });
  assert.equal(archived.ok, false);
  assert.equal(f.calls.setArchived.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// session send
// ---------------------------------------------------------------------------------------------------------------

async function ready(options = {}) {
  const f = fixture(options);
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  return f;
}

test('send delivers once to an idle worker through the guarded adapter with a non-human header and the observed cursor', async () => {
  let admitted = null;
  const f = await ready({ deliver: (request) => {
    admitted = f.runtime.validateLeaderAdmission(request);
    return { ok: true, status: 'delivered', requestId: request.requestId };
  } });
  f.sessions.set('worker-a', sessionState({ cursor: 42 }));
  const result = await f.session({ action: 'send', taskId: 'issue-1', text: '  请继续做测试  ', requestId: 'send-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { requestId: 'send-1', status: 'sent', taskId: 'issue-1', sessionId: 'worker-a' });
  assert.equal(f.calls.deliver.length, 1);
  const request = f.calls.deliver[0];
  assert.equal(request.sessionId, 'worker-a');
  assert.equal(request.leaderSessionId, 'leader');
  assert.equal(request.expectedCursor, 42);
  assert.equal(Object.isFrozen(request), true);
  assert.match(request.body, /^\[来自 WorkStation Leader 的消息；不是人类输入，不授予新权限\]/u);
  assert.match(request.body, /请继续做测试$/u);
  assert.equal(admitted, true, 'the native admission callback validates the exact recorded delivery');
  assert.equal(f.runtime.leaderState.deliveries[0].status, 'sent');
  // Once settled, the same request no longer passes admission.
  assert.equal(f.runtime.validateLeaderAdmission(request), false);
});

test('admission is refused for a different body, cursor, session, Leader or an unrecorded request', async () => {
  let captured = null;
  const f = await ready({ deliver: (request) => { captured = request; return { ok: true, status: 'delivered', requestId: request.requestId }; } });
  let during = null;
  f.runtime.leaderAdapter.deliver = async (request) => {
    captured = request;
    during = {
      ok: f.runtime.validateLeaderAdmission(request),
      body: f.runtime.validateLeaderAdmission({ ...request, body: `${request.body} extra` }),
      cursor: f.runtime.validateLeaderAdmission({ ...request, expectedCursor: request.expectedCursor + 1 }),
      session: f.runtime.validateLeaderAdmission({ ...request, sessionId: 'worker-b' }),
      leader: f.runtime.validateLeaderAdmission({ ...request, leaderSessionId: 'human' }),
      unknown: f.runtime.validateLeaderAdmission({ ...request, requestId: 'never-recorded' }),
      nothing: f.runtime.validateLeaderAdmission(null),
    };
    f.runtime.leaderStopping = true;
    during.stopping = f.runtime.validateLeaderAdmission(request);
    f.runtime.leaderStopping = false;
    return { ok: true, status: 'delivered', requestId: request.requestId };
  };
  assert.equal((await f.session({ action: 'send', taskId: 'issue-1', text: 'hi' })).ok, true);
  assert.deepEqual(during, { ok: true, body: false, cursor: false, session: false, leader: false, unknown: false, nothing: false, stopping: false });
  assert.ok(captured);
});

test('send to a busy, queued, or cold-unactivatable worker is refused without any delivery', async () => {
  const f = await ready();
  f.sessions.set('worker-a', sessionState({ running: true }));
  const running = await f.session({ action: 'send', taskId: 'issue-1', text: 'hi' });
  assert.equal(running.ok, false);
  assert.match(running.error, /worker 忙碌或有 queue/u);
  f.sessions.set('worker-a', sessionState({ queue: ['x'] }));
  assert.equal((await f.session({ action: 'send', taskId: 'issue-1', text: 'hi' })).ok, false);
  assert.equal(f.calls.deliver.length, 0);
  assert.deepEqual(f.runtime.leaderState.deliveries, []);
});

test('send to a worker waiting on a native approval or question is refused: only the human answers those', async () => {
  const f = await ready();
  for (const kind of ['approval', 'question']) {
    f.sessions.set('worker-a', sessionState({ pendingInput: [kind] }));
    const result = await f.session({ action: 'send', taskId: 'issue-1', text: 'approve it' });
    assert.equal(result.ok, false);
    assert.match(result.error, /等待原生审批\/问答，只能由人类在该会话里回答/u);
  }
  assert.equal(f.calls.deliver.length, 0);
});

test('send wakes a cold session first, and refuses when it cannot be woken', async () => {
  const f = await ready();
  const cold = () => sessionState({ active: false, queue: null });
  f.sessions.set('worker-a', cold());
  let prepared = 0;
  f.runtime.leaderAdapter.prepareWorker = async (sessionId) => { prepared += 1; f.sessions.set(sessionId, sessionState({ cursor: 20 })); return { ok: true }; };
  const result = await f.session({ action: 'send', taskId: 'issue-1', text: 'wake up' });
  assert.equal(result.ok, true);
  assert.equal(prepared, 1);
  assert.equal(f.calls.deliver[0].expectedCursor, 20);

  f.sessions.set('worker-a', cold());
  f.runtime.leaderAdapter.prepareWorker = async () => ({ ok: false, error: 'cannot resume' });
  const refused = await f.session({ action: 'send', taskId: 'issue-1', text: 'again' });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /冷会话未能激活：cannot resume/u);
  // Still cold after a "successful" prepare that changed nothing: refused rather than delivered blind.
  f.runtime.leaderAdapter.prepareWorker = async () => ({ ok: true });
  const stillCold = await f.session({ action: 'send', taskId: 'issue-1', text: 'third' });
  assert.equal(stillCold.ok, false);
  assert.equal(f.calls.deliver.length, 1);
});

test('send is refused when the Host lacks guarded non-human delivery', async () => {
  const f = await ready();
  f.runtime.leaderAdapter.capabilities = { atomicIdleDelivery: true, nonHumanSource: false };
  const result = await f.session({ action: 'send', taskId: 'issue-1', text: 'hi' });
  assert.equal(result.ok, false);
  assert.match(result.error, /宿主不支持非 human 的原子空闲投递/u);
  delete f.runtime.leaderAdapter.deliver;
  f.runtime.leaderAdapter.capabilities = { atomicIdleDelivery: true, nonHumanSource: true };
  assert.equal((await f.session({ action: 'send', taskId: 'issue-1', text: 'hi' })).ok, false);
});

test('send validates text and requestId before touching anything', async () => {
  const f = await ready();
  for (const args of [{ text: '' }, { text: '   ' }, { text: 5 }, {}, { text: 'x'.repeat(LEADER_LIMITS.maxPromptText + 1) }]) {
    const result = await f.session({ action: 'send', taskId: 'issue-1', ...args });
    assert.equal(result.ok, false, JSON.stringify(args).slice(0, 50));
    assert.match(result.error, /text 必须是 1\.\./u);
  }
  assert.match((await f.session({ action: 'send', taskId: 'issue-1', text: 'hi', requestId: ' ' })).error, /requestId 无效/u);
  assert.equal((await f.session({ action: 'send', taskId: 'issue-1', text: 'x'.repeat(LEADER_LIMITS.maxPromptText) })).ok, true);
  assert.equal(f.calls.deliver.length, 1);
});

test('send only reaches plugin-created workers: unknown taskIds, human sessions and archived workers are refused', async () => {
  const f = await ready();
  for (const args of [{ taskId: 'issue-404' }, { taskId: 'ghost-9' }, { taskId: 'human' }, { taskId: 'issue-1', sessionId: 'human' }, { taskId: 'issue-1', sessionId: 'leader' }, {}]) {
    const result = await f.session({ action: 'send', text: 'hi', ...args });
    assert.equal(result.ok, false, JSON.stringify(args));
  }
  f.archivedSessionIds.push('worker-a');
  assert.equal((await f.session({ action: 'send', taskId: 'issue-1', text: 'hi' })).ok, false);
  assert.equal(f.calls.deliver.length, 0);
});

test('a repeated requestId with the same message returns the earlier result without resending; a different message is refused', async () => {
  const f = await ready();
  const first = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-1' });
  assert.equal(first.ok, true);
  const again = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-1' });
  assert.equal(again.ok, true);
  assert.deepEqual(again.result, { requestId: 'r-1', status: 'sent', duplicate: true });
  const other = await f.session({ action: 'send', taskId: 'issue-1', text: 'something else', requestId: 'r-1' });
  assert.equal(other.ok, false);
  assert.match(other.error, /requestId 已绑定另一条消息，不可重用/u);
  assert.equal(f.calls.deliver.length, 1);
});

test('a throwing deliver is recorded as uncertain, never resent, blocks further sends and archive until resolved', async () => {
  let fail = true;
  const f = await ready({ deliver: (request) => { if (fail) throw new Error('socket closed'); return { ok: true, status: 'delivered', requestId: request.requestId }; } });
  const first = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-1' });
  assert.equal(first.ok, false);
  assert.match(first.error, /投递结果不确定，不会自动重发/u);
  assert.equal(f.runtime.leaderState.deliveries[0].status, 'uncertain');
  assert.equal(f.runtime.leaderAdmissions.has('r-1'), false, 'admission is closed once settled');
  fail = false;
  // Same request: not resent.
  const same = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-1' });
  assert.equal(same.ok, false);
  assert.match(same.error, /不自动重发/u);
  // New request on the same worker: blocked while the earlier delivery is unconfirmed.
  const next = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-2' });
  assert.equal(next.ok, false);
  assert.match(next.error, /该会话有未确认投递/u);
  const archive = await f.session({ action: 'archive', taskId: 'issue-1', reason: 'done' });
  assert.equal(archive.ok, false);
  assert.match(archive.error, /未确认投递/u);
  assert.equal(f.calls.deliver.length, 1);
  // The board surfaces it.
  assert.equal((await f.board()).result.openDeliveries[0].requestId, 'r-1');
  // After a human/Leader check, the same worker accepts a new message again.
  assert.equal((await f.session({ action: 'resolve_delivery', requestId: 'r-1', resolution: 'not-delivered' })).ok, true);
  assert.equal((await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-2' })).ok, true);
});

test('a rejected delivery is recorded as rejected; an unverifiable receipt is uncertain', async () => {
  const f = await ready({ deliver: (request) => ({ ok: false, status: 'rejected', error: 'worker became busy' }) });
  const rejected = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-1' });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /宿主拒绝投递：worker became busy/u);
  assert.equal(f.runtime.leaderState.deliveries[0].status, 'rejected');
  // A rejected record does not block a new request; the same requestId stays blocked.
  assert.equal((await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-1' })).ok, false);
  f.runtime.leaderAdapter.deliver = async () => ({ ok: true, status: 'delivered', requestId: 'someone-else' });
  const unverifiable = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-2' });
  assert.equal(unverifiable.ok, false);
  assert.match(unverifiable.error, /投递回执不可验证，不会自动重发/u);
  assert.equal(f.runtime.leaderState.deliveries.find((entry) => entry.requestId === 'r-2').status, 'uncertain');
  f.runtime.leaderAdapter.deliver = async () => undefined;
  const none = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-3' });
  assert.equal(none.ok, false);
});

test('the delivery is durably recorded as sending before the adapter is called', async () => {
  const f = await ready();
  let journalAtDeliver = null;
  f.runtime.leaderAdapter.deliver = async (request) => {
    journalAtDeliver = copy(f.runtime.leaderState.deliveries);
    return { ok: true, status: 'delivered', requestId: request.requestId };
  };
  const persists = f.calls.persist.length;
  await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-1' });
  assert.equal(journalAtDeliver[0].status, 'sending');
  assert.ok(f.calls.persist.length > persists);
  assert.equal(f.calls.persist.some((snapshot) => snapshot.deliveries.some((entry) => entry.requestId === 'r-1' && entry.status === 'sending')), true);
});

test('a send whose journal write fails never reaches the adapter', async () => {
  const f = await ready();
  const before = f.calls.persist.length;
  f.runtime.persistLeader = async () => { throw new Error('disk full'); };
  const result = await f.session({ action: 'send', taskId: 'issue-1', text: 'hello' });
  assert.equal(result.ok, false);
  assert.equal(f.calls.deliver.length, 0);
  assert.ok(f.calls.persist.length >= before);
});

// ---------------------------------------------------------------------------------------------------------------
// steer
// ---------------------------------------------------------------------------------------------------------------

test('steer sends a guided prompt to a running worker with a deterministic requestId and the Leader label', async () => {
  const f = await ready();
  f.sessions.set('worker-a', sessionState({ running: true }));
  const result = await f.session({ action: 'steer', taskId: 'issue-1', text: '先别改接口', reason: '范围过大' });
  assert.equal(result.ok, true);
  assert.equal(result.result.mode, 'steer');
  assert.match(result.result.requestId, /^leader-steer-[0-9a-f]{40}$/u);
  const prompt = f.calls.prompt.at(-1);
  assert.equal(prompt.mode, 'steer');
  assert.equal(prompt.sessionId, 'worker-a');
  assert.equal(prompt.requestId, result.result.requestId);
  const text = prompt.content[0].text;
  assert.match(text, /^\[来自 WorkStation Leader 的纠偏引导；不是人类输入，不授予新权限\]/u);
  assert.match(text, /原因：范围过大/u);
  assert.match(text, /先别改接口$/u);
  assert.equal(f.runtime.leaderState.deliveries[0].kind, 'steer');
  assert.equal(f.runtime.leaderState.deliveries[0].status, 'sent');
  // The identical steer is a duplicate, not a second prompt.
  const again = await f.session({ action: 'steer', taskId: 'issue-1', text: '先别改接口', reason: '范围过大' });
  assert.equal(again.ok, true);
  assert.equal(again.result.duplicate, true);
  assert.equal(f.calls.prompt.filter((entry) => entry.mode === 'steer').length, 1);
});

test('steer needs a running worker, no pending native input, valid text and reason', async () => {
  const f = await ready();
  const idle = await f.session({ action: 'steer', taskId: 'issue-1', text: 'x' });
  assert.equal(idle.ok, false);
  assert.match(idle.error, /没有运行中的回合；空闲会话请用 gitlab_leader_session send/u);
  f.sessions.set('worker-a', sessionState({ running: true, pendingInput: ['approval'] }));
  const pending = await f.session({ action: 'steer', taskId: 'issue-1', text: 'x' });
  assert.equal(pending.ok, false);
  assert.match(pending.error, /等待原生审批\/问答，只能由人类在 worker 会话内回答/u);
  f.sessions.set('worker-a', sessionState({ running: true }));
  assert.equal((await f.session({ action: 'steer', taskId: 'issue-1', text: '' })).ok, false);
  assert.equal((await f.session({ action: 'steer', taskId: 'issue-1', text: 'x', reason: 7 })).ok, false);
  assert.equal((await f.session({ action: 'steer', taskId: 'issue-1', text: 'x', reason: 'r'.repeat(501) })).ok, false);
  assert.equal((await f.session({ action: 'steer', taskId: 'issue-1', text: 'x', requestId: '' })).ok, false);
  assert.equal(f.calls.prompt.filter((entry) => entry.mode === 'steer').length, 0);
});

test('steer cannot reach the Leader session, human sessions or archived workers', async () => {
  const f = await ready();
  f.sessions.set('worker-a', sessionState({ running: true }));
  f.sessions.set('human', sessionState({ running: true }));
  assert.equal((await f.session({ action: 'steer', taskId: 'ghost-9', text: 'x' })).ok, false);
  assert.equal((await f.session({ action: 'steer', taskId: 'issue-1', sessionId: 'human', text: 'x' })).ok, false);
  f.archivedSessionIds.push('worker-a');
  assert.equal((await f.session({ action: 'steer', taskId: 'issue-1', text: 'x' })).ok, false);
  assert.equal(f.calls.prompt.filter((entry) => entry.mode === 'steer').length, 0);
});

test('a Host-rejected steer is dropped and can be retried; an unclear failure is uncertain and not resent', async () => {
  let mode = 'reject';
  const f = await ready({ prompt: (request) => {
    if (request.mode !== 'steer') return { accepted: true };
    if (mode === 'reject') throw remote('turn finished', 'session/rejected');
    if (mode === 'throw') throw new Error('socket reset');
    return { accepted: true };
  } });
  f.sessions.set('worker-a', sessionState({ running: true }));
  const rejected = await f.session({ action: 'steer', taskId: 'issue-1', text: 'go left', requestId: 's-1' });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /宿主拒绝纠偏：turn finished/u);
  assert.deepEqual(f.runtime.leaderState.deliveries, []);
  mode = 'throw';
  const unclear = await f.session({ action: 'steer', taskId: 'issue-1', text: 'go left', requestId: 's-1' });
  assert.equal(unclear.ok, false);
  assert.match(unclear.error, /纠偏投递结果不确定，不会自动重发/u);
  assert.equal(f.runtime.leaderState.deliveries[0].status, 'uncertain');
  mode = 'ok';
  const retry = await f.session({ action: 'steer', taskId: 'issue-1', text: 'go left', requestId: 's-1' });
  assert.equal(retry.ok, false);
  assert.match(retry.error, /不自动重发/u);
  assert.equal(f.calls.prompt.filter((entry) => entry.mode === 'steer').length, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// rename / model / archive
// ---------------------------------------------------------------------------------------------------------------

test('rename keeps the #iid prefix for Issue sessions, accepts any title for ad-hoc tasks and updates the records', async () => {
  const f = await ready();
  const bad = await f.session({ action: 'rename', taskId: 'issue-1', title: '随便取名' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Issue 会话标题必须以 #1 开头/u);
  assert.equal((await f.session({ action: 'rename', taskId: 'issue-1', title: '#12 看错号' })).ok, false, '#12 is not #1');
  assert.equal((await f.session({ action: 'rename', taskId: 'issue-1', title: '' })).ok, false);
  assert.equal((await f.session({ action: 'rename', taskId: 'issue-1', title: 'x'.repeat(81) })).ok, false);
  assert.equal(f.calls.rename.filter((entry) => entry.sessionId === 'worker-a').length, 0);
  const ok = await f.session({ action: 'rename', taskId: 'issue-1', title: '#1 修复登录' });
  assert.equal(ok.ok, true);
  assert.deepEqual(f.calls.rename.at(-1), { sessionId: 'worker-a', title: '#1 修复登录' });
  assert.equal(f.runtime.state.handled['issue-1'].sessionTitle, '#1 修复登录');
  assert.ok(f.calls.persistQuiet.includes('会话标题'));

  const task = (await f.session({ action: 'create', title: 'T', brief: 'B' })).result;
  const renamed = await f.session({ action: 'rename', taskId: task.taskId, title: '任意标题' });
  assert.equal(renamed.ok, true);
  assert.equal(f.runtime.leaderState.tasks[0].title, '任意标题');
});

test('rename, model and archive refuse the Leader session, human sessions, archived and missing sessions', async () => {
  const f = await ready();
  const item = f.addIssue(2);
  f.runtime.state.handled[item.id] = handledRecord(item, 'leader');
  for (const args of [{ action: 'rename', title: '#1 x' }, { action: 'model', model: { provider: 'prov', model: 'm1' } }, { action: 'archive', reason: 'cleanup' }]) {
    for (const target of [{ taskId: 'ghost-9' }, { taskId: 'issue-2' }, { taskId: 'issue-1', sessionId: 'human' }, { taskId: 'leader' }, { taskId: 'issue-1', sessionId: 'leader' }]) {
      const result = await f.session({ ...args, ...target });
      assert.equal(result.ok, false, `${args.action} ${JSON.stringify(target)}`);
    }
  }
  assert.equal(f.calls.model.filter((entry) => entry.sessionId !== 'leader').length, 0);
  assert.equal(f.calls.setArchived.length + f.calls.archive.length, 0);
  assert.equal(f.calls.rename.filter((entry) => entry.sessionId !== 'leader').length, 0);
  f.archivedSessionIds.push('worker-a');
  assert.equal((await f.session({ action: 'rename', taskId: 'issue-1', title: '#1 x' })).ok, false);
  f.archivedSessionIds.length = 0;
  f.sessions.delete('worker-a');
  assert.equal((await f.session({ action: 'rename', taskId: 'issue-1', title: '#1 x' })).ok, false);
});

test('model change needs a catalog model and a quiet active session', async () => {
  const f = await ready();
  const model = { provider: 'prov', model: 'm2', reasoningEffort: 'high' };
  const ok = await f.session({ action: 'model', taskId: 'issue-1', model });
  assert.equal(ok.ok, true);
  assert.deepEqual(f.calls.model.at(-1), { sessionId: 'worker-a', ...model });
  const unknown = await f.session({ action: 'model', taskId: 'issue-1', model: { provider: 'prov', model: 'nope' } });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /该模型不在宿主模型目录中/u);
  assert.deepEqual(unknown.result.available, [{ provider: 'prov', model: 'm1' }, { provider: 'prov', model: 'm2' }]);
  assert.equal((await f.session({ action: 'model', taskId: 'issue-1', model: null })).ok, false);
  assert.equal((await f.session({ action: 'model', taskId: 'issue-1', model: { provider: '', model: 'm1' } })).ok, false);
  assert.equal((await f.session({ action: 'model', taskId: 'issue-1' })).ok, false);
  f.sessions.set('worker-a', sessionState({ running: true }));
  const busy = await f.session({ action: 'model', taskId: 'issue-1', model });
  assert.equal(busy.ok, false);
  assert.match(busy.error, /会话忙碌\/状态不可验证，未换模型/u);
  f.sessions.set('worker-a', sessionState({ pendingInput: ['approval'] }));
  assert.equal((await f.session({ action: 'model', taskId: 'issue-1', model })).ok, false);
  f.runtime.host.modelCatalog = async () => { throw new Error('catalog offline'); };
  f.sessions.set('worker-a', sessionState());
  assert.match((await f.session({ action: 'model', taskId: 'issue-1', model })).error, /模型目录不可用：catalog offline/u);
  assert.equal(f.calls.model.filter((entry) => entry.sessionId === 'worker-a').length, 1);
});

test('archive needs a reason and a quiet session; Issue workers go through setSessionArchived, ad-hoc tasks through the Host', async () => {
  const f = await ready();
  assert.match((await f.session({ action: 'archive', taskId: 'issue-1' })).error, /归档必须说明理由/u);
  assert.equal((await f.session({ action: 'archive', taskId: 'issue-1', reason: '   ' })).ok, false);
  assert.equal((await f.session({ action: 'archive', taskId: 'issue-1', reason: 'r'.repeat(501) })).ok, false);
  f.sessions.set('worker-a', sessionState({ running: true }));
  const busy = await f.session({ action: 'archive', taskId: 'issue-1', reason: 'done' });
  assert.equal(busy.ok, false);
  assert.match(busy.error, /会话仍在运行\/有排队\/等待原生审批，未归档/u);
  f.sessions.set('worker-a', sessionState({ pendingInput: ['question'] }));
  assert.equal((await f.session({ action: 'archive', taskId: 'issue-1', reason: 'done' })).ok, false);
  f.sessions.set('worker-a', sessionState());
  const ok = await f.session({ action: 'archive', taskId: 'issue-1', reason: '  已合并  ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.result.archived, true);
  assert.equal(ok.result.reason, '已合并');
  assert.deepEqual(f.calls.setArchived, [{ sessionId: 'worker-a', archived: true }]);
  assert.equal(f.calls.archive.length, 0);
  const again = await f.session({ action: 'archive', taskId: 'issue-1', reason: 'again' });
  assert.equal(again.ok, true);
  assert.equal(again.result.already, true);
  assert.equal(f.calls.setArchived.length, 1);

  const task = (await f.session({ action: 'create', title: 'T', brief: 'B' })).result;
  assert.equal((await f.session({ action: 'archive', taskId: task.taskId, reason: 'finished' })).ok, true);
  assert.deepEqual(f.calls.archive, [task.sessionId]);
  assert.equal(f.runtime.leaderState.tasks[0].status, 'archived');
  assert.equal(f.calls.setArchived.length, 1);
});

test('archive failures are reported: unverifiable state, and a Host refusal from setSessionArchived', async () => {
  const f = await ready({ setArchived: () => ({ ok: false, error: '会话仍在执行，结算后再变更归档状态。' }) });
  const refused = await f.session({ action: 'archive', taskId: 'issue-1', reason: 'done' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, '会话仍在执行，结算后再变更归档状态。');
  f.runtime.host.sessionState = async () => { throw remote('host exploded', 'session/internal'); };
  const unknown = await f.session({ action: 'archive', taskId: 'issue-1', reason: 'done' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /会话状态不可验证，未归档/u);
});

test('a cold quiet session can be archived; a missing session cannot be acted on', async () => {
  const f = await ready();
  f.sessions.set('worker-a', sessionState({ active: false, queue: null }));
  assert.equal((await f.session({ action: 'archive', taskId: 'issue-1', reason: 'done' })).ok, true);
  const g = await ready();
  g.sessions.delete('worker-a');
  const result = await g.session({ action: 'archive', taskId: 'issue-1', reason: 'done' });
  assert.equal(result.ok, false);
  assert.equal(g.calls.setArchived.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// resolve_delivery
// ---------------------------------------------------------------------------------------------------------------

async function uncertainDelivery() {
  const f = await ready({ deliver: () => { throw new Error('socket closed'); } });
  await f.session({ action: 'send', taskId: 'issue-1', text: 'hello', requestId: 'r-1' });
  return f;
}

test('resolve_delivery lets the Leader or the UI settle an uncertain delivery as delivered or not delivered', async () => {
  const viaAgent = await uncertainDelivery();
  const delivered = await viaAgent.session({ action: 'resolve_delivery', requestId: 'r-1', resolution: 'delivered' });
  assert.equal(delivered.ok, true);
  assert.equal(delivered.result.status, 'sent');
  assert.equal(delivered.result.resolvedBy, 'leader');
  assert.equal(viaAgent.runtime.leaderState.deliveries[0].status, 'sent');
  assert.equal((await viaAgent.board()).result.openDeliveries.length, 0);

  const viaUi = await uncertainDelivery();
  const denied = await viaUi.invoke('resolveDelivery', { requestId: 'r-1', outcome: 'not-delivered' });
  assert.equal(denied.ok, true);
  assert.equal(denied.result.status, 'rejected');
  assert.equal(denied.result.resolvedBy, 'ui');
  assert.match(denied.result.error, /未送达；不会自动重发/u);
  assert.equal(viaUi.calls.deliver.length, 1, 'resolving never resends');
  viaUi.runtime.leaderAdapter.deliver = async (request) => ({ ok: true, status: 'delivered', requestId: request.requestId });
  assert.equal((await viaUi.session({ action: 'send', taskId: 'issue-1', text: 'new', requestId: 'r-2' })).ok, true);
});

test('resolve_delivery rejects bad input, unknown requests and deliveries that are not uncertain', async () => {
  const f = await ready();
  await f.session({ action: 'send', taskId: 'issue-1', text: 'ok', requestId: 'sent-1' });
  assert.match((await f.session({ action: 'resolve_delivery', requestId: 'sent-1' })).error, /必须提供 requestId 和 resolution/u);
  assert.match((await f.session({ action: 'resolve_delivery', requestId: 'sent-1', resolution: 'maybe' })).error, /必须提供 requestId 和 resolution/u);
  assert.match((await f.session({ action: 'resolve_delivery', requestId: 'nope', resolution: 'delivered' })).error, /找不到该投递记录/u);
  const settled = await f.session({ action: 'resolve_delivery', requestId: 'sent-1', resolution: 'not-delivered' });
  assert.equal(settled.ok, false);
  assert.match(settled.error, /只有“结果不确定”的投递可以人工核对/u);
  assert.equal(f.runtime.leaderState.deliveries[0].status, 'sent');
  // A delivery still in flight cannot be resolved either.
  f.runtime.leaderState.deliveries.push({ requestId: 'flying', kind: 'send', taskId: 'issue-1', sessionId: 'worker-a', status: 'sending', at: 1, error: '' });
  assert.equal((await f.session({ action: 'resolve_delivery', requestId: 'flying', resolution: 'delivered' })).ok, false);
});

test('the worker cannot resolve deliveries and the Leader cannot use the UI-only operation name', async () => {
  const f = await uncertainDelivery();
  assert.equal((await f.invoke('resolveDelivery', { requestId: 'r-1', resolution: 'delivered' }, f.agent())).ok, false);
  assert.equal((await f.invoke('session', { action: 'resolve_delivery', requestId: 'r-1', resolution: 'delivered' }, f.worker('worker-a'))).ok, false);
  assert.equal(f.runtime.leaderState.deliveries[0].status, 'uncertain');
});

export { copy, issueItem };
test('creating the Leader binds the plugin tools after the ID is saved and before the first rename or prompt', async () => {
  const f = fixture();
  const order = [];
  const { refreshBindings } = f.runtime.leaderAdapter;
  f.runtime.leaderAdapter.refreshBindings = function bind() { order.push(`bind:${f.runtime.leaderState.sessionId}`); return refreshBindings.call(this); };
  const { renameSession, prompt } = f.runtime.host;
  f.runtime.host.renameSession = async (...args) => { order.push('rename'); return renameSession(...args); };
  f.runtime.host.prompt = async (...args) => { order.push('prompt'); return prompt(...args); };
  assert.equal((await f.invoke('create', {})).ok, true);
  assert.deepEqual(order, ['bind:leader', 'rename', 'prompt']);
});

test('a live Leader whose tools cannot be bound is reported as an error instead of ready', async () => {
  const f = fixture({ bindLeader: false, bindStatus: 'tools 服务不支持 register' });
  f.runtime.leaderServicesContext = { agents: { get: (id) => (id === 'leader' ? { id } : undefined) } };
  const result = await f.invoke('create', {});
  assert.equal(result.ok, false);
  assert.match(result.error, /插件工具未能绑定（tools 服务不支持 register）/);
  assert.equal(f.runtime.leaderState.sessionId, 'leader');
  assert.equal(f.runtime.leaderState.phase, 'error');
  assert.equal(f.calls.prompt.length, 0);
});

test('a Leader that is not resident yet is created normally; its tools bind when the session opens', async () => {
  const warnings = [];
  const f = fixture({ bindLeader: false, bindStatus: 'Leader agent 当前不在宿主 agent 注册表中（未常驻）' });
  f.runtime.logger = { warn: (line) => warnings.push(line), error() {}, info() {} };
  f.runtime.leaderServicesContext = { agents: { get: () => undefined } };
  const result = await f.invoke('create', {});
  assert.equal(result.ok, true);
  assert.equal(result.result.phase, 'ready');
  assert.ok(warnings.some((line) => /尚未常驻/.test(line)));
});

test('persisting plugin state refreshes worker tool bindings so new workers get the report tool', async () => {
  const { default: source } = await import('node:fs').then((fs) => ({ default: fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8') }));
  const block = source.slice(source.indexOf('async persistQuietly'), source.indexOf('resetTimer() {'));
  assert.match(block, /this\.syncLeaderWorkerTools\?\.\(\)/);
});

