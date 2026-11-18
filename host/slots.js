import { normalizeMrUrls } from '../core.js';
import { IDLE_SETTLE_POLLS } from './constants.js';
import { errorMessage, sessionSummaryTitle } from './util.js';

/**
 * 会话跟踪与对账结算（reconcile）：track/untrack 手动派发的 Issue 会话，
 * 读取会话执行历史，回合结束后把 running 记录转为 verifying 交给闭环核对。
 * 挂到 GitlabTodoRuntime 原型上，this 指向运行时实例。
 */
export const slotsMethods = {

  sessionPollMs() {
    return Number.isFinite(this.config.sessionPollMs) ? Math.max(20, this.config.sessionPollMs) : 3000;
  },

  ensureSessionTimer() {
    let trackedItems = 0;
    for (const record of this.trackedSessions.values()) trackedItems += record.todos.size;
    const needed = !this.stopping && trackedItems > 0;
    if (needed && !this.sessionTimer) {
      this.sessionTimer = setInterval(() => void this.reconcileSessions(), this.sessionPollMs());
      this.sessionTimer.unref?.();
    } else if (!needed && this.sessionTimer) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }
  },

  wakeWaiters() {
    const waiters = [...this.statusWaiters];
    this.statusWaiters.clear();
    for (const wake of waiters) wake();
  },

  /**
   * 跟踪表结构：Map<sessionId, { todos: Map<itemId, {startedAt, requestId}>, unreadablePolls, idlePolls }>。
   * 字段名 todos 沿用旧结构，键是 Issue id。一个会话可挂多条消息，各自按 requestId 结算；
   * unreadable/idle 计数是会话级的：会话空闲且仍有消息未落档时统一兜底。
   */
  trackSession(sessionId, itemId, startedAt = Date.now(), requestId = '') {
    if (!sessionId || !itemId) return;
    let record = this.trackedSessions.get(sessionId);
    if (!record) {
      record = { todos: new Map(), unreadablePolls: 0, idlePolls: 0 };
      this.trackedSessions.set(sessionId, record);
    }
    if (!record.todos.has(itemId)) {
      record.todos.set(itemId, { startedAt, requestId });
      this.ensureSessionTimer();
    }
  },

  /** 只解除一个 Issue 在该会话上的跟踪；会话上没有其他待结算消息时一并停表。 */
  untrackItem(sessionId, itemId) {
    const record = this.trackedSessions.get(sessionId);
    if (!record) return;
    if (record.todos.delete(itemId)) this.wakeWaiters();
    if (record.todos.size === 0) this.untrackSession(sessionId);
    else this.ensureSessionTimer();
  },

  untrackSession(sessionId) {
    if (this.trackedSessions.delete(sessionId)) this.wakeWaiters();
    this.ensureSessionTimer();
  },

  isItemTracked(sessionId, itemId) {
    return this.trackedSessions.get(sessionId)?.todos.has(itemId) === true;
  },

  reconcileSessions() {
    if (this.reconcilePromise) return this.reconcilePromise;
    const operation = this.executeReconcile().finally(() => {
      if (this.reconcilePromise === operation) this.reconcilePromise = null;
    });
    this.reconcilePromise = operation;
    return operation;
  },

  /** pending 的消息已在日志中证实被接受：补建 handled，再走统一结算，不再丢弃结果。 */
  materializePendingRecord(itemId, pending, summary = null) {
    const item = pending.item;
    const previous = this.state.handled[itemId];
    const continuing = Boolean(previous?.sessionId);
    const round = continuing
      ? Math.max(Number.isSafeInteger(pending.round) ? pending.round : 1, (previous.round ?? 1) + 1)
      : (Number.isSafeInteger(pending.round) ? pending.round : 1);
    const history = Array.isArray(pending.history) && pending.history.length > 0
      ? pending.history
      : continuing
        ? [...(Array.isArray(previous.history) ? previous.history : []), {
            sessionId: previous.sessionId,
            sessionTitle: previous.sessionTitle ?? '',
            archived: previous.archived === true,
            round: previous.round ?? 1,
            endedAt: previous.completedAt ?? null,
            status: previous.reportStatus || previous.executionStatus || '',
            note: previous.closureNote || previous.reportSummary || previous.executionError || '',
          }].slice(-10)
        : [];
    const record = {
      id: itemId,
      sessionId: pending.sessionId,
      outcome: 'session-accepted',
      executionStatus: 'running',
      requestId: pending.requestId ?? '',
      // 名册仅作显示兜底；标题未知时留空，不能给旧 pending 合成新标题。
      sessionTitle: pending.sessionTitle || sessionSummaryTitle(summary)
        || (previous?.sessionId === pending.sessionId ? previous.sessionTitle : '') || '',
      archived: false,
      archiveError: '',
      acceptedAt: pending.createdAt,
      title: item.title,
      url: item.url,
      project: item.project,
      round,
      firstAcceptedAt: continuing
        ? (previous.firstAcceptedAt ?? previous.acceptedAt)
        : (pending.firstAcceptedAt ?? pending.createdAt),
      history,
      dispatchFailures: 0,
      openMrs: Array.isArray(pending.openMrs)
        ? pending.openMrs
        : (Array.isArray(previous?.openMrs) ? previous.openMrs : []),
      item: { ...item, body: '' },
      closure: '',
      closureNote: '',
      nextAttemptAt: null,
      replied: null,
      reportStatus: '',
      reportSummary: '',
      resumeAfterMinutes: null,
    };
    this.state.handled[itemId] = record;
    delete this.state.pending[itemId];
    this.state.recent = [record, ...this.state.recent.filter((entry) => entry.id !== itemId)].slice(0, 50);
    return record;
  },

  async executeReconcile() {
    if (this.stopping) return;
    try {
      const value = await this.host.listSessions();
      if (!Array.isArray(value?.items)) throw new Error('session/list 响应缺少 items 数组。');
      const byId = new Map(value.items.map((item) => [String(item.sessionId), item]));
      const owned = new Map();
      for (const record of Object.values(this.state.handled)) {
        if (record?.sessionId && record.executionStatus === 'running') {
          owned.set(record.id, {
            sessionId: record.sessionId,
            itemId: record.id,
            startedAt: record.acceptedAt,
            requestId: record.requestId ?? '',
            // 状态里仍是 running 却没人跟踪：上次运行被重启打断的遗留记录，需要接管结算。
            orphaned: record.executionStatus === 'running',
          });
        }
      }
      for (const record of Object.values(this.state.pending)) {
        if (record?.sessionId && record.item?.id) {
          owned.set(record.item.id, {
            sessionId: record.sessionId,
            itemId: record.item.id,
            startedAt: record.createdAt,
            requestId: record.requestId ?? '',
            // pending 无论名册 running/idle 都要读历史：响应丢失时它可能已经执行完。
            orphaned: true,
          });
        }
      }
      // 重启恢复：按 Issue 逐条接管。名册报告 running 的会话重新跟踪；
      // 状态停在 running 的遗留记录只为结算，不再占用跟踪表。
      for (const record of owned.values()) {
        const tracked = this.trackedSessions.get(record.sessionId);
        if (tracked?.todos.has(record.itemId)) continue;
        const running = byId.get(record.sessionId)?.running === true;
        if (running) {
          this.trackSession(record.sessionId, record.itemId, record.startedAt, record.requestId);
        } else if (record.orphaned && !this.dispatches.has(record.itemId)) {
          this.trackSession(record.sessionId, record.itemId, record.startedAt, record.requestId);
        }
      }

      let changed = false;
      let settled = false;
      for (const [sessionId, tracked] of [...this.trackedSessions]) {
        const summary = byId.get(sessionId);
        const requests = [...tracked.todos.entries()].map(([itemId, entry]) => {
          const handled = this.state.handled[itemId];
          const originUrl = handled?.sessionId === sessionId ? handled.url : this.state.pending[itemId]?.item?.url;
          return { key: itemId, requestId: entry.requestId, startedAt: entry.startedAt, originUrl };
        });
        const inspections = await this.host.inspectRequests(sessionId, summary, requests);
        if (summary?.running) continue;

        const pending = [...inspections.values()].filter((inspection) => inspection?.outcome === 'pending');
        tracked.unreadablePolls = pending.some((inspection) => inspection.unreadable) ? tracked.unreadablePolls + 1 : 0;
        // 会话空闲但消息没落档/没有回合结束记录：可能是重启中断，也可能是队列丢失。
        // 正在执行 dispatch 的 Issue 不计入，避免提示词尚未送达时误结算。
        const idlePending = requests.some((request) => {
          const inspection = inspections.get(request.key);
          return (inspection?.idle || inspection?.awaitingMessage) && !this.dispatches.has(request.key);
        });
        tracked.idlePolls = idlePending ? tracked.idlePolls + 1 : 0;
        const unreadableTimeout = tracked.unreadablePolls >= 24;
        const idleTimeout = tracked.idlePolls >= IDLE_SETTLE_POLLS;

        for (const [itemId] of [...tracked.todos]) {
          const inspection = inspections.get(itemId) ?? { outcome: 'pending', unreadable: true, reason: '结算响应缺少该 Issue。' };
          if (inspection.outcome === 'pending') {
            if (unreadableTimeout) {
              inspection.outcome = 'failed';
              inspection.error = `会话空闲但执行历史持续不可读：${inspection.reason ?? '未知原因'}`;
            } else if (idleTimeout && (inspection.idle || inspection.awaitingMessage)) {
              inspection.outcome = 'failed';
              inspection.error = inspection.awaitingMessage
                ? '会话空闲但消息未落档（消息丢失或被重启中断）'
                : '会话空闲但没有回合结束记录（回合未启动或被重启中断）';
            } else {
              continue;
            }
          }
          const pendingRecord = this.state.pending[itemId];
          let handled = this.state.handled[itemId];
          const pendingSupersedesHandled = pendingRecord?.sessionId === sessionId && (!handled
            || handled.sessionId !== sessionId
            || (pendingRecord.requestId && handled.requestId !== pendingRecord.requestId));
          let materialized = false;
          if (pendingSupersedesHandled
            && (inspection.messageAccepted === true || inspection.outcome === 'cancelled')) {
            handled = this.materializePendingRecord(itemId, pendingRecord, summary);
            materialized = true;
          }
          if (pendingSupersedesHandled && !materialized) {
            if (!pendingRecord.requestId) {
              // 无幂等标识的旧 pending：无法确认原消息是否入队时，转人工而不是重发（可能双执行）。
              handled = this.materializePendingRecord(itemId, pendingRecord, summary);
              handled.executionStatus = 'failed';
              handled.completedAt = Date.now();
              handled.executionError = '旧版 pending 缺少 requestId，无法确认原消息是否已被 Host 接受';
              handled.closure = 'needs-human';
              handled.closureNote = '已停止自动重试以避免重复执行；请人工核对原会话后决定是否重新处理';
              handled.pendingUnconfirmed = true;
              handled.nextAttemptAt = null;
              changed = true;
            }
            // pending 尚未证实被接受时，绝不能把本次 inspection 错算到上一轮 handled。
            this.untrackItem(sessionId, itemId);
            continue;
          }
          if (handled?.sessionId === sessionId) {
            if (this.state.pending[itemId]?.sessionId === sessionId) delete this.state.pending[itemId];
            handled.executionStatus = inspection.outcome === 'succeeded' ? 'completed' : 'failed';
            handled.completedAt = Date.now();
            handled.executionError = inspection.error ?? '';
            // 回合结束只说明“会话停了”，是否闭环要再核对 GitLab 事实（见 verifySettled）。
            handled.closure = 'verifying';
            handled.closureNote = '';
            handled.nextAttemptAt = null;
            const report = inspection.report ?? null;
            handled.reportStatus = report?.status ?? '';
            handled.reportSummary = report?.summary ?? '';
            handled.resumeAfterMinutes = report?.resumeAfterMinutes ?? null;
            if (report) handled.openMrs = normalizeMrUrls(report.openMrs, handled.url);
            changed = true;
            settled = true;
          }
          this.untrackItem(sessionId, itemId);
        }
      }
      if (changed) await this.persistQuietly('执行结算');
      this.wakeWaiters();
      if (settled) await this.verifySettled();
    } catch (error) {
      this.logger.warn(`会话状态核对失败：${errorMessage(error)}`);
    } finally {
      this.ensureSessionTimer();
    }
  },
};
