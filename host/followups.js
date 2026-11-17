import { mrApiPath, mrWatchState, targetKey } from '../core.js';
import { FOLLOW_UP_MAX_AGE_MS } from './constants.js';

/**
 * 续办生命周期：MR 事件监视（提前触发）、到期入队。
 * 挂到 GitlabTodoRuntime 原型上，this 指向运行时实例。
 */
export const followupsMethods = {

  /** 是否有别的插件会话正在同一个 Issue/MR 上执行。 */
  targetBusy(todo) {
    const key = targetKey(todo?.url);
    if (!key) return false;
    for (const tracked of this.trackedSessions.values()) {
      for (const todoId of tracked.todos.keys()) {
        if (todoId === todo.id) continue;
        const url = this.state.handled[todoId]?.url ?? this.state.pending[todoId]?.item?.url;
        if (targetKey(url) === key) return true;
      }
    }
    return false;
  },

  /**
   * 事件驱动续办：逐条核对“待续办 + waiting + openMrs”记录监视的 MR。
   * 状态从 running/未知翻转为流水线结果、合并或关闭时，把续办提前到本轮（nextAttemptAt=now），
   * 并清掉监视器（一次事件只触发一次；下一轮会话若仍 waiting 会重建）。
   * 定时续办不受影响，始终作为兜底。API 失败的 MR 跳过本轮。
   */
  async refreshWatches() {
    if (this.stopping) return { changed: false, triggered: false };
    let changed = false;
    let triggered = false;
    // 同一轮内按 API 路径去重：同一 MR 被多条记录监视时只请求一次。
    const detailCache = new Map();
    for (const record of Object.values(this.state.handled)) {
      if (record?.closure !== 'follow-up' || !Array.isArray(record.watch?.mrs) || record.watch.mrs.length === 0) continue;
      if (this.dispatches.has(record.id) || this.isTodoTracked(record.sessionId, record.id)) continue;
      let fired = false;
      for (const mrUrl of [...record.watch.mrs]) {
        const api = mrApiPath(mrUrl);
        if (!api) continue;
        let detail = detailCache.get(api);
        if (detail === undefined) {
          try {
            detail = JSON.parse(await this.runGlab(['api', '-X', 'GET', api]));
          } catch {
            detail = null;
          }
          detailCache.set(api, detail);
        }
        if (detail == null) continue;
        const state = mrWatchState(detail);
        const previous = record.watch.lastStates[mrUrl] ?? '';
        if (previous === state) continue;
        record.watch.lastStates[mrUrl] = state;
        changed = true;
        if (state === 'merged' || state === 'closed' || state.startsWith('pipeline:')) {
          fired = true;
          break;
        }
      }
      if (fired) {
        record.nextAttemptAt = Date.now();
        record.watch = null;
        triggered = true;
        this.logger.info(`Todo ${record.id} 等待的 MR 状态翻转，提前触发续办。`);
      }
    }
    return { changed, triggered };
  },

  /** 把到期的续办排进派发队列；同一对象上有别的会话在跑时顺延到下一轮。 */
  async enqueueFollowUps() {
    const now = Date.now();
    const queued = new Set(this.dispatchQueue.map((entry) => entry.todo.id));
    for (const record of Object.values(this.state.handled)) {
      if (record?.closure !== 'follow-up' || !record.sessionId) continue;
      if (!Number.isFinite(record.nextAttemptAt) || record.nextAttemptAt > now) continue;
      if (queued.has(record.id) || this.dispatches.has(record.id) || this.isTodoTracked(record.sessionId, record.id)) continue;
      const item = record.item ?? this.state.todos.find((todo) => todo.id === record.id) ?? null;
      if (!item) {
        record.closure = 'needs-human';
        record.closureNote = `${record.closureNote}；缺少 Todo 数据，无法续办`.replace(/^；/, '');
        record.nextAttemptAt = null;
        record.watch = null;
        await this.restoreNeedsHumanSession(record);
        continue;
      }
      // 链路超龄（如长期被同目标会话占住而无限顺延）：转需人工，不再自动续办。
      if (Date.now() - (record.firstAcceptedAt ?? record.acceptedAt ?? 0) > FOLLOW_UP_MAX_AGE_MS) {
        record.closure = 'needs-human';
        record.closureNote = `${record.closureNote}；超出自动续办时限，转人工接手`.replace(/^；/, '');
        record.nextAttemptAt = null;
        record.watch = null;
        await this.restoreNeedsHumanSession(record);
        continue;
      }
      if (this.targetBusy(item)) continue;
      this.dispatchQueue.push({ todo: item, followUp: true });
      queued.add(record.id);
    }
    this.ensureSessionTimer();
  },
};
