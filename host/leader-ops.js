import { createHash, randomUUID } from 'node:crypto';
import { issueApiPath, LEADER_LIMITS, LEADER_OPS_LIMITS, normalizeLeaderNotes, validateLeaderSettings } from '../core.js';
import { errorMessage } from './util.js';

// Leader operating tools: steer a running worker, hand the Leader chat over to a fresh session (UI),
// and call the GitLab REST API (writes only behind the gitlabWrite setting). Mixed into leaderMethods.
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (error, result = null) => ({ ok: false, result, error });
const success = (result) => ({ ok: true, result });
const clip = (value, max) => { const text = String(value ?? '').replace(/\s+/gu, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const OPEN_DELIVERY = new Set(['sending', 'uncertain']);
const pendingInputs = new Set(['approval', 'question', 'other']);
const validState = (state) => state && Number.isSafeInteger(state.cursor) && typeof state.running === 'boolean'
  && Array.isArray(state.pendingInput) && state.pendingInput.every((input) => pendingInputs.has(input));
const quiet = (state) => validState(state) && !state.running
  && (state.queue === null || (Array.isArray(state.queue) && state.queue.length === 0)) && state.pendingInput.length === 0;
// A structured Host error means the Host answered and refused; anything else (timeout, transport) is uncertain.
const hostRejected = (error) => error?.isDSHRemoteError === true;
// glab reports HTTP 4xx refusals explicitly; those requests were answered, not lost.
const gitlabRejected = (error) => error?.beforeRequest === true || /\b(?:HTTP\s*)?(?:400|401|403|404|405|409|413|422)\b/u.test(errorMessage(error));
const API_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const API_KEYS = ['method', 'path', 'body'];

export const STEER_HEADER = '[来自 WorkStation Leader 的纠偏引导；不是人类输入，不授予新权限]';

/** Normalizes a GitLab REST path: optional leading slash and `api/v4/` prefix are dropped. */
const normalizeApiPath = (value) => {
  if (typeof value !== 'string') return null;
  const path = value.trim().replace(/^\/+/u, '').replace(/^api\/v4\//u, '');
  if (!path || path.length > 1000 || path.startsWith('-') || path.includes('..') || !/^[A-Za-z0-9_%./?=&,:~+@-]+$/u.test(path)) return null;
  return path;
};

export const leaderOpsMethods = {
  // ---------------------------------------------------------------- steer

  /** Inject a note into a RUNNING managed worker's current turn (Host mode 'steer'). No rate limit. */
  async steerIssueRecord(request) {
    const text = typeof request.text === 'string' ? request.text.trim() : '';
    if (!text || text.length > LEADER_LIMITS.maxPromptText) return failure(`text 必须是 1..${LEADER_LIMITS.maxPromptText} 字符。`);
    const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
    if (reason.length > 500) return failure('reason 不能超过 500 字符。');
    if (request.requestId !== undefined && !validId(request.requestId)) return failure('requestId 无效。');
    const item = this.leaderManagedItem(request, true);
    const requestId = request.requestId ?? `leader-steer-${digest([item.taskId, item.sessionId, text]).slice(0, 40)}`;
    if (item.lastSteerRequestId === requestId) {
      if (item.lastSteerStatus === 'sent') return success({ requestId, status: 'sent', duplicate: true });
      if (item.lastSteerStatus === 'uncertain' || item.lastSteerStatus === 'sending') return failure('同一纠偏投递结果不确定，不会自动重发；先 gitlab_leader_read 核对该 worker 是否已收到。');
    }
    const inspection = await this.inspectLeaderSession(item.sessionId);
    if (inspection.status !== 'active' || !validState(inspection.state)) return failure(inspection.error || 'worker 会话已归档/缺失/状态不可验证，不能纠偏。');
    if (inspection.state.pendingInput.length > 0) return failure('worker 正在等待原生审批/问答，只能由人类在 worker 会话内回答；告诉人类去该 worker 会话处理。');
    if (!inspection.state.running) return failure('worker 当前没有运行中的回合；空闲会话请用 gitlab_leader_session send。');
    const body = [STEER_HEADER, `范围：${this.leaderScopeLine(item)}`, ...(reason ? [`理由：${reason}`] : []),
      '遵守原任务授权，与人类指示冲突时以人类为准。', '', text].join('\n');
    // Record the attempt durably before the send, so a crash never re-steers the same text silently.
    const previous = { lastSteerRequestId: item.lastSteerRequestId ?? null, lastSteerStatus: item.lastSteerStatus ?? null };
    item.lastSteerRequestId = requestId; item.lastSteerStatus = 'sending';
    await this.saveLeaderStrict();
    this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
    try {
      await this.host.prompt({ requestId, sessionId: item.sessionId, mode: 'steer', content: [{ type: 'text', text: body }] });
    } catch (error) {
      if (hostRejected(error)) {
        // The Host answered and refused: nothing was injected.
        Object.assign(item, previous);
        this.leaderAudit('session-steer', item, { requestId, status: 'rejected', error: clip(errorMessage(error), 300) });
        await this.saveLeaderStrict();
        return failure(`宿主拒绝纠偏：${errorMessage(error)}`);
      }
      item.lastSteerStatus = 'uncertain';
      this.leaderAudit('session-steer', item, { requestId, status: 'uncertain', error: clip(errorMessage(error), 300) });
      await this.saveLeaderStrict();
      return failure(`纠偏投递结果不确定，不会自动重发；先 gitlab_leader_read 核对：${errorMessage(error)}`);
    }
    item.lastSteerStatus = 'sent'; item.lastActivityAt = Date.now();
    this.leaderAudit('session-steer', item, { requestId, status: 'sent', ...(reason ? { reason: clip(reason, 200) } : {}), text: clip(text, 300) });
    await this.saveLeaderStrict();
    return success({ requestId, status: 'sent', mode: 'steer' });
  },

  // ---------------------------------------------------------------- GitLab REST API

  /**
   * Check stage (under the journal lock): validate, enforce gitlabWrite for non-GET, sign note bodies,
   * and durably audit the call (writes get a pending ledger entry). The call itself runs outside the lock.
   */
  async prepareLeaderGitlabApi(request) {
    const state = this.leaderState;
    const unknown = Object.keys(request).filter((key) => !API_KEYS.includes(key));
    if (unknown.length) return failure(`未知字段：${unknown.join(', ')}。`);
    const method = typeof request.method === 'string' ? request.method.toUpperCase() : '';
    if (!API_METHODS.includes(method)) return failure(`method 必须是 ${API_METHODS.join('/')} 之一。`);
    const path = normalizeApiPath(request.path);
    if (!path) return failure('path 必须是 GitLab REST 路径（如 projects/<id>/issues/1/notes），不含空白、".." 或前导 "-"。');
    let body = request.body;
    if (body !== undefined) {
      if (method === 'GET') return failure('GET 不接受 body；把参数放进 path 的查询串。');
      if (!body || typeof body !== 'object') return failure('body 必须是 JSON 对象或数组。');
      let size;
      try { size = JSON.stringify(body).length; } catch { return failure('body 不能序列化为 JSON。'); }
      if (size > LEADER_LIMITS.maxApiBody) return failure(`body 不能超过 ${LEADER_LIMITS.maxApiBody} 字符。`);
    }
    if (method === 'GET') {
      this.leaderAudit('gitlab-api', null, { method, path: clip(path, 300) });
      await this.saveLeaderStrict();
      return success({ method, path });
    }
    if (state.settings?.gitlabWrite !== true) return failure('GitLab 写操作未开启：人类需在 Leader 设置里开启“允许 GitLab 写操作”（gitlabWrite）。GET 可照常使用。');
    const note = method === 'POST' && /\/notes$/u.test(path.split('?')[0]);
    if (note && body && !Array.isArray(body) && typeof body.body === 'string') {
      const signature = String(state.settings.commentSignature ?? '').trim();
      if (signature && !body.body.includes(signature)) body = { ...body, body: `${body.body.trim()}\n\n${signature}` };
    }
    const requestId = `leader-api-${randomUUID()}`;
    const item = this.leaderItemForApiPath(path);
    if (note) {
      state.comments = [...(Array.isArray(state.comments) ? state.comments : []),
        { requestId, taskId: item?.taskId ?? null, method, path: clip(path, 300), status: 'pending', noteId: null, url: '', at: Date.now(), error: '' }]
        .slice(-LEADER_OPS_LIMITS.maxComments);
    }
    this.leaderAudit('gitlab-api', item, { requestId, method, path: clip(path, 300), status: 'pending' });
    await this.saveLeaderStrict();
    return success({ method, path, ...(body !== undefined ? { body } : {}), requestId, write: true, note, taskId: item?.taskId ?? null });
  },

  /** The enrolled Issue whose API path prefixes `path`, if any (for audit/comment linkage only). */
  leaderItemForApiPath(path) {
    const base = path.split('?')[0];
    return this.leaderState.items.find((item) => {
      const api = issueApiPath(this.itemById?.(item.taskId) ?? { url: item.url });
      return api && (base === api || base.startsWith(`${api}/`));
    }) ?? null;
  },

  /** Runs the checked call once (never retried); writes commit their outcome under the lock. */
  async runLeaderGitlabApi(check) {
    const shape = (response) => {
      const text = typeof response === 'string' ? response : JSON.stringify(response);
      if (text === undefined || text.length <= LEADER_LIMITS.maxApiBody) return { response, untrusted: true };
      return { response: `${text.slice(0, LEADER_LIMITS.maxApiBody)}…`, truncated: true, untrusted: true };
    };
    if (check.write !== true) {
      try { return success({ method: check.method, path: check.path, ...shape(await this.apiRequest(check.method, check.path)) }); }
      catch (error) { return failure(`GitLab 请求失败：${clip(errorMessage(error), 1000)}`); }
    }
    let outcome;
    this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
    try { outcome = { status: 'done', response: await this.apiRequest(check.method, check.path, check.body) }; }
    catch (error) { outcome = { status: gitlabRejected(error) ? 'rejected' : 'uncertain', error: clip(errorMessage(error), 500) }; }
    return this.leaderExclusive(async () => {
      try {
        const state = this.leaderState;
        const noteId = check.note && Number.isSafeInteger(outcome.response?.id) ? outcome.response.id : null;
        const item = check.taskId ? state.items.find((entry) => entry.taskId === check.taskId) ?? null : null;
        const url = noteId !== null && item?.url ? `${item.url}#note_${noteId}` : '';
        const entry = (state.comments ?? []).find((comment) => comment.requestId === check.requestId);
        if (entry) Object.assign(entry, { status: outcome.status === 'done' ? 'posted' : outcome.status, noteId, url, error: outcome.error ?? '' });
        this.leaderAudit('gitlab-api', item, { requestId: check.requestId, method: check.method, path: clip(check.path, 300), status: outcome.status,
          ...(noteId !== null ? { noteId } : {}), ...(outcome.error ? { error: outcome.error } : {}) });
        if (item && outcome.status === 'done') item.lastActivityAt = Date.now();
        await this.saveLeaderStrict();
        if (outcome.status === 'done') return success({ requestId: check.requestId, method: check.method, path: check.path, status: 'done', ...(url ? { url } : {}), ...shape(outcome.response) });
        if (outcome.status === 'rejected') return failure(`GitLab 拒绝了请求（未生效，可修正后重试）：${outcome.error}`);
        return failure(`GitLab 写请求结果不确定，不会自动重发；先用 GET 核对是否已生效再决定：${outcome.error}`);
      } catch (error) {
        return failure(`GitLab 请求结果记录失败：${errorMessage(error)}`, this.leaderProjection());
      } finally { this.ensureLeaderTimer(); }
    });
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
    if (state.outbox.some((entry) => OPEN_DELIVERY.has(entry.status))) return failure('存在发送中/结果不确定的 Leader 投递，先核对（resolve_delivery）后再交接。', this.leaderProjection());
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
    for (const item of state.items) if (item.status === 'watching') item.status = 'standby';
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
    const lines = [`[交接] 你接替了上一任 Leader 会话 ${oldId}；journal（纳管、笔记、队列、审计）原样保留，授权不因交接扩大。先用 gitlab_leader_overview 核对，不要重复上一任已发出的消息。`,
      '纳管 Issue（每行一个）：'];
    for (const item of state.items) {
      const notes = normalizeLeaderNotes(item.notes, { strict: false }) ?? {};
      lines.push(`- ${item.taskId} | ${clip(item.title, 80)} | 状态 ${item.status}`
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

};
