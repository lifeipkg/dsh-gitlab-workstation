import { randomUUID } from 'node:crypto';
import { classifyTodo } from '../core.js';
import {
  LEGACY_REASON,
  beginInflight,
  closeTodo,
  failDelivery,
  finishTurn,
  gcLedger,
  ingestTodos,
  pendingInBatch,
  pushEvent,
  reconcileManual,
  recordReport,
  resumeBreaker,
  retryTodo,
  selectBatches,
  settleAttention,
  settleDone,
  skipTodo,
  validateReport,
  wakeThreads,
} from '../core/todo-machine.js';
import { buildFirstBatchPrompt, buildFollowUpPrompt, buildSessionTitleForThread } from '../core/todo-prompt.js';
import { IDLE_SETTLE_POLLS, MAX_RULE_SKIPS_PER_POLL, RULE_SKIP_REASONS } from './constants.js';
import { errorMessage } from './util.js';

const UNREADABLE_LIMIT = 24;
const PRECHECK_PER_POLL = 20;

/**
 * Todo 台账周期（v4.0）：拉取→入账→规则跳过/预检→组批→投递→回合结算。
 * 状态与转移规则全在 core/todo-machine.js，这里只做 I/O 与编排。挂到运行时原型上。
 */
export const todoCycleMethods = {

  /** 工具绑定器用：会话所属的台账线程（不是台账线程会话则为 null）。 */
  todoThreadForSession(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    return Object.values(this.state?.ledger?.threads ?? {}).find((thread) => thread.sessionId === sessionId) ?? null;
  },

  /** 规则跳过 / 预检跳过：GitLab 标记完成后以 skipped 入账。标记失败不入账，下轮重试。 */
  async ledgerSkipTodo(todo, reason) {
    await this.markTodoDone(todo);
    ingestTodos(this.state.ledger, [todo], { initialState: 'skipped', reason });
    return true;
  },

  /** 一轮拉取后的台账处理。todos 为 GitLab 当前全部待办。 */
  async runTodoCycle(todos, source) {
    const ledger = this.state.ledger;
    const now = Date.now();
    const pendingIds = new Set(todos.map((todo) => todo.id));
    const closed = reconcileManual(ledger, pendingIds, now);
    if (closed.length > 0) this.logger.info(`台账：${closed.length} 条 Todo 已在 GitLab 手动完成。`);
    const fresh = todos.filter((todo) => !ledger.todos[todo.id]);
    const enabled = this.state.settings.enabled;

    if (ledger.legacyPending) {
      // 升级后首轮：GitLab 上仍待办的旧 Todo 一律 waiting（迁移前遗留），由人在收件箱决定重试或关闭。
      const result = ingestTodos(ledger, fresh.filter((todo) => classifyTodo(todo, this.gitlabUserId) === 'direct-mention'),
        { now, initialState: 'waiting', reason: LEGACY_REASON });
      ledger.legacyPending = false;
      this.logger.info(`台账迁移：${result.added.length} 条遗留 Todo 记为 waiting。`);
    } else if (enabled) {
      const woken = await this.admitFreshTodos(fresh, now);
      if (woken.size > 0) wakeThreads(ledger, woken, now);
    }
    const removed = gcLedger(ledger, now);
    if (removed > 0) this.logger.info(`台账清理 ${removed} 条终态 Todo。`);
    this.state.lastNewCount = fresh.length;
    this.logger.info(`轮询完成（${source}）：待办 ${todos.length} 条，新增 ${fresh.length} 条，自动处理 ${enabled ? '开启' : '关闭'}。`);
    if (enabled) await this.dispatchTodoBatches();
    this.ensureTodoTimer();
  },

  /** 新 Todo 准入：规则跳过 → 预检 → queued。返回有新 queued Todo 的线程集合（用于唤醒 waiting）。 */
  async admitFreshTodos(fresh, now) {
    const ledger = this.state.ledger;
    const threads = new Set();
    if (fresh.length === 0) return threads;
    const classified = new Map(fresh.map((todo) => [todo.id, classifyTodo(todo, this.gitlabUserId)]));
    if (this.state.settings.ruleSkipEnabled !== false) {
      const noise = fresh.filter((todo) => RULE_SKIP_REASONS[classified.get(todo.id)]).slice(0, MAX_RULE_SKIPS_PER_POLL);
      for (const todo of noise) {
        try {
          await this.ledgerSkipTodo(todo, RULE_SKIP_REASONS[classified.get(todo.id)]);
          classified.set(todo.id, 'skipped');
        } catch (error) {
          this.logger.warn(`规则跳过 Todo ${todo.id} 标记完成失败：${errorMessage(error)}`);
        }
      }
    }
    let mentions = fresh.filter((todo) => classified.get(todo.id) === 'direct-mention' && !ledger.todos[todo.id]).slice(0, PRECHECK_PER_POLL);
    if (this.state.settings.precheckEnabled && mentions.length > 0) mentions = await this.precheckMentions(mentions);
    if (mentions.length > 0) {
      const result = ingestTodos(ledger, mentions, { now });
      for (const key of result.threadKeys) threads.add(key);
    }
    return threads;
  },

  freeTodoSlots() {
    const inflight = Object.values(this.state.ledger.threads).filter((thread) => thread.inflight).length;
    return Math.max(0, this.concurrencyLimit() - this.occupiedSlots() - inflight);
  },

  dispatchTodoBatches() {
    if (this.todoDispatchPromise) return this.todoDispatchPromise;
    const operation = this.executeTodoDispatch().finally(() => {
      if (this.todoDispatchPromise === operation) this.todoDispatchPromise = null;
    });
    this.todoDispatchPromise = operation;
    return operation;
  },

  async executeTodoDispatch() {
    if (this.stopping) return;
    const ledger = this.state.ledger;
    const batches = selectBatches(ledger, { free: this.freeTodoSlots() });
    for (const { thread, todos } of batches) {
      if (this.stopping) break;
      await this.deliverTodoBatch(thread, todos);
    }
    if (batches.length > 0) await this.persistQuietly('Todo 批次投递');
    this.ensureTodoTimer();
  },

  async deliverTodoBatch(thread, todos) {
    const ledger = this.state.ledger;
    const settings = this.state.settings;
    const ids = todos.map((todo) => todo.id);
    const requestId = `todo-${randomUUID()}`;
    beginInflight(ledger, thread.key, ids, { requestId });
    // 先落盘再投递：崩溃后可凭 inflight 与 requestId 对账，不会重复投递。
    await this.persistQuietly('Todo 在途批次');
    (this.todoDeliveryBusy ??= new Set()).add(thread.key);
    try {
      let created = false;
      if (!thread.sessionId) {
        const request = { workspaceId: this.resolveWorkspaceId(settings.sessionCwd) };
        if (typeof this.config.agentPreset === 'string' && this.config.agentPreset) request.agentPreset = this.config.agentPreset;
        thread.sessionId = await this.host.createSession(request);
        thread.archived = false;
        thread.primed = false;
        created = true;
        await this.persistQuietly('Todo 线程会话');
        const renamed = await this.host.renameSession(thread.sessionId, buildSessionTitleForThread(thread));
        if (typeof renamed?.title === 'string') thread.sessionTitle = renamed.title;
        if (settings.sessionModel) await this.host.selectModel({ sessionId: thread.sessionId, ...settings.sessionModel });
      } else if (thread.archived) {
        await this.host.unarchiveSession(thread.sessionId);
        thread.archived = false;
      }
      const bound = await this.todoBinder?.ensureBound(thread.sessionId);
      if (bound && !bound.ok) throw new Error(`报告工具未能绑定：${bound.error}`);
      const me = { username: this.gitlabUsername, id: this.gitlabUserId };
      const text = thread.primed && !created
        ? buildFollowUpPrompt({ thread, todos })
        : buildFirstBatchPrompt({ thread, todos, settings, me });
      await this.host.prompt({ requestId, sessionId: thread.sessionId, mode: 'queue', content: [{ type: 'text', text }] });
      thread.primed = true;
      thread.inflight.sentAt = Date.now();
    } catch (error) {
      const message = errorMessage(error);
      this.logger.warn(`Todo 批次投递失败（${thread.key}）：${message}`);
      thread.inflight = null;
      failDelivery(ledger, thread.key, ids, message);
      pushEvent(ledger, 'delivery-failed', message, { threadKey: thread.key });
    } finally {
      this.todoDeliveryBusy.delete(thread.key);
    }
  },

  /** gitlab_todo_report 工具入口（由 todo-tools 绑定器调用）。 */
  async handleTodoReport(sessionId, args) {
    const ledger = this.state.ledger;
    const thread = this.todoThreadForSession(sessionId);
    if (!thread) return { ok: false, error: '该会话不是 Todo 处理会话。' };
    const checked = validateReport(thread, args);
    if (checked.error) return { ok: false, error: checked.error, pending: pendingInBatch(thread) };
    const accepted = [];
    const failed = [];
    for (const id of checked.ids) {
      const todo = ledger.todos[id];
      if (!todo || todo.state === 'done' || todo.state === 'skipped') { accepted.push(id); continue; }
      if (checked.status === 'done') {
        try {
          await this.markTodoDone(todo);
          settleDone(ledger, thread.key, id, checked.summary);
          accepted.push(id);
        } catch (error) {
          const message = `标记完成失败：${errorMessage(error)}`;
          settleAttention(ledger, thread.key, id, message);
          failed.push({ todoId: id, error: message });
        }
      } else {
        recordReport(ledger, thread.key, id, checked.status, checked.summary);
        accepted.push(id);
      }
    }
    await this.persistQuietly('Todo 报告');
    return { ok: failed.length === 0, accepted, failed, pending: pendingInBatch(thread) };
  },

  todoInflightThreads() {
    return Object.values(this.state?.ledger?.threads ?? {}).filter((thread) => thread.inflight);
  },

  ensureTodoTimer() {
    const needed = !this.stopping && this.todoInflightThreads().length > 0;
    if (needed && !this.todoTimer) {
      this.todoTimer = setInterval(() => void this.reconcileTodoInflight(), this.sessionPollMs());
      this.todoTimer.unref?.();
    } else if (!needed && this.todoTimer) {
      clearInterval(this.todoTimer);
      this.todoTimer = null;
    }
  },

  reconcileTodoInflight() {
    if (this.todoReconcilePromise) return this.todoReconcilePromise;
    const operation = this.executeTodoReconcile().finally(() => {
      if (this.todoReconcilePromise === operation) this.todoReconcilePromise = null;
    });
    this.todoReconcilePromise = operation;
    return operation;
  },

  async executeTodoReconcile() {
    if (this.stopping) return;
    const ledger = this.state.ledger;
    const threads = this.todoInflightThreads();
    if (threads.length === 0) { this.ensureTodoTimer(); return; }
    try {
      const value = await this.host.listSessions();
      if (!Array.isArray(value?.items)) throw new Error('session/list 响应缺少 items 数组。');
      this.sessionRosterKnown = true;
      const byId = new Map(value.items.map((item) => [String(item.sessionId), item]));
      this.todoPolls ??= new Map();
      let changed = false;
      for (const thread of threads) {
        if (!thread.inflight || this.todoDeliveryBusy?.has(thread.key)) continue;
        const summary = byId.get(thread.sessionId);
        if (summary?.running) continue;
        const { inflight } = thread;
        const inspections = await this.host.inspectRequests(thread.sessionId, summary,
          [{ key: 'batch', requestId: inflight.requestId, startedAt: inflight.sentAt, originUrl: thread.url }]);
        const inspection = inspections.get('batch');
        let result = null;
        if (inspection?.outcome === 'succeeded') result = { failed: false };
        else if (inspection?.outcome === 'failed' || inspection?.outcome === 'cancelled') {
          result = { failed: true, error: inspection.error || (inspection.outcome === 'cancelled' ? '会话已取消或不存在' : '回合失败') };
        } else {
          const poll = this.todoPolls.get(thread.key) ?? { unreadable: 0, idle: 0 };
          poll.unreadable = inspection?.unreadable ? poll.unreadable + 1 : 0;
          poll.idle = inspection?.idle || inspection?.awaitingMessage ? poll.idle + 1 : 0;
          this.todoPolls.set(thread.key, poll);
          if (poll.unreadable >= UNREADABLE_LIMIT) result = { failed: true, error: '会话历史长期无法读取' };
          else if (poll.idle >= IDLE_SETTLE_POLLS) result = { failed: true, error: '会话空闲但没有本批的回合记录' };
        }
        if (!result) continue;
        this.todoPolls.delete(thread.key);
        await this.settleTodoTurn(thread, result);
        changed = true;
      }
      if (changed) {
        await this.persistQuietly('Todo 回合结算');
        if (this.state.settings.enabled) await this.dispatchTodoBatches();
      }
    } catch (error) {
      this.logger.warn(`Todo 对账失败：${errorMessage(error)}`);
    } finally {
      this.ensureTodoTimer();
    }
  },

  async settleTodoTurn(thread, { failed, error }) {
    const ledger = this.state.ledger;
    const outcome = finishTurn(ledger, thread.key, { failed, error });
    if (outcome.unreported.length > 0) {
      this.logger.warn(`线程 ${thread.key} 回合结束，${outcome.unreported.length} 条 Todo 未报告，已退回队列。`);
    }
    if (outcome.settled && this.state.settings.autoArchive !== false && thread.sessionId && !thread.archived) {
      try {
        await this.host.archiveSession(thread.sessionId);
        thread.archived = true;
      } catch (archiveError) {
        pushEvent(ledger, 'archive-failed', errorMessage(archiveError), { threadKey: thread.key });
      }
    }
    this.wakeWaiters();
  },

  // ---- 面板 / Leader 动作 ----

  /** 面板「处理」按钮：不在台账则按类型入账（MR/指派通知直接完成），已在台账则重试。 */
  async todoManualDispatch(todo) {
    const ledger = this.state.ledger;
    try {
      if (ledger.todos[todo.id]) {
        if (!retryTodo(ledger, todo.id)) return { ok: false, error: `Todo 当前状态为 ${ledger.todos[todo.id].state}，无需处理。` };
      } else {
        const kind = classifyTodo(todo, this.gitlabUserId);
        if (kind === 'merge-request' || kind === 'assignment-notify') {
          await this.ledgerSkipTodo(todo, RULE_SKIP_REASONS[kind] || '无需会话处理，已直接标记完成');
          await this.persistQuietly('Todo 直接完成');
          return { ok: true, sessionId: null, skipped: true };
        }
        ingestTodos(ledger, [todo], {});
      }
      await this.persistQuietly('Todo 手动处理');
      await this.dispatchTodoBatches();
      return { ok: true, sessionId: ledger.threads[ledger.todos[todo.id]?.threadKey]?.sessionId ?? null };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  },

  async todoRetry(todoId) {
    const ok = retryTodo(this.state.ledger, todoId);
    if (ok) {
      await this.persistQuietly('Todo 重试');
      void this.dispatchTodoBatches();
    }
    return ok;
  },

  async todoClose(todoId, by = 'human') {
    const todo = this.state.ledger.todos[todoId];
    if (!todo) return { ok: false, error: 'Todo 不在台账中。' };
    try { await this.markTodoDone(todo); } catch (error) { return { ok: false, error: `标记完成失败：${errorMessage(error)}` }; }
    closeTodo(this.state.ledger, todoId, by);
    await this.persistQuietly('Todo 关闭');
    return { ok: true };
  },

  async todoResume() {
    const was = resumeBreaker(this.state.ledger);
    await this.persistQuietly('恢复投递');
    if (was) void this.dispatchTodoBatches();
    return was;
  },

  todoSkip(todoId, reason) { return skipTodo(this.state.ledger, todoId, reason); },
};
