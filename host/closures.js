import { assessClosure } from '../core.js';
import { FOLLOW_UP_MAX_AGE_MS } from './constants.js';
import { errorMessage } from './util.js';

/**
 * Issue 闭环裁决：回合结算后核对 GitLab 事实（Issue 是否已关闭），
 * 下结论 closed / follow-up / needs-human，并按结论归档。
 * 挂到 GitlabTodoRuntime 原型上，this 指向运行时实例。
 */
export const closuresMethods = {

  /**
   * 回合刚结算后立刻核对闭环：逐条读取 Issue 当前状态再裁决。
   * 读取失败不裁决，记录保持 verifying，留给下一次手动刷新或对账重试。
   */
  async verifySettled() {
    if (this.stopping) return;
    const fetchStartedAt = Date.now();
    if (await this.assessClosures(fetchStartedAt)) await this.persistQuietly('闭环核对');
  },

  /**
   * 闭环裁决。fetchStartedAt 之前结束的回合不裁决（状态核对可能早于回合结束）。
   * - verifying：回合结束后取得的 Issue 状态才裁决；取不到（null）则保持 verifying。
   * - follow-up：Issue 已关闭 → closed；仍开放则保持续办记录。
   * - needs-human：保持待人工确认，不自动闭环，也不自动续办。
   */
  async assessClosures(fetchStartedAt) {
    let changed = false;
    for (const record of Object.values(this.state.handled)) {
      if (!record?.sessionId || !record.closure) continue;
      if (this.isItemTracked(record.sessionId, record.id) || this.dispatches.has(record.id)) continue;
      if (record.closure === 'closed') {
        // 共享会话此前因其他任务未结算而跳过归档：这里每轮补偿重试，
        // 否则首条记录 closed 后会永远失去归档机会。
        const before = `${record.archived}|${record.archiveError}`;
        await this.archiveRecord(record);
        if (before !== `${record.archived}|${record.archiveError}`) changed = true;
        continue;
      }
      // 取消归档失败不能靠改标志掩盖：保留下轮重试；人工后来手动归档会清空该错误，不再强开。
      if (record.closure === 'needs-human' && record.archived === true
        && String(record.archiveError ?? '').startsWith('需人工会话取消归档失败')) {
        await this.restoreNeedsHumanSession(record);
        changed = true;
      }
      // 闭环事实只认“Issue 已关闭”：证明为 true 才算 closed，其余（仍开放、不可判定）按仍开放处理。
      const issueClosed = await this.issueIsClosed(record.item);
      const targetOpen = issueClosed !== true;
      if (record.closure === 'verifying') {
        if ((record.completedAt ?? 0) > fetchStartedAt) continue;
        if (issueClosed === null) continue;
        await this.concludeRecord(record, targetOpen);
        changed = true;
      } else if (!targetOpen && record.replied !== false && record.pendingUnconfirmed !== true) {
        record.closure = 'closed';
        record.closureNote = 'Issue 已关闭';
        record.nextAttemptAt = null;
        await this.archiveRecord(record);
        changed = true;
      }
    }
    return changed;
  },

  /** 对一条刚结算的记录下闭环结论，并按结论归档。 */
  async concludeRecord(record, targetOpen) {
    const settings = this.state.settings;
    const item = record.item ?? this.state.issues?.find((entry) => entry.id === record.id) ?? null;
    const round = record.round ?? 1;
    let followUpBlocked = '';
    if (record.automatic === false) followUpBlocked = '手动派发的会话不自动续办';
    else if (settings.followUpEnabled === false) followUpBlocked = '自动续办未开启';
    else if (round - 1 > settings.maxFollowUps) followUpBlocked = `已达自动补救轮数上限（补救 ${round - 1} 轮）`;
    else if (Date.now() - (record.firstAcceptedAt ?? record.acceptedAt) > FOLLOW_UP_MAX_AGE_MS) followUpBlocked = '超出自动续办时限';
    else if (!item) followUpBlocked = '缺少 Issue 数据，无法续办';
    const verdict = assessClosure({
      itemOpen: targetOpen,
      replied: null,
      turnOk: record.executionStatus === 'completed',
      turnError: record.executionError,
      report: record.reportStatus
        ? { status: record.reportStatus, summary: record.reportSummary, resumeAfterMinutes: record.resumeAfterMinutes }
        : null,
      round,
      followUpBlocked,
      baseDelayMinutes: settings.followUpDelayMinutes,
      unit: 'issue',
    });
    record.replied = null;
    record.closure = verdict.closure;
    record.closureNote = verdict.note;
    record.nextAttemptAt = verdict.closure === 'follow-up' ? Date.now() + verdict.delayMinutes * 60000 : null;
    this.logger.info(`闭环裁决 Issue ${record.id}：${verdict.closure}${verdict.note ? `（${verdict.note.slice(0, 120)}）` : ''}`);
    // 需人工接手的会话保留不归档；若上一轮 follow-up 已归档，必须真实取消归档。
    if (verdict.closure === 'needs-human') await this.restoreNeedsHumanSession(record);
    else await this.archiveRecord(record);
  },

  /** 确保 needs-human 可接手：只管理插件自己创建的会话；失败保留真实 archived 并留错误。 */
  async restoreNeedsHumanSession(record) {
    if (!record?.sessionId || record.archived !== true) return false;
    try {
      await this.host.unarchiveSession(record.sessionId);
      record.archived = false;
      record.archiveError = '';
      this.logger.info(`需人工会话 ${record.sessionId} 已取消归档，保留供人工接手。`);
      return true;
    } catch (error) {
      record.archiveError = `需人工会话取消归档失败：${errorMessage(error)}`.slice(0, 500);
      this.logger.warn(record.archiveError);
      return false;
    }
  },

  /** 归档一条记录的会话：需人工的记录不归档；共享会话还有其他任务时也不归档。 */
  async archiveRecord(record) {
    if (!record?.sessionId || record.archived || record.closure === 'needs-human') return;
    if (record.executionStatus !== 'completed' || this.state.settings.autoArchive === false) return;
    // 同会话的另一条记录可能已停但仍需人工，不能经 closed 主记录的补归档绕过保护。
    if (Object.values(this.state.handled).some((other) => other?.sessionId === record.sessionId
      && other.closure === 'needs-human' && !other.acknowledgedAt)) return;
    const tracked = this.trackedSessions.get(record.sessionId);
    if ([...tracked?.todos.keys() ?? []].some((itemId) => itemId !== record.id)) return;
    if (Object.values(this.state.pending).some((pending) => pending.sessionId === record.sessionId && pending.item?.id !== record.id)) return;
    try {
      await this.host.archiveSession(record.sessionId);
      record.archived = true;
      record.archiveError = '';
    } catch (archiveError) {
      // 归档失败不影响闭环结论；仍有工作在跑等拒绝只记录原因，不强行停止任何工作。
      record.archiveError = errorMessage(archiveError);
      this.logger.warn(`归档会话 ${record.sessionId} 失败：${record.archiveError}`);
    }
  },
};
