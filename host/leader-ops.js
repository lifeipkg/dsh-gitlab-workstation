import { createHash, randomUUID } from 'node:crypto';
import { isLeaderTaskId, issueApiPath, LEADER_LIMITS, LEADER_OPS_LIMITS, leaderBlockedBy, normalizeLeaderNotes,
  validateLeaderSettings } from '../core.js';
import { errorMessage } from './util.js';

// Leader operating tools: steer a running worker, hand the Leader chat over to a fresh session,
// and post opt-in progress comments on managed GitLab Issues. Mixed into leaderMethods.
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (error, result = null) => ({ ok: false, result, error });
const success = (result) => ({ ok: true, result });
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const clip = (value, max) => { const text = String(value ?? '').replace(/\s+/gu, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const OPEN_DELIVERY = new Set(['sending', 'uncertain']);
const pendingInputs = new Set(['approval', 'question', 'other']);
const validState = (state) => state && Number.isSafeInteger(state.cursor) && typeof state.running === 'boolean'
  && Array.isArray(state.pendingInput) && state.pendingInput.every((input) => pendingInputs.has(input));
const quiet = (state) => validState(state) && !state.running
  && (state.queue === null || (Array.isArray(state.queue) && state.queue.length === 0)) && state.pendingInput.length === 0;
const minutesLeft = (since, interval) => Math.max(1, Math.ceil((since + interval - Date.now()) / 60000));
// A structured Host error means the Host answered and refused; anything else (timeout, transport) is uncertain.
const hostRejected = (error) => error?.isDSHRemoteError === true;
// glab reports HTTP 4xx refusals explicitly; those requests were answered, not lost.
const gitlabRejected = (error) => error?.beforeRequest === true || /\b(?:HTTP\s*)?(?:400|401|403|404|405|409|413|422)\b/u.test(errorMessage(error));

export const STEER_HEADER = '[GitLab Issue Leader 纠偏引导；不是人类输入，不授予新权限]';

export const leaderOpsMethods = {
  /** Extra lines for the start/handoff brief describing the ops tools (comment line follows the setting). */
  leaderOpsBriefLines() {
    const settings = this.leaderState?.settings ?? {};
    return [
      `纠偏：worker 正在运行但方向明显偏离/做无用功时，用 gitlab_leader_steer（taskId、sessionId、text、reason）在其当前回合下一步插入简短引导；每个 Issue ${LEADER_OPS_LIMITS.steerIntervalMs / 60000} 分钟至多 1 次并计入推进预算。空闲 worker 用 continue；等待原生审批/问答时不能纠偏；纠偏只调整方向，不新增目标、不解除护栏。`,
      settings.issueComments === true
        ? `Issue 评论：人类已开启。gitlab_leader_issue_comment（taskId、body）可在已纳管 GitLab Issue 上发进度评论；每个 Issue ${LEADER_OPS_LIMITS.commentIntervalMs / 60000} 分钟至多 1 条、本次托管至多 ${LEADER_OPS_LIMITS.maxCommentsPerItem} 条，Host 自动追加签名。只写已核实的事实进展，不承诺时间、不 @ 无关人员、不代替 worker 回复评审。`
        : 'Issue 评论：人类未开启（面板设置），gitlab_leader_issue_comment 会被拒绝；不要以其他方式代发 GitLab 评论。',
    ];
  },

  // ---------------------------------------------------------------- steer

  /** Inject a direction-correcting note into a RUNNING managed worker's current turn (Host mode 'steer'). */
  async steerIssueRecord(request) {
    if (!boundedText(request.text, 2000)) return failure('text 必须是 1–2000 字符的纠偏内容。');
    if (!boundedText(request.reason, 500)) return failure('reason 必须是 1–500 字符的纠偏理由。');
    const state = this.leaderState;
    const item = this.leaderManagedItem(request, true);
    const blockedBy = leaderBlockedBy(item, state.completed);
    if (blockedBy.length > 0) return failure(`该 Issue 依赖未完成（${blockedBy.join(', ')}），不能纠偏。`);
    const requestId = `leader-steer-${digest([item.taskId, item.sessionId, request.text]).slice(0, 40)}`;
    if (item.lastSteerRequestId === requestId) {
      if (item.lastSteerStatus === 'sent') return success({ requestId, status: 'sent', duplicate: true, actions: item.actions, maxActions: LEADER_LIMITS.maxActions });
      if (item.lastSteerStatus === 'uncertain' || item.lastSteerStatus === 'sending') return failure('同一纠偏投递结果不确定，禁止自动重发；请人类在 worker 会话核查。');
    }
    if (item.lastSteerAt !== null && item.lastSteerAt !== undefined && Date.now() - item.lastSteerAt < LEADER_OPS_LIMITS.steerIntervalMs) {
      return failure(`同一 Issue ${LEADER_OPS_LIMITS.steerIntervalMs / 60000} 分钟内至多纠偏 1 次；约 ${minutesLeft(item.lastSteerAt, LEADER_OPS_LIMITS.steerIntervalMs)} 分钟后再试，或等它停下后用 continue。`);
    }
    const inspection = await this.inspectLeaderSession(item.sessionId);
    if (inspection.status !== 'active' || !validState(inspection.state)) return failure(inspection.error || 'worker 会话已归档/缺失/状态不可验证，不能纠偏。');
    if (inspection.state.pendingInput.length > 0) return failure('worker 正在等待原生审批/问答，只能由人类在 worker 会话内回答；不能纠偏。');
    if (!inspection.state.running) return failure('worker 当前没有运行中的回合；空闲会话请用 gitlab_leader_continue 续办，纠偏仅用于运行中的 worker。');
    const text = [STEER_HEADER,
      `范围：${this.leaderScopeLine(item)}`,
      `理由：${request.reason.trim()}`,
      '遵守原任务授权，只调整方向，不新增目标、不解除护栏；与人类指示冲突时以人类为准。',
      '',
      request.text.trim()].join('\n');
    // Reserve the budget and rate slot durably before the send, so a crash never re-steers for free.
    const previous = { lastSteerAt: item.lastSteerAt ?? null, lastSteerRequestId: item.lastSteerRequestId ?? null, lastSteerStatus: item.lastSteerStatus ?? null };
    item.actions += 1; item.lastSteerAt = Date.now(); item.lastSteerRequestId = requestId; item.lastSteerStatus = 'sending';
    await this.saveLeaderStrict();
    this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
    try {
      await this.host.prompt({ requestId, sessionId: item.sessionId, mode: 'steer', content: [{ type: 'text', text }] });
    } catch (error) {
      if (hostRejected(error)) {
        // The Host answered and refused: nothing was injected, so the reservation is refunded.
        item.actions = Math.max(0, item.actions - 1); Object.assign(item, previous);
        this.leaderAudit('steer', item, { requestId, status: 'rejected', reason: clip(request.reason, 200), error: clip(errorMessage(error), 300) });
        await this.saveLeaderStrict();
        return failure(`宿主拒绝纠偏（未扣预算）：${errorMessage(error)}`);
      }
      item.lastSteerStatus = 'uncertain';
      this.leaderAudit('steer-uncertain', item, { requestId, reason: clip(request.reason, 200), error: clip(errorMessage(error), 300) });
      await this.saveLeaderStrict();
      return failure(`纠偏投递结果不确定，已计入预算且不会自动重发；请人类在 worker 会话核查：${errorMessage(error)}`);
    }
    item.lastSteerStatus = 'sent'; item.lastActivityAt = Date.now();
    this.leaderAudit('steer', item, { requestId, status: 'sent', reason: clip(request.reason, 200), text: clip(request.text, 300) });
    await this.saveLeaderStrict();
    return success({ requestId, status: 'sent', mode: 'steer', actions: item.actions, maxActions: LEADER_LIMITS.maxActions });
  },

  // ---------------------------------------------------------------- handoff

  /**
   * UI-only: replace the Leader chat session with a fresh one (same preset/workspace/model rules as
   * create) while keeping the whole journal. A running Leader is resumed on the new session with a
   * handoff brief; a paused one stays paused. The old session is archived best-effort.
   */
  async handoffLeaderRecord(request) {
    const state = this.leaderState;
    if (Object.keys(request).some((key) => key !== 'model')) return failure('交接只接受可选的 model 参数。');
    if (!state.sessionId || state.creation?.status !== 'ready') {
      return failure(state.creation && ['creating', 'uncertain'].includes(state.creation.status)
        ? '前次 Leader 创建结果不确定，禁止交接/重复创建；请先在面板处理创建记录。'
        : '请先创建并完成 Leader 设置，再交接。', this.leaderProjection());
    }
    if (this.leaderStorageFault || this.stopping) return failure('Leader journal 未严格落盘或插件正在停止，不能交接。');
    if (state.outbox.some((entry) => OPEN_DELIVERY.has(entry.status))) return failure('存在发送中/结果不确定的 Leader 投递，先人工核对（resolveDelivery）后再交接。', this.leaderProjection());
    const nextSettings = request.model === undefined ? state.settings : validateLeaderSettings({ model: request.model }, state.settings);
    const oldId = state.sessionId;
    const inspection = await this.inspectLeaderSession(oldId);
    const gone = inspection.status === 'archived' || inspection.status === 'missing';
    if (!gone && (inspection.status !== 'active' || !quiet(inspection.state))) {
      return failure('Leader 会话正在运行、有排队/待答输入或状态不可验证；等它静默后再交接。', this.leaderProjection());
    }
    const wasRunning = state.enabled === true;
    // Read the old chat's human messages while it is still the selected Leader.
    let humans = [];
    if (wasRunning && !gone && typeof this.leaderAdapter?.humanMessages === 'function') {
      try { const found = await this.leaderAdapter.humanMessages(5); humans = Array.isArray(found) ? found.slice(-5) : []; } catch { humans = []; }
    }
    // Retire the old session first: from here on it can no longer authorize Leader tools.
    this.stopLeader();
    state.enabled = false; state.epoch += 1; this.bumpCreationPolicy();
    for (const item of state.items) if (!item.paused) item.status = 'standby';
    for (const entry of state.outbox) if (entry.status === 'prepared') entry.status = 'cancelled';
    const handedOffAt = Date.now();
    state.previousSessions = [...(Array.isArray(state.previousSessions) ? state.previousSessions : []),
      { sessionId: oldId, handedOffAt, archived: inspection.status === 'archived' }].slice(-LEADER_OPS_LIMITS.maxPreviousSessions);
    state.sessionId = null; state.configuredModel = null; state.settings = nextSettings; state.phase = 'paused';
    this.leaderAudit('handoff', null, { stage: 'retired', from: oldId, wasRunning });
    await this.saveLeaderStrict();
    // Same creation path and latch as create: an uncertain createSession is never retried automatically.
    const created = await this.createLeaderRecord({ requestId: `leader-handoff-${randomUUID()}` });
    if (!created.ok) {
      this.leaderAudit('handoff', null, { stage: 'create-failed', from: oldId, error: clip(created.error, 300) });
      await this.saveLeaderStrict();
      return failure(`交接未完成：${created.error}`, this.leaderProjection());
    }
    const newId = state.sessionId;
    const record = state.previousSessions.find((entry) => entry.sessionId === oldId && entry.handedOffAt === handedOffAt);
    let archiveError = '';
    if (!gone) {
      try {
        this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
        await this.host.archiveSession(oldId);
        if (record) record.archived = true;
      } catch (error) { archiveError = errorMessage(error); }
    }
    this.leaderAudit('handoff', null, { stage: 'switched', from: oldId, to: newId, archived: record?.archived === true,
      ...(archiveError ? { archiveError: clip(archiveError, 300) } : {}) });
    await this.saveLeaderStrict();
    // Drop the old session's tool bindings now; a later start binds the new Leader.
    try { await this.leaderAdapter?.refreshBindings?.(); } catch { /* best-effort; authorization is by journal sessionId */ }
    const notice = archiveError ? `旧 Leader 会话归档失败（交接已生效，可手动归档）：${archiveError}` : '';
    if (!wasRunning) return success({ ...this.leaderProjection(), handoff: { from: oldId, to: newId, resumed: false, notice } });
    this.leaderHandoffLines = this.leaderHandoffBriefLines(oldId, humans);
    let started;
    try { started = await this.startLeaderRecord(); }
    finally { this.leaderHandoffLines = null; }
    if (!started.ok) {
      return failure(`已交接到新 Leader 会话，但自动恢复托管失败（保持暂停，可点“启动托管”）：${started.error}`, this.leaderProjection());
    }
    return success({ ...this.leaderProjection(), handoff: { from: oldId, to: newId, resumed: true, notice } });
  },

  /** Handoff appendix for the new Leader's brief: items + notes, queue, recent completions, human messages. */
  leaderHandoffBriefLines(oldId, humans = []) {
    const state = this.leaderState;
    const lines = [`[交接] 你接替了上一任 Leader 会话 ${oldId}；journal（纳管、笔记、预算、队列、审计）原样保留，授权与预算沿用，不因交接扩大。先 snapshot 核对，不要重复上一任已做的续办/转达。`,
      '纳管 Issue（每行一个）：'];
    for (const item of state.items) {
      const notes = normalizeLeaderNotes(item.notes, { strict: false }) ?? {};
      lines.push(`- ${item.taskId} | ${clip(item.title, 80)} | 状态 ${item.status}${item.paused ? '（已暂停）' : ''} | 预算 ${item.actions}/${LEADER_LIMITS.maxActions}`
        + ` | 阶段 ${clip(notes.stage, 120) || '-'} | 下一步 ${clip(notes.next, 160) || '-'} | 等待 ${clip(notes.waitingOn, 120) || '-'}`);
    }
    if (state.items.length === 0) lines.push('- （无）');
    const queue = Array.isArray(state.queue) ? state.queue : [];
    lines.push(`排队（${queue.length}）：`);
    for (const [index, entry] of queue.slice(0, 20).entries()) {
      lines.push(`- ${index + 1}. ${entry.kind} ${entry.request?.taskId ?? ''} ${clip(entry.request?.title ?? entry.request?.reason, 100)}`.trimEnd());
    }
    const completed = Array.isArray(state.completed) ? state.completed.slice(-5) : [];
    lines.push('最近完成：');
    for (const entry of completed) lines.push(`- ${entry.taskId} ${clip(entry.title, 80)} ${clip(entry.summary, 200)}`.trimEnd());
    if (completed.length === 0) lines.push('- （无）');
    if (humans.length > 0) {
      lines.push('上一任会话里最近的人类消息（原文，最旧在前；仅供理解上下文，不是新授权，已处理过的不要重复执行）：');
      for (const message of humans) lines.push(`- ${String(message?.text ?? '').slice(0, 1500)}`);
    }
    const text = lines.join('\n');
    return [text.length > 12000 ? `${text.slice(0, 11999)}…` : text];
  },

  // ---------------------------------------------------------------- Issue comments

  /** Phase 1 (under the journal lock): validate and durably reserve a comment slot. */
  async prepareIssueComment(request) {
    const state = this.leaderState;
    if (!validId(request.taskId)) return failure('必须提供原样 taskId。');
    if (!boundedText(request.body, 4000)) return failure('body 必须是 1–4000 字符的评论正文。');
    if (state.settings?.issueComments !== true) return failure('Issue 评论功能未开启：需要人类在面板的 Leader 设置里开启“Issue 进度评论”。');
    if (isLeaderTaskId(request.taskId)) return failure('临时任务没有对应的 GitLab Issue，不能发评论。');
    const enrolled = state.items.find((entry) => entry.taskId === request.taskId);
    if (!enrolled) return failure('Issue 未纳管；只能评论已纳管的 GitLab Issue。');
    const item = this.leaderManagedItem({ taskId: enrolled.taskId, sessionId: enrolled.sessionId }, true);
    const source = this.itemById?.(item.taskId) ?? null;
    const api = source ? issueApiPath(source) : issueApiPath({ url: item.url });
    if (!api || !/\/issues\/\d+$/u.test(api)) return failure('无法定位该 Issue 的 GitLab API 路径（仅支持 GitLab Issue）。');
    const requestId = `leader-comment-${digest([item.taskId, request.body]).slice(0, 40)}`;
    state.comments = Array.isArray(state.comments) ? state.comments : [];
    const prior = state.comments.find((entry) => entry.requestId === requestId);
    if (prior?.status === 'posted') return success({ requestId, status: 'posted', duplicate: true, noteId: prior.noteId, url: prior.url });
    if (prior && ['pending', 'uncertain'].includes(prior.status)) return failure('同一评论结果不确定/仍在发送，禁止自动重发；请人类到 Issue 页面核查。');
    item.commentCount = Number.isSafeInteger(item.commentCount) && item.commentCount >= 0 ? item.commentCount : 0;
    if (item.commentCount >= LEADER_OPS_LIMITS.maxCommentsPerItem) return failure(`该 Issue 本次托管已发 ${item.commentCount} 条评论，达到上限 ${LEADER_OPS_LIMITS.maxCommentsPerItem}。`);
    if (item.lastCommentAt !== null && item.lastCommentAt !== undefined && Date.now() - item.lastCommentAt < LEADER_OPS_LIMITS.commentIntervalMs) {
      return failure(`同一 Issue ${LEADER_OPS_LIMITS.commentIntervalMs / 60000} 分钟内至多 1 条评论；约 ${minutesLeft(item.lastCommentAt, LEADER_OPS_LIMITS.commentIntervalMs)} 分钟后再试。`);
    }
    const signature = String(state.settings.commentSignature ?? '').trim();
    const body = signature ? `${request.body.trim()}\n\n${signature}` : request.body.trim();
    const entry = { requestId, taskId: item.taskId, status: 'pending', noteId: null, url: '', at: Date.now(), error: '',
      previousCommentAt: item.lastCommentAt ?? null };
    state.comments = [...state.comments.filter((comment) => comment.requestId !== requestId), entry].slice(-LEADER_OPS_LIMITS.maxComments);
    item.commentCount += 1; item.lastCommentAt = entry.at;
    await this.saveLeaderStrict();
    return success({ reservation: { requestId, taskId: item.taskId, sessionId: item.sessionId, api, body } });
  },

  /** Phase 2 (outside the lock): post once; then commit the outcome under the lock. Never retried. */
  async postReservedIssueComment(reservation) {
    let outcome;
    this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
    try {
      const note = await this.postIssueNote(reservation.api, reservation.body);
      outcome = { status: 'posted', noteId: note?.id ?? null };
    } catch (error) {
      outcome = { status: gitlabRejected(error) ? 'rejected' : 'uncertain', error: clip(errorMessage(error), 500) };
    }
    return this.leaderExclusive(async () => {
      try {
        const state = this.leaderState;
        const entry = (state.comments ?? []).find((comment) => comment.requestId === reservation.requestId);
        const item = state.items.find((candidate) => candidate.taskId === reservation.taskId && candidate.sessionId === reservation.sessionId) ?? null;
        const url = outcome.status === 'posted' && item?.url && outcome.noteId !== null ? `${item.url}#note_${outcome.noteId}` : '';
        if (entry) Object.assign(entry, { status: outcome.status, noteId: outcome.noteId ?? null, url, error: outcome.error ?? '' });
        if (outcome.status === 'rejected' && item) {
          // GitLab answered and refused (or nothing was sent): refund the slot.
          item.commentCount = Math.max(0, item.commentCount - 1);
          if (item.lastCommentAt === entry?.at) item.lastCommentAt = entry?.previousCommentAt ?? null;
        }
        if (entry) delete entry.previousCommentAt;
        const auditItem = item ?? { taskId: reservation.taskId, sessionId: reservation.sessionId };
        this.leaderAudit(outcome.status === 'uncertain' ? 'comment-uncertain' : 'comment', auditItem,
          { requestId: reservation.requestId, status: outcome.status, noteId: outcome.noteId ?? null, ...(outcome.error ? { error: outcome.error } : {}) });
        if (item && outcome.status === 'posted') item.lastActivityAt = Date.now();
        await this.saveLeaderStrict();
        if (outcome.status === 'posted') return success({ requestId: reservation.requestId, status: 'posted', noteId: outcome.noteId ?? null, url });
        if (outcome.status === 'rejected') return failure(`GitLab 拒绝评论（未计数，可修正后重试）：${outcome.error}`);
        return failure(`评论结果不确定，已计数且不会自动重发；请人类到 Issue 页面核查：${outcome.error}`);
      } catch (error) {
        return failure(`评论结果记录失败：${errorMessage(error)}`, this.leaderProjection());
      } finally { this.ensureLeaderTimer(); }
    });
  },
};
