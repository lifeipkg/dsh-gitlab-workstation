import { isIssueItem } from '../core.js';
import { errorMessage } from './util.js';

const validId = (value) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/u.test(value);
const pendingInputs = new Set(['approval', 'question', 'other']);
const validState = (value) => value && Number.isSafeInteger(value.cursor) && value.cursor >= 0
  && typeof value.active === 'boolean' && typeof value.running === 'boolean'
  && (value.queue === null || Array.isArray(value.queue))
  && Array.isArray(value.pendingInput) && value.pendingInput.every((item) => pendingInputs.has(item));
const matchesSource = (record, id) => record && (record.sessionId === id || record.history?.some((entry) => entry.sessionId === id));

function handoffText(record, sourceSessionId) {
  return ['人工接手资料（仅供你审阅后发送；本操作未启动任务处理）：',
    `原任务：${record.url || record.item?.url || ''}`, `原会话：${sourceSessionId}`,
    record.closureNote && `此前状态：${record.closureNote}`, record.reportSummary && `此前摘要：${record.reportSummary}`,
    record.lastReply?.body && `此前回复：${record.lastReply.body.slice(0, 2000)}`,
    '原会话不存在（可能已删除），上述内容是历史快照；实际任务状态需重新核实。'].filter(Boolean).join('\n');
}

export const sessionEntryMethods = {
  async inspectSession(sessionId) {
    const result = (status, reason) => ({ sessionId: validId(sessionId) ? sessionId : '', status,
      ...(reason ? { reason } : {}), manualHandoffs: (this.state?.manualHandoffs ?? [])
        .filter((entry) => entry.sourceSessionId === sessionId || entry.sessionId === sessionId).map((entry) => ({ ...entry })) });
    if (!validId(sessionId)) return result('unknown', '无效会话 ID。');
    try {
      const state = await this.host.sessionState(sessionId);
      if (!validState(state)) return result('unknown', '宿主会话状态响应无效，未跳转。');
      const archived = this.ctx.workspaceRegistry?.archivedSessionIds;
      if (!Array.isArray(archived) || !archived.every((id) => typeof id === 'string')) return result('unknown', '无法读取宿主权威归档状态，未跳转。');
      return result(archived.includes(sessionId) ? 'archived' : 'active');
    } catch (error) {
      if (error?.isDSHRemoteError === true && error.code === 'session/not-found' && error.details?.sessionId === sessionId) return result('missing', '原会话不存在（可能已删除）。');
      return result('unknown', errorMessage(error).slice(0, 500));
    }
  },

  handoffTaskRecord(taskId, sourceSessionId) {
    const record = this.state.handled[taskId] ?? this.state.pending[taskId];
    return matchesSource(record, sourceSessionId) ? record : null;
  },

  bindHandoffRecord(taskId, entry) {
    this.state.manualHandoffs ??= [];
    const journalIndex = this.state.manualHandoffs.findIndex((item) => item.taskId === taskId && item.requestId === entry.requestId);
    if (journalIndex >= 0) this.state.manualHandoffs[journalIndex] = entry; else this.state.manualHandoffs.push(entry);
    const record = this.handoffTaskRecord(taskId, entry.sourceSessionId);
    if (!record) return false;
    record.manualHandoffs ??= [];
    const index = record.manualHandoffs.findIndex((item) => item.requestId === entry.requestId);
    if (index >= 0) record.manualHandoffs[index] = entry; else record.manualHandoffs.push(entry);
    return true;
  },

  async createHandoff(taskId, sourceSessionId, requestId) {
    if (!validId(taskId) || !validId(sourceSessionId) || !validId(requestId)) return { ok: false, error: '人工接手参数无效。' };
    if (!this.handoffTaskRecord(taskId, sourceSessionId)) return { ok: false, error: '任务与原会话不匹配，不能新建接手会话。' };
    this.handoffOperations ??= new Map();
    const inFlight = this.handoffOperations.get(taskId);
    if (inFlight) {
      if (inFlight.requestId === requestId && inFlight.sourceSessionId === sourceSessionId) return inFlight.promise;
      return { ok: false, error: '该任务的人工接手创建仍在执行，请等待结果。' };
    }
    const operation = this.createHandoffRecord(taskId, sourceSessionId, requestId);
    this.handoffOperations.set(taskId, { requestId, sourceSessionId, promise: operation });
    try { return await operation; } finally { this.handoffOperations.delete(taskId); }
  },

  async createHandoffRecord(taskId, sourceSessionId, requestId) {
    this.state.manualHandoffs ??= [];
    const journal = this.state.manualHandoffs;
    let entry = journal.find((item) => item.taskId === taskId && item.requestId === requestId);
    if (entry && entry.sourceSessionId !== sourceSessionId) return { ok: false, error: '接手请求 ID 已用于另一原会话。' };
    if (!entry) {
      const prior = [...journal].reverse().find((item) => item.taskId === taskId && item.sourceSessionId === sourceSessionId && item.sessionId);
      if (prior && (await this.inspectSession(prior.sessionId)).status !== 'missing') entry = prior;
    }
    const ambiguous = journal.find((item) => item.taskId === taskId && !item.sessionId && ['creating', 'creation-unknown'].includes(item.status));
    if (ambiguous) return { ok: false, error: '前次创建结果尚不确定，不能重复创建；请先核查宿主会话。', requestId: ambiguous.requestId };
    if (!entry?.sessionId) {
      const original = await this.inspectSession(sourceSessionId);
      if (original.status !== 'missing') return { ok: false, error: '只有明确不存在的原会话才能新建人工接手；请先核验或恢复原会话。', status: original.status };
      const record = this.handoffTaskRecord(taskId, sourceSessionId);
      if (!record) return { ok: false, error: '任务记录在核验期间改变，未创建会话。' };
      if (!entry && journal.filter((item) => item.taskId === taskId).length >= 50) return { ok: false, error: '该任务的接手历史达到上限，请先人工核对。' };
      let workspaceId;
      try { workspaceId = this.resolveWorkspaceId(isIssueItem(record.item) ? this.state.settings.issueSessionCwd : this.state.settings.sessionCwd); }
      catch (error) { return { ok: false, error: errorMessage(error) }; }
      entry ??= { taskId, requestId, sourceSessionId, sessionId: '', createdAt: Date.now(), status: 'prepared', handoffText: handoffText(record, sourceSessionId), error: '' };
      if (!journal.includes(entry)) journal.push(entry);
      this.bindHandoffRecord(taskId, entry);
      entry.status = 'creating';
      try { await this.persist(); } catch (error) { entry.status = 'prepared'; entry.error = `无法保存创建准备记录：${errorMessage(error)}`; return { ok: false, error: entry.error }; }
      if (!this.handoffTaskRecord(taskId, sourceSessionId)) {
        entry.status = 'prepared'; entry.error = '任务记录在保存期间改变，未创建会话。';
        await this.persist().catch(() => {}); return { ok: false, error: entry.error };
      }
      try {
        entry.sessionId = await this.host.createSession({ workspaceId, ...(this.config.agentPreset ? { agentPreset: this.config.agentPreset } : {}) });
        entry.status = 'created';
      } catch (error) {
        entry.status = 'creation-unknown'; entry.error = `创建结果不确定，禁止自动重建：${errorMessage(error)}`;
        this.bindHandoffRecord(taskId, entry);
        await this.persist().catch(() => {}); return { ok: false, error: entry.error, requestId };
      }
      this.bindHandoffRecord(taskId, entry);
      try { await this.persist(); } catch (error) {
        entry.error = `会话已创建但记录保存失败；重试必须复用此会话：${errorMessage(error)}`;
        this.bindHandoffRecord(taskId, entry);
        await this.persist().catch(() => {});
        return { ok: false, error: entry.error, sessionId: entry.sessionId, handoffText: entry.handoffText, requestId: entry.requestId, sourceSessionId };
      }
    }
    try {
      this.bindHandoffRecord(taskId, entry);
      await this.persist();
      const existing = await this.inspectSession(entry.sessionId);
      if (existing.status !== 'active') return { ok: false, error: existing.reason || '已创建的接手会话不可打开，请核验或恢复它。', status: existing.status, sessionId: entry.sessionId, handoffText: entry.handoffText, requestId: entry.requestId, sourceSessionId };
      const record = this.handoffTaskRecord(taskId, sourceSessionId);
      if (!record) return { ok: false, error: '任务记录已改变；新会话保留在接手历史，未启动任务处理。', sessionId: entry.sessionId, handoffText: entry.handoffText, requestId: entry.requestId, sourceSessionId };
      if (entry.status !== 'ready') {
        await this.host.renameSession(entry.sessionId, `${record.sessionTitle || record.title || 'GitLab 任务'} · 人工接手`);
        const model = isIssueItem(record.item) ? this.state.settings.issueSessionModel : this.state.settings.sessionModel;
        if (model) await this.host.selectModel({ sessionId: entry.sessionId, ...model });
        entry.status = 'ready'; entry.error = '';
        this.bindHandoffRecord(taskId, entry);
        await this.persist();
      }
      if (entry.error) { entry.error = ''; this.bindHandoffRecord(taskId, entry); await this.persist(); }
      return { ok: true, sessionId: entry.sessionId, handoffText: entry.handoffText, requestId: entry.requestId, sourceSessionId };
    } catch (error) {
      entry.error = `会话已创建，设置或保存失败；重试会复用它：${errorMessage(error)}`;
      this.bindHandoffRecord(taskId, entry);
      await this.persist().catch(() => {});
      return { ok: false, error: entry.error, sessionId: entry.sessionId, handoffText: entry.handoffText, requestId: entry.requestId, sourceSessionId };
    }
  },
};
