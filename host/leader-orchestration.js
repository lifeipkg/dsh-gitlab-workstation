import { createHash, randomBytes } from 'node:crypto';
import { isLeaderTaskId, LEADER_LIMITS, LEADER_REPORT_KINDS, leaderBlockedBy, normalizeLeaderCompletion, normalizeLeaderTodo, targetKey } from '../core.js';
import { errorMessage } from './util.js';

// Leader orchestration (v2.39): running-worker cap + durable FIFO queue, Issue dependencies,
// accepted completion (complete tool) and Todo routing to an enrolled worker. Mixed into leaderMethods;
// all journal mutation here runs under leaderExclusive (directly or via leaderLockedOperation).
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (error, result = null) => ({ ok: false, result, error });
const success = (result) => ({ ok: true, result });
const OPEN_DELIVERY = new Set(['sending', 'uncertain']);
const validState = (state) => state && Number.isSafeInteger(state.cursor) && state.cursor >= 0
  && typeof state.active === 'boolean' && typeof state.running === 'boolean'
  && (state.queue === null || Array.isArray(state.queue)) && Array.isArray(state.pendingInput);
const quiet = (state) => validState(state) && !state.running
  && (state.queue === null || state.queue.length === 0) && state.pendingInput.length === 0;
const squash = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
const clip = (value, limit) => squash(value).slice(0, limit);
const wakeReason = (value) => String(value).slice(0, 100);
// Worker report kinds that bypass the 2-minute interval (same-kind same-text is deduplicated instead).
const URGENT_REPORT_KINDS = new Set(['blocked', 'done', 'question']);
const REPORT_KIND_LABELS = Object.freeze({ progress: '进展', blocked: '卡住', done: '完成', question: '提问', message: '跨 Issue 消息' });
const MAX_NOTICES = 10;

export const leaderOrchestrationMethods = {
  // ---------- running-worker cap ----------

  /**
   * "Running" = an enrolled worker whose last cached observation shows a busy turn or queued input.
   * A worker the Leader just created/continued counts as running until the next observation after
   * that kick (bounded by stallMs), so a burst of requests cannot overshoot the cap between reconciles.
   */
  leaderItemRunning(item) {
    if (['archived', 'missing'].includes(item.status)) return false;
    const observedAt = item.observation?.observedAt ?? 0;
    if (Number.isSafeInteger(item.kickedAt) && observedAt <= item.kickedAt && Date.now() - item.kickedAt < LEADER_LIMITS.stallMs) return true;
    const state = item.observation?.state;
    if (state) return state.running === true || (Array.isArray(state.queue) && state.queue.length > 0);
    return item.status === 'running';
  },

  leaderRunningCount(excludeTaskId = null) {
    return (this.leaderState?.items ?? []).filter((item) => item.taskId !== excludeTaskId && this.leaderItemRunning(item)).length;
  },

  leaderMaxRunningWorkers() {
    const value = this.leaderState?.settings?.maxRunningWorkers;
    return Number.isSafeInteger(value) ? value : LEADER_LIMITS.defaultRunningWorkers;
  },

  leaderCapacityFull(excludeTaskId = null) {
    return this.leaderRunningCount(excludeTaskId) + (this.leaderReservedStarts ?? 0) >= this.leaderMaxRunningWorkers();
  },

  /** New direct requests also wait behind an active queue so FIFO order holds. */
  leaderShouldQueue(excludeTaskId = null) {
    const queue = Array.isArray(this.leaderState?.queue) ? this.leaderState.queue : [];
    return this.leaderCapacityFull(excludeTaskId) || (queue.length > 0 && this.leaderState.enabled === true);
  },

  leaderReleaseStart() { this.leaderReservedStarts = Math.max(0, (this.leaderReservedStarts ?? 0) - 1); },

  /** Must run under leaderExclusive. Dedupes same-kind requests per taskId (ad-hoc create: per title/brief/dir). */
  async leaderEnqueue(kind, { taskId = null, sessionId = null, request }) {
    const state = this.leaderState;
    state.queue = Array.isArray(state.queue) ? state.queue : [];
    const fingerprint = digest(taskId ? [kind, taskId] : [kind, request.title, request.brief, request.workingDirectory]).slice(0, 40);
    const capacity = { running: this.leaderRunningCount(), maxRunningWorkers: this.leaderMaxRunningWorkers() };
    const existing = state.queue.findIndex((entry) => entry.fingerprint === fingerprint);
    if (existing >= 0) return success({ queued: true, duplicate: true, position: existing + 1, queueId: state.queue[existing].id, ...capacity });
    if (state.queue.length >= LEADER_LIMITS.maxQueue) return failure(`排队请求已达 ${LEADER_LIMITS.maxQueue} 条上限；请等待运行中的 worker 完成或请人类取消部分排队。`);
    const entry = { id: `leader-queue-${randomBytes(6).toString('hex')}`, kind, taskId, sessionId, request: clone(request),
      fingerprint, queuedAt: Date.now(), requestedBy: 'leader' };
    state.queue.push(entry);
    this.leaderAudit('queue', entry, { queueId: entry.id, kind, position: state.queue.length, ...capacity });
    await this.saveLeaderStrict();
    return success({ queued: true, position: state.queue.length, queueId: entry.id, ...capacity,
      note: `同时运行的 worker 已达上限 ${capacity.maxRunningWorkers}；Host 会在空位出现时按顺序自动执行，无需重复提交。` });
  },

  /**
   * Create admission (outside the journal lock): either reserve a running slot (caller must release it
   * via leaderReleaseStart) or persist the request in the queue and return its position.
   */
  async leaderAdmitCreate(snapshot, options = {}) {
    if (options.fromQueue) return null;
    return this.leaderExclusive(async () => {
      if (this.leaderStorageFault) return failure('Leader journal 不可写，未创建会话。');
      if (!this.leaderShouldQueue()) { this.leaderReservedStarts = (this.leaderReservedStarts ?? 0) + 1; return null; }
      return this.leaderEnqueue('create', { taskId: snapshot.taskId ?? null, request: snapshot });
    });
  },

  leaderQueueNotice(text, wake) {
    const state = this.leaderState;
    state.queueNotices = [...(Array.isArray(state.queueNotices) ? state.queueNotices : []), { text: clip(text, 300), wake: wake === true, at: Date.now() }].slice(-MAX_NOTICES);
  },

  leaderQueueLabel(entry) {
    const item = (this.leaderState?.items ?? []).find((candidate) => candidate.taskId === entry.taskId);
    const iid = item ? this.leaderIssueIid(item) : null;
    return entry.kind === 'create'
      ? `创建 ${entry.taskId ? `${entry.taskId} ` : '[临时] '}${clip(entry.request?.title, 60)}`
      : `续办 ${iid ? `#${iid} ` : ''}${clip(item?.title ?? entry.taskId, 60)}`;
  },

  leaderDropQueued(entry, error) {
    this.leaderAudit('queue-drop', entry, { queueId: entry.id, kind: entry.kind, error: String(error ?? '').slice(0, 500) });
    this.leaderQueueNotice(`- 排队的${this.leaderQueueLabel(entry)} 出队失败已丢弃：${clip(error, 160)}${entry.taskId ? `（taskId=${entry.taskId}）` : ''}`, true);
  },

  /** Drain FIFO while slots are free. Continue runs under the lock; create runs outside (dispatch takes the lock itself). */
  async drainLeaderQueue() {
    for (let round = 0; round < LEADER_LIMITS.maxQueue; round += 1) {
      const entry = await this.leaderExclusive(() => this.leaderDequeue());
      if (!entry) return;
      if (entry.kind !== 'create') continue;
      let result;
      try {
        const request = entry.taskId ? { taskId: entry.taskId }
          : { title: entry.request.title, brief: entry.request.brief, ...(entry.request.workingDirectory ? { workingDirectory: entry.request.workingDirectory } : {}) };
        result = await this.leaderCreateSessionRecord(request, { fromQueue: true });
      } catch (error) { result = failure(errorMessage(error)); }
      finally { this.leaderReleaseStart(); }
      await this.leaderExclusive(async () => {
        if (result?.ok) this.leaderQueueNotice(`- 排队的${this.leaderQueueLabel(entry)} 已执行：sessionId=${result.result?.sessionId ?? '?'}`, false);
        else this.leaderDropQueued(entry, result?.error || '创建失败');
        await this.saveLeaderStrict();
      });
    }
  },

  async leaderDequeue() {
    const state = this.leaderState;
    if (!state?.enabled || this.stopping || this.leaderStorageFault || this.leaderJournalUnreadable || this.leaderDurableEpoch !== state.epoch) return null;
    const head = Array.isArray(state.queue) ? state.queue[0] : null;
    if (!head || this.leaderCapacityFull(head.kind === 'continue' ? head.taskId : null)) return null;
    state.queue = state.queue.slice(1);
    this.leaderAudit('dequeue', head, { queueId: head.id, kind: head.kind, waitedMs: Date.now() - head.queuedAt });
    if (head.kind === 'create') { this.leaderReservedStarts = (this.leaderReservedStarts ?? 0) + 1; await this.saveLeaderStrict(); return head; }
    let outcome;
    try { outcome = await this.leaderRunQueuedContinue(head); }
    catch (error) { outcome = failure(errorMessage(error)); }
    if (outcome.ok) this.leaderQueueNotice(`- 排队的${this.leaderQueueLabel(head)} 已投递给 worker。`, false);
    else this.leaderDropQueued(head, outcome.error);
    await this.saveLeaderStrict();
    return head;
  },

  /** Re-validates a queued continue (enrolled, active, unblocked, quiet, no native approval); the evidence token was checked at enqueue. */
  async leaderRunQueuedContinue(entry) {
    const state = this.leaderState;
    const item = state.items.find((candidate) => candidate.taskId === entry.taskId && candidate.sessionId === entry.sessionId);
    if (!item) return failure('该 Issue 已不再纳管（可能已完成、归档或解除纳管）。');
    this.leaderManagedItem(entry, true);
    const blocked = leaderBlockedBy(item, state.completed);
    if (blocked.length) return failure(`依赖 ${blocked.join('、')} 未完成；如需绕过请先用 update_issue 调整 dependsOn。`);
    const inspection = await this.inspectLeaderSession(item.sessionId);
    if (inspection.status !== 'active') return failure(`worker 会话不可用（${inspection.status}）。`);
    if (inspection.state.pendingInput.length) return failure('worker 有原生审批/问答等待人类。');
    if (!quiet(inspection.state)) return failure('worker 不空闲（运行中或有排队输入）。');
    item.observation = { ...(item.observation ?? {}), state: clone(inspection.state), cursor: inspection.state.cursor, epoch: state.epoch,
      observedAt: Date.now(), logCursor: item.cursor, logEpoch: item.logEpoch, truncated: item.observation?.truncated === true };
    const result = await this.advanceManagedRecord({ taskId: item.taskId, sessionId: item.sessionId, body: entry.request.body, reason: entry.request.reason,
      requestId: `leader-queued-${digest([entry.id, entry.request.body]).slice(0, 40)}`,
      evidence: { cursor: inspection.state.cursor, epoch: state.epoch, logCursor: item.cursor, logEpoch: item.logEpoch } });
    if (result.ok) item.kickedAt = Date.now();
    return result;
  },

  /** UI only: a human removes a queued Leader request. */
  async cancelLeaderQueued(request) {
    const state = this.leaderState;
    const queue = Array.isArray(state.queue) ? state.queue : [];
    const entry = validId(request?.queueId) ? queue.find((candidate) => candidate.id === request.queueId) : null;
    if (!entry) return failure('排队请求不存在（可能已出队执行或被丢弃）。');
    state.queue = queue.filter((candidate) => candidate !== entry);
    this.leaderAudit('queue-drop', entry, { queueId: entry.id, kind: entry.kind, by: 'ui' });
    this.leaderQueueNotice(`- 人类取消了排队的${this.leaderQueueLabel(entry)}。`, false);
    await this.saveLeaderStrict();
    return success(this.leaderProjection());
  },

  // ---------- dependencies ----------

  /** Returns an error message or null. Upstreams must be enrolled or completed; no self-edge, no cycle. */
  leaderDependencyError(item, dependsOn) {
    const state = this.leaderState;
    if (dependsOn.includes(item.taskId)) return '不能依赖自己。';
    const done = new Set((state.completed ?? []).map((entry) => entry.taskId));
    const managed = new Map(state.items.map((entry) => [entry.taskId, entry]));
    const unknown = dependsOn.filter((taskId) => !done.has(taskId) && !managed.has(taskId));
    if (unknown.length) return `依赖 ${unknown.join('、')} 既未纳管也不在已完成记录中；dependsOn 只能填 snapshot.items 或 snapshot.completed 里的 taskId。`;
    const edges = (taskId) => (taskId === item.taskId ? dependsOn : managed.get(taskId)?.notes?.dependsOn ?? []);
    const visited = new Set();
    const reaches = (taskId, path) => {
      if (taskId === item.taskId) return path;
      if (visited.has(taskId) || done.has(taskId)) return null;
      visited.add(taskId);
      for (const next of edges(taskId)) { const found = reaches(next, [...path, next]); if (found) return found; }
      return null;
    };
    for (const upstream of dependsOn) {
      const cycle = reaches(upstream, [item.taskId, upstream]);
      if (cycle) return `依赖成环：${cycle.join(' → ')}；拒绝。`;
    }
    return null;
  },

  leaderWakeDependents(upstreamTaskId) {
    const state = this.leaderState;
    const woken = [];
    for (const item of state.items) {
      const dependsOn = item.notes?.dependsOn ?? [];
      if (!dependsOn.includes(upstreamTaskId)) continue;
      const reason = leaderBlockedBy(item, state.completed).length ? wakeReason(`dependency:${upstreamTaskId}`) : 'unblocked';
      item.pendingWake = Array.isArray(item.pendingWake) ? item.pendingWake : [];
      if (!item.pendingWake.includes(reason)) item.pendingWake.push(reason);
      item.pendingWake = item.pendingWake.slice(-10);
      woken.push({ taskId: item.taskId, reason });
    }
    return woken;
  },

  // ---------- completion ----------

  /**
   * Two-phase completion. Phase "check" (locked) validates the request and worker quietness; the GitLab
   * facts are read without the lock; phase "commit" (locked) re-validates everything before committing.
   */
  async completeIssueRecord(request, context = {}) {
    const state = this.leaderState;
    const item = this.leaderManagedItem(request);
    const summary = typeof request.summary === 'string' ? request.summary.trim() : '';
    if (!summary || summary.length > 1000) return failure('summary 必须是 1..1000 字符的验收结论。');
    if (request.acceptWithoutMr !== undefined && typeof request.acceptWithoutMr !== 'boolean') return failure('acceptWithoutMr 必须是布尔值。');
    const reason = request.reason === undefined ? '' : typeof request.reason === 'string' ? request.reason.trim() : null;
    if (reason === null || reason.length > 500) return failure('reason 必须是至多 500 字符的文本。');
    if (this.leaderStorageFault) return failure('Leader journal 不可写，未完成。');
    if (item.alerts.some((alert) => alert.status === 'pending')) return failure('该 Issue 有待人类处理的问题，人类回复前不能收尾。');
    if (state.outbox.some((entry) => (entry.taskId === item.taskId || entry.sessionId === item.sessionId) && OPEN_DELIVERY.has(entry.status))) return failure('该 Issue 有未确认投递，先人工核对再收尾。');
    const inspection = await this.inspectLeaderSession(item.sessionId);
    if (inspection.status === 'active') {
      if (inspection.state.pendingInput.length) return failure('worker 有原生审批/问答等待人类，不能收尾。');
      if (!quiet(inspection.state)) return failure('worker 正在运行或有排队输入；等它静默后再收尾。');
    } else if (inspection.status === 'unknown') return failure('worker 会话状态不可验证，未收尾。');
    const kind = isLeaderTaskId(item.taskId) ? 'task' : 'issue';
    if (context.stage === 'check') return success({ taskId: item.taskId, sessionId: item.sessionId, kind });
    let verification = { issueState: null, mergedMrs: [], pipeline: null };
    if (kind === 'issue') {
      const gitlab = context.gitlab;
      if (!gitlab?.available) return failure(`无法读取 GitLab Issue 事实，未收尾：${clip(gitlab?.error ?? (gitlab?.errors ?? []).join('；'), 300) || '未知错误'}`);
      if (!Array.isArray(gitlab.mergeRequests)) return failure('关联 MR 读取失败，无法核对，未收尾。');
      const merged = gitlab.mergeRequests.filter((merge) => merge.state === 'merged');
      const failedOpen = gitlab.mergeRequests.find((merge) => merge.state === 'opened' && merge.pipeline?.status === 'failed');
      if (failedOpen) return failure(`关联 MR !${failedOpen.iid} 仍 open 且最新流水线失败，不能收尾；先修复流水线或关闭该 MR。`);
      if (gitlab.state === 'opened' && !merged.length && !(request.acceptWithoutMr === true && reason)) {
        return failure('Issue 仍 open 且没有已合并的关联 MR；如属纯调查等无需 MR 的任务，传 acceptWithoutMr=true 并在 reason 写明理由。');
      }
      const pipelineSource = gitlab.mergeRequests.find((merge) => merge.pipeline) ?? null;
      verification = { issueState: gitlab.state ?? null, mergedMrs: merged.map((merge) => merge.iid).filter(Number.isSafeInteger),
        pipeline: pipelineSource ? { status: pipelineSource.pipeline.status ?? null, url: pipelineSource.pipeline.url ?? '' } : null };
    }
    let archived = false; let archiveError = '';
    if (state.settings?.archiveOnComplete !== false && inspection.status === 'active') {
      this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
      try {
        if (kind === 'task') { await this.host.archiveSession(item.sessionId); archived = true; }
        else { const result = await this.setSessionArchived(item.sessionId, true); archived = result?.ok === true; if (!archived) archiveError = result?.error || '宿主拒绝归档。'; }
      } catch (error) { archiveError = errorMessage(error); }
    }
    const task = kind === 'task' ? this.leaderTask(item.taskId) : null;
    if (task && (archived || inspection.status !== 'active')) task.status = 'archived';
    const record = normalizeLeaderCompletion({ taskId: item.taskId, sessionId: item.sessionId, title: item.title, url: item.url, kind, summary,
      completedAt: Date.now(), acceptWithoutMr: request.acceptWithoutMr === true, reason, verification });
    state.completed = [...(Array.isArray(state.completed) ? state.completed : []).filter((entry) => entry.taskId !== item.taskId), record].slice(-LEADER_LIMITS.maxCompleted);
    this.retireLeaderBudget(item);
    state.items = state.items.filter((entry) => entry !== item);
    for (const entry of state.outbox) if (entry.sessionId === item.sessionId && entry.status === 'prepared') entry.status = 'cancelled';
    state.queue = (Array.isArray(state.queue) ? state.queue : []).filter((entry) => entry.taskId !== item.taskId);
    if (archiveError) this.leaderAudit('archive-failed', item, { error: archiveError.slice(0, 500) });
    this.leaderAudit('complete', item, { summary: summary.slice(0, 300), archived, verification, ...(reason ? { reason } : {}) });
    const woken = this.leaderWakeDependents(item.taskId);
    state.epoch += 1; await this.saveLeaderStrict();
    return success({ taskId: item.taskId, sessionId: item.sessionId, completed: clone(record), archived, ...(archiveError ? { archiveError } : {}), woken });
  },

  // ---------- Todo routing (called by the Workstation dispatch path) ----------

  /** Sync, no network: the enrolled, healthy, unblocked Issue worker for a GitLab target URL, if any. */
  leaderWorkerForTarget(url) {
    const state = this.leaderState;
    if (!state?.enabled || this.stopping || this.leaderStorageFault || this.leaderJournalUnreadable || this.leaderDurableEpoch !== state.epoch) return null;
    const key = targetKey(url);
    if (!key) return null;
    const item = state.items.find((candidate) => !isLeaderTaskId(candidate.taskId) && targetKey(candidate.url) === key);
    if (!item || item.paused || item.alerts.some((alert) => alert.status === 'pending')) return null;
    if (['archived', 'missing', 'unknown'].includes(item.status)) return null;
    if (leaderBlockedBy(item, state.completed).length) return null;
    if (!this.leaderIssueMapping(item.taskId, item.sessionId)) return null;
    return { taskId: item.taskId, sessionId: item.sessionId };
  },

  /** A new @-mention Todo on an enrolled Issue was routed to its worker; wake the Leader with one line. */
  async noteLeaderTodo(taskId, todo = {}) {
    return this.leaderExclusive(async () => {
      const state = this.leaderState;
      const item = state?.items.find((candidate) => candidate.taskId === taskId);
      if (!item) return failure('该 Issue 未纳管。');
      if (this.leaderStorageFault || this.leaderJournalUnreadable) return failure('Leader journal 不可写。');
      const todoId = String(todo.todoId ?? '').trim();
      if (!todoId) return failure('缺少 todoId。');
      item.lastTodo = normalizeLeaderTodo({ ...todo, todoId, routedAt: Date.now() });
      const reason = wakeReason(`todo:${todoId}`);
      item.pendingWake = Array.isArray(item.pendingWake) ? item.pendingWake : [];
      if (!item.pendingWake.includes(reason)) item.pendingWake.push(reason);
      item.pendingWake = item.pendingWake.slice(-10);
      this.leaderAudit('todo-routed', item, { todoId, title: clip(todo.title, 200), author: clip(todo.author, 100) });
      await this.saveLeaderStrict();
      return success({ taskId: item.taskId, sessionId: item.sessionId });
    });
  },

  /**
   * gitlab_leader_report: an enrolled worker (caller identity already authorized) reports to the Leader.
   * Recorded even while the Leader is paused; pendingWake is durable. Never spends Leader action budget.
   */
  async workerReportRecord(request, identity) {
    const state = this.leaderState;
    if (this.leaderStorageFault || this.leaderJournalUnreadable) return failure('Leader journal 不可写，报告未记录。');
    const item = state.items.find((candidate) => candidate.sessionId === identity?.sessionId);
    if (!item || item.sessionId === state.sessionId) return failure('调用会话不是当前已纳管的 worker。');
    if (Object.keys(request).some((key) => !['kind', 'text', 'toTaskId'].includes(key))) return failure('报告参数包含未知字段。');
    const { kind } = request;
    if (!LEADER_REPORT_KINDS.includes(kind)) return failure(`kind 必须是 ${LEADER_REPORT_KINDS.join('/')} 之一。`);
    if (typeof request.text !== 'string' || !request.text.trim()) return failure('text 不能为空。');
    if (request.text.length > LEADER_LIMITS.maxReportText) return failure(`text 不能超过 ${LEADER_LIMITS.maxReportText} 字。`);
    const text = request.text.trim();
    let toTaskId = null;
    if (request.toTaskId !== undefined && request.toTaskId !== null) {
      if (kind !== 'message') return failure('toTaskId 仅 kind=message 可用。');
      if (typeof request.toTaskId !== 'string' || request.toTaskId === item.taskId
        || !state.items.some((candidate) => candidate.taskId === request.toTaskId)) return failure('toTaskId 必须是另一个已纳管 Issue/临时任务的 taskId（不能是自己）。');
      toTaskId = request.toTaskId;
    }
    const reports = Array.isArray(state.reports) ? state.reports : [];
    const now = Date.now();
    if (URGENT_REPORT_KINDS.has(kind)) {
      const previous = [...reports].reverse().find((entry) => entry.taskId === item.taskId && entry.kind === kind);
      if (previous && squash(previous.text) === squash(text)) return success({ recorded: false, duplicate: true, reportId: previous.id, taskId: item.taskId });
    }
    const count = Number.isSafeInteger(item.reportCount) ? item.reportCount : 0;
    if (count >= LEADER_LIMITS.maxReportsPerItem) return failure(`本预算周期报告已达上限 ${LEADER_LIMITS.maxReportsPerItem} 条；等待人类在面板重置预算后再报告。`);
    if (!URGENT_REPORT_KINDS.has(kind) && Number.isSafeInteger(item.lastReportAt) && now - item.lastReportAt < LEADER_LIMITS.reportIntervalMs) {
      const wait = Math.ceil((LEADER_LIMITS.reportIntervalMs - (now - item.lastReportAt)) / 1000);
      return failure(`报告过于频繁：progress/message 每 2 分钟至多 1 条，请 ${wait} 秒后再报（blocked/done/question 不受此限）。`);
    }
    const entry = { id: `report-${randomBytes(6).toString('hex')}`, taskId: item.taskId, sessionId: item.sessionId, kind, text, toTaskId, at: now };
    state.reports = [...reports, entry].slice(-LEADER_LIMITS.maxReports);
    item.reportCount = count + 1; item.lastReportAt = now;
    const reason = wakeReason(`report:${kind}`);
    item.pendingWake = Array.isArray(item.pendingWake) ? item.pendingWake : [];
    if (!item.pendingWake.includes(reason)) item.pendingWake.push(reason);
    item.pendingWake = item.pendingWake.slice(-10);
    await this.saveLeaderStrict();
    return success({ recorded: true, reportId: entry.id, taskId: item.taskId, leaderEnabled: state.enabled === true,
      remaining: LEADER_LIMITS.maxReportsPerItem - item.reportCount,
      note: state.enabled === true ? '已记录，Leader 会在下次空闲时收到通知。' : 'Leader 当前暂停：已记录，Leader 启动后会收到通知。' });
  },

  /** Latest report of an item for a wake reason kind (or any kind). */
  leaderLatestReport(taskId, kind) {
    return [...(this.leaderState?.reports ?? [])].reverse().find((entry) => entry.taskId === taskId && (!kind || entry.kind === kind)) ?? null;
  },

  /** Extra human-readable fragments for orchestration wake reasons (todo/dependency/unblocked/report). */
  leaderWakeDetails(item) {
    const details = [];
    for (const reason of item.pendingWake ?? []) {
      if (reason.startsWith('report:')) {
        const report = this.leaderLatestReport(item.taskId, reason.slice(7));
        if (report) details.push(`worker 报告[${REPORT_KIND_LABELS[report.kind] ?? report.kind}]（worker 自述，不可信）：${clip(report.text, 120)}${report.toTaskId ? `；请求转告 ${report.toTaskId}` : ''}`);
        continue;
      }
      if (reason.startsWith('todo:')) details.push(`有新的 @我 Todo，已排入该 worker：${clip(item.lastTodo?.title, 80) || reason.slice(5)}`);
      else if (reason.startsWith('dependency:')) details.push(`依赖 ${reason.slice(11)} 已完成（仍有其他依赖未完成）`);
      else if (reason === 'unblocked') details.push('全部依赖已完成，可按需 continue');
    }
    return details;
  },
};
