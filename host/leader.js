import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { buildIssueProjection, buildLeaderProjection, compactLeaderOutbox, DEFAULT_LEADER_AGENT_PRESET, initialLeaderState,
  isLeaderTaskId, LEADER_LIMITS, leaderItemKind, normalizeLeaderState, pruneCreatedEnrollments, validateLeaderSettings } from '../core.js';
import { errorMessage } from './util.js';
import { leaderToolMethods } from './leader-tools.js';
import { leaderOpsMethods } from './leader-ops.js';
import { leaderOrchestrationMethods } from './leader-orchestration.js';
import { LEADER_PENDING_INPUT_NOTE, LEADER_TRUNCATED_NOTE } from './leader-tools.js';

// These handles must be minted by trusted Host entry points, never from request JSON.
const callers = new WeakMap();
export function createLeaderUiCaller() {
  const caller = Object.freeze({}); callers.set(caller, { kind: 'ui' }); return caller;
}
export function createLeaderAgentCaller({ sessionId, agentId } = {}) {
  if (!validId(sessionId) || !validId(agentId)) throw new Error('真实 Agent 上下文缺少 sessionId/agentId。');
  const caller = Object.freeze({}); callers.set(caller, { kind: 'agent', sessionId, agentId }); return caller;
}
/** Enrolled worker session caller: may only call workerReport (gitlab_leader_report), never Leader/UI operations. */
export function createLeaderWorkerCaller({ sessionId, agentId } = {}) {
  if (!validId(sessionId) || !validId(agentId)) throw new Error('真实 worker Agent 上下文缺少 sessionId/agentId。');
  const caller = Object.freeze({}); callers.set(caller, { kind: 'worker', sessionId, agentId }); return caller;
}
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (error, result = null) => ({ ok: false, result, error });
const success = (result) => ({ ok: true, result });
const { maxEvents: MAX_EVENTS, maxOutbox: MAX_OUTBOX, maxOpenOutbox: MAX_OPEN_OUTBOX } = LEADER_LIMITS;
const OPEN_DELIVERY = new Set(['sending', 'uncertain']);
// Rule triage: only these transitions are worth a model wakeup. Plain running/watching churn,
// summaries and cursor movement are recorded silently and surface on the next real wakeup.
const WAKE_STATUSES = new Set(['needs-human', 'unknown', 'missing', 'archived']);
const OBSERVE_CONCURRENCY = 4;
const pendingAlertIds = (item) => item.alerts.filter((alert) => alert.status === 'pending').map((alert) => alert.id);
const leaderSignal = (item) => digest([item.status, item.error, pendingAlertIds(item)]);
const states = new Set(['approval', 'question', 'other']);
const validState = (state) => state && Number.isSafeInteger(state.cursor) && state.cursor >= 0
  && typeof state.active === 'boolean' && typeof state.running === 'boolean'
  && (state.queue === null || Array.isArray(state.queue)) && Array.isArray(state.pendingInput)
  && state.pendingInput.every((input) => states.has(input));
// active means a resident Agent, not a busy turn. Cold sessions have queue:null;
// native guarded delivery is only available for a live, truly idle Agent.
const quiet = (state) => validState(state) && !state.running
  && (state.queue === null || state.queue.length === 0) && state.pendingInput.length === 0;
const idle = (state) => quiet(state) && state.active && Array.isArray(state.queue);
const freeze = (value) => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const uiOperations = new Set(['snapshot', 'create', 'configure', 'start', 'pause', 'enroll', 'unenroll',
  'resolveDelivery', 'resolveCreation', 'resolveTask', 'handoff', 'cancelQueued']);
// The Leader agent's six basic tools (v2.43). Session targets are limited to plugin-created worker
// sessions (Issue/Todo workers, Leader ad-hoc tasks); never the Leader itself or human sessions. GitLab writes need gitlabWrite.
const agentOperations = new Set(['overview', 'inbox', 'read', 'session', 'note', 'gitlabApi', 'run']);
// Enrolled worker sessions (Issue workers and ad-hoc tasks) report to the Leader; this is their only operation.
const workerOperations = new Set(['workerReport']);

export const leaderMethods = {
  ...leaderToolMethods,
  ...leaderOpsMethods,
  ...leaderOrchestrationMethods,
  leaderFile() { return join(this.storageDirectory(), 'leader.json'); },

  async loadLeader() {
    // The journal may be loaded by agent/created before runtime.start(); migrate first either way.
    await this.prepareStorage?.();
    this.stopLeader();
    this.leaderJournalUnreadable = false;
    try { this.leaderState = normalizeLeaderState(JSON.parse(await readFile(this.leaderFile(), 'utf8'))); }
    catch (error) {
      this.leaderState = initialLeaderState();
      if (error?.code !== 'ENOENT') {
        this.leaderJournalUnreadable = true; this.leaderStorageFault = true;
        this.leaderState.phase = 'error'; this.leaderState.error = `读取 Leader journal 失败，未覆盖原文件；仅 Leader 停止：${errorMessage(error)}`;
        return this.leaderProjection();
      }
    }
    this.leaderStorageFault = false; this.leaderDurableAdmissions = new Set(); this.leaderPersistedSnapshot = null;
    // Restart never implicitly starts the Leader or replays an uncertain delivery.
    try { await this.saveLeaderStrict(); } catch { /* Leader-only failure; Todo remains usable. */ }
    return this.leaderProjection();
  },

  async persistLeader() {
    // Compact JSON; process-local read evidence is never durable (restart nulls it anyway).
    const snapshot = JSON.stringify(this.leaderState, (key, value) => key === 'observation' ? null : value);
    const operation = (this.leaderWriteChain ?? Promise.resolve()).catch(() => {}).then(async () => {
      // Identical bytes are already durable: skip the temp file, fsync and rename entirely.
      if (snapshot === this.leaderPersistedSnapshot) return;
      await mkdir(this.storageDirectory(), { recursive: true });
      const temporary = join(this.storageDirectory(), `leader-${process.pid}-${randomUUID()}.tmp`);
      let file;
      try {
        file = await open(temporary, 'wx', 0o600);
        await file.writeFile(snapshot, 'utf8'); await file.sync(); await file.close(); file = null;
        await rename(temporary, this.leaderFile());
        this.leaderPersistedSnapshot = snapshot;
      } catch (error) {
        this.leaderPersistedSnapshot = null;
        await file?.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error;
      }
    });
    this.leaderWriteChain = operation;
    return operation;
  },

  leaderProjection() { return buildLeaderProjection(this.leaderState ?? initialLeaderState()); },

  leaderExclusive(operation) {
    const pending = (this.leaderOperationChain ?? Promise.resolve()).catch(() => {}).then(operation);
    this.leaderOperationChain = pending;
    return pending;
  },

  stopLeader() {
    clearInterval(this.leaderTimer); this.leaderTimer = null;
  },

  ensureLeaderTimer() {
    if (this.stopping || !this.leaderState?.enabled || this.leaderStorageFault) { this.stopLeader(); return; }
    if (!this.leaderTimer) {
      const ms = Math.max(30000, Number(this.config?.leaderPollMs) || 60000);
      this.leaderTimer = setInterval(() => void this.reconcileLeader().catch((error) => this.logger?.warn?.(`Leader 观察失败：${errorMessage(error)}`)), ms);
      this.leaderTimer.unref?.();
    }
  },

  async saveLeaderStrict() {
    try {
      await this.persistLeader(); this.leaderStorageFault = false; this.leaderDurableEpoch = this.leaderState.epoch;
      this.syncLeaderWorkerTools();
    }
    catch (error) {
      this.leaderStorageFault = true; this.stopLeader();
      this.leaderState.enabled = false; this.leaderState.phase = 'error';
      this.leaderState.error = `Leader journal 落盘失败，已停止所有副作用：${errorMessage(error)}`;
      throw new Error(this.leaderState.error);
    }
  },

  /** Enrollment set changed (enroll/auto-enroll/unenroll/complete/handoff): add/remove gitlab_leader_report on resident workers. */
  syncLeaderWorkerTools(force = false) {
    const key = JSON.stringify([this.leaderState?.sessionId ?? null, ...(this.leaderState?.items ?? []).map((item) => item.sessionId)]);
    if (!force && key === this.leaderWorkerToolsKey) return undefined;
    this.leaderWorkerToolsKey = key;
    try {
      const pending = this.leaderAdapter?.refreshWorkerBindings?.();
      pending?.catch?.(() => {});
      return pending;
    } catch { return undefined; } // Best-effort: `when` re-checks enrollment on every call.
  },

  authorizeLeader(caller, operation) {
    const identity = caller && callers.get(caller);
    if (!identity) throw new Error('拒绝无可信身份的 Leader 调用。');
    if (identity.kind === 'worker') {
      if (!workerOperations.has(operation)) throw new Error('worker 会话只能向 Leader 报告，不能调用任何 Leader 或 UI 操作。');
      if (!validId(identity.sessionId) || !validId(identity.agentId) || identity.sessionId === this.leaderState?.sessionId
        || !this.isLeaderManagedSession(identity.sessionId)) throw new Error('调用会话不是当前已纳管的 worker。');
      return identity;
    }
    if (workerOperations.has(operation)) throw new Error('workerReport 仅限已纳管 worker 会话调用。');
    if (identity.kind === 'ui') {
      // Defense in depth beyond the RPC allow-list: Leader tools act as the Leader Agent, never as the human UI.
      if (!uiOperations.has(operation)) throw new Error('该操作仅限 Leader Agent 工具调用。');
      return identity;
    }
    if (!agentOperations.has(operation)) throw new Error('Leader Agent 不能修改 Leader 设置、创建 Leader 或交接。');
    if (identity.sessionId !== this.leaderState?.sessionId || !validId(identity.agentId)) throw new Error('调用 Agent 不属于当前 Leader 会话。');
    return identity;
  },

  async leaderOperation(operation, request = {}, caller) {
    try { this.authorizeLeader(caller, operation); }
    catch (error) { return failure(errorMessage(error)); }
    if (workerOperations.has(operation)) {
      // Workers never see the Leader projection (other Issues, settings, audit): strip it from every failure.
      if (this.leaderJournalUnreadable) return failure('Leader journal 不可用，报告未记录。');
      if (!request || typeof request !== 'object' || Array.isArray(request)) return failure('报告参数必须是对象。');
      const result = await this.leaderLockedOperation(operation, request, caller);
      return result.ok ? result : failure(result.error);
    }
    if (this.leaderJournalUnreadable && operation !== 'snapshot') return failure('Leader journal 未知/损坏；只读冻结，先人工修复再 reload，绝不覆盖或重新创建。', this.leaderProjection());
    if (!request || typeof request !== 'object' || Array.isArray(request)) return failure('Leader 参数必须是对象。');
    if (!uiOperations.has(operation) && !agentOperations.has(operation)) return failure('不支持的 Leader 操作；正式审批/问答仅限原生人类入口。');
    if (operation === 'session' && request.action === 'create') {
      // Dispatch awaits the Leader lock itself (enrollment), so it must start outside the lock.
      try { return await this.leaderCreateSessionRecord(request); }
      catch (error) { return failure(errorMessage(error), this.leaderProjection()); }
      finally { this.ensureLeaderTimer(); }
    }
    if (operation === 'overview') {
      // GitLab refresh can take up to the glab timeout; it only touches the Issue-tab cache, never the journal.
      let refreshError = '';
      if (request.refresh === true) {
        try { await this.refreshIssues?.(); } catch (error) { refreshError = errorMessage(error).slice(0, 500); }
      }
      const result = await this.leaderLockedOperation(operation, request, caller);
      if (result.ok && refreshError) result.result.refreshError = refreshError;
      return result;
    }
    if (operation === 'inbox' && request.refresh === true) {
      // Same as the Todo tab refresh (may auto-dispatch when enabled); dispatch takes the Leader lock itself.
      let refreshError = '';
      try { await this.poll?.('leader'); } catch (error) { refreshError = errorMessage(error).slice(0, 500); }
      const result = await this.leaderLockedOperation(operation, request, caller);
      if (result.ok && refreshError) result.result.refreshError = refreshError;
      return result;
    }
    if (operation === 'note' && request.complete !== undefined) {
      // Notes first, then completion: check under the lock, read GitLab facts outside it, re-validate and commit under the lock.
      const check = await this.leaderLockedOperation(operation, request, caller, { stage: 'check' });
      if (!check.ok) return check;
      let gitlab = null;
      if (check.result.kind === 'issue') {
        try { gitlab = await this.leaderIssueGitlab(check.result.taskId); }
        catch (error) { gitlab = { available: false, error: errorMessage(error) }; }
      }
      return await this.leaderLockedOperation(operation, request, caller, { stage: 'commit', gitlab });
    }
    if (operation === 'gitlabApi') {
      // GitLab calls run outside the journal lock; writes are reserved and committed under it.
      const check = await this.leaderLockedOperation(operation, request, caller, { stage: 'check' });
      if (!check.ok) return check;
      return await this.runLeaderGitlabApi(check.result, caller);
    }
    const result = await this.leaderLockedOperation(operation, request, caller);
    // GitLab reads can take up to the glab timeout; run them after releasing the journal lock.
    if (operation === 'read' && result.ok && result.result?.taskId && result.result.kind === 'issue') result.result.gitlab = await this.leaderIssueGitlab(result.result.taskId);
    return result;
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
          case 'snapshot': return this.leaderSnapshotRecord();
          case 'create': return await this.createLeaderRecord(request);
          case 'configure': return await this.configureLeader(request.settings ?? request);
          case 'start': return await this.startLeaderRecord();
          case 'pause': return await this.pauseLeaderRecord();
          case 'enroll': return await this.enrollLeaderIssue(request);
          case 'unenroll': return await this.unenrollLeaderIssue(request);
          case 'resolveDelivery': return await this.resolveLeaderDelivery(request);
          case 'resolveCreation': return await this.resolveLeaderCreation(request);
          case 'resolveTask': return await this.resolveLeaderTask(request);
          case 'handoff': return await this.handoffLeaderRecord(request);
          case 'cancelQueued': return await this.cancelLeaderQueued(request);
          case 'overview': return this.leaderOverviewRecord();
          case 'inbox': return this.leaderInboxRecord();
          case 'read': return await this.readIssueRecord(request);
          case 'session': return await this.leaderSessionRecord(request);
          case 'note': return await this.leaderNoteRecord(request, context);
          case 'gitlabApi': return await this.prepareLeaderGitlabApi(request, context);
          case 'run': return await this.leaderRunRecord(request);
          default: return failure('不支持的 Leader 操作。');
        }
      } catch (error) {
        // Failed pure journal writes never leave an in-memory permission grant for a later start.
        // Once a side effect began, retain known IDs/outbox; disk's preparing/sending tombstone prevents replay.
        if (sideEffects === (this.leaderSideEffectGeneration ?? 0)) {
          this.leaderState = before;
          if (this.leaderStorageFault) { this.leaderState.enabled = false; this.leaderState.phase = 'error'; this.leaderState.error = errorMessage(error); }
        }
        return failure(errorMessage(error), this.leaderProjection());
      }
      finally { this.ensureLeaderTimer(); }
    });
  },


  leaderIssueMapping(taskId, sessionId) {
    if (!validId(taskId) || !validId(sessionId) || sessionId === this.leaderState?.sessionId) return null;
    if (isLeaderTaskId(taskId)) {
      // Ad-hoc tasks map only through the Leader journal's own registry, never through the Issue list.
      const task = (this.leaderState?.tasks ?? []).find((entry) => entry.taskId === taskId && entry.status === 'created' && entry.sessionId === sessionId);
      return task ? { id: task.taskId, sessionId: task.sessionId, title: task.title, url: '', kind: 'task' } : null;
    }
    const projection = buildIssueProjection(this.state);
    const issue = [...projection.items, ...projection.orphans].find((item) => item.id === taskId && item.sessionId === sessionId && !item.routed);
    if (issue) return { ...issue, kind: 'issue' };
    return this.leaderTodoMapping(taskId, sessionId);
  },

  // Plugin-created Todo sessions (inbox dispatch): the handled/pending record is the only mapping authority.
  // Routed Todos live in someone else's session (human or Leader worker) and are never managed through this path.
  leaderTodoMapping(taskId, sessionId) {
    if (!validId(taskId) || /^issue-/u.test(taskId)) return null;
    const record = this.state?.handled?.[taskId] ?? this.state?.pending?.[taskId];
    if (!record || record.sessionId !== sessionId || record.routed === true) return null;
    const todo = (this.state?.todos ?? []).find((entry) => entry.id === taskId) ?? record.item ?? {};
    return { id: taskId, sessionId, title: String(record.title ?? todo.title ?? record.sessionTitle ?? '').slice(0, 1000),
      url: String(record.url ?? todo.url ?? ''), kind: 'todo', sessionTitle: record.sessionTitle ?? '' };
  },

  // Read-only overview of every Issue-tab session so the Leader chat can answer "how is everything".
  // It reads only main state (no logs, no delivery) and grants nothing: advancement still needs enrollment.
  leaderIssuesOverview() {
    const projection = buildIssueProjection(this.state);
    const enrolled = new Map((this.leaderState?.items ?? []).map((item) => [item.taskId, item]));
    return [...projection.items, ...projection.orphans].filter((item) => validId(item.sessionId) && !item.routed).slice(0, 200)
      .map((item) => ({ taskId: item.id, sessionId: item.sessionId, title: String(item.title ?? '').slice(0, 300), url: item.url ?? '',
        executionStatus: item.executionStatus, executionError: String(item.executionError ?? '').slice(0, 500), outcome: item.outcome,
        closure: item.closure, reportSummary: String(item.reportSummary ?? '').slice(0, 1000), archived: item.archived, missing: item.missing,
        enrolled: enrolled.get(item.id)?.sessionId === item.sessionId, leaderStatus: enrolled.get(item.id)?.sessionId === item.sessionId ? enrolled.get(item.id).status : null,
        untrusted: true }));
  },

  isLeaderManagedSession(sessionId) {
    return this.leaderState?.items.some((item) => item.sessionId === sessionId) === true;
  },

  leaderManagedItem(request, requireActive = false, allowStaleMapping = false) {
    // sessionId is optional: without it the taskId's current enrolled worker is used.
    if (!validId(request.taskId) || (request.sessionId !== undefined && !validId(request.sessionId))) throw new Error('必须提供原样 taskId（sessionId 可选）。');
    const item = this.leaderState.items.find((entry) => entry.taskId === request.taskId && (request.sessionId === undefined || entry.sessionId === request.sessionId));
    if (!item || (!allowStaleMapping && !this.leaderIssueMapping(item.taskId, item.sessionId))) throw new Error('会话未纳管或映射已改变（Issue/Todo/临时任务）；拒绝任意/历史会话 ID。');
    if (requireActive) {
      if (this.leaderState.outbox.some((entry) => (entry.taskId === item.taskId || entry.sessionId === item.sessionId) && ['sending', 'uncertain'].includes(entry.status))) throw new Error('该 Issue 有未确认投递；即使换 requestId 或解除后重选也不能重复推进。');
      if (this.stopping || this.leaderStorageFault) throw new Error('Leader journal 不可写或插件正在停止。');
    }
    return item;
  },

  async inspectLeaderSession(sessionId) {
    if (!validId(sessionId)) return { status: 'unknown', error: '无效会话 ID。', state: null };
    try {
      // Native projection includes continued/timed questions after the foreground wait.
      // Unenrolled UI candidates still use passive Host preflight; no grant/advance occurs here.
      const state = typeof this.leaderAdapter?.state === 'function'
        && (sessionId === this.leaderState?.sessionId || this.isLeaderManagedSession(sessionId))
        ? await this.leaderAdapter.state(sessionId) : await this.host.sessionState(sessionId);
      const archived = this.ctx.workspaceRegistry?.archivedSessionIds;
      if (!validState(state) || !Array.isArray(archived) || !archived.every((id) => typeof id === 'string')) {
        return { status: 'unknown', error: '宿主状态/权威归档 registry 不可验证。', state: null };
      }
      return { status: archived.includes(sessionId) ? 'archived' : 'active', state, error: '' };
    } catch (error) {
      if (error?.isDSHRemoteError === true && error.code === 'session/not-found' && error.details?.sessionId === sessionId) {
        return { status: 'missing', error: '原会话不存在；禁止自动重建或恢复。', state: null };
      }
      return { status: 'unknown', error: errorMessage(error).slice(0, 1000), state: null };
    }
  },

  bumpCreationPolicy() {
    const state = this.leaderState;
    state.creationPolicyEpoch += 1;
    state.createdEnrollments = pruneCreatedEnrollments(state.createdEnrollments, state.creationPolicyEpoch);
  },

  /**
   * Leader isolation preset. Unset config selects the bundled no-tool `gitlab-issue-leader`
   * preset (persona + compaction only; the five scoped tools are bound by the adapter).
   * `''`/null explicitly keeps the Host default preset. An explicit id must resolve.
   */
  async resolveLeaderPreset() {
    const configured = this.config?.leaderAgentPreset;
    if (configured === '' || configured === null) return null;
    const explicit = configured !== undefined;
    const wanted = explicit ? configured : DEFAULT_LEADER_AGENT_PRESET;
    if (!validId(wanted)) throw new Error('leaderAgentPreset 配置无效，未创建 Leader。');
    const registry = this.leaderServicesContext?.agentPresets;
    if (typeof registry?.resolve !== 'function') return explicit ? wanted : null;
    try {
      const resolved = await registry.resolve(wanted);
      if (resolved?.broken) throw new Error(`Leader preset ${wanted} 激活失败：${errorMessage(resolved.broken?.message ?? resolved.broken)}`);
      return wanted;
    } catch (error) {
      if (explicit) throw new Error(`Leader preset 不可用，未创建 Leader：${errorMessage(error)}`);
      this.logger?.warn?.(`内置 Leader preset 不可用，回退宿主默认 preset：${errorMessage(error)}`);
      return null;
    }
  },

  async createLeaderRecord(request) {
    const state = this.leaderState;
    const nextSettings = request.settings === undefined ? state.settings : validateLeaderSettings(request.settings, state.settings);
    if (state.enabled) return failure('请先暂停 Leader 再重新设置既有会话。');
    if (!state.sessionId && state.creation && ['creating', 'uncertain'].includes(state.creation.status)) {
      return failure('前次 Leader 创建结果不确定，禁止重复创建；请核查宿主。', this.leaderProjection());
    }
    if (!state.sessionId) {
      // Resolve before the creation tombstone: an unknown preset must fail cleanly, never latch.
      const agentPreset = await this.resolveLeaderPreset();
      if (nextSettings.autoEnrollNew !== state.settings.autoEnrollNew) { this.bumpCreationPolicy(); state.epoch += 1; }
      state.settings = nextSettings;
      const workspaceId = this.resolveWorkspaceId(this.state?.settings?.issueSessionCwd ?? '');
      state.creation = { requestId: validId(request.requestId) ? request.requestId : `leader-create-${randomUUID()}`, status: 'creating', createdAt: Date.now(),
        ...(agentPreset ? { agentPreset } : {}) };
      state.phase = 'uncertain';
      await this.saveLeaderStrict();
      try {
        this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
        const id = await this.host.createSession({ workspaceId, ...(agentPreset ? { agentPreset } : {}) });
        if (!validId(id) || this.isLeaderManagedSession(id)) throw new Error('宿主返回无效/冲突的 Leader ID。');
        state.sessionId = id; state.creation.status = 'created';
        await this.saveLeaderStrict();
      } catch (error) {
        state.creation.status = state.sessionId ? 'created' : 'uncertain';
        state.error = `Leader 创建/记录结果不确定，禁止自动重建：${errorMessage(error)}`;
        state.phase = state.sessionId ? 'error' : 'uncertain';
        await this.saveLeaderStrict();
        return failure(state.error, this.leaderProjection());
      }
    }
    const inspection = await this.inspectLeaderSession(state.sessionId);
    if (state.enabled) return failure('请先暂停 Leader 再重新设置既有会话。');
    if (inspection.status !== 'active' || !quiet(inspection.state)) {
      state.phase = inspection.status === 'unknown' ? 'uncertain' : 'error'; state.error = inspection.error || 'Leader 会话忙碌/已归档，未改变设置。';
      await this.saveLeaderStrict(); return failure(state.error, this.leaderProjection());
    }
    // Persist the known ID and desired configuration before all configuration side effects.
    if (nextSettings.autoEnrollNew !== state.settings.autoEnrollNew) { this.bumpCreationPolicy(); state.epoch += 1; }
    state.settings = nextSettings; state.creation.status = 'created';
    await this.saveLeaderStrict();
    try {
      this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
      await this.host.renameSession(state.sessionId, 'WorkStation Leader');
      if (state.settings.model) await this.host.selectModel({ sessionId: state.sessionId, ...state.settings.model });
      else if (state.configuredModel) {
        if (typeof this.leaderAdapter?.resetModel !== 'function') throw new Error('unavailable：无法核验重置 Leader 默认模型，保留原模型并报告失败。');
        await this.leaderAdapter.resetModel(state.sessionId);
      }
      state.configuredModel = clone(state.settings.model);
      state.creation.status = 'ready'; state.phase = 'ready'; state.error = ''; state.enabled = false;
      await this.saveLeaderStrict(); return success(this.leaderProjection());
    } catch (error) {
      state.phase = 'error'; state.error = `Leader 已创建；设置失败，重试复用已知 ID：${errorMessage(error)}`;
      await this.saveLeaderStrict(); return failure(state.error, this.leaderProjection());
    }
  },

  async configureLeader(settings) {
    const state = this.leaderState;
    const next = validateLeaderSettings(settings, state.settings);
    const modelChanged = digest(next.model) !== digest(state.sessionId ? (state.configuredModel ?? null) : state.settings.model);
    if (state.enabled && modelChanged) return failure('请先暂停 Leader 再更换模型。');
    if (modelChanged && state.sessionId) {
      const inspection = await this.inspectLeaderSession(state.sessionId);
      if (inspection.status !== 'active' || !quiet(inspection.state)) return failure('Leader 状态不可验证/忙碌，未更换模型。');
    }
    if (next.autoEnrollNew !== state.settings.autoEnrollNew) this.bumpCreationPolicy();
    state.settings = next; state.epoch += 1; await this.saveLeaderStrict();
    if (modelChanged && state.sessionId) {
      try {
        this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
        // null is explicitly reset by the adapter; the native selectModel API cannot silently fake a reset.
        if (next.model) await this.host.selectModel({ sessionId: state.sessionId, ...next.model });
        else if (typeof this.leaderAdapter?.resetModel === 'function') await this.leaderAdapter.resetModel(state.sessionId);
        else throw new Error('unavailable：宿主尚无已核验的 Leader 默认模型重置能力。');
        state.configuredModel = clone(next.model);
        state.error = state.creation?.status === 'ready' ? '' : 'Leader 设置尚未完成，请重试设置复用已知会话；不会重复创建。';
        state.phase = 'paused'; await this.saveLeaderStrict();
      } catch (error) { state.error = errorMessage(error); state.phase = 'error'; await this.saveLeaderStrict(); return failure(state.error, this.leaderProjection()); }
    }
    return success(this.leaderProjection());
  },

  validateLeaderAdmission(request) {
    const state = this.leaderState;
    if (!state || this.stopping || this.leaderStorageFault || this.leaderDurableEpoch !== state.epoch
      || request.epoch !== state.epoch || request.leaderSessionId !== state.sessionId) return false;
    const entry = state.outbox.find((entry) => entry.requestId === request.requestId);
    if (!entry || entry.status !== 'sending' || !this.leaderDurableAdmissions?.has(entry.requestId)
      || entry.sessionId !== request.sessionId || entry.body !== request.body || entry.expectedCursor !== request.expectedCursor
      || entry.epoch !== request.epoch || (entry.taskId ?? null) !== request.taskId) return false;
    // Wake notifications need a running Leader; Leader sends to its workers work while it is paused
    // (paused only stops automatic wakes).
    if (entry.kind === 'notify') return state.enabled && request.sessionId === state.sessionId;
    const item = state.items.find((item) => item.taskId === entry.taskId && item.sessionId === entry.sessionId);
    return Boolean(item && item.status !== 'unknown' && this.leaderIssueMapping(item.taskId, item.sessionId));
  },

  leaderAdapterAvailable() {
    const adapter = this.leaderAdapter;
    return adapter?.capabilities?.atomicIdleDelivery === true && adapter.capabilities.nonHumanSource === true
      && typeof adapter.observe === 'function' && typeof adapter.deliver === 'function' && typeof adapter.notify === 'function';
  },

  async startLeaderRecord() {
    const state = this.leaderState;
    if (!state.sessionId || state.creation?.status !== 'ready') return failure('请先创建并完成 Leader 设置。');
    if (state.enabled) return success(this.leaderProjection());
    if (state.phase === 'error' && state.error) return failure('Leader 设置/保存尚未修复，请先显式重试 create/configure。');
    // Explicit UI start may prepare only the Leader. Cold workers are never activated by observation.
    await this.saveLeaderStrict();
    if (typeof this.leaderAdapter?.prepare === 'function') {
      this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
      const prepared = await this.leaderAdapter.prepare(state.sessionId);
      if (prepared?.ok !== true) return failure(prepared?.error || 'unavailable：Leader 无法安全恢复为 resident Agent。');
    }
    if (typeof this.leaderAdapter?.refreshBindings === 'function' && await this.leaderAdapter.refreshBindings() !== true) return failure('unavailable：Leader 原生 scoped 绑定未完成。');
    // Native capabilities become available only after binding a prepared resident Leader.
    if (!this.leaderAdapterAvailable()) return failure('unavailable：未提供已核验的非 human、原子 idle CAS Leader 适配器，绝不退回 session/prompt。');
    const inspection = await this.inspectLeaderSession(state.sessionId);
    if (inspection.status !== 'active' || !idle(inspection.state)) return failure('Leader 忙碌/等待原生输入/归档/缺失/未知，不能开始。');
    if (state.outbox.some((entry) => entry.kind === 'notify' && OPEN_DELIVERY.has(entry.status))) return failure('Leader 通知 outbox 结果不确定，需人工核对，不能自动续办。');
    // The explicit human start also wakes quiet cold workers so guarded idle CAS can reach them.
    await this.prepareColdWorkers(state.items);
    state.enabled = true; state.phase = 'ready'; state.epoch += 1; state.wakeups = 0; state.error = '';
    state.lastStartedAt = Date.now();
    for (const item of state.items) if (item.status === 'standby') item.status = 'watching';
    await this.saveLeaderStrict();
    let delivered;
    try {
      await this.executeLeaderReconcile(true);
      if (!state.enabled) return failure(state.error, this.leaderProjection());
      delivered = await this.deliverLeaderBootstrap(inspection.state.cursor);
    } catch (error) { delivered = failure(errorMessage(error)); }
    if (delivered.ok) return success(this.leaderProjection());
    // A run without a delivered bootstrap is not a running Leader. deliverLeaderOutbox already
    // froze uncertain receipts (phase uncertain); a known rejection rolls back to paused.
    if (state.enabled) {
      this.stopLeader();
      state.enabled = false; state.phase = 'paused'; state.epoch += 1;
      for (const item of state.items) if (item.status === 'watching') item.status = 'standby';
      state.error = `Leader 启动简报未送达，已回退为暂停；可重新启动：${String(delivered.error ?? '').slice(0, 500)}`;
      try { await this.saveLeaderStrict(); } catch { /* saveLeaderStrict already froze Leader on storage fault. */ }
    } else {
      for (const item of state.items) if (item.status === 'watching') item.status = 'standby';
      try { await this.saveLeaderStrict(); } catch { /* saveLeaderStrict already froze Leader on storage fault. */ }
    }
    return failure(state.error || delivered.error, this.leaderProjection());
  },

  async deliverLeaderBootstrap(expectedCursor) {
    const state = this.leaderState;
    // deliverLeaderOutbox re-inspects and CAS-checks this cursor before the native send.
    const entry = this.prepareLeaderOutbox({ kind: 'notify', sessionId: state.sessionId,
      requestId: `leader-bootstrap-${state.epoch}-${randomUUID()}`, epoch: state.epoch, expectedCursor,
      // leaderHandoffLines is set only while a UI handoff restarts the run on the new Leader session.
      body: [this.leaderHandoffLines ? '[WorkStation Leader 非人类交接简报；UI 人类已显式交接 Leader 会话，托管保持运行]' : '[WorkStation Leader 非人类启动简报；UI 人类已显式开始本次托管]',
        ...this.leaderBriefLines(),
        JSON.stringify(state.items.map((item) => ({ taskId: item.taskId, sessionId: item.sessionId, url: item.url, title: item.title,
          status: item.status, summary: item.summary, error: item.error,
          alerts: item.alerts.filter((alert) => alert.status === 'pending') }))).slice(0, 12000), ...(this.leaderHandoffLines ?? [])].join('\n') });
    state.wakeups += 1; await this.saveLeaderStrict();
    const delivered = await this.deliverLeaderOutbox(entry);
    return delivered.ok ? success(this.leaderProjection()) : failure(delivered.error, this.leaderProjection());
  },

  /** Wake quiet cold workers from a trusted path. Failures are per-Issue and never block others. */
  async prepareColdWorkers(items) {
    if (typeof this.leaderAdapter?.prepareWorker !== 'function') return;
    for (const item of items) {
      const inspection = await this.inspectLeaderSession(item.sessionId);
      if (inspection.status !== 'active' || inspection.state.active || !quiet(inspection.state)) continue;
      this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
      const prepared = await this.leaderAdapter.prepareWorker(item.sessionId);
      item.error = prepared?.ok === true ? '' : `worker 冷会话激活失败：${String(prepared?.error ?? '未知').slice(0, 500)}`;
    }
  },

  async pauseLeaderRecord() {
    this.stopLeader(); const state = this.leaderState;
    state.enabled = false; state.phase = state.sessionId ? 'paused' : 'not-created'; state.epoch += 1;
    for (const item of state.items) if (item.status === 'watching') item.status = 'standby';
    for (const entry of state.outbox) if (entry.status === 'prepared') entry.status = 'cancelled';
    await this.saveLeaderStrict(); return success(this.leaderProjection());
  },

  async enrollLeaderIssue(request, actor = 'ui') {
    const state = this.leaderState;
    const mapping = this.leaderIssueMapping(request.taskId, request.sessionId);
    if (!mapping) return failure('只能 UI 显式选入 Issue tab 当前关联的独立 worker 会话；ID/任务不匹配或发生路由。');
    const existing = state.items.find((item) => item.taskId === request.taskId || item.sessionId === request.sessionId);
    if (existing) return existing.taskId === request.taskId && existing.sessionId === request.sessionId ? success(this.leaderProjection()) : failure('已有另一显式映射；先由 UI 解除托管，不自动接管 handoff。');
    if (state.items.length >= 200) return failure('纳管会话达到 200 个上限。');
    const inspection = await this.inspectLeaderSession(request.sessionId);
    if (inspection.status !== 'active') return failure('会话归档/缺失/未知，未选入。');
    state.items.push({ taskId: request.taskId, kind: leaderItemKind({ taskId: request.taskId, kind: mapping.kind }), sessionId: request.sessionId, title: mapping.title, url: mapping.url,
      status: state.enabled ? 'watching' : 'standby', summary: '', error: '', alerts: [], enrolledAt: Date.now(),
      provenance: { kind: actor === 'leader' ? 'leader' : 'ui', createdAt: Date.now() }, cursor: null, logEpoch: null, observation: null,
      notificationFingerprint: '', pendingWake: [] });
    state.epoch += 1; await this.saveLeaderStrict(); return success(this.leaderProjection());
  },

  // Internal dispatch hook, never an agent/UI operation. Main-state creation proof must be
  // stamped at actual create under the then-durable policy and persisted before this call.
  autoEnrollLeaderCreated(taskId, sessionId) {
    return this.leaderExclusive(async () => {
      const state = this.leaderState;
      if (!state || this.leaderJournalUnreadable || this.leaderStorageFault || state.settings.autoEnrollNew !== true
        || this.leaderDurableEpoch !== state.epoch || !Number.isSafeInteger(state.creationPolicyEpoch)
        || state.creationPolicyEpoch < 0) return failure('新建默认托管策略尚未严格落盘或已关闭。');
      const record = [this.state?.handled?.[taskId], this.state?.pending?.[taskId]].find((record) => record?.sessionId === sessionId
        && record.leaderCreatedSession === sessionId && record.leaderCreatedPolicyEpoch === state.creationPolicyEpoch);
      const mapping = this.leaderIssueMapping(taskId, sessionId);
      if (!record || !mapping) return failure('缺少当前 policy epoch 下真实新建的已落盘 Issue provenance；不追溯纳管。');
      state.createdEnrollments = pruneCreatedEnrollments(state.createdEnrollments, state.creationPolicyEpoch);
      if (state.createdEnrollments.some((entry) => entry.taskId === taskId && entry.sessionId === sessionId)) return success(this.leaderProjection());
      if (state.createdEnrollments.length >= LEADER_LIMITS.maxCreatedEnrollments) return failure('新建来源 journal 已达上限，请人工核查。');
      const existing = state.items.find((item) => item.taskId === taskId || item.sessionId === sessionId);
      if (existing && (existing.taskId !== taskId || existing.sessionId !== sessionId)) return failure('已有另一显式映射，禁止自动 handoff。');
      if (!existing && state.items.length >= 200) return failure('纳管会话达到上限。');
      const inspection = await this.inspectLeaderSession(sessionId);
      if (inspection.status !== 'active') return failure('真实新建会话不可验证，未自动选入。');
      const before = clone(state);
      try {
        state.createdEnrollments.push({ taskId, sessionId, epoch: state.epoch, creationPolicyEpoch: state.creationPolicyEpoch, createdAt: Date.now() });
        if (!existing) state.items.push({ taskId, kind: leaderItemKind({ taskId, kind: mapping.kind }), sessionId, title: mapping.title, url: mapping.url,
          // The Leader is the human's single progress window: a new Issue joins as standby while the
          // Leader is paused and becomes watched on the next explicit start, without a per-Issue resume.
          status: state.enabled ? 'watching' : 'standby', summary: '', error: '', alerts: [],
          enrolledAt: Date.now(), provenance: { kind: 'created', taskId, sessionId, epoch: state.epoch, creationPolicyEpoch: state.creationPolicyEpoch, createdAt: Date.now() },
          cursor: null, logEpoch: null, observation: null, notificationFingerprint: '', pendingWake: [] });
        state.epoch += 1; await this.saveLeaderStrict();
        return success(this.leaderProjection());
      } catch (error) {
        this.leaderState = before; this.leaderState.enabled = false; this.leaderState.phase = 'error'; this.leaderState.error = errorMessage(error);
        return failure(errorMessage(error), this.leaderProjection());
      }
    });
  },

  async unenrollLeaderIssue(request) {
    const item = this.leaderManagedItem(request, false, true);
    this.leaderState.items = this.leaderState.items.filter((entry) => entry !== item); this.leaderState.epoch += 1;
    for (const entry of this.leaderState.outbox) if (entry.taskId === item.taskId && entry.status === 'prepared') entry.status = 'cancelled';
    await this.saveLeaderStrict(); return success(this.leaderProjection());
  },

  async resolveLeaderDelivery(request, actor = 'ui') {
    const state = this.leaderState;
    if (!validId(request.requestId) || !['delivered', 'not-delivered'].includes(request.resolution)) return failure('必须提供 requestId 和 resolution（delivered/not-delivered）。');
    const entry = state.outbox.find((candidate) => candidate.requestId === request.requestId);
    if (!entry) return failure('找不到该投递记录。');
    if (entry.status !== 'uncertain') return failure('只有“结果不确定”的投递可以人工核对；发送中的投递请等待其结束。');
    // The human looked at the target session and states what happened; nothing is resent either way.
    const previousError = entry.error;
    entry.status = request.resolution === 'delivered' ? 'sent' : 'rejected';
    entry.resolvedBy = actor === 'leader' ? 'leader' : 'ui'; entry.resolvedAt = Date.now();
    entry.error = request.resolution === 'delivered' ? '' : '人类核对确认未送达；不会自动重发。';
    if (entry.kind === 'notify' && state.phase === 'uncertain' && state.sessionId
      && !state.outbox.some((candidate) => candidate.kind === 'notify' && OPEN_DELIVERY.has(candidate.status))) {
      state.phase = state.creation?.status === 'ready' ? 'paused' : 'error'; state.error = '';
    }
    if (entry.taskId) {
      const item = state.items.find((candidate) => candidate.taskId === entry.taskId && candidate.sessionId === entry.sessionId);
      if (item && previousError && item.error === previousError) item.error = '';
      if (item && item.status === 'unknown') { item.status = state.enabled ? 'watching' : 'standby'; item.error = '投递已核对；下一次观察会刷新该 worker 状态。'; }
    }
    state.epoch += 1; await this.saveLeaderStrict(); return success(this.leaderProjection());
  },

  async resolveLeaderCreation(request) {
    const state = this.leaderState;
    if (state.enabled) return failure('请先暂停 Leader。');
    if (state.sessionId || !state.creation || !['creating', 'uncertain'].includes(state.creation.status)) return failure('当前没有结果不确定的 Leader 创建记录。');
    if (request.resolution === 'abandon') {
      // The human verified no Leader exists (or chooses to leave a stray one). Keep an audit trail.
      state.abandonedCreations = [...(state.abandonedCreations ?? []), { requestId: state.creation.requestId,
        createdAt: state.creation.createdAt ?? null, abandonedAt: Date.now() }].slice(-LEADER_LIMITS.maxAbandonedCreations);
      state.creation = null; state.phase = 'not-created'; state.error = ''; state.epoch += 1;
      await this.saveLeaderStrict(); return success(this.leaderProjection());
    }
    if (request.resolution !== 'claim' || !validId(request.sessionId)) return failure('resolution 必须是 abandon，或 claim 并提供人类核实的 Leader 会话 ID。');
    if (this.isLeaderManagedSession(request.sessionId)) return failure('该会话已被纳管为 worker，不能作为 Leader。');
    const issues = buildIssueProjection(this.state);
    if ([...issues.items, ...issues.orphans].some((item) => item.sessionId === request.sessionId)) return failure('该会话属于某个 Issue worker，不能作为 Leader。');
    const inspection = await this.inspectLeaderSession(request.sessionId);
    if (inspection.status !== 'active' || !quiet(inspection.state)) return failure('该会话不存在/已归档/忙碌/不可验证，未认领。');
    state.sessionId = request.sessionId; state.creation.status = 'created'; state.creation.claimedAt = Date.now();
    state.error = ''; state.epoch += 1;
    await this.saveLeaderStrict();
    // Reuse the normal setup path (rename/model) against the claimed ID; never creates another.
    return this.createLeaderRecord({});
  },

  async observeLeaderItem(item, options = {}) {
    const inspection = await this.inspectLeaderSession(item.sessionId);
    if (!this.leaderIssueMapping(item.taskId, item.sessionId)) { item.status = 'unknown'; item.error = '会话映射已改变，禁止自动纳管新会话。'; return []; }
    // An unresolved delivery keeps the worker 'unknown' until resolve_delivery; it is never resent.
    if (this.leaderState.outbox.some((entry) => entry.taskId === item.taskId && entry.sessionId === item.sessionId && entry.status === 'uncertain')) {
      item.status = 'unknown'; return [];
    }
    if (inspection.status !== 'active') {
      item.status = inspection.status; item.error = inspection.error; item.observation = null;
      return [];
    }
    const previous = item.observation;
    item.observation = { state: clone(inspection.state), cursor: inspection.state.cursor, epoch: this.leaderState.epoch, observedAt: Date.now() };
    // A native approval/question is answered by the human inside the worker session. It blocks delivery
    // (idle() requires no pendingInput) but no longer pauses the Issue: observation resumes on its own.
    if (inspection.state.pendingInput.length) { item.status = 'needs-human'; item.error = LEADER_PENDING_INPUT_NOTE; }
    else if (item.error === LEADER_PENDING_INPUT_NOTE) item.error = '';
    if (!inspection.state.pendingInput.length) item.status = idle(inspection.state) ? 'watching'
      : inspection.state.running || (inspection.state.queue?.length ?? 0) > 0 ? 'running'
        : !inspection.state.active && quiet(inspection.state) ? 'cold' : 'unknown';
    // A Leader-recorded needsHuman question keeps the status visible until the Leader passes an answer on.
    if (item.status === 'watching' && (item.alerts ?? []).some((alert) => alert.status === 'pending')) item.status = 'needs-human';
    // A quiet cold worker is a normal state (e.g. after DSH restart), not an error: an explicit
    // start/resume or a Leader advance activates it from a trusted path before delivery.
    if (item.status === 'cold' && item.error.startsWith('unavailable：worker 为冷会话')) item.error = '';
    if (typeof this.leaderAdapter?.observe !== 'function') { item.status = 'unknown'; item.observation = null; item.error = 'unavailable：无有界日志观察适配器。'; return []; }
    let value;
    try { value = await this.leaderAdapter.observe(item.sessionId, item.cursor); }
    catch (error) { item.status = 'unknown'; item.observation = null; item.error = errorMessage(error).slice(0, 1000); return []; }
    const valid = value && Number.isSafeInteger(value.cursor) && value.cursor >= 0
      && Number.isSafeInteger(value.highWater) && value.highWater >= value.cursor && Array.isArray(value.events)
      && value.events.length <= MAX_EVENTS && typeof value.truncated === 'boolean'
      && (value.epoch === undefined || typeof value.epoch === 'string')
      && value.events.every((event) => Number.isSafeInteger(event?.seq) && event.seq > (item.cursor ?? -1) && event.seq <= value.cursor && typeof event.type === 'string');
    if (!valid || (item.cursor !== null && value.cursor < item.cursor) || (item.logEpoch !== null && (value.epoch ?? null) !== item.logEpoch)) {
      item.status = 'unknown'; item.observation = null; item.error = '日志游标倒退/epoch 改变/增量响应无效，禁止续办。'; return [];
    }
    const baseline = item.cursor === null;
    item.cursor = baseline ? value.highWater : value.cursor; item.logEpoch = value.epoch ?? null;
    item.observation.logCursor = item.cursor; item.observation.logEpoch = item.logEpoch; item.observation.truncated = value.truncated;
    if (baseline) { item.lastActivityAt ??= Date.now(); if (inspection.state.active && item.status !== 'needs-human') item.error = ''; return []; }
    // Stall detection keys off real log activity, not reconcile ticks.
    if (value.events.length) { item.lastActivityAt = Date.now(); item.stallNotifiedAt = null; }
    // Truncation only records a note; the cursor already resynced to the newest position (no pause).
    if (value.truncated) item.error = LEADER_TRUNCATED_NOTE;
    else if (item.error === LEADER_TRUNCATED_NOTE) item.error = '';
    const events = value.events.map((event) => ({ seq: event.seq, time: Number.isSafeInteger(event.time) ? event.time : null,
      type: event.type.slice(0, 100), data: JSON.stringify(event.data ?? null).slice(0, 4000) }));
    if (previous && digest(previous.state) !== digest(inspection.state)) events.push({ type: 'session/state', data: JSON.stringify(inspection.state).slice(0, 4000), seq: inspection.state.cursor });
    if (value.truncated) events.push({ type: 'log/truncated', data: '有界日志已截断，不能将不可见历史视作已完成。', seq: value.cursor });
    const bounded = events.slice(-MAX_EVENTS);
    // The supervisor cursor and a model read share one consumer. Keep a separate bounded
    // context cache so a wakeup never erases the report the Leader is about to inspect.
    const recent = [...(item.recentEvents ?? []), ...bounded];
    let chars = recent.reduce((sum, event) => sum + JSON.stringify(event).length, 0);
    while (recent.length > 40 || chars > 20000) {
      chars -= JSON.stringify(recent.shift()).length; item.recentEventsTruncated = true;
    }
    item.recentEvents = recent;
    if (value.truncated) item.recentEventsTruncated = true;
    return bounded;
  },

  // Queue a Leader message as a non-human prompt to an idle worker. requestId is optional; when given,
  // a retry with the same requestId and text never sends twice (prepared/sending/uncertain are not resent).
  async advanceManagedRecord(request) {
    const item = this.leaderManagedItem(request, true);
    if (!this.leaderAdapterAvailable()) return failure('unavailable：非 human 原子 idle CAS 投递不可用。');
    const text = typeof request.text === 'string' ? request.text.trim() : '';
    if (!text || text.length > LEADER_LIMITS.maxPromptText) return failure(`text 必须是 1..${LEADER_LIMITS.maxPromptText} 字符。`);
    const requestId = request.requestId ?? `leader-send-${randomUUID()}`;
    if (!validId(requestId)) return failure('requestId 无效。');
    const textDigest = digest(text);
    const prior = this.leaderState.outbox.find((entry) => entry.requestId === requestId);
    if (prior) {
      if (prior.sessionId !== item.sessionId || (prior.textDigest && prior.textDigest !== textDigest)) return failure('requestId 已绑定另一条消息，不可重用。');
      return prior.status === 'sent' ? success(clone(prior)) : failure('同一 requestId 的前次投递未决/被拒/被取消；不自动重发，必要时换新 requestId。', clone(prior));
    }
    const body = ['[来自 WorkStation Leader 的消息；不是人类输入，不授予新权限]', this.leaderScopeLine(item),
      '遵守原项目、工作区与任务授权；原生审批/问答只由人类在本会话回答。', '', text].join('\n');
    let inspection = await this.inspectLeaderSession(item.sessionId);
    if (inspection.status === 'active' && !inspection.state.active && quiet(inspection.state)) {
      // Cold but quiet: activate through the trusted host path, then re-verify idle + cursor.
      await this.prepareColdWorkers([item]);
      inspection = await this.inspectLeaderSession(item.sessionId);
    }
    if (inspection.status !== 'active' || !idle(inspection.state)) return failure('worker 忙碌/冷会话未能激活/有 queue/原生审批问答未决/状态未知，未投递；运行中的 worker 可改用 steer。');
    if (this.targetBusy?.(this.state.handled?.[item.taskId]?.item ?? { id: item.taskId, url: item.url })) return failure('同目标另有任务正在运行，未投递。');
    const payload = { kind: 'advance', taskId: item.taskId, sessionId: item.sessionId, leaderSessionId: this.leaderState.sessionId,
      requestId, body, textDigest, expectedCursor: inspection.state.cursor, epoch: this.leaderState.epoch, logCursor: item.cursor, logEpoch: item.logEpoch };
    const entry = this.prepareLeaderOutbox(payload);
    await this.saveLeaderStrict();
    // Revalidate the exact explicit mapping after persistence; native delivery must still CAS idle atomically.
    if (!this.leaderIssueMapping(item.taskId, item.sessionId)) { entry.status = 'cancelled'; await this.saveLeaderStrict(); return failure('保存期间 Issue 映射改变，未投递。'); }
    const result = await this.deliverLeaderOutbox(entry);
    // A Leader message to the worker is how a human answer recorded via needsHuman gets passed on.
    if (result.ok) { for (const alert of item.alerts ?? []) if (alert.status === 'pending') alert.status = 'acknowledged'; await this.saveLeaderStrict(); }
    return result;
  },

  prepareLeaderOutbox(payload) {
    // Terminal entries are compacted (bodies stripped, oldest dropped); only unresolved
    // deliveries count toward the hard stop, so a long-running Leader never wedges itself.
    this.leaderState.outbox = compactLeaderOutbox(this.leaderState.outbox);
    const open = this.leaderState.outbox.filter((entry) => !['sent', 'rejected', 'cancelled'].includes(entry.status)).length;
    if (open >= MAX_OPEN_OUTBOX || this.leaderState.outbox.length >= MAX_OUTBOX) throw new Error('Leader 未决投递达到上限，停止自动动作，需人工核对。');
    const entry = { ...clone(payload), fingerprint: digest(payload), status: 'prepared', createdAt: Date.now(), error: '' };
    this.leaderState.outbox.push(entry); return entry;
  },

  async deliverLeaderOutbox(entry) {
    if ((!this.leaderState.enabled && entry.kind === 'notify') || this.leaderStorageFault || entry.epoch !== this.leaderState.epoch || entry.status !== 'prepared') return failure('Leader 已暂停、epoch 过期或 outbox 非可投递态。');
    const method = entry.kind === 'advance' ? 'deliver' : entry.kind === 'relay' ? 'relay' : 'notify';
    if (typeof this.leaderAdapter?.[method] !== 'function') {
      entry.status = 'rejected'; entry.error = `unavailable：适配器缺少 ${method}，未投递。`; await this.saveLeaderStrict(); return failure(entry.error, clone(entry));
    }
    const inspection = await this.inspectLeaderSession(entry.sessionId);
    if (inspection.status !== 'active' || !idle(inspection.state) || inspection.state.cursor !== entry.expectedCursor) {
      entry.status = 'rejected'; entry.error = '投递前会话忙碌/输入未决/游标变化/不可验证。'; await this.saveLeaderStrict(); return failure(entry.error, clone(entry));
    }
    entry.status = 'sending'; await this.saveLeaderStrict();
    this.leaderDurableAdmissions ??= new Set(); this.leaderDurableAdmissions.add(entry.requestId);
    try {

      this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
      const result = await this.leaderAdapter[method](freeze({ sessionId: entry.sessionId, leaderSessionId: this.leaderState.sessionId,
        taskId: entry.taskId ?? null, requestId: entry.requestId, body: entry.body, expectedCursor: entry.expectedCursor,
        epoch: entry.epoch, logCursor: entry.logCursor ?? null, logEpoch: entry.logEpoch ?? null }));
      if (result?.ok !== true || result.status !== 'delivered' || result.requestId !== entry.requestId) {
        if (result?.ok === false && result.status === 'rejected') { entry.status = 'rejected'; entry.error = String(result.error ?? '投递明确拒绝。').slice(0, 1000); }
        else { entry.status = 'uncertain'; entry.error = '非 human 投递回执不可验证；禁止自动重发。'; }
      } else { entry.status = 'sent'; entry.sentAt = Date.now(); entry.error = ''; }
    } catch (error) { entry.status = 'uncertain'; entry.error = `投递结果不确定，禁止重发：${errorMessage(error)}`; }
    this.leaderDurableAdmissions.delete(entry.requestId);
    if (entry.status === 'uncertain') {
      if (entry.taskId) { const item = this.leaderState.items.find((item) => item.taskId === entry.taskId); if (item) { item.status = 'unknown'; item.error = entry.error; } }
      else { this.leaderState.enabled = false; this.leaderState.phase = 'uncertain'; this.leaderState.error = entry.error; }
    }
    await this.saveLeaderStrict();
    return entry.status === 'sent' ? success(clone(entry)) : failure(entry.error, clone(entry));
  },

  reconcileLeader() {
    if (this.leaderReconcilePromise) return this.leaderReconcilePromise;
    // After fresh observations, freed running slots start queued Leader requests (FIFO; never while paused).
    const operation = this.leaderExclusive(() => this.executeLeaderReconcile()).then(async (result) => {
      try { await this.drainLeaderQueue(); } catch (error) { this.logger?.warn?.(`Leader 排队出队失败：${errorMessage(error)}`); }
      return result;
    }).finally(() => { if (this.leaderReconcilePromise === operation) this.leaderReconcilePromise = null; this.ensureLeaderTimer(); });
    this.leaderReconcilePromise = operation; return operation;
  },

  async executeLeaderReconcile(baselineOnly = false) {
    const state = this.leaderState;
    if (!state?.enabled || this.stopping || this.leaderStorageFault) return success(this.leaderProjection());
    const leader = await this.inspectLeaderSession(state.sessionId);
    if (leader.status !== 'active') { state.enabled = false; state.phase = leader.status === 'unknown' ? 'uncertain' : 'paused'; state.error = leader.error || 'Leader 已归档。'; await this.saveLeaderStrict(); return failure(state.error); }
    if (!this.leaderAdapterAvailable()) { state.enabled = false; state.phase = 'error'; state.error = 'unavailable：安全 Leader 适配器不可用。'; await this.saveLeaderStrict(); return failure(state.error); }
    // Observe with bounded concurrency; results are merged in item order so journals stay deterministic.
    const observed = new Array(state.items.length);
    let next = 0;
    const worker = async () => {
      while (next < state.items.length) {
        const index = next++; const item = state.items[index];
        observed[index] = await this.observeLeaderItem(item, { light: true });
      }
    };
    await Promise.all(Array.from({ length: Math.min(OBSERVE_CONCURRENCY, state.items.length) }, worker));
    for (const [index, item] of state.items.entries()) {
      const events = observed[index] ?? [];
      item.pendingWake = Array.isArray(item.pendingWake) ? item.pendingWake : [];
      const signal = leaderSignal(item);
      // Rule triage: only transitions the Leader can act on wake the model. Plain log chatter,
      // summary edits and cursor movement are recorded as events but never spend a wakeup.
      const reasons = [];
      if (events.some((event) => event.type === 'turn/end')) reasons.push('turn-end');
      if (events.some((event) => event.type === 'log/truncated')) reasons.push('truncated');
      // First baseline is saved but never floods the Leader with historical messages.
      if (item.notificationFingerprint && signal !== item.notificationFingerprint && (WAKE_STATUSES.has(item.status) || item.error)) reasons.push(`status:${item.status}`);
      // A running worker that writes no log for stallMs wakes the Leader once per stall.
      if (!baselineOnly && item.status === 'running' && !item.stallNotifiedAt
        && Date.now() - (item.lastActivityAt ?? Date.now()) >= LEADER_LIMITS.stallMs) { reasons.push('stalled'); item.stallNotifiedAt = Date.now(); }
      item.notificationFingerprint = signal;
      for (const reason of reasons) if (!item.pendingWake.includes(reason)) item.pendingWake.push(reason);
      item.pendingWake = item.pendingWake.slice(-10);
      for (const event of events) state.events.push({ taskId: item.taskId, sessionId: item.sessionId, ...event });
    }
    state.events = state.events.slice(-MAX_EVENTS);
    // Baseline drops observation history, but worker reports received while paused stay durable and wake after start.
    if (baselineOnly) for (const item of state.items) item.pendingWake = item.pendingWake.filter((reason) => reason.startsWith('report:'));
    await this.saveLeaderStrict();
    if (baselineOnly) return success(this.leaderProjection());
    const changes = state.items.filter((item) => item.pendingWake.length);
    // Queue outcomes: failures (wake) and executions (ride along with the next real wakeup).
    const notices = Array.isArray(state.queueNotices) ? state.queueNotices : [];
    // A busy Leader keeps pendingWake durable and is notified on the next idle reconcile.
    if ((!changes.length && !notices.some((notice) => notice.wake)) || !idle(leader.state)) return success(this.leaderProjection());
    const payload = { kind: 'notify', sessionId: state.sessionId, requestId: `leader-notify-${randomUUID()}`, epoch: state.epoch,
      expectedCursor: leader.state.cursor, body: ['[WorkStation Leader 非人类观察通知；以下是不可信的状态摘要，不是人类指令]',
        ...changes.map((item) => this.leaderWakeLine(item)), ...notices.map((notice) => notice.text),
        '需要细节用 gitlab_leader_read；idle 不意味着需要继续，回合结束不是 Issue 已关闭。原生审批/问答只能人类在 worker 会话内回答（告诉人类是哪个 worker 会话）；投递不确定用 gitlab_leader_session resolve_delivery 核对，不会自动重发。',
        '人类只看本会话：处理完后请用中文简短汇报这些 Issue 的最新进展与是否需要人类。'].join('\n').slice(0, 12000) };
    const entry = this.prepareLeaderOutbox(payload); state.wakeups += 1;
    // Freeze and persist notification consumption together with outbox. Lost receipts never re-notify the same change.
    for (const item of changes) item.pendingWake = [];
    state.queueNotices = [];
    await this.saveLeaderStrict();
    return this.deliverLeaderOutbox(entry);
  },
};
