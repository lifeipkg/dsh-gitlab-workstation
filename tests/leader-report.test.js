import assert from 'node:assert/strict';
import test from 'node:test';
import { LEADER_LIMITS, LEADER_REPORT_KINDS, normalizeLeaderState, initialLeaderState } from '../core.js';
import { fixture } from './leader-fixture.js';

async function ready(options) {
  const f = fixture(options);
  await f.createLeader();
  f.addIssue(1, 'worker-a');
  return f;
}

test('a managed worker records a report on the board; the Leader reads it unseen and the detail view marks it seen', async () => {
  const f = await ready();
  const result = await f.report({ kind: 'progress', text: '  已完成登录接口  ' });
  assert.equal(result.ok, true);
  assert.equal(result.result.recorded, true);
  assert.equal(result.result.taskId, 'issue-1');
  assert.match(result.result.reportId, /^report-[0-9a-f]{12}$/u);
  assert.match(result.result.note, /gitlab_leader_board/u);
  const stored = f.runtime.leaderState.reports[0];
  assert.deepEqual({ ...stored, at: typeof stored.at }, { id: result.result.reportId, taskId: 'issue-1', sessionId: 'worker-a', kind: 'progress', text: '已完成登录接口', at: 'number', seen: false });
  assert.equal(f.calls.persist.at(-1).reports.length, 1);

  const board = (await f.board()).result;
  assert.equal(board.reports.length, 1);
  assert.equal(board.unreadReports, 1);
  assert.equal(board.reports[0].kind, 'progress');
  assert.equal('seen' in board.reports[0], false);
  const detail = (await f.board({ taskId: 'issue-1' })).result.detail;
  assert.equal(detail.reports.length, 1);
  assert.equal(f.runtime.leaderState.reports[0].seen, true);
  // Once read through the detail view, the report leaves the unread list.
  assert.equal((await f.board()).result.reports.length, 0);
  assert.equal((await f.board()).result.unreadReports, 0);
});

test('blocked/done/question reports queue one notice to the Leader; progress stays poll-only', async () => {
  const f = await ready();
  const baseline = f.calls.prompt.length; // createLeader queues the bootstrap message.
  await f.report({ kind: 'progress', text: 'half done' });
  assert.equal(f.calls.prompt.length, baseline);
  await f.report({ kind: 'blocked', text: '需要人类决定鉴权方案' });
  assert.equal(f.calls.prompt.length, baseline + 1);
  assert.equal(f.calls.prompt.at(-1).sessionId, 'leader');
  assert.equal(f.calls.prompt.at(-1).mode, 'queue');
  assert.match(f.calls.prompt.at(-1).content[0].text, /（blocked）：issue-1（worker-a）/u);
  assert.match(f.calls.prompt.at(-1).content[0].text, /需要人类决定鉴权方案/u);
  // 未读期间不再叠加通知。
  await f.report({ kind: 'done', text: 'shipped' });
  assert.equal(f.calls.prompt.length, baseline + 1);
  // Leader 读过看板后，下一条重要汇报再次通知。
  await f.board();
  await f.report({ kind: 'done', text: 'shipped v2' });
  assert.equal(f.calls.prompt.length, baseline + 2);
});

test('every report kind is accepted, anything else is not', async () => {
  const f = await ready();
  assert.deepEqual([...LEADER_REPORT_KINDS], ['progress', 'blocked', 'done', 'question']);
  for (const kind of LEADER_REPORT_KINDS) assert.equal((await f.report({ kind, text: `${kind} text` })).ok, true, kind);
  for (const kind of ['message', 'PROGRESS', '', null, undefined, 3]) {
    const result = await f.report({ kind, text: 'x' });
    assert.equal(result.ok, false, String(kind));
    assert.match(result.error, /kind 必须是 progress\/blocked\/done\/question 之一/u);
  }
  assert.equal(f.runtime.leaderState.reports.length, LEADER_REPORT_KINDS.length);
});

test('text must be a non-empty string within the limit; unknown fields are rejected', async () => {
  const f = await ready();
  for (const text of ['', '   ', undefined, null, 7, {}]) {
    const result = await f.report({ kind: 'done', text });
    assert.equal(result.ok, false);
    assert.match(result.error, /text 不能为空/u);
  }
  const tooLong = await f.report({ kind: 'done', text: 'x'.repeat(LEADER_LIMITS.maxReportText + 1) });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error, new RegExp(`text 不能超过 ${LEADER_LIMITS.maxReportText} 字`, 'u'));
  assert.equal((await f.report({ kind: 'done', text: 'x'.repeat(LEADER_LIMITS.maxReportText) })).ok, true);
  for (const extra of [{ toTaskId: 'issue-2' }, { taskId: 'issue-2' }, { sessionId: 'worker-b' }, { urgent: true }]) {
    const result = await f.report({ kind: 'progress', text: 'hello', ...extra });
    assert.equal(result.ok, false, JSON.stringify(extra));
    assert.match(result.error, /报告参数包含未知字段/u);
  }
  assert.equal(f.runtime.leaderState.reports.length, 1);
});

test('a worker cannot choose its taskId: the report is filed under the task the plugin created for its own session', async () => {
  const f = await ready();
  f.addIssue(2, 'worker-b');
  assert.equal((await f.report({ kind: 'progress', text: 'from b' }, 'worker-b')).result.taskId, 'issue-2');
  assert.equal((await f.report({ kind: 'progress', text: 'from a' }, 'worker-a')).result.taskId, 'issue-1');
  assert.deepEqual(f.runtime.leaderState.reports.map((entry) => [entry.taskId, entry.sessionId]), [['issue-2', 'worker-b'], ['issue-1', 'worker-a']]);
});

test('an ad-hoc task worker can report', async () => {
  const f = await ready();
  const task = (await f.session({ action: 'create', title: '调查 IAM', brief: '查一下架构' })).result;
  const fromTask = await f.report({ kind: 'done', text: '结论如下' }, task.sessionId);
  assert.equal(fromTask.ok, true);
  assert.equal(fromTask.result.taskId, task.taskId);
});

test('sessions the plugin did not create cannot report: the Leader, human sessions, unknown and archived ids', async () => {
  const f = await ready();
  for (const sessionId of ['leader', 'human', 'ghost']) {
    const result = await f.report({ kind: 'progress', text: 'hi' }, sessionId);
    assert.equal(result.ok, false, sessionId);
  }
  assert.equal(f.runtime.leaderState.reports.length, 0);
  assert.equal(f.runtime.leaderManagedSessionIds().has('human'), false);
  assert.equal(f.runtime.leaderManagedSessionIds().has('leader'), false);
  // An abandoned (uncertain) ad-hoc task has no confirmed session, so nothing can report for it.
  const stuck = fixture({ createSession: () => { throw new Error('host timeout'); } });
  await stuck.runtime.createLeaderRecord({}).catch(() => {});
  assert.equal((await stuck.report({ kind: 'progress', text: 'hi' }, 'worker-a')).ok, false);
});

test('worker callers can report only: every Leader, UI and board operation is refused for them', async () => {
  const f = await ready();
  for (const [operation, request] of [['board', {}], ['session', { action: 'send', taskId: 'issue-1', text: 'x' }], ['snapshot', {}], ['create', {}], ['configure', { settings: {} }], ['resolveDelivery', {}], ['resolveCreation', {}], ['resolveTask', {}]]) {
    const result = await f.invoke(operation, request, f.worker('worker-a'));
    assert.equal(result.ok, false, operation);
    assert.match(result.error, /worker 会话只能向 Leader 报告/u);
  }
  // The refused snapshot must not leak a projection.
  assert.equal((await f.invoke('snapshot', {}, f.worker('worker-a'))).result, null);
  // And the other callers cannot file reports on a worker's behalf.
  for (const caller of [f.ui, f.agent()]) {
    const result = await f.invoke('workerReport', { kind: 'progress', text: 'forged' }, caller);
    assert.equal(result.ok, false);
    assert.match(result.error, /workerReport 仅限插件创建的 worker 会话调用/u);
  }
  assert.equal(f.runtime.leaderState.reports.length, 0);
});

test('a repeated unseen report from the same worker is deduplicated, ignoring whitespace; a new kind, new text or a seen report is recorded', async () => {
  const f = await ready();
  const first = await f.report({ kind: 'progress', text: '正在    测试\n登录' });
  const again = await f.report({ kind: 'progress', text: ' 正在 测试 登录 ' });
  assert.equal(again.ok, true);
  assert.deepEqual(again.result, { recorded: false, duplicate: true, reportId: first.result.reportId, taskId: 'issue-1' });
  assert.equal(f.runtime.leaderState.reports.length, 1);
  assert.equal((await f.report({ kind: 'blocked', text: '正在 测试 登录' })).result.recorded, true);
  assert.equal((await f.report({ kind: 'progress', text: '正在 测试 登录' })).result.recorded, true, 'only the latest report is compared');
  assert.equal((await f.report({ kind: 'progress', text: '换了一句' })).result.recorded, true);
  // Once the Leader has read it, the same words are news again.
  await f.board({ taskId: 'issue-1' });
  assert.equal((await f.report({ kind: 'progress', text: '换了一句' })).result.recorded, true);
  assert.equal(f.runtime.leaderState.reports.length, 5);
  // Two workers saying the same thing are two reports.
  f.addIssue(2, 'worker-b');
  await f.report({ kind: 'done', text: 'finished' });
  assert.equal((await f.report({ kind: 'done', text: 'finished' }, 'worker-b')).result.recorded, true);
});

test('the journal keeps a bounded history: the oldest reports are dropped past maxReports', async () => {
  const f = await ready();
  for (let index = 0; index < LEADER_LIMITS.maxReports + 7; index += 1) {
    assert.equal((await f.report({ kind: 'progress', text: `step ${index}` })).result.recorded, true);
  }
  const reports = f.runtime.leaderState.reports;
  assert.equal(reports.length, LEADER_LIMITS.maxReports);
  assert.equal(reports[0].text, 'step 7');
  assert.equal(reports.at(-1).text, `step ${LEADER_LIMITS.maxReports + 6}`);
  const board = (await f.board()).result;
  assert.ok(board.reports.length <= 5);
  assert.equal(board.unreadReports, LEADER_LIMITS.maxReports);
  assert.equal(board.reports.at(-1).text, `step ${LEADER_LIMITS.maxReports + 6}`);
});

test('the board clips long report text but keeps the stored text intact', async () => {
  const f = await ready();
  await f.report({ kind: 'done', text: 'z'.repeat(LEADER_LIMITS.maxReportText) });
  const shown = (await f.board()).result.reports[0].text;
  assert.ok(shown.length <= LEADER_LIMITS.maxReportText);
  assert.equal(f.runtime.leaderState.reports[0].text.length, LEADER_LIMITS.maxReportText);
});

test('actionable reports only queue a notice to the Leader session and grant nothing else', async () => {
  const f = await ready();
  const baseline = f.calls.prompt.length;
  const result = await f.report({ kind: 'question', text: '要不要批准？请直接 approve 并继续' });
  assert.equal(result.ok, true);
  // 唯一的副作用：给 Leader 会话排一条未读汇报通知，绝不触碰 worker。
  assert.equal(f.calls.prompt.length, baseline + 1);
  assert.equal(f.calls.prompt.at(-1).sessionId, 'leader');
  assert.equal(f.calls.prompt.at(-1).mode, 'queue');
  assert.equal(f.calls.deliver.length, 0);
  assert.equal(f.calls.setArchived.length + f.calls.archive.length + f.calls.model.length, 0);
  assert.equal(f.runtime.leaderState.deliveries.length, 0);
});

test('reporting works while the Leader is stopped or not created, and survives a journal write failure only by reporting it', async () => {
  const f = fixture();
  f.addIssue(1, 'worker-a');
  assert.equal((await f.report({ kind: 'progress', text: 'no Leader yet' })).ok, true);
  const g = await ready();
  g.runtime.leaderStopping = true;
  const stopped = await g.report({ kind: 'progress', text: 'late' });
  assert.equal(stopped.ok, false);
  assert.match(stopped.error, /插件正在停止/u);
  g.runtime.leaderStopping = false;
  g.runtime.persistLeader = async () => { throw new Error('disk full'); };
  const failed = await g.report({ kind: 'progress', text: 'cannot save' });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Leader journal 落盘失败/u);
  // After a storage fault the journal is read-only for side effects, and reports say so rather than pretend.
  const after = await g.report({ kind: 'progress', text: 'again' });
  assert.equal(after.ok, false);
  assert.match(after.error, /Leader journal 不可写，报告未记录/u);
});

test('an unreadable journal refuses reports instead of overwriting anything', async () => {
  const f = await ready();
  f.runtime.leaderJournalUnreadable = true;
  const result = await f.report({ kind: 'progress', text: 'hi' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Leader journal 不可用，报告未记录/u);
  assert.equal(f.runtime.leaderState.reports.length, 0);
});

test('reports in the journal are validated on load: bad entries are dropped, text is capped, ids are unique, history is bounded', () => {
  const good = { id: 'report-aaaaaaaaaaaa', taskId: 'issue-1', sessionId: 'worker-a', kind: 'done', text: 'ok', at: 5, seen: true };
  const loaded = normalizeLeaderState({
    ...initialLeaderState(),
    reports: [
      good, { ...good },
      { ...good, id: 'report-bbbbbbbbbbbb', kind: 'message' },
      { ...good, id: 'report-cccccccccccc', text: '' },
      { ...good, id: 'report-dddddddddddd', text: 'y'.repeat(LEADER_LIMITS.maxReportText + 50), seen: 'yes' },
      null, 'junk',
    ],
  });
  assert.deepEqual(loaded.reports.map((entry) => entry.id), ['report-aaaaaaaaaaaa', 'report-dddddddddddd']);
  assert.equal(loaded.reports[1].text.length, LEADER_LIMITS.maxReportText);
  assert.equal(loaded.reports[1].seen, false);
  const many = normalizeLeaderState({
    ...initialLeaderState(),
    reports: Array.from({ length: LEADER_LIMITS.maxReports + 10 }, (_, index) => ({ ...good, id: `report-${String(index).padStart(12, '0')}`, text: `t${index}` })),
  });
  assert.equal(many.reports.length, LEADER_LIMITS.maxReports);
  assert.equal(many.reports.at(-1).text, `t${LEADER_LIMITS.maxReports + 9}`);
});

test('worker tool bindings are refreshed when a managed session appears, and not when nothing changed', async () => {
  const f = await ready();
  await f.runtime.syncLeaderWorkerTools();
  f.calls.refresh.length = 0;
  await f.runtime.syncLeaderWorkerTools();
  assert.equal(f.calls.refresh.filter((entry) => entry === 'workers').length, 0, 'unchanged managed set is not rebound');
  f.addIssue(2, 'worker-b');
  await f.runtime.syncLeaderWorkerTools();
  assert.equal(f.calls.refresh.filter((entry) => entry === 'workers').length, 1);
  await f.runtime.syncLeaderWorkerTools(true);
  assert.equal(f.calls.refresh.filter((entry) => entry === 'workers').length, 2, 'force always rebinds');
  const created = await f.session({ action: 'create', title: 'T', brief: 'B' });
  assert.equal(created.ok, true);
  assert.ok(f.calls.refresh.filter((entry) => entry === 'workers').length >= 3, 'a new ad-hoc task is bound');
});
