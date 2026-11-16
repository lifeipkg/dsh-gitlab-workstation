import { createHash, randomBytes } from 'node:crypto';
import { isLeaderTaskId, issueApiPath, LEADER_LIMITS, normalizeLeaderNotes, validateLeaderSettings } from '../core.js';
import { errorMessage } from './util.js';

// Leader capability surface (v2.36): session management for GitLab Issue workers, evidence-token
// continuation, verified human-reply relay and structured progress notes. v2.38 adds Leader-dispatched
// ad-hoc task sessions (no GitLab Issue) that are managed exactly like Issue workers. Mixed into leaderMethods;
// everything here runs on the runtime and reuses the journal/outbox/admission machinery in leader.js.
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (error, result = null) => ({ ok: false, result, error });
const success = (result) => ({ ok: true, result });
const OPEN_DELIVERY = new Set(['sending', 'uncertain']);
const validState = (state) => state && Number.isSafeInteger(state.cursor) && state.cursor >= 0
  && typeof state.active === 'boolean' && typeof state.running === 'boolean'
  && (state.queue === null || Array.isArray(state.queue)) && Array.isArray(state.pendingInput);
const quiet = (state) => validState(state) && !state.running
  && (state.queue === null || state.queue.length === 0) && state.pendingInput.length === 0;
const idle = (state) => quiet(state) && state.active && Array.isArray(state.queue);
const squash = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
const clip = (value, limit) => squash(value).slice(0, limit);
const MAX_AUDIT = 200;

/** Status words the Leader must use consistently when reporting to the human. */
export const LEADER_STATUS_GLOSSARY = Object.freeze({
  standby: '已纳管，Leader 暂停中；下次启动托管后开始观察。',
  watching: 'worker 空闲，Leader 正在观察；空闲本身不是继续的理由。',
  running: 'worker 正在执行一个回合。',
  cold: 'worker 未加载到内存（例如 DSH 重启后）；需要推进时由 Host 自动激活。',
  paused: '该 Issue 已暂停自动推进（人类暂停或预算耗尽）。',
  'needs-human': '需要人类：原生审批/问答等待，或 Leader 提出的问题待人类回复。',
  unknown: '状态无法验证（日志截断、投递不确定等），需人类核查。',
  missing: '会话已不存在。',
  archived: '会话已归档。',
  task: 'kind=task：Leader 派发的临时任务会话（不对应 GitLab Issue），同样受纳管、预算与审计约束。',
  stalled: '唤醒原因：worker 处于运行中但超过 20 分钟没有新日志。',
});

export const leaderToolMethods = {
  leaderIssueIid(item) {
    const source = this.itemById?.(item.taskId) ?? null;
    const iid = source?.iid ?? String(item.url ?? '').match(/\/-\/issues\/(\d+)/u)?.[1] ?? null;
    return iid === null || iid === undefined ? null : String(iid);
  },

  /** The scope line every Leader-originated worker message carries. */
  leaderScopeLine(item) {
    return isLeaderTaskId(item.taskId) ? `仅限原临时任务：${item.title}（${item.taskId}）` : `仅限原 Issue：${item.url}`;
  },

  leaderTask(taskId) {
    return (Array.isArray(this.leaderState?.tasks) ? this.leaderState.tasks : []).find((task) => task.taskId === taskId) ?? null;
  },

  leaderAudit(action, item, detail = {}) {
    const state = this.leaderState;
    state.audit = [...(Array.isArray(state.audit) ? state.audit : []), { action, taskId: item?.taskId ?? null,
      sessionId: item?.sessionId ?? null, at: Date.now(), detail: JSON.stringify(detail).slice(0, 1000) }].slice(-MAX_AUDIT);
  },

  // Deterministic: a reconcile re-observation with no new activity keeps the token valid,
  // while any new worker event, cursor move or authority change invalidates it.
  leaderEvidenceToken(item) {
    if (!item.observation || item.observation.truncated) return null;
    return digest([item.taskId, item.sessionId, item.observation.cursor, item.cursor, item.logEpoch, this.leaderState.epoch]).slice(0, 32);
  },

  leaderSnapshotRecord() {
    return success({ ...this.leaderProjection(), issues: this.leaderIssuesOverview(), glossary: LEADER_STATUS_GLOSSARY });
  },

  async readIssueRecord(request) {
    // Read scope is exact enrollment, not advancement authority; paused items stay inspectable.
    const item = this.leaderManagedItem(request);
    await this.observeLeaderItem(item); await this.saveLeaderStrict();
    const pendingInput = item.observation?.state?.pendingInput ?? [];
    let pendingQuestions = [];
    if (pendingInput.includes('question') && typeof this.leaderAdapter?.questions === 'function') {
      try { pendingQuestions = (await this.leaderAdapter.questions(item.sessionId)).slice(0, 10).map((entry) => clip(entry, 2000)); }
      catch (error) { pendingQuestions = [`问题原文不可读取：${errorMessage(error).slice(0, 300)}`]; }
    }
    const events = (item.recentEvents ?? []).map((event) => ({ ...clone(event), sourceSessionId: item.sessionId, untrusted: true }));
    const task = isLeaderTaskId(item.taskId) ? this.leaderTask(item.taskId) : null;
    return success({ taskId: item.taskId, kind: task ? 'task' : 'issue', ...(task ? { brief: task.brief } : {}),
      sessionId: item.sessionId, iid: this.leaderIssueIid(item), title: item.title, url: item.url,
      status: item.status, paused: item.paused, error: item.error, summary: item.summary, notes: item.notes ?? null,
      alerts: item.alerts.filter((alert) => alert.status === 'pending'), actions: item.actions, maxActions: LEADER_LIMITS.maxActions,
      expiresAt: item.expiresAt, pendingInput: clone(pendingInput), pendingQuestions,
      events, eventsTruncated: item.recentEventsTruncated === true || item.observation?.truncated === true,
      evidenceToken: this.leaderEvidenceToken(item), untrusted: true });
  },

  /** Read-only GitLab context; never on the Leader journal lock, failures are reported, not fatal. */
  async leaderIssueGitlab(taskId) {
    const source = this.itemById?.(taskId);
    const api = source ? issueApiPath(source) : null;
    if (!api || typeof this.runGlab !== 'function') return { available: false, error: '无法定位该 Issue 的 GitLab API 路径。' };
    const errors = [];
    const read = async (path) => {
      try { return JSON.parse(await this.runGlab(['api', '-X', 'GET', path])); }
      catch (error) { errors.push(`${path}：${errorMessage(error).slice(0, 300)}`); return null; }
    };
    const [issue, notes, merges] = await Promise.all([read(api),
      read(`${api}/notes?sort=desc&order_by=created_at&per_page=30`), read(`${api}/related_merge_requests`)]);
    const result = { available: Boolean(issue), untrusted: true, errors };
    if (issue) Object.assign(result, { title: clip(issue.title, 300), state: issue.state ?? null, labels: Array.isArray(issue.labels) ? issue.labels.slice(0, 20) : [],
      assignees: (issue.assignees ?? []).map((user) => user?.username).filter(Boolean).slice(0, 10), author: issue.author?.username ?? null,
      updatedAt: issue.updated_at ?? null, description: String(issue.description ?? '').slice(0, 4000) });
    if (Array.isArray(notes)) result.comments = notes.filter((note) => note && !note.system).slice(0, 20).reverse()
      .map((note) => ({ author: note.author?.username ?? null, createdAt: note.created_at ?? null, body: String(note.body ?? '').slice(0, 1500) }));
    if (Array.isArray(merges)) {
      result.mergeRequests = await Promise.all(merges.slice(0, 5).map(async (merge) => {
        const entry = { iid: merge.iid, title: clip(merge.title, 200), state: merge.state ?? null, url: merge.web_url ?? '', pipeline: null };
        if (Number.isSafeInteger(merge.project_id) && Number.isSafeInteger(merge.iid) && merge.state === 'opened') {
          const pipelines = await read(`projects/${merge.project_id}/merge_requests/${merge.iid}/pipelines?per_page=1`);
          if (Array.isArray(pipelines) && pipelines[0]) entry.pipeline = { status: pipelines[0].status ?? null, url: pipelines[0].web_url ?? '' };
        }
        return entry;
      }));
    }
    return result;
  },

  /**
   * Leader-scheduled worker creation for a GitLab todo-list Issue, through the same dispatch path as
   * the Issue tab. Runs OUTSIDE leaderExclusive: dispatch itself awaits the Leader lock for enrollment.
   * No count limit (the Leader schedules); one active worker per Issue is enforced here.
   */
  async leaderCreateSessionRecord(request) {
    if (this.leaderStorageFault) return failure('Leader journal 不可写，未创建会话。');
    // No taskId: an ad-hoc task the human asked for that has no GitLab Issue (investigation, analysis...).
    if (request.taskId === undefined) return this.leaderCreateTaskRecord(request);
    if (!validId(request.taskId)) return failure('必须提供 snapshot.issues 中的 taskId；临时任务不传 taskId，改传 title + brief。');
    const issue = (Array.isArray(this.state.issues) ? this.state.issues : []).find((entry) => entry.id === request.taskId);
    if (!issue) return failure('该 taskId 不在 Issue tab 当前列表中；请人类先刷新 Issue 列表。若任务不对应 GitLab Issue，不传 taskId，改传 title + brief 创建临时任务会话。');
    if (this.state.pending?.[issue.id] || this.dispatches?.has?.(issue.id)) return failure('该 Issue 已有正在创建的会话，请稍后用 snapshot 查看结果。');
    const handled = this.state.handled?.[issue.id];
    if (validId(handled?.sessionId) && handled.routed !== true && handled.sessionId !== this.leaderState?.sessionId) {
      const inspection = await this.inspectLeaderSession(handled.sessionId);
      if (inspection.status === 'active' || inspection.status === 'unknown') {
        const enrolled = await this.leaderExclusive(() => this.enrollLeaderSpawned(issue.id, handled.sessionId, 'existing'));
        return enrolled.ok ? success({ sessionId: handled.sessionId, existing: true, projection: enrolled.result })
          : failure(`该 Issue 已有可用会话 ${handled.sessionId}（每个 Issue 只保留一个活动 worker；需要新会话请先归档旧会话）：${enrolled.error}`);
      }
    }
    let result;
    try { result = await this.dispatch(issue, Boolean(handled)); }
    catch (error) { return failure(`创建会话失败：${errorMessage(error)}`); }
    if (!result?.ok || !validId(result.sessionId)) return failure(result?.error || '创建会话失败，宿主未返回会话 ID。');
    const enrolled = await this.leaderExclusive(() => this.enrollLeaderSpawned(issue.id, result.sessionId, 'created'));
    return enrolled.ok ? success({ sessionId: result.sessionId, existing: false, projection: enrolled.result })
      : failure(`会话 ${result.sessionId} 已创建并开始处理，但未能纳管：${enrolled.error}`);
  },

  /**
   * Ad-hoc worker session without a GitLab Issue. The journal records a "creating" tombstone before the
   * Host create, so a crash leaves an uncertain entry for the human instead of a silent retry. No count
   * limit: the Leader schedules. The brief is delivered as the session's first prompt.
   */
  async leaderCreateTaskRecord(request) {
    if (this.leaderJournalUnreadable || !validId(this.leaderState?.sessionId)) return failure('Leader 尚未创建或 journal 不可读，未创建会话。');
    const title = typeof request.title === 'string' ? squash(request.title) : '';
    const brief = typeof request.brief === 'string' ? request.brief.trim() : '';
    if (!title || title.length > 70) return failure('临时任务必须提供 1..70 字符的 title。');
    if (!brief || brief.length > 8000) return failure('临时任务必须提供 1..8000 字符的 brief（完整、自包含的任务说明）。');
    const directory = request.workingDirectory === undefined ? '' : typeof request.workingDirectory === 'string' ? request.workingDirectory.trim() : null;
    if (directory === null || directory.length > 500) return failure('workingDirectory 必须是已在 DSH 注册的工作区路径。');
    let workspaceId;
    try { workspaceId = this.resolveWorkspaceId(directory || this.state.settings?.issueSessionCwd || ''); }
    catch (error) {
      const available = (this.ctx?.workspaceRegistry?.list?.() ?? []).map((entry) => entry?.path ?? entry?.cwd)
        .filter((path) => typeof path === 'string' && path).slice(0, 30);
      return failure(`工作区不可用：${errorMessage(error)}`, { available });
    }
    const taskId = `leader-task-${randomBytes(6).toString('hex')}`;
    const reserved = await this.leaderExclusive(async () => {
      if (this.leaderStorageFault) return failure('Leader journal 不可写，未创建会话。');
      let tasks = Array.isArray(this.leaderState.tasks) ? this.leaderState.tasks : [];
      // Journal hygiene only: forget finished entries first; never drop a task that still binds a session.
      if (tasks.length >= LEADER_LIMITS.maxTasks) tasks = tasks.filter((task) => task.status !== 'archived');
      if (tasks.length >= LEADER_LIMITS.maxTasks) return failure(`临时任务记录已达 ${LEADER_LIMITS.maxTasks} 条；请先归档已完成的临时任务会话。`);
      this.leaderState.tasks = [...tasks, { taskId, sessionId: null, title, brief: brief.slice(0, 1000), workspace: directory,
        status: 'creating', createdAt: Date.now(), error: '' }];
      await this.saveLeaderStrict();
      return success(null);
    });
    if (!reserved.ok) return reserved;
    this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
    const create = { workspaceId };
    if (typeof this.config?.agentPreset === 'string' && this.config.agentPreset) create.agentPreset = this.config.agentPreset;
    let sessionId;
    try { sessionId = await this.host.createSession(create); }
    catch (error) {
      await this.leaderExclusive(async () => {
        const task = this.leaderTask(taskId);
        if (task) { task.status = 'uncertain'; task.error = `宿主创建会话报错，结果不确定：${errorMessage(error)}`.slice(0, 1000); await this.saveLeaderStrict(); }
      });
      return failure(`创建临时任务会话失败：${errorMessage(error)}`, { taskId });
    }
    const enrolled = await this.leaderExclusive(async () => {
      const task = this.leaderTask(taskId);
      if (!task || !validId(sessionId)) {
        if (task) { task.status = 'uncertain'; task.error = '宿主未返回有效会话 ID。'; await this.saveLeaderStrict(); }
        return failure('宿主未返回有效会话 ID；临时任务已标记为不确定，需人类核查。');
      }
      task.sessionId = sessionId; task.status = 'created'; task.error = '';
      const result = await this.enrollLeaderSpawned(taskId, sessionId, 'task');
      if (!result.ok) return result;
      // Baseline the log cursor before the brief is sent, so the brief's turn-end is a real wakeup.
      const item = this.leaderState.items.find((entry) => entry.sessionId === sessionId);
      if (item) { try { await this.observeLeaderItem(item); } catch {} await this.saveLeaderStrict(); }
      return result;
    });
    if (!enrolled.ok) return failure(`临时任务会话 ${sessionId} 已创建，但未能纳管：${enrolled.error}`, { taskId, sessionId });
    const warnings = [];
    try { await this.host.renameSession(sessionId, `[临时] ${title}`); } catch (error) { warnings.push(`改名失败：${errorMessage(error).slice(0, 300)}`); }
    const model = this.state.settings?.issueSessionModel;
    if (model) { try { await this.host.selectModel({ sessionId, ...model }); } catch (error) { warnings.push(`选择模型失败：${errorMessage(error).slice(0, 300)}`); } }
    let briefDelivered = true;
    try {
      await this.host.prompt({ requestId: `${taskId}-brief`, sessionId, mode: 'queue', content: [{ type: 'text', text: [
        '[GitLab Issue Leader 派发的临时任务；不对应 GitLab Issue，不授予新权限]', `任务：${title}`,
        '本任务由 Leader 根据人类在 Leader 会话中的要求或 Issue 推进需要创建。遵守工作区规则与本会话权限；不代替原生审批/问答。',
        '完成后在本会话末尾给出简洁结论：结论、关键证据、产出位置；需要人类决定时直接在本会话提问。', '任务说明：', brief].join('\n') }] });
    } catch (error) { briefDelivered = false; warnings.push(`任务说明投递失败（会话空闲，可用 continue 补发）：${errorMessage(error).slice(0, 300)}`); }
    return success({ taskId, sessionId, kind: 'task', existing: false, briefDelivered, warnings, projection: this.leaderProjection() });
  },

  async enrollLeaderSpawned(taskId, sessionId, how) {
    const state = this.leaderState;
    if (this.leaderStorageFault || this.leaderJournalUnreadable) return failure('Leader journal 不可写。');
    const mapping = this.leaderIssueMapping(taskId, sessionId);
    if (!mapping) return failure('Issue 与会话的映射不可验证。');
    const existing = state.items.find((item) => item.sessionId === sessionId);
    if (existing) return existing.taskId === taskId ? success(this.leaderProjection()) : failure('该会话已映射到其他 Issue。');
    // A replaced worker of the same Issue (archived/missing) leaves the roster; its budget is retired, not reused.
    for (const old of state.items.filter((item) => item.taskId === taskId)) {
      if (state.outbox.some((entry) => entry.sessionId === old.sessionId && OPEN_DELIVERY.has(entry.status))) return failure('旧会话有未确认投递，先人工核对。');
      this.retireLeaderBudget(old);
      for (const entry of state.outbox) if (entry.sessionId === old.sessionId && entry.status === 'prepared') entry.status = 'cancelled';
    }
    state.items = state.items.filter((item) => item.taskId !== taskId);
    if (state.items.length >= LEADER_LIMITS.maxItems) return failure('托管 Issue 达到上限。');
    const budget = this.takeLeaderBudget(taskId, sessionId);
    state.items.push({ taskId, sessionId, title: mapping.title, url: mapping.url, status: state.enabled ? 'watching' : 'standby',
      summary: '', error: '', paused: false, alerts: [], enrolledAt: Date.now(), expiresAt: budget?.expiresAt ?? Date.now() + LEADER_LIMITS.issueLeaseMs,
      provenance: { kind: 'leader', taskId, sessionId, createdAt: Date.now() }, cursor: null, logEpoch: null, observation: null,
      actions: budget?.actions ?? 0, notificationFingerprint: '', pendingWake: [], notes: null, lastActivityAt: Date.now(), stallNotifiedAt: null });
    this.leaderAudit({ existing: 'session-enroll', task: 'task-create' }[how] ?? 'session-create', { taskId, sessionId }, { how, ...(how === 'task' ? { title: mapping.title } : {}) });
    state.epoch += 1; await this.saveLeaderStrict();
    return success(this.leaderProjection());
  },

  async renameManagedSession(request) {
    const item = this.leaderManagedItem(request);
    const iid = this.leaderIssueIid(item);
    const title = typeof request.title === 'string' ? squash(request.title) : '';
    const task = isLeaderTaskId(item.taskId) ? this.leaderTask(item.taskId) : null;
    if (task) {
      if (!title || title.length > 80) return failure('临时任务会话标题必须是 1..80 字符。');
      this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
      await this.host.renameSession(item.sessionId, title);
      task.title = title.slice(0, 80); item.title = task.title;
      this.leaderAudit('session-rename', item, { title }); await this.saveLeaderStrict();
      return success({ sessionId: item.sessionId, title });
    }
    if (!iid) return failure('无法确定该 Issue 的编号，拒绝改名。');
    if (!title || title.length > 80 || !title.startsWith(`#${iid}`) || /\d/u.test(title.charAt(iid.length + 1))) return failure(`标题必须以 #${iid} 开头且不超过 80 字符。`);
    this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
    await this.host.renameSession(item.sessionId, title);
    const record = this.state.handled?.[item.taskId];
    if (record?.sessionId === item.sessionId) { record.sessionTitle = title; await this.persistQuietly?.('Leader 会话改名'); }
    this.leaderAudit('session-rename', item, { title }); await this.saveLeaderStrict();
    return success({ sessionId: item.sessionId, title });
  },

  async archiveManagedSession(request) {
    const item = this.leaderManagedItem(request, false, true);
    const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
    if (!reason || reason.length > 500) return failure('归档必须给出 1..500 字符的理由。');
    if (this.leaderState.outbox.some((entry) => entry.sessionId === item.sessionId && OPEN_DELIVERY.has(entry.status))) return failure('该会话有未确认投递，先人工核对再归档。');
    const inspection = await this.inspectLeaderSession(item.sessionId);
    if (inspection.status === 'active') {
      if (!quiet(inspection.state)) return failure('会话正在运行、有排队输入或等待人类审批/问答，不能归档。');
      this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
      if (isLeaderTaskId(item.taskId)) {
        // Ad-hoc task sessions are not Issue-tab dispatches; archive them through the Host directly.
        try { await this.host.archiveSession(item.sessionId); } catch (error) { return failure(`宿主拒绝归档：${errorMessage(error)}`); }
      } else {
        const archived = await this.setSessionArchived(item.sessionId, true);
        if (!archived?.ok) return failure(archived?.error || '宿主拒绝归档。');
      }
    } else if (inspection.status === 'unknown') return failure('会话状态不可验证，未归档。');
    const task = isLeaderTaskId(item.taskId) ? this.leaderTask(item.taskId) : null;
    if (task) task.status = 'archived';
    this.retireLeaderBudget(item);
    this.leaderState.items = this.leaderState.items.filter((entry) => entry !== item);
    for (const entry of this.leaderState.outbox) if (entry.sessionId === item.sessionId && entry.status === 'prepared') entry.status = 'cancelled';
    this.leaderAudit('session-archive', item, { reason, previous: inspection.status });
    this.leaderState.epoch += 1; await this.saveLeaderStrict();
    return success({ sessionId: item.sessionId, archived: true });
  },

  async selectManagedSessionModel(request) {
    const item = this.leaderManagedItem(request);
    let model;
    try { model = validateLeaderSettings({ model: request.model }, { model: null, autoEnrollNew: false }).model; }
    catch (error) { return failure(errorMessage(error)); }
    if (!model) return failure('必须提供 model：{provider, model, reasoningEffort?}。');
    let catalog;
    try { catalog = await this.host.modelCatalog(); } catch (error) { return failure(`模型目录不可用：${errorMessage(error)}`); }
    const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
    const known = groups.some((group) => (group?.id ?? group?.provider) === model.provider
      && (Array.isArray(group.models) ? group.models : []).some((entry) => (entry?.id ?? entry?.model) === model.model));
    if (!known) {
      // The Leader has no other way to discover models: list the catalog (bounded) with the refusal.
      const available = groups.flatMap((group) => (Array.isArray(group?.models) ? group.models : [])
        .map((entry) => ({ provider: group?.id ?? group?.provider, model: entry?.id ?? entry?.model }))).filter((entry) => validId(entry.provider) && validId(entry.model)).slice(0, 100);
      return failure('该模型不在宿主模型目录中；请从 available 中选择。', { available });
    }
    const inspection = await this.inspectLeaderSession(item.sessionId);
    if (inspection.status !== 'active' || !quiet(inspection.state)) return failure('会话正在运行/等待人类/不可验证，空闲时再切换模型。');
    this.leaderSideEffectGeneration = (this.leaderSideEffectGeneration ?? 0) + 1;
    await this.host.selectModel({ sessionId: item.sessionId, ...model });
    this.leaderAudit('session-model', item, model); await this.saveLeaderStrict();
    return success({ sessionId: item.sessionId, model });
  },

  async continueIssueRecord(request) {
    const item = this.leaderManagedItem(request);
    const token = this.leaderEvidenceToken(item);
    if (typeof request.evidenceToken !== 'string' || !token || request.evidenceToken !== token) return failure('evidenceToken 已失效：worker 有新活动或授权已变化，请先重新 read_issue。');
    const body = typeof request.body === 'string' ? request.body.trim() : '';
    return this.advanceManagedRecord({ taskId: item.taskId, sessionId: item.sessionId, body, reason: request.reason,
      requestId: `leader-continue-${digest([token, body]).slice(0, 40)}`,
      evidence: { cursor: item.observation.cursor, epoch: this.leaderState.epoch, logCursor: item.cursor, logEpoch: item.logEpoch } });
  },

  /**
   * Forward a human's reply, written in the Leader session, to one worker. The Host verifies the text
   * really is (part of) a recent human-authored Leader message; the Leader cannot invent it. Allowed
   * while the Leader is paused and spends no budget. Native approvals/questions still need the human.
   */
  async relayReplyRecord(request) {
    const state = this.leaderState;
    const item = this.leaderManagedItem(request);
    const text = typeof request.text === 'string' ? request.text.trim() : '';
    if (!text || text.length > 4000) return failure('text 必须是 1..4000 字符的人类原话。');
    if (typeof this.leaderAdapter?.humanMessages !== 'function' || typeof this.leaderAdapter?.relay !== 'function') return failure('unavailable：人类消息核验或转达适配器不可用。');
    const wanted = squash(text);
    const messages = await this.leaderAdapter.humanMessages(10);
    const source = [...messages].reverse().find((message) => squash(message.text).includes(wanted));
    if (!source) return failure('这段文字不在人类最近 10 条 Leader 会话消息中；只能原样转达人类亲自写的内容。');
    const key = digest([source.seq, item.taskId, wanted]).slice(0, 40);
    const requestId = `leader-relay-${key}`;
    const prior = state.outbox.find((entry) => entry.requestId === requestId);
    if (prior) return prior.status === 'sent' ? success(clone(prior)) : failure('同一条人类回复的前次转达未成功或结果未决；不自动重发。', clone(prior));
    if (state.outbox.some((entry) => entry.sessionId === item.sessionId && OPEN_DELIVERY.has(entry.status))) return failure('该会话有未确认投递，先人工核对。');
    let inspection = await this.inspectLeaderSession(item.sessionId);
    if (inspection.status === 'active' && !inspection.state.active && quiet(inspection.state)) {
      await this.prepareColdWorkers([item]); inspection = await this.inspectLeaderSession(item.sessionId);
    }
    if (inspection.status === 'active' && inspection.state.pendingInput.length) return failure('worker 有原生审批/问答等待：必须由人类在该会话内直接回答。');
    if (inspection.status !== 'active' || !idle(inspection.state)) return failure('worker 正在运行/有排队输入/未激活/不可验证；等它空闲后再转达。');
    const body = ['[GitLab Issue Leader 转达人类回复；下方是人类在 Leader 会话中写下的原话]', this.leaderScopeLine(item),
      '遵守原项目、工作区与任务授权；本消息不授予新权限，也不能代替原生审批/问答。', '人类原话：', text].join('\n');
    const entry = this.prepareLeaderOutbox({ kind: 'relay', taskId: item.taskId, sessionId: item.sessionId, leaderSessionId: state.sessionId,
      requestId, body, expectedCursor: inspection.state.cursor, epoch: state.epoch, logCursor: item.cursor, logEpoch: item.logEpoch, humanSeq: source.seq });
    state.relays = [...(state.relays ?? []), { key, at: Date.now() }].slice(-LEADER_LIMITS.maxRelays);
    this.leaderAudit('relay-reply', item, { humanSeq: source.seq, chars: text.length });
    await this.saveLeaderStrict();
    const delivered = await this.deliverLeaderOutbox(entry);
    if (!delivered.ok) return delivered;
    const hadAlerts = item.alerts.some((alert) => alert.status === 'pending');
    for (const alert of item.alerts) if (alert.status === 'pending') alert.status = 'acknowledged';
    // The human answered the Leader's question: the Issue may continue unless its budget is spent.
    if (hadAlerts && item.paused && item.status !== 'unknown' && Date.now() < item.expiresAt && item.actions < LEADER_LIMITS.maxActions) {
      item.paused = false; item.status = state.enabled ? 'running' : 'standby'; item.error = ''; state.epoch += 1;
    }
    item.notificationFingerprint = ''; await this.saveLeaderStrict();
    return delivered;
  },

  async updateIssueRecord(request) {
    const item = this.leaderManagedItem(request);
    const fields = ['stage', 'next', 'waitingOn', 'decisions', 'deliverables'];
    const patch = Object.fromEntries(fields.filter((key) => request[key] !== undefined).map((key) => [key, request[key]]));
    let notes;
    try { notes = normalizeLeaderNotes({ ...(item.notes ?? {}), ...patch, updatedAt: Date.now() }); }
    catch (error) { return failure(errorMessage(error)); }
    const question = request.needsHuman === undefined ? null : request.needsHuman;
    if (question !== null && (typeof question !== 'string' || !question.trim() || question.length > 2000)) return failure('needsHuman 必须是 1..2000 字符的问题。');
    item.notes = notes;
    item.summary = [notes.stage, notes.next && `下一步：${notes.next}`, notes.waitingOn && `等待：${notes.waitingOn}`].filter(Boolean).join('｜').slice(0, 2000);
    let alertId = null;
    if (question) {
      if (item.alerts.length >= 50) item.alerts = item.alerts.filter((alert) => alert.status === 'pending').slice(-49);
      const text = question.trim(); alertId = `leader-alert-${digest([item.taskId, item.sessionId, text]).slice(0, 24)}`;
      if (!item.alerts.some((alert) => alert.id === alertId && alert.status === 'pending')) {
        item.alerts = item.alerts.filter((alert) => alert.id !== alertId);
        item.alerts.push({ id: alertId, question: text, status: 'pending', createdAt: Date.now() });
      }
      item.paused = true; item.status = 'needs-human'; this.leaderState.epoch += 1;
      for (const entry of this.leaderState.outbox) if (entry.taskId === item.taskId && entry.status === 'prepared') entry.status = 'cancelled';
      // The Leader already knows about its own question; do not echo it back as a wakeup.
      item.notificationFingerprint = ''; item.pendingWake = [];
    }
    await this.saveLeaderStrict();
    return success({ taskId: item.taskId, sessionId: item.sessionId, notes: clone(notes), summary: item.summary, alertId,
      ...(alertId ? { note: '该 Issue 已暂停并标记需人类；人类在 Leader 会话回复后，用 relay_reply 原样转达。' } : {}) });
  },

  /** UI only: a human checked the Host session list and dismisses an uncertain ad-hoc task record. */
  async resolveLeaderTask(request) {
    const task = isLeaderTaskId(request?.taskId) ? this.leaderTask(request.taskId) : null;
    if (!task) return failure('临时任务不存在。');
    if (request.action !== 'dismiss') return failure('action 只能是 dismiss。');
    if (task.status !== 'uncertain') return failure('只有结果不确定的临时任务需要人工处理。');
    task.status = 'archived'; task.error = '人类已核查并放弃该不确定的创建记录。';
    this.leaderAudit('task-dismiss', { taskId: task.taskId, sessionId: task.sessionId }, { title: task.title });
    await this.saveLeaderStrict();
    return success(this.leaderProjection());
  },

  /** Short one-line wake summary per Issue; details come from read_issue, not the notification. */
  leaderWakeLine(item) {
    const iid = this.leaderIssueIid(item);
    const question = item.alerts.find((alert) => alert.status === 'pending')?.question;
    return [`- ${iid ? `#${iid} ` : isLeaderTaskId(item.taskId) ? '[临时] ' : ''}${clip(item.title, 60)}`, `状态 ${item.status}`, `原因 ${item.pendingWake.join(',')}`,
      item.error && `错误 ${clip(item.error, 160)}`, question && `待人类：${clip(question, 160)}`,
      `taskId=${item.taskId} sessionId=${item.sessionId}`].filter(Boolean).join('｜');
  },

  /** Best-effort: before the run lease/wake budget stops the Leader, tell the human in the Leader session. */
  async leaveLeaderStopNote(reason) {
    const state = this.leaderState;
    try {
      if (!this.leaderAdapterAvailable() || state.outbox.some((entry) => entry.kind === 'notify' && OPEN_DELIVERY.has(entry.status))) return;
      const leader = await this.inspectLeaderSession(state.sessionId);
      if (leader.status !== 'active' || !idle(leader.state)) return;
      const entry = this.prepareLeaderOutbox({ kind: 'notify', sessionId: state.sessionId, requestId: `leader-stop-${state.epoch}-${Date.now()}`,
        epoch: state.epoch, expectedCursor: leader.state.cursor, stopNote: true, body: ['[GitLab Issue Leader 非人类通知：自动托管即将暂停]',
          `原因：${reason}`, '请用中文向人类简短说明各 Issue 当前状态与需要人类处理的事项，并提醒：如需继续自动推进，请在 Issue → Leader 中重新“启动托管”。',
          '暂停后 continue 不可用；会话管理、update_issue 与 relay_reply 仍可在人类要求时使用。'].join('\n') });
      await this.saveLeaderStrict();
      await this.deliverLeaderOutbox(entry);
    } catch (error) { this.logger?.warn?.(`Leader 停止前通知失败：${errorMessage(error)}`); }
  },
};
