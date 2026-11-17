import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { buildIssueProjection, buildLeaderProjection, DEFAULT_LEADER_AGENT_PRESET, initialLeaderState,
  isLeaderTaskId, LEADER_LIMITS, LEADER_REPORT_KINDS, normalizeLeaderState, validateLeaderSettings } from '../core.js';
import { errorMessage } from './util.js';
import { leaderToolMethods } from './leader-tools.js';
import { clone, digest, failure, LEADER_BOOTSTRAP, quiet, squash, success, validId } from './leader-util.js';

// These handles must be minted by trusted Host entry points, never from request JSON.
const callers = new WeakMap();
export function createLeaderUiCaller() {
  const caller = Object.freeze({}); callers.set(caller, { kind: 'ui' }); return caller;
}
export function createLeaderAgentCaller({ sessionId, agentId } = {}) {
  if (!validId(sessionId) || !validId(agentId)) throw new Error('真实 Agent 上下文缺少 sessionId/agentId。');
  const caller = Object.freeze({}); callers.set(caller, { kind: 'agent', sessionId, agentId }); return caller;
}
/** Plugin-created worker session caller: may only call workerReport (gitlab_leader_report), never Leader/UI operations. */
export function createLeaderWorkerCaller({ sessionId, agentId } = {}) {
  if (!validId(sessionId) || !validId(agentId)) throw new Error('真实 worker Agent 上下文缺少 sessionId/agentId。');
  const caller = Object.freeze({}); callers.set(caller, { kind: 'worker', sessionId, agentId }); return caller;
}

const MISSING_CHECK_MS = 10000;
// UI: only the Leader session's own lifecycle. Everything about worker sessions is the Leader Agent's job (v3).
const uiOperations = new Set(['snapshot', 'create', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery']);
const agentOperations = new Set(['board', 'session', 'inbox']);
const workerOperations = new Set(['workerReport']);

export const leaderMethods = {
  ...leaderToolMethods,
  leaderFile() { return join(this.storageDirectory(), 'leader.json'); },

  async loadLeader() {
    await this.prepareStorage?.();
    this.leaderStopping = false;
    this.leaderJournalUnreadable = false;
    try {
      const state = normalizeLeaderState(JSON.parse(await readFile(this.leaderFile(), 'utf8')));
      if (state.migratedFrom === 1) {
        // v1 journals carried items/outbox/budgets that v3 drops: keep a copy of the original once.
        try { await copyFile(this.leaderFile(), `${this.leaderFile()}.v1.bak`); } catch { /* best effort */ }
        delete state.migratedFrom;
      }
      this.leaderState = state;
    } catch (error) {
      if (error?.code === 'ENOENT') this.leaderState = initialLeaderState();
      else {
        this.leaderState = initialLeaderState();
        this.leaderJournalUnreadable = true; this.leaderStorageFault = true;
        this.leaderState.phase = 'error';
        this.leaderState.error = `读取 Leader journal 失败，未覆盖原文件；仅 Leader 停止：${errorMessage(error)}`;
        return this.leaderProjection();
      }
    }
    this.leaderStorageFault = false;
    this.leaderPersistedSnapshot = null;
    try { await this.saveLeaderStrict(); } catch { /* the error is already recorded on the state */ }
    return this.leaderProjection();
  },

  async persistLeader() {
    const snapshot = JSON.stringify(this.leaderState);
    const run = async () => {
      if (snapshot === this.leaderPersistedSnapshot) return;
      await mkdir(this.storageDirectory(), { recursive: true });
      const target = this.leaderFile();
      const temp = join(this.storageDirectory(), `leader-${process.pid}-${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temp, 'wx', 0o600);
        await handle.writeFile(snapshot, 'utf8');
        await handle.sync();
        await handle.close(); handle = undefined;
        await rename(temp, target);
        this.leaderPersistedSnapshot = snapshot;
      } catch (error) {
        this.leaderPersistedSnapshot = null;
        try { await handle?.close(); } catch { /* ignore */ }
        try { await unlink(temp); } catch { /* ignore */ }
        throw error;
      }
    };
    const next = (this.leaderWriteChain ?? Promise.resolve()).catch(() => {}).then(run);
    this.leaderWriteChain = next;
    return next;
  },

  leaderProjection() { return buildLeaderProjection(this.leaderState ?? initialLeaderState()); },

  leaderExclusive(operation) {
    const next = (this.leaderOperationChain ?? Promise.resolve()).catch(() => {}).then(operation);
    this.leaderOperationChain = next;
    return next;
  },

  /** v3 has no background loop; this only blocks new operations while the plugin shuts down. */
  stopLeader() { this.leaderStopping = true; },

  markLeaderSideEffect() { this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1; },

  async saveLeaderStrict() {
    try {
      await this.persistLeader();
    } catch (error) {
      this.leaderStorageFault = true;
      if (this.leaderState) {
        this.leaderState.phase = 'error';
        this.leaderState.error = `Leader journal 落盘失败，已停止所有副作用：${errorMessage(error)}`;
      }
      throw new Error(`Leader journal 落盘失败，已停止所有副作用：${errorMessage(error)}`);
    }
    this.leaderStorageFault = false;
    this.syncLeaderWorkerTools();
  },

  /** Worker sessions gain gitlab_leader_report whenever the set of plugin-created sessions changes. */
  syncLeaderWorkerTools(force = false) {
    const key = JSON.stringify([this.leaderState?.sessionId ?? null, [...this.leaderManagedSessionIds()].sort()]);
    if (!force && key === this.leaderWorkerToolKey) return;
    this.leaderWorkerToolKey = key;
    void Promise.resolve(this.leaderAdapter?.refreshWorkerBindings?.()).catch((error) => this.logger?.warn?.(`Leader worker 工具绑定失败：${errorMessage(error)}`));
  },

  authorizeLeader(caller, operation) {
    const identity = callers.get(caller);
    if (!identity) throw new Error('拒绝无可信身份的 Leader 调用。');
    if (identity.kind === 'worker') {
      if (!workerOperations.has(operation)) throw new Error('worker 会话只能向 Leader 报告，不能调用任何 Leader 或 UI 操作。');
      if (!validId(identity.sessionId) || identity.sessionId === this.leaderState?.sessionId || !this.isLeaderManagedSession(identity.sessionId)) {
        throw new Error('调用会话不是当前插件创建的 worker。');
      }
      return identity;
    }
    if (workerOperations.has(operation)) throw new Error('workerReport 仅限插件创建的 worker 会话调用。');
    if (identity.kind === 'ui') {
      if (!uiOperations.has(operation)) throw new Error('该操作仅限 Leader Agent 工具调用。');
      return identity;
    }
    if (!agentOperations.has(operation)) throw new Error('Leader Agent 不能修改 Leader 设置、创建 Leader 或处理 Leader 创建记录。');
    if (!validId(identity.sessionId) || identity.sessionId !== this.leaderState?.sessionId) throw new Error('调用 Agent 不属于当前 Leader 会话。');
    return identity;
  },

  async leaderOperation(operation, request = {}, caller) {
    try { this.authorizeLeader(caller, operation); } catch (error) { return failure(errorMessage(error)); }
    if (this.leaderStopping) return failure('插件正在停止，Leader 操作已拒绝。');
    if (workerOperations.has(operation)) {
      if (this.leaderJournalUnreadable) return failure('Leader journal 不可用，报告未记录。');
      if (!request || typeof request !== 'object' || Array.isArray(request)) return failure('报告参数必须是对象。');
      const result = await this.leaderLockedOperation(operation, request, caller);
      // Workers never see the Leader projection.
      return result.ok ? result : failure(result.error);
    }
    if (this.leaderJournalUnreadable && operation !== 'snapshot') {
      return failure('Leader journal 未知/损坏；只读冻结，先人工修复再 reload，绝不覆盖或重新创建。', this.leaderProjection());
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) return failure('Leader 参数必须是对象。');
    if (operation === 'session' && request.action === 'create') {
      // dispatch() awaits the Leader lock internally, so creation must run outside it.
      try { return await this.leaderCreateSessionRecord(request); } catch (error) { return failure(errorMessage(error), this.leaderProjection()); }
    }
    if (operation === 'inbox') {
      // The inbox lives in Todo state, not the Leader journal; acknowledge takes the same path as the UI button.
      try { return await this.leaderInboxRecord(request); } catch (error) { return failure(errorMessage(error)); }
    }
    const context = {};
    if (operation === 'board' && request.refresh === true) {
      const problems = [];
      try { await this.refreshIssues?.(); } catch (error) { problems.push(`Issue 列表刷新失败：${errorMessage(error)}`); }
      try { await this.poll?.('leader'); } catch (error) { problems.push(`收件箱刷新失败：${errorMessage(error)}`); }
      if (problems.length) context.refreshError = problems.join('；').slice(0, 500);
    }
    return this.leaderLockedOperation(operation, request, caller, context);
  },

  leaderLockedOperation(operation, request, caller, context = {}) {
    return this.leaderExclusive(async () => {
      const before = clone(this.leaderState ?? initialLeaderState());
      const sideEffects = this.leaderSideEffectGeneration ?? 0;
      try {
        const identity = this.authorizeLeader(caller, operation);
        this.leaderState ??= initialLeaderState();
        switch (operation) {
          case 'workerReport': return await this.workerReportRecord(request, identity);
          case 'snapshot':
            if (identity.kind === 'ui') await this.resetMissingLeader();
            return success(this.leaderProjection());
          case 'create': return await this.createLeaderRecord(request);
          case 'configure': return await this.configureLeader(request.settings ?? request);
          case 'resolveDelivery': return await this.resolveLeaderDelivery(request, 'ui');
          case 'resolveCreation': return await this.resolveLeaderCreation(request);
          case 'resolveTask': return await this.resolveLeaderTask(request);
          case 'board': return await this.leaderBoardRecord(request, context);
          case 'session': return await this.leaderSessionRecord(request);
          default: return failure('不支持的 Leader 操作。');
        }
      } catch (error) {
        // Roll back only when nothing outside the journal happened; after a Host side effect the journal is the truth.
        if (sideEffects === (this.leaderSideEffectGeneration ?? 0)) {
          this.leaderState = before;
          if (this.leaderStorageFault) { this.leaderState.phase = 'error'; this.leaderState.error = errorMessage(error); }
        }
        return failure(errorMessage(error), this.leaderProjection());
      }
    });
  },

  // ---- Managed sessions: every session the plugin itself created (Issue/Todo workers, Leader ad-hoc tasks) ----

  /** Records of plugin-created sessions: taskId → sessionId (routed records point at someone else's session and are excluded). */
  leaderManagedPairs() {
    const pairs = [];
    for (const task of this.leaderState?.tasks ?? []) {
      if (task.status === 'created' && validId(task.sessionId)) pairs.push([task.taskId, task.sessionId]);
    }
    for (const records of [this.state?.handled, this.state?.pending]) {
      for (const [taskId, record] of Object.entries(records ?? {})) {
        if (validId(record?.sessionId) && record.routed !== true) pairs.push([taskId, record.sessionId]);
      }
    }
    for (const thread of Object.values(this.state?.ledger?.threads ?? {})) {
      const taskId = `thread:${thread.key}`;
      if (validId(taskId) && validId(thread.sessionId)) pairs.push([taskId, thread.sessionId]);
    }
    return pairs.filter(([, sessionId]) => sessionId !== this.leaderState?.sessionId);
  },

  leaderManagedSessionIds() { return new Set(this.leaderManagedPairs().map(([, sessionId]) => sessionId)); },

  isLeaderManagedSession(sessionId) {
    return validId(sessionId) && sessionId !== this.leaderState?.sessionId && this.leaderManagedPairs().some(([, id]) => id === sessionId);
  },

  /** The taskId a session reports under (latest record wins when several Todos share one session). */
  leaderTaskForSession(sessionId) {
    const pairs = this.leaderManagedPairs().filter(([, id]) => id === sessionId);
    return pairs.length ? pairs[pairs.length - 1][0] : null;
  },

  leaderSessionForTask(taskId) {
    if (!validId(taskId)) return null;
    if (isLeaderTaskId(taskId)) {
      const task = this.leaderState?.tasks?.find((entry) => entry.taskId === taskId && entry.status === 'created');
      return task?.sessionId ?? null;
    }
    if (taskId.startsWith('thread:')) {
      const thread = this.state?.ledger?.threads?.[taskId.slice(7)];
      return validId(thread?.sessionId) ? thread.sessionId : null;
    }
    const issue = this.leaderIssueEntries().find((entry) => entry.id === taskId && !entry.routed && validId(entry.sessionId));
    if (issue) return issue.sessionId;
    const record = this.state?.handled?.[taskId] ?? this.state?.pending?.[taskId];
    return validId(record?.sessionId) && record.routed !== true ? record.sessionId : null;
  },

  leaderIssueEntries() {
    const projection = buildIssueProjection(this.state);
    return [...(projection.items ?? []), ...(projection.orphans ?? [])];
  },

  /** Verifies the (taskId, sessionId) pair against Host records; null when the session is not plugin-created or the mapping changed. */
  leaderIssueMapping(taskId, sessionId) {
    if (!validId(taskId) || !validId(sessionId) || sessionId === this.leaderState?.sessionId) return null;
    if (isLeaderTaskId(taskId)) {
      const task = this.leaderState?.tasks?.find((entry) => entry.taskId === taskId && entry.status === 'created' && entry.sessionId === sessionId);
      return task ? { id: task.taskId, sessionId, title: task.title, url: '', kind: 'task' } : null;
    }
    const issue = this.leaderIssueEntries().find((entry) => entry.id === taskId && entry.sessionId === sessionId && !entry.routed);
    if (issue) return { ...issue, kind: 'issue' };
    return this.leaderTodoMapping(taskId, sessionId);
  },

  leaderTodoMapping(taskId, sessionId) {
    if (/^issue-/u.test(taskId)) return null;
    if (taskId.startsWith('thread:')) {
      const thread = this.state?.ledger?.threads?.[taskId.slice(7)];
      if (!thread || thread.sessionId !== sessionId) return null;
      return { id: taskId, sessionId, title: String(thread.title ?? '').slice(0, 1000), url: String(thread.url ?? ''), kind: 'todo', sessionTitle: thread.sessionTitle ?? '' };
    }
    const record = this.state?.handled?.[taskId] ?? this.state?.pending?.[taskId];
    if (!record || record.sessionId !== sessionId || record.routed === true) return null;
    const todo = this.state?.todos?.find((entry) => entry.id === taskId) ?? record.item ?? {};
    return { id: taskId, sessionId, title: String(record.title ?? todo.title ?? record.sessionTitle ?? '').slice(0, 1000),
      url: String(record.url ?? todo.url ?? ''), kind: 'todo', sessionTitle: record.sessionTitle ?? '' };
  },

  /** Resolves an agent request to a verified managed target; sessionId is optional because the Host knows it. */
  leaderResolveTarget(request) {
    const taskId = request?.taskId;
    if (!validId(taskId)) throw new Error('必须提供原样 taskId（来自 gitlab_leader_board）。');
    const sessionId = validId(request.sessionId) ? request.sessionId : this.leaderSessionForTask(taskId);
    if (!validId(sessionId)) throw new Error(`taskId ${taskId} 当前没有可管理的会话（未创建、已归档或已路由到非插件会话）。`);
    const item = this.leaderIssueMapping(taskId, sessionId);
    if (!item) throw new Error('会话不属于本插件创建的 Issue/Todo/临时任务，或映射已改变；拒绝任意/历史会话 ID。');
    return { ...item, taskId: item.id };
  },

  async inspectLeaderSession(sessionId) {
    try {
      const read = typeof this.leaderAdapter?.state === 'function'
        ? (id) => this.leaderAdapter.state(id) : (id) => this.host.sessionState(id);
      const state = await read(sessionId);
      const archived = this.ctx?.workspaceRegistry?.archivedSessionIds;
      if (!Array.isArray(archived) || !archived.every((id) => typeof id === 'string')) {
        return { status: 'unknown', error: '宿主状态/权威归档 registry 不可验证。', state: null };
      }
      if (archived.includes(sessionId)) return { status: 'archived', state, error: '' };
      return { status: 'active', state, error: '' };
    } catch (error) {
      const missing = error?.isDSHRemoteError === true && error.code === 'session/not-found' && error.details?.sessionId === sessionId;
      if (missing) return { status: 'missing', error: '原会话不存在；禁止自动重建或恢复。', state: null };
      return { status: 'unknown', error: errorMessage(error).slice(0, 1000), state: null };
    }
  },

  // ---- Leader session lifecycle ----

  async resolveLeaderPreset() {
    const configured = this.config?.leaderAgentPreset;
    if (configured === undefined || configured === null || configured === '') return null;
    if (!validId(configured)) throw new Error('leaderAgentPreset 配置无效，未创建 Leader。');
    const registry = this.leaderServicesContext?.agentPresets;
    if (typeof registry?.resolve !== 'function') return configured;
    try {
      const resolved = await registry.resolve(configured);
      if (resolved?.broken) throw new Error(`Leader preset ${configured} 激活失败：${errorMessage(resolved.broken)}`);
      return configured;
    } catch (error) {
      throw new Error(`Leader preset 不可用，未创建 Leader：${errorMessage(error)}`);
    }
  },

  async createLeaderRecord(request) {
    const state = this.leaderState;
    const nextSettings = request.settings === undefined ? state.settings : validateLeaderSettings(request.settings, state.settings);
    if (!state.sessionId && ['creating', 'uncertain'].includes(state.creation?.status)) {
      return failure('前次 Leader 创建结果不确定，禁止重复创建；请核查宿主。', this.leaderProjection());
    }
    if (!state.sessionId) {
      const agentPreset = await this.resolveLeaderPreset();
      state.settings = nextSettings;
      const workspaceId = this.resolveWorkspaceId(this.state?.settings?.issueSessionCwd ?? '');
      state.creation = { requestId: validId(request.requestId) ? request.requestId : `leader-create-${randomUUID()}`,
        status: 'creating', createdAt: Date.now(), ...(agentPreset ? { agentPreset } : {}) };
      state.phase = 'uncertain';
      // Persist intent before the Host side effect: an unknown outcome is never recreated automatically.
      await this.saveLeaderStrict();
      try {
        this.markLeaderSideEffect();
        const id = await this.host.createSession({ workspaceId, ...(agentPreset ? { agentPreset } : {}) });
        if (!validId(id) || this.isLeaderManagedSession(id)) throw new Error('宿主返回无效/冲突的 Leader ID。');
        state.sessionId = id; state.creation.status = 'created';
        await this.saveLeaderStrict();
      } catch (error) {
        state.creation.status = state.sessionId ? 'created' : 'uncertain';
        state.error = `Leader 创建/记录结果不确定，禁止自动重建：${errorMessage(error)}`;
        state.phase = state.sessionId ? 'error' : 'uncertain';
        try { await this.saveLeaderStrict(); } catch { /* keep the original error */ }
        return failure(state.error, this.leaderProjection());
      }
    }
    const inspection = await this.inspectLeaderSession(state.sessionId);
    if (inspection.status === 'missing' && await this.resetMissingLeader({ force: true })) {
      return failure('原 Leader 会话已不存在，记录已重置；请重新点击“创建 Leader”。', this.leaderProjection());
    }
    if (inspection.status !== 'active' || !quiet(inspection.state)) {
      state.phase = inspection.status === 'unknown' ? 'uncertain' : 'error';
      state.error = inspection.error || 'Leader 会话忙碌/已归档，未改变设置。';
      await this.saveLeaderStrict();
      return failure(state.error, this.leaderProjection());
    }
    state.settings = nextSettings;
    // Remember whether the role briefing was already delivered before this pass touches the status.
    const briefed = state.creation?.status === 'ready';
    if (!briefed) state.creation = { ...state.creation, status: 'created' };
    await this.saveLeaderStrict();
    try {
      this.markLeaderSideEffect();
      // The Host fires agent/created inside createSession, before the new ID is recorded, so that hook cannot recognise
      // the Leader. Bind the two plugin tools here, now that the ID is durable and before any prompt reaches the agent.
      await this.bindLeaderTools(state.sessionId);
      await this.host.renameSession(state.sessionId, 'WorkStation Leader');
      if (state.settings.model) await this.host.selectModel({ sessionId: state.sessionId, ...state.settings.model });
      else if (state.configuredModel) await this.resetLeaderModel(state.sessionId);
      state.configuredModel = clone(state.settings.model);
      state.creation.status = 'ready'; state.phase = 'ready'; state.error = '';
      await this.saveLeaderStrict();
      if (!briefed) {
        // Role briefing for the Host's standard preset. Best effort: the Leader works without it, and it is never retried.
        try {
          await this.host.prompt({ requestId: `leader-bootstrap-${state.sessionId}`, sessionId: state.sessionId, mode: 'queue',
            content: [{ type: 'text', text: LEADER_BOOTSTRAP }] });
        } catch (error) { this.logger?.warn?.(`Leader 角色说明发送失败：${errorMessage(error)}`); }
      }
      return success(this.leaderProjection());
    } catch (error) {
      state.phase = 'error';
      state.error = `Leader 已创建；设置失败，重试复用已知 ID：${errorMessage(error)}`;
      try { await this.saveLeaderStrict(); } catch { /* keep the original error */ }
      return failure(state.error, this.leaderProjection());
    }
  },

  /** Binds gitlab_leader_board/gitlab_leader_session to the resident Leader agent. A cold session binds when it is opened (agent/created). */
  async bindLeaderTools(sessionId) {
    if (typeof this.leaderAdapter?.refreshBindings !== 'function') return;
    if (await this.leaderAdapter.refreshBindings()) return;
    const reason = this.leaderAdapter.bindingStatus || '原因未知';
    if (this.leaderServicesContext?.agents?.get?.(sessionId)) {
      throw new Error(`Leader 已在运行，但插件工具未能绑定（${reason}）；Leader 将只有宿主标准工具。`);
    }
    this.logger?.warn?.(`Leader 会话尚未常驻，工具将在会话打开时绑定（${reason}）。`);
  },

  async resetLeaderModel(sessionId) {
    if (typeof this.leaderAdapter?.resetModel !== 'function') throw new Error('unavailable：无法核验重置 Leader 默认模型，保留原模型并报告失败。');
    await this.leaderAdapter.resetModel(sessionId);
  },

  async configureLeader(settings) {
    const state = this.leaderState;
    const next = validateLeaderSettings(settings, state.settings);
    const current = state.sessionId ? (state.configuredModel ?? null) : state.settings.model;
    const modelChanged = digest(next.model) !== digest(current);
    if (modelChanged && state.sessionId) {
      const inspection = await this.inspectLeaderSession(state.sessionId);
      if (inspection.status !== 'active' || !quiet(inspection.state)) return failure('Leader 状态不可验证/忙碌，未更换模型。', this.leaderProjection());
    }
    state.settings = next;
    await this.saveLeaderStrict();
    if (!modelChanged || !state.sessionId) return success(this.leaderProjection());
    try {
      this.markLeaderSideEffect();
      if (next.model) await this.host.selectModel({ sessionId: state.sessionId, ...next.model });
      else await this.resetLeaderModel(state.sessionId);
      state.configuredModel = clone(next.model);
      state.error = state.creation?.status === 'ready' ? '' : 'Leader 设置尚未完成，请重试设置复用已知会话；不会重复创建。';
      state.phase = state.creation?.status === 'ready' ? 'ready' : 'error';
      await this.saveLeaderStrict();
      return success(this.leaderProjection());
    } catch (error) {
      state.error = errorMessage(error); state.phase = 'error';
      try { await this.saveLeaderStrict(); } catch { /* keep the original error */ }
      return failure(state.error, this.leaderProjection());
    }
  },

  async resetMissingLeader({ force = false } = {}) {
    const state = this.leaderState;
    if (!state?.sessionId || !['created', 'ready'].includes(state.creation?.status) || this.leaderStopping || this.leaderStorageFault) return false;
    const now = Date.now();
    if (!force && now - (this.leaderMissingCheckAt ?? 0) < MISSING_CHECK_MS) return false;
    this.leaderMissingCheckAt = now;
    const sessionId = state.sessionId;
    const inspection = await this.inspectLeaderSession(sessionId);
    if (inspection.status !== 'missing' || state.sessionId !== sessionId) return false;
    state.sessionId = null; state.configuredModel = null; state.creation = null; state.phase = 'not-created'; state.error = '';
    await this.saveLeaderStrict();
    try { await this.leaderAdapter?.refreshBindings?.(); } catch { /* best effort */ }
    return true;
  },

  async resolveLeaderCreation(request) {
    const state = this.leaderState;
    if (state.sessionId || !state.creation || !['creating', 'uncertain'].includes(state.creation.status)) {
      return failure('当前没有结果不确定的 Leader 创建记录。', this.leaderProjection());
    }
    if (request.resolution === 'abandon') {
      state.abandonedCreations = [...state.abandonedCreations,
        { requestId: state.creation.requestId, createdAt: state.creation.createdAt ?? null, abandonedAt: Date.now() }].slice(-LEADER_LIMITS.maxAbandonedCreations);
      state.creation = null; state.phase = 'not-created'; state.error = '';
      await this.saveLeaderStrict();
      return success(this.leaderProjection());
    }
    if (request.resolution !== 'claim' || !validId(request.sessionId)) {
      return failure('resolution 必须是 abandon，或 claim 并提供人类核实的 Leader 会话 ID。', this.leaderProjection());
    }
    if (this.isLeaderManagedSession(request.sessionId)) return failure('该会话是插件创建的 worker，不能作为 Leader。', this.leaderProjection());
    if (this.leaderIssueEntries().some((entry) => entry.sessionId === request.sessionId)) {
      return failure('该会话属于某个 Issue worker，不能作为 Leader。', this.leaderProjection());
    }
    const inspection = await this.inspectLeaderSession(request.sessionId);
    if (inspection.status !== 'active' || !quiet(inspection.state)) {
      return failure('该会话不存在/已归档/忙碌/不可验证，未认领。', this.leaderProjection());
    }
    state.sessionId = request.sessionId;
    state.creation = { ...state.creation, status: 'created', claimedAt: Date.now() };
    state.error = '';
    await this.saveLeaderStrict();
    return this.createLeaderRecord({});
  },

  async resolveLeaderTask(request) {
    const task = this.leaderState.tasks.find((entry) => entry.taskId === request.taskId);
    if (!task) return failure('临时任务不存在。', this.leaderProjection());
    if (request.action !== 'dismiss') return failure('action 只能是 dismiss。', this.leaderProjection());
    if (task.status !== 'uncertain') return failure('只有结果不确定的临时任务需要人工处理。', this.leaderProjection());
    task.status = 'archived'; task.error = '人类已核查并放弃该不确定的创建记录。';
    await this.saveLeaderStrict();
    return success(this.leaderProjection());
  },

  // ---- Deliveries (Leader → worker), reports (worker → Leader) ----

  /** Native guarded delivery calls back here: only a durably recorded 'sending' entry bound to the exact body and cursor passes. */
  validateLeaderAdmission(request) {
    const state = this.leaderState;
    if (!state || this.leaderStopping || this.leaderStorageFault || this.leaderJournalUnreadable) return false;
    if (!request || request.leaderSessionId !== state.sessionId) return false;
    const admission = this.leaderAdmissions?.get(request.requestId);
    if (!admission || admission.sessionId !== request.sessionId || admission.expectedCursor !== request.expectedCursor
      || admission.body !== request.body) return false;
    if (!this.isLeaderManagedSession(request.sessionId)) return false;
    return state.deliveries.some((entry) => entry.requestId === request.requestId && entry.status === 'sending' && entry.sessionId === request.sessionId);
  },

  leaderAdapterAvailable() {
    const adapter = this.leaderAdapter;
    return adapter?.capabilities?.atomicIdleDelivery === true && adapter.capabilities.nonHumanSource === true
      && typeof adapter.observe === 'function' && typeof adapter.deliver === 'function';
  },

  async prepareColdWorker(sessionId) {
    if (typeof this.leaderAdapter?.prepareWorker !== 'function') return { ok: false, error: '宿主不支持唤醒冷会话。' };
    const inspection = await this.inspectLeaderSession(sessionId);
    if (inspection.status !== 'active' || inspection.state.active || !quiet(inspection.state)) return { ok: true, status: 'unchanged' };
    this.markLeaderSideEffect();
    return this.leaderAdapter.prepareWorker(sessionId);
  },

  async resolveLeaderDelivery(request, actor = 'leader') {
    if (!validId(request.requestId) || !['delivered', 'not-delivered'].includes(request.resolution ?? request.outcome)) {
      return failure('必须提供 requestId 和 resolution（delivered/not-delivered）。', this.leaderProjection());
    }
    const entry = this.leaderState.deliveries.find((item) => item.requestId === request.requestId);
    if (!entry) return failure('找不到该投递记录。', this.leaderProjection());
    if (entry.status !== 'uncertain') return failure('只有“结果不确定”的投递可以人工核对；发送中的投递请等待其结束。', this.leaderProjection());
    const delivered = (request.resolution ?? request.outcome) === 'delivered';
    entry.status = delivered ? 'sent' : 'rejected';
    entry.resolvedBy = actor; entry.resolvedAt = Date.now();
    entry.error = delivered ? '' : '人类/Leader 核对确认未送达；不会自动重发。';
    await this.saveLeaderStrict();
    return success(clone(entry));
  },

  async workerReportRecord(request, identity) {
    if (this.leaderStorageFault) return failure('Leader journal 不可写，报告未记录。');
    const taskId = this.leaderTaskForSession(identity.sessionId);
    if (!taskId) return failure('调用会话不是当前插件创建的 worker。');
    if (Object.keys(request).some((key) => !['kind', 'text'].includes(key))) return failure('报告参数包含未知字段。');
    if (!LEADER_REPORT_KINDS.includes(request.kind)) return failure(`kind 必须是 ${LEADER_REPORT_KINDS.join('/')} 之一。`);
    if (typeof request.text !== 'string' || !request.text.trim()) return failure('text 不能为空。');
    if (request.text.length > LEADER_LIMITS.maxReportText) return failure(`text 不能超过 ${LEADER_LIMITS.maxReportText} 字。`);
    const text = request.text.trim();
    const previous = [...this.leaderState.reports].reverse().find((entry) => entry.taskId === taskId && entry.sessionId === identity.sessionId);
    if (previous && previous.kind === request.kind && previous.seen !== true && squash(previous.text) === squash(text)) {
      return success({ recorded: false, duplicate: true, reportId: previous.id, taskId });
    }
    const entry = { id: `report-${randomBytes(6).toString('hex')}`, taskId, sessionId: identity.sessionId, kind: request.kind,
      text, at: Date.now(), seen: false };
    this.leaderState.reports = [...this.leaderState.reports, entry].slice(-LEADER_LIMITS.maxReports);
    await this.saveLeaderStrict();
    return success({ recorded: true, reportId: entry.id, taskId, note: 'Leader 在下次 gitlab_leader_board 时读到；报告不改变你的授权，需要人类决定时仍在本会话直接提问。' });
  },
};
