import { buildIssueProjection, LEADER_LIMITS } from '../core.js';
import { errorMessage } from './util.js';

// v2.42 Leader autonomy: the Leader reads the human's whole assigned-Issue list and runs the
// supervision controls (enroll/pause/resume/budget/delivery check/start) itself, so the human only
// talks to the Leader session. Native approvals/questions stay human-only (Host cannot answer them).
const failure = (error, result = null) => ({ ok: false, result, error });
const success = (result) => ({ ok: true, result });
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
const clip = (value, limit) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
const validState = (state) => state && Number.isSafeInteger(state.cursor) && state.cursor >= 0
  && typeof state.active === 'boolean' && typeof state.running === 'boolean'
  && (state.queue === null || Array.isArray(state.queue)) && Array.isArray(state.pendingInput);
const quiet = (state) => validState(state) && !state.running && (state.queue === null || state.queue.length === 0) && state.pendingInput.length === 0;
const OPEN_DELIVERY = new Set(['sending', 'uncertain']);

export const LEADER_MANAGE_ACTIONS = Object.freeze(['enroll', 'unenroll', 'pause', 'resume', 'reset_budget', 'resolve_delivery', 'start', 'pause_leader']);
// Errors written by the pre-v2.42 Host that paused an Issue only to wait for a UI click.
export const LEGACY_HUMAN_GATE_ERRORS = Object.freeze([
  '日志增量超出有界补扫，证据已截断；停止推进，需 UI 人类核查后恢复。',
  '原生审批/问答等待人类；Leader 无权代答。',
  '投递已人工核对；确认无误后请显式恢复该 Issue。',
]);
export const LEADER_TRUNCATED_NOTE = '日志增量超出有界补扫，部分历史未读到；Host 已从最新位置重新同步，下次观察无新截断时自动清除。';
export const LEADER_PENDING_INPUT_NOTE = '原生审批/问答等待人类在 worker 会话内回答；Leader 无权代答，回答后自动恢复观察。';

export const leaderAutonomyMethods = {
  /** Every open Issue assigned to the human (Issue tab list), with session/enrollment state. */
  async listIssuesRecord(request = {}) {
    if (request.refresh !== undefined && typeof request.refresh !== 'boolean') return failure('refresh 必须是布尔值。');
    let refreshError = '';
    if (request.refresh === true) {
      try { await this.refreshIssues(); }
      catch (error) { refreshError = errorMessage(error).slice(0, 500); }
    }
    const projection = buildIssueProjection(this.state);
    const enrolled = new Map((this.leaderState?.items ?? []).map((item) => [item.taskId, item]));
    const completed = new Set((this.leaderState?.completed ?? []).map((entry) => entry.taskId));
    const issues = [...projection.items, ...projection.orphans].slice(0, 300).map((issue) => {
      const item = enrolled.get(issue.id);
      return { taskId: issue.id, iid: issue.url.match(/\/-\/(?:issues|work_items)\/(\d+)/u)?.[1] ?? null,
        title: clip(issue.title, 300), url: issue.url, project: issue.project ?? '', author: issue.author ?? '', state: issue.state ?? '',
        // listed=false: the Issue left the assigned-open list (closed/reassigned) but a session record remains.
        listed: !issue.missing, sessionId: issue.routed ? null : issue.sessionId, executionStatus: issue.executionStatus, archived: issue.archived,
        enrolled: Boolean(item), leaderStatus: item?.status ?? null, completed: completed.has(issue.id),
        next: item ? 'read_issue / continue' : issue.sessionId && !issue.archived && !issue.routed ? 'session_create(taskId) 纳管已有会话' : 'session_create(taskId) 新建 worker' };
    });
    return success({ lastIssuesAt: this.state?.lastIssuesAt ?? null, refreshed: request.refresh === true && !refreshError,
      ...(refreshError ? { refreshError } : {}), count: issues.length, issues, untrusted: true });
  },

  /** Supervision controls the human used to click in the UI; every action is audited. */
  async manageRecord(request) {
    const action = request.action;
    if (!LEADER_MANAGE_ACTIONS.includes(action)) return failure(`action 必须是 ${LEADER_MANAGE_ACTIONS.join('/')} 之一。`);
    const target = { taskId: request.taskId, sessionId: request.sessionId };
    let result;
    switch (action) {
      case 'enroll': result = await this.enrollLeaderIssue(target, 'leader'); break;
      case 'unenroll': result = await this.unenrollLeaderIssue(target); break;
      case 'pause': result = await this.pauseLeaderIssue(target); break;
      case 'resume': result = await this.resumeLeaderIssue(target); break;
      case 'reset_budget': result = await this.resetLeaderIssueBudget(target); break;
      case 'resolve_delivery':
        result = await this.resolveLeaderDelivery({ requestId: request.requestId, resolution: request.outcome }, 'leader'); break;
      case 'start': result = await this.startLeaderFromAgent(); break;
      case 'pause_leader': result = await this.pauseLeaderRecord(); break;
      default: return failure('不支持的 action。');
    }
    if (!result.ok) return failure(result.error);
    const item = target.taskId ? { taskId: target.taskId, sessionId: target.sessionId ?? null } : null;
    this.leaderAudit(`manage-${action}`, item, { ...(request.reason ? { reason: clip(request.reason, 500) } : {}),
      ...(request.requestId ? { requestId: request.requestId, outcome: request.outcome } : {}) });
    await this.saveLeaderStrict();
    const current = target.taskId ? this.leaderState.items.find((entry) => entry.taskId === target.taskId) : null;
    return success({ action, phase: this.leaderState.phase, enabled: this.leaderState.enabled, expiresAt: this.leaderState.expiresAt,
      ...(current ? { item: { taskId: current.taskId, sessionId: current.sessionId, status: current.status, paused: current.paused,
        error: current.error, actions: current.actions, maxActions: LEADER_LIMITS.maxActions, expiresAt: current.expiresAt } } : {}),
      note: action === 'start' || action === 'resume' || action === 'enroll' ? 'journal epoch 已变化：continue 前请重新 read_issue 取新 evidenceToken。' : undefined });
  },

  /**
   * The Leader renews its own run (e.g. after the 24h lease or wakeup budget ran out, or after a pause).
   * It is mid-turn, so no bootstrap brief is sent; uncertain notifications still block (never replayed).
   */
  async startLeaderFromAgent() {
    const state = this.leaderState;
    if (!state.sessionId || state.creation?.status !== 'ready') return failure('Leader 尚未完成设置。');
    if (this.leaderStorageFault || (state.phase === 'error' && state.error)) return failure(`Leader journal/设置故障，需人类修复：${state.error}`);
    if (state.outbox.some((entry) => entry.kind === 'notify' && OPEN_DELIVERY.has(entry.status))) return failure('有结果不确定的 Leader 通知；先用 resolve_delivery 核对。');
    if (!this.leaderAdapterAvailable()) return failure('unavailable：Leader 适配器不可用。');
    const renewed = state.enabled;
    await this.prepareColdWorkers(state.items.filter((item) => !item.paused));
    state.enabled = true; state.phase = 'ready'; state.epoch += 1; state.expiresAt = Date.now() + LEADER_LIMITS.leaseMs;
    state.wakeups = 0; state.error = ''; state.lastStartedAt = Date.now();
    for (const item of state.items) if (!item.paused && item.status === 'standby') item.status = 'watching';
    await this.saveLeaderStrict();
    if (!renewed) await this.executeLeaderReconcile(true);
    return state.enabled ? success(this.leaderProjection()) : failure(state.error || 'Leader 启动后立即停止。');
  },

  /** Pre-v2.42 journals: lift pauses that existed only to wait for a UI click; the condition itself is re-checked by observation. */
  liftLegacyHumanGates() {
    let changed = false;
    for (const item of this.leaderState?.items ?? []) {
      if (!item.paused || !LEGACY_HUMAN_GATE_ERRORS.includes(item.error)) continue;
      if (item.alerts.some((alert) => alert.status === 'pending')) continue;
      if (this.leaderState.outbox.some((entry) => entry.taskId === item.taskId && OPEN_DELIVERY.has(entry.status))) continue;
      item.paused = false; item.error = ''; item.status = this.leaderState.enabled ? 'watching' : 'standby';
      // Resync from the newest log position; the skipped history is gone either way.
      item.observation = null; item.cursor = null; item.logEpoch = null;
      changed = true;
    }
    return changed;
  },

  leaderAutonomyBriefLines() {
    return [
      '自主权：你可以自己决定做什么并去做，不需要人类在 UI 里点按钮。gitlab_leader_list_issues 读取人类被指派的全部 open Issue（refresh=true 先从 GitLab 刷新），用 session_create(taskId) 纳管已有会话或新建 worker；gitlab_leader_manage 处理托管控制：enroll/unenroll/pause/resume/reset_budget（Issue 预算或时限用完时自行重置）/resolve_delivery（先 read_issue 核对 worker 日志再判定 delivered/not-delivered）/start（本次托管时限或唤醒预算用完后自行续期）/pause_leader。',
      '仍只有人类能做：回答 worker 会话里的原生审批/问答（ask_user_question/权限确认）。遇到时告诉人类去对应 worker 会话回答，回答后 Host 自动恢复观察。',
    ];
  },
};

export { quiet as leaderQuiet, validId as leaderValidId };
