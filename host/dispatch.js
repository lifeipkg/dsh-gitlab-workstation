import { randomUUID } from 'node:crypto';
import {
  buildIssuePrompt,
  buildSessionTitle,
  buildWorkspaceOverview,
  isIssueItem,
  normalizeMrUrls,
  normalizeWorkspacePath,
} from '../core.js';
import { errorMessage } from './util.js';

/**
 * Issue 派发与面板动作：手动派发（幂等去重、pending/requestId 重试）、会话归档切换、
 * 工作区总览。挂到 GitlabTodoRuntime 原型上，this 指向运行时实例。
 */
export const dispatchMethods = {

  resolveWorkspaceId(configured = this.state.settings.issueSessionCwd) {
    const items = this.ctx.workspaceRegistry?.list?.() ?? [];
    if (configured) {
      const match = items.find((item) => normalizeWorkspacePath(item.path ?? item.cwd) === normalizeWorkspacePath(configured));
      if (match?.id) return match.id;
      throw new Error(`配置的工作区文件夹未在 DSH 工作区中注册：${configured}`);
    }
    let best;
    let bestAt = Number.NEGATIVE_INFINITY;
    for (const item of items) {
      const at = Date.parse(item.updatedAt);
      if (Number.isFinite(at) && at > bestAt) {
        best = item;
        bestAt = at;
      }
    }
    const workspaceId = best?.id ?? items[0]?.id;
    if (!workspaceId) throw new Error('DSH 尚未注册工作区，请先创建或选择一个工作区。');
    return workspaceId;
  },

  /** 插件自己派发过的会话（handled + pending），供工作区总览打标。 */
  pluginSessionRecords() {
    const records = [];
    for (const record of Object.values(this.state.handled)) {
      if (!record?.sessionId) continue;
      records.push({
        sessionId: record.sessionId,
        sessionTitle: record.sessionTitle,
        automatic: false,
        archived: record.archived === true,
        url: record.url,
      });
    }
    for (const record of Object.values(this.state.pending)) {
      if (!record?.sessionId) continue;
      records.push({
        sessionId: record.sessionId,
        sessionTitle: '',
        automatic: false,
        archived: false,
        url: record.item?.url ?? '',
      });
    }
    return records;
  },

  async workspaceOverview() {
    const workspaces = this.ctx.workspaceRegistry?.list?.() ?? [];
    let roster = [];
    try {
      const value = await this.host.listSessions();
      if (Array.isArray(value?.items)) roster = value.items;
    } catch {
      roster = [];
    }
    return buildWorkspaceOverview(workspaces, roster, this.pluginSessionRecords(), this.state.settings.issueSessionCwd);
  },

  /**
   * 按 id 找 Issue：先查 Issue 面板缓存，再回落到 handled/pending 里保存的快照
   * （列表刷新后仍可重新处理）。
   */
  itemById(id) {
    const key = String(id ?? '');
    if (!key) return null;
    const direct = Array.isArray(this.state.issues) ? this.state.issues.find((item) => item.id === key) : null;
    if (direct) return direct;
    return this.state.handled[key]?.item ?? this.state.pending[key]?.item ?? null;
  },

  async dispatchById(id) {
    const issue = this.itemById(id);
    if (!issue) return { ok: false, error: '当前列表中找不到该对象，请刷新后重试。' };
    if (!isIssueItem(issue)) return { ok: false, error: '只支持派发 Issue。' };
    return this.dispatch(issue, Boolean(this.state.handled[issue.id]));
  },

  /** 插件真正创建过的会话。 */
  pluginCreatedSessionIds() {
    const ids = new Set();
    for (const record of Object.values(this.state.handled)) {
      if (record?.sessionId) ids.add(record.sessionId);
      for (const entry of record?.history ?? []) if (entry?.sessionId) ids.add(entry.sessionId);
    }
    for (const record of Object.values(this.state.pending)) {
      if (record?.sessionId) ids.add(record.sessionId);
      for (const entry of record?.history ?? []) if (entry?.sessionId) ids.add(entry.sessionId);
    }
    return ids;
  },

  archivedSessionIds() {
    const ids = new Set();
    const raw = this.ctx.workspaceRegistry?.archivedSessionIds;
    try {
      const values = raw && typeof raw.list === 'function' ? raw.list() : raw;
      if (values && typeof values[Symbol.iterator] === 'function') {
        for (const id of values) if (typeof id === 'string') ids.add(id);
      }
    } catch {
      // 归档名册读取失败不影响主流程，但留一条调试日志便于排查“外部归档过滤失效”。
      this.logger.debug('读取工作区归档会话列表失败，跳过外部归档过滤。');
    }
    for (const record of Object.values(this.state.handled)) {
      if (record?.sessionId && record.archived === true) ids.add(record.sessionId);
      for (const entry of record?.history ?? []) {
        if (entry?.sessionId && entry.archived === true) ids.add(entry.sessionId);
      }
    }
    for (const record of Object.values(this.state.pending)) {
      for (const entry of record?.history ?? []) {
        if (entry?.sessionId && entry.archived === true) ids.add(entry.sessionId);
      }
    }
    return ids;
  },

  async dispatch(issue, force = false) {
    const existingSessionId = this.state.handled[issue.id]?.sessionId ?? this.state.pending[issue.id]?.sessionId;
    if (force && existingSessionId && this.isItemTracked(existingSessionId, issue.id)) {
      return { ok: false, error: '该 Issue 的 Session 仍在执行，请等待当前执行结束后再重新处理。' };
    }
    if (!force && this.state.handled[issue.id]) {
      return { ok: true, sessionId: this.state.handled[issue.id].sessionId, duplicate: true };
    }
    if (this.dispatches.has(issue.id)) return this.dispatches.get(issue.id);
    const operation = this.executeDispatch(issue, force).finally(() => {
      if (this.dispatches.get(issue.id) === operation) this.dispatches.delete(issue.id);
    });
    this.dispatches.set(issue.id, operation);
    return operation;
  },

  /**
   * 手动切换一个插件会话的归档状态（面板“最近会话”快捷操作）。
   * 只作用于插件自己派发过的会话；归档仍在执行的会话会被 Host 拒绝，原样把错误带回去。
   */
  async setSessionArchived(sessionId, archived) {
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: '缺少 sessionId。' };
    if (typeof archived !== 'boolean') return { ok: false, error: 'archived 必须是布尔值。' };
    let record = null;
    let historyEntry = null;
    for (const item of Object.values(this.state.handled)) {
      if (item?.sessionId === sessionId) {
        record = item;
        break;
      }
      const entry = item?.history?.find((candidate) => candidate.sessionId === sessionId);
      if (entry) {
        record = item;
        historyEntry = entry;
        break;
      }
    }
    if (!record) return { ok: false, error: '该会话不是插件创建的会话。' };
    const archiveState = historyEntry ?? record;
    if (archived && this.trackedSessions.has(sessionId)) {
      return { ok: false, error: '会话仍在执行，结算后再变更归档状态。' };
    }
    try {
      if (archived) await this.host.archiveSession(sessionId);
      else await this.host.unarchiveSession(sessionId);
      archiveState.archived = archived;
      archiveState.archiveError = '';
      await this.persistQuietly('会话归档状态');
      return { ok: true };
    } catch (error) {
      if (archived) archiveState.archiveError = errorMessage(error);
      await this.persistQuietly('会话归档状态');
      throw error;
    }
  },

  async executeDispatch(issue, force) {
    const pending = this.state.pending[issue.id];
    // pending 代表可能已被 Host 接受的消息；无论是否 force，都只能复用原会话与 requestId。
    let sessionId = pending?.sessionId ?? null;
    const previous = this.state.handled[issue.id];
    const continuing = Boolean(force && previous?.sessionId);
    const round = continuing ? (previous.round ?? 1) + 1 : 1;
    const firstAcceptedAt = continuing ? (previous.firstAcceptedAt ?? previous.acceptedAt) : Date.now();
    const history = continuing
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
    const ownMrs = continuing && Array.isArray(previous.openMrs) ? previous.openMrs : [];
    const sessionTitle = buildSessionTitle(issue);
    try {
      if (pending && !pending.requestId) {
        throw new Error('该 Issue 有旧版本留下的 pending 消息，缺少可用于幂等重试的 requestId。为避免重复执行，本次未重新投递；请先让插件完成原会话核对，无法确认时会转为需人工。');
      }
      // 已有会话不能用新 builder 虚构原标题；旧 pending 可能尚未保存标题。
      let effectiveTitle = sessionTitle;
      if (sessionId) {
        effectiveTitle = pending?.sessionTitle
          || (previous?.sessionId === sessionId ? previous.sessionTitle : '') || '';
        if (!effectiveTitle) {
          try {
            const projections = await this.host.invoke('projections', { sessionId });
            if (projections?.kind === 'sequenced' && Number.isSafeInteger(projections.asOfSeq)
              && projections.asOfSeq >= 0 && typeof projections.values?.title === 'string') {
              effectiveTitle = projections.values.title.trim();
            }
          } catch {
            // 标题缺失/查询失败不是删除证据，也不能触发 rename 或重新 create。
          }
        }
      }
      const requestId = pending && pending.sessionId === sessionId && pending.requestId
        ? pending.requestId
        : `gitlab-issue-${randomUUID()}`;
      const promptStartedAt = pending && pending.sessionId === sessionId && Number.isFinite(pending.createdAt)
        ? pending.createdAt
        : Date.now();
      let created = false;
      if (!sessionId) {
        const request = {
          workspaceId: this.resolveWorkspaceId(this.state.settings.issueSessionCwd),
        };
        if (typeof this.config.agentPreset === 'string' && this.config.agentPreset) {
          request.agentPreset = this.config.agentPreset;
        }
        sessionId = await this.host.createSession(request);
        created = true;
        this.trackSession(sessionId, issue.id, promptStartedAt, requestId);
        this.state.pending[issue.id] = {
          sessionId,
          createdAt: promptStartedAt,
          requestId,
          round,
          firstAcceptedAt,
          history,
          openMrs: [...ownMrs],
          automatic: false,
          item: issue,
        };
        await this.persistQuietly('pending Session');
        const renamed = await this.host.renameSession(sessionId, sessionTitle);
        if (typeof renamed?.title === 'string') {
          effectiveTitle = renamed.title;
          const currentPending = this.state.pending[issue.id];
          if (currentPending?.sessionId === sessionId && currentPending.requestId === requestId) {
            currentPending.sessionTitle = renamed.title;
            await this.persistQuietly('pending 会话标题');
          }
        }
      } else {
        this.trackSession(sessionId, issue.id, promptStartedAt, requestId);
      }
      if (created && this.state.settings.issueSessionModel) {
        await this.host.selectModel({
          sessionId,
          ...this.state.settings.issueSessionModel,
        });
      }
      await this.host.prompt({
        requestId,
        sessionId,
        mode: 'queue',
        content: [{
          type: 'text',
          text: buildIssuePrompt(issue),
        }],
      });
      const record = {
        id: issue.id,
        sessionId,
        outcome: 'session-accepted',
        executionStatus: 'running',
        requestId,
        sessionTitle: effectiveTitle,
        archived: false,
        archiveError: '',
        acceptedAt: Date.now(),
        title: issue.title,
        url: issue.url,
        project: issue.project,
        round,
        firstAcceptedAt,
        history,
        dispatchFailures: 0,
        // 手动派发的 Issue 会话不参与自动续办（与 HEAD 的 manual 派发 automatic:false 一致）。
        automatic: false,
        // 链路上累计的未合并 MR：没有新结案报告时沿用上一轮的记录。
        openMrs: normalizeMrUrls(ownMrs, issue.url),
        item: { ...issue, body: '' },
        closure: '',
        closureNote: '',
        nextAttemptAt: null,
        replied: null,
        reportStatus: '',
        reportSummary: '',
      };
      this.state.handled[issue.id] = record;
      delete this.state.pending[issue.id];
      this.state.recent = [record, ...this.state.recent.filter((item) => item.id !== issue.id)].slice(0, 50);
      this.state.lastDispatchError = null;
      await this.persistQuietly('已接受 Issue');
      this.logger.info(`派发 Issue ${issue.id} → 会话 ${sessionId}（${effectiveTitle}）。`);
      return { ok: true, sessionId, duplicate: false };
    } catch (error) {
      if (sessionId && !(!pending?.requestId && pending?.sessionId === sessionId)) this.untrackItem(sessionId, issue.id);
      this.state.lastDispatchError = `Issue ${issue.id} 创建或驱动 Session 失败：${errorMessage(error)}`;
      await this.persistQuietly('派发错误');
      this.logger.warn(`${this.state.lastDispatchError}`);
      return { ok: false, error: this.state.lastDispatchError, sessionId };
    }
  },
};
