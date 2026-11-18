export const STATE_VERSION = 8;

// Leader v3 keeps a small journal of its own: session id, model, ad-hoc task registry, the child-report board and
// the uncertain-delivery ledger. Issue automatic:false and STATE_VERSION stay unchanged.
export const LEADER_STATE_VERSION = 2;
// Journal/size bounds shared by Host enforcement and the UI projection. There are no action budgets, leases or wakeups.
export const LEADER_LIMITS = Object.freeze({
  maxTasks: 200, maxAbandonedCreations: 20,
  // Child → Leader reports (gitlab_leader_report): journal size and text size.
  maxReports: 200, maxReportText: 2000,
  // Leader text inputs (messages sent to child sessions, ad-hoc task briefs).
  maxPromptText: 8000,
  // Delivery ledger: only open (sending/uncertain) entries matter; terminal ones are trimmed.
  maxDeliveries: 100,
});
export const LEADER_REPORT_KINDS = Object.freeze(['progress', 'blocked', 'done', 'question']);
const DEFAULT_LEADER_SETTINGS = Object.freeze({ model: null });
// Name of the opt-in persona preset shipped in cordis.patch.yml. The Leader defaults to the Host's standard preset.
export const DEFAULT_LEADER_AGENT_PRESET = 'gitlab-issue-leader';
// Leader-dispatched ad-hoc tasks (no GitLab Issue): namespaced taskIds plus their own journal registry.
export const LEADER_TASK_STATUSES = Object.freeze(['creating', 'created', 'uncertain', 'archived']);
export const LEADER_DELIVERY_KINDS = Object.freeze(['send', 'steer']);
export const LEADER_DELIVERY_STATUSES = Object.freeze(['sending', 'sent', 'rejected', 'uncertain']);
export const isLeaderTaskId = (value) => typeof value === 'string' && /^leader-task-[0-9a-f]{12}$/u.test(value);
/** Kind of a plugin-created session on the board: ad-hoc task (leader-task-…) or Issue (default). */
export const leaderItemKind = (item) => (isLeaderTaskId(item?.taskId) ? 'task' : 'issue');
const OPEN_DELIVERY = new Set(['sending', 'uncertain']);
const leaderId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u001f]/u.test(value);

export function initialLeaderState() {
  return { version: LEADER_STATE_VERSION, sessionId: null, phase: 'not-created', settings: { ...DEFAULT_LEADER_SETTINGS },
    configuredModel: null, creation: null, abandonedCreations: [], tasks: [], reports: [], deliveries: [], error: '' };
}

/** Normalizes one child report entry; returns null for malformed entries. */
export function normalizeLeaderReport(value) {
  if (!isRecord(value)) return null;
  if (!leaderId(value.id) || !leaderId(value.taskId) || !leaderId(value.sessionId)) return null;
  if (!LEADER_REPORT_KINDS.includes(value.kind) || typeof value.text !== 'string' || !value.text) return null;
  if (!Number.isSafeInteger(value.at) || value.at < 0) return null;
  return { id: value.id, taskId: value.taskId, sessionId: value.sessionId, kind: value.kind,
    text: value.text.slice(0, LEADER_LIMITS.maxReportText), at: value.at, seen: value.seen === true };
}

/** Normalizes one delivery ledger entry; an in-flight (sending) entry is uncertain after a restart and never resent. */
export function normalizeLeaderDelivery(value, { restart = false } = {}) {
  if (!isRecord(value) || !leaderId(value.requestId) || !leaderId(value.sessionId) || !LEADER_DELIVERY_KINDS.includes(value.kind)
    || !LEADER_DELIVERY_STATUSES.includes(value.status)) return null;
  const sending = restart && value.status === 'sending';
  return { requestId: value.requestId, kind: value.kind, taskId: leaderId(value.taskId) ? value.taskId : null, sessionId: value.sessionId,
    status: sending ? 'uncertain' : value.status, at: timestamp(value.at),
    error: sending ? '重启时投递结果不确定，禁止自动重发；Leader 可读取会话日志核对后自行决定是否再发。' : text(value.error).slice(0, 500) };
}

/** Keeps every open delivery and the newest terminal ones within the cap. */
export function compactLeaderDeliveries(deliveries, limit = LEADER_LIMITS.maxDeliveries) {
  const open = deliveries.filter((entry) => OPEN_DELIVERY.has(entry.status));
  const room = Math.max(0, limit - open.length);
  const keep = new Set([...open, ...deliveries.filter((entry) => !OPEN_DELIVERY.has(entry.status)).slice(-room)]);
  return deliveries.filter((entry) => keep.has(entry));
}

/** Coarse state shown by the UI: not-created | creation-uncertain | setup-incomplete | error | ready. */
export function leaderRunState(state) {
  if (!state) return 'not-created';
  if (state.phase === 'error') return 'error';
  if (!state.sessionId) return state.creation ? 'creation-uncertain' : 'not-created';
  if (state.creation?.status !== 'ready') return 'setup-incomplete';
  return 'ready';
}

export function validateLeaderSettings(input, current = DEFAULT_LEADER_SETTINGS) {
  if (!isRecord(input)) throw new Error('Leader 设置必须是对象。');
  if (Object.keys(input).some((key) => key !== 'model')) throw new Error('未知 Leader 设置。');
  const next = { ...DEFAULT_LEADER_SETTINGS, ...current };
  if ('model' in input) {
    const model = input.model;
    if (model !== null && (!isRecord(model)
      || typeof model.provider !== 'string' || !model.provider.trim() || model.provider.length > 200
      || typeof model.model !== 'string' || !model.model.trim() || model.model.length > 200
      || (model.reasoningEffort !== undefined && (typeof model.reasoningEffort !== 'string' || !model.reasoningEffort.trim() || model.reasoningEffort.length > 200)))) {
      throw new Error('Leader 模型必须是 null 或有效 provider/model/reasoningEffort 对象。');
    }
    next.model = model === null ? null : { provider: model.provider.trim(), model: model.model.trim(),
      ...(model.reasoningEffort !== undefined ? { reasoningEffort: model.reasoningEffort.trim() } : {}) };
  }
  return next;
}

/**
 * Loads a Leader journal. v1 journals (items/outbox/queue/budgets) migrate to v2: only the session id, model, creation
 * record, ad-hoc task registry and valid reports survive. `migratedFrom` tells the Host to back the old file up first.
 */
export function normalizeLeaderState(value) {
  if (!isRecord(value) || ![1, LEADER_STATE_VERSION].includes(value.version)) throw new Error('Leader journal 版本/结构无效，禁止自动重建。');
  if (value.sessionId !== null && !leaderId(value.sessionId)) throw new Error('Leader journal 会话 ID 无效，禁止重复创建。');
  const migrated = value.version === 1;
  const result = initialLeaderState();
  result.sessionId = value.sessionId;
  const settings = isRecord(value.settings) ? { model: value.settings.model ?? null } : {};
  result.settings = validateLeaderSettings(settings, initialLeaderState().settings);
  result.configuredModel = validateLeaderSettings({ model: value.configuredModel ?? null }).model;
  if (value.creation !== null && value.creation !== undefined) {
    if (!isRecord(value.creation) || !leaderId(value.creation.requestId)) throw new Error('Leader 创建 journal 无效，禁止重复创建。');
    result.creation = { ...JSON.parse(JSON.stringify(value.creation)) };
    if (!['created', 'ready'].includes(result.creation.status)) result.creation.status = 'uncertain';
    if (result.creation.agentPreset !== undefined && result.creation.agentPreset !== null && !leaderId(result.creation.agentPreset)) delete result.creation.agentPreset;
  }
  result.abandonedCreations = (Array.isArray(value.abandonedCreations) ? value.abandonedCreations : [])
    .filter((entry) => isRecord(entry) && leaderId(entry.requestId)).slice(-LEADER_LIMITS.maxAbandonedCreations);
  // Ad-hoc task registry: only "created" binds a session; a restart mid-creation is uncertain, never retried.
  const seenTasks = new Set();
  result.tasks = (Array.isArray(value.tasks) ? value.tasks : [])
    .filter((entry) => isRecord(entry) && isLeaderTaskId(entry.taskId) && !seenTasks.has(entry.taskId) && Boolean(seenTasks.add(entry.taskId))
      && LEADER_TASK_STATUSES.includes(entry.status) && (entry.sessionId === null || entry.sessionId === undefined || leaderId(entry.sessionId)))
    .map((entry) => {
      const sessionId = leaderId(entry.sessionId) ? entry.sessionId : null;
      const status = entry.status === 'creating' || (entry.status === 'created' && !sessionId) ? 'uncertain' : entry.status;
      return { taskId: entry.taskId, sessionId, title: text(entry.title).slice(0, 80), brief: text(entry.brief).slice(0, 1000),
        workspace: text(entry.workspace).slice(0, 500), status, createdAt: timestamp(entry.createdAt),
        error: entry.status === 'creating' ? '重启时临时任务创建结果不确定，禁止自动重建；请人工核查宿主会话列表。' : text(entry.error).slice(0, 1000) };
    }).slice(-LEADER_LIMITS.maxTasks);
  const seenReports = new Set();
  result.reports = (Array.isArray(value.reports) ? value.reports : [])
    .map((entry) => normalizeLeaderReport(migrated ? { ...entry, seen: true } : entry))
    .filter((entry) => entry && !seenReports.has(entry.id) && Boolean(seenReports.add(entry.id))).slice(-LEADER_LIMITS.maxReports);
  result.deliveries = migrated ? [] : compactLeaderDeliveries((Array.isArray(value.deliveries) ? value.deliveries : [])
    .map((entry) => normalizeLeaderDelivery(entry, { restart: true })).filter(Boolean));
  result.phase = result.sessionId ? (result.creation?.status === 'ready' ? 'ready' : 'error') : result.creation ? 'uncertain' : 'not-created';
  result.error = text(value.error).slice(0, 1000);
  if (migrated) result.migratedFrom = 1;
  return result;
}

export function buildLeaderProjection(state = initialLeaderState()) {
  const creation = isRecord(state.creation) ? { status: text(state.creation.status, 'uncertain'),
    createdAt: timestamp(state.creation.createdAt), agentPreset: typeof state.creation.agentPreset === 'string' ? state.creation.agentPreset : null } : null;
  const reports = Array.isArray(state.reports) ? state.reports : [];
  return { sessionId: state.sessionId ?? null,
    phase: ['not-created', 'ready', 'error', 'uncertain'].includes(state.phase) ? state.phase : 'uncertain',
    runState: leaderRunState(state),
    settings: JSON.parse(JSON.stringify(state.settings)),
    creation,
    // Open deliveries are the only records a human might need to look at; terminal ones stay internal.
    deliveries: (state.deliveries ?? []).filter((entry) => OPEN_DELIVERY.has(entry.status)).map((entry) => ({ requestId: entry.requestId,
      kind: entry.kind, taskId: entry.taskId ?? null, sessionId: entry.sessionId, status: entry.status, error: entry.error || '', at: timestamp(entry.at) })),
    // Ad-hoc tasks the Leader dispatched; uncertain ones need a human to check the Host session list.
    tasks: (Array.isArray(state.tasks) ? state.tasks : []).filter((task) => task.status !== 'archived').slice(-50).map((task) => ({
      taskId: task.taskId, sessionId: task.sessionId ?? null, title: task.title, status: task.status,
      createdAt: timestamp(task.createdAt), error: task.error || '' })),
    // Child self-reports (untrusted child output, newest last); `unseen` counts those the Leader has not read yet.
    reports: reports.slice(-30).map((entry) => ({ ...entry })),
    unseenReports: reports.filter((entry) => entry.seen !== true).length,
    error: state.error || '' };
}

/** Compact one-line summary of a child report (null when none). */
export function leaderReportSummary(entry) {
  if (!isRecord(entry)) return null;
  return { id: entry.id, kind: entry.kind, text: text(entry.text).replace(/\s+/gu, ' ').trim().slice(0, 200), at: timestamp(entry.at), seen: entry.seen === true };
}


export const DEFAULT_SETTINGS = Object.freeze({
  autoArchive: true,
  maxConcurrentSessions: 2,
  // Issue 新会话独立配置；null/空串跟随 DSH 默认模型/最近工作区。
  issueSessionCwd: '',
  issueSessionModel: null,
  followUpEnabled: true,
  // 续办省 token：补救类续办优先复用上一轮会话。
  followUpReuseSession: true,
  maxFollowUps: 3,
  followUpDelayMinutes: 15,
});

/** handled 历史保留策略：已闭环/已确认记录超过该天数后从状态文件里清掉（活跃记录永不删）。 */
export const HANDLED_CLOSED_RETENTION_DAYS = 90;
/** 已结算记录的硬上限：超过时按结算时间删最旧，保护所有未结算与未确认记录。 */
export const HANDLED_SETTLED_MAX = 500;
/** 闭环状态：'' 为尚未结算或旧版本记录；verifying 为回合已结束、等待核对 GitLab 事实。 */
export const CLOSURE_STATES = ['verifying', 'closed', 'follow-up', 'needs-human'];
/** 会话结案报告的自述状态。 */
export const REPORT_STATUSES = ['done', 'waiting', 'needs-human'];
export const CLOSURE_MARKER = '[TODO-CLOSURE]';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function safeUrl(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  return /^https?:\/\//i.test(candidate) ? candidate : '';
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function defaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

export function validateSettings(input, current = defaultSettings()) {
  if (!isRecord(input)) throw new Error('设置必须是 JSON 对象。');
  const next = { ...current };
  for (const key of ['autoArchive', 'followUpEnabled', 'followUpReuseSession']) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') throw new Error(`${key} 必须是布尔值。`);
      next[key] = input[key];
    }
  }
  if ('maxConcurrentSessions' in input) {
    const value = input.maxConcurrentSessions;
    if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
      throw new Error('自动处理并发数必须是 1 到 10 之间的整数。');
    }
    next.maxConcurrentSessions = value;
  }
  if ('maxFollowUps' in input) {
    const value = input.maxFollowUps;
    if (!Number.isSafeInteger(value) || value < 0 || value > 10) {
      throw new Error('自动续办轮数上限必须是 0 到 10 之间的整数。');
    }
    next.maxFollowUps = value;
  }
  if ('followUpDelayMinutes' in input) {
    const value = input.followUpDelayMinutes;
    if (!Number.isSafeInteger(value) || value < 1 || value > 1440) {
      throw new Error('续办等待时间必须是 1 到 1440 分钟之间的整数。');
    }
    next.followUpDelayMinutes = value;
  }
  if ('issueSessionCwd' in input) {
    if (typeof input.issueSessionCwd !== 'string' || input.issueSessionCwd.length > 1024) {
      throw new Error('Issue Session 工作区文件夹必须是不超过 1024 字符的字符串。');
    }
    next.issueSessionCwd = input.issueSessionCwd.trim();
  }
  if ('issueSessionModel' in input) {
    const value = input.issueSessionModel;
    if (value !== null && (!isRecord(value)
      || typeof value.provider !== 'string' || !value.provider.trim() || value.provider.length > 200
      || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200)) {
      throw new Error('Issue Session 模型必须是 null，或包含非空 provider 和 model 的对象。');
    }
    if (value?.reasoningEffort !== undefined
      && (typeof value.reasoningEffort !== 'string' || !value.reasoningEffort.trim() || value.reasoningEffort.length > 200)) {
      throw new Error('Issue 思考强度必须省略，或是不超过 200 字符的非空字符串。');
    }
    next.issueSessionModel = value === null ? null : {
      provider: value.provider.trim(),
      model: value.model.trim(),
      ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort.trim() } : {}),
    };
  }
  return next;
}

/** 状态文件中的 Issue 条目回读：与 normalizeIssue 同构，保留 source/iid/projectId/labels/updatedAt。 */
export function normalizeStoredIssue(raw) {
  if (!isIssueItem(raw)) throw new Error('Issue 条目缺少 source=issue 标记。');
  const idValue = raw.id;
  if ((typeof idValue !== 'string' && typeof idValue !== 'number') || !String(idValue).trim()) {
    throw new Error('Issue 条目缺少有效 id。');
  }
  const id = String(idValue).trim();
  const iid = Number.isSafeInteger(raw.iid) && raw.iid >= 1 ? raw.iid : (text(raw.iid).slice(0, 20) || '');
  const projectId = (typeof raw.projectId === 'string' || typeof raw.projectId === 'number') && String(raw.projectId).trim()
    ? String(raw.projectId).trim() : '';
  return {
    id,
    title: text(raw.title, `Issue ${id}`).slice(0, 1000),
    url: safeUrl(raw.url),
    noteId: '',
    project: text(raw.project).slice(0, 500),
    targetType: 'issue',
    action: 'issue-processing',
    authorId: '',
    author: text(raw.author).slice(0, 200),
    body: text(raw.body).slice(0, 2000),
    state: text(raw.state).slice(0, 100),
    createdAt: text(raw.createdAt).slice(0, 100),
    source: 'issue',
    iid,
    projectId,
    labels: Array.isArray(raw.labels)
      ? raw.labels.filter((label) => typeof label === 'string' && label.trim()).map((label) => label.trim().slice(0, 100)).slice(0, 20)
      : [],
    updatedAt: text(raw.updatedAt).slice(0, 100),
  };
}

/** 该条目是否来自「指派给我的 Issue」面板，而不是 GitLab Todo 待办列表。 */
export function isIssueItem(item) {
  return isRecord(item) && item.source === 'issue';
}

/**
 * Issue 面板条目归一化：REST /issues 响应 → 与 normalizeTodo 同构的 item，
 * 另带 source/iid/projectId/labels/updatedAt。合成 id `issue-<projectId>-<iid>`
 * 与真实 Todo 数字 id 不冲突，可安全共用 handled/pending 记录体系。
 * 无效条目返回 null（列表容错），调用方过滤。
 */
export function normalizeIssue(raw) {
  if (!isRecord(raw)) return null;
  const iid = Number.isSafeInteger(raw.iid) && raw.iid >= 1 ? raw.iid : 0;
  if (!iid) return null;
  const projectId = (typeof raw.project_id === 'string' || typeof raw.project_id === 'number') && String(raw.project_id).trim()
    ? String(raw.project_id).trim() : '';
  if (!projectId) return null;
  const url = safeUrl(raw.web_url);
  // references.full 形如 group/sub#iid，是最权威的项目路径来源；缺失时退回 web_url 解析。
  let project = '';
  const ref = String(raw.references?.full ?? '');
  const refMatch = ref.match(/^(.+?)#\d+$/);
  if (refMatch) project = refMatch[1];
  if (!project && url) {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/^\/(.+?)\/-\/(issues|work_items)\/\d+\/?$/);
      if (match && !match[1].startsWith('groups/')) project = match[1];
    } catch {}
  }
  const author = isRecord(raw.author) ? raw.author : {};
  return {
    id: `issue-${projectId}-${iid}`,
    title: text(raw.title).slice(0, 1000) || `Issue #${iid}`,
    url,
    noteId: '',
    project: text(project).slice(0, 500),
    targetType: 'issue',
    action: 'issue-processing',
    authorId: '',
    author: text(author.username, text(author.name)).slice(0, 200),
    body: text(raw.description).slice(0, 2000),
    state: text(raw.state).slice(0, 100),
    createdAt: text(raw.created_at).slice(0, 100),
    source: 'issue',
    iid,
    projectId,
    labels: Array.isArray(raw.labels)
      ? raw.labels.filter((label) => typeof label === 'string' && label.trim()).map((label) => label.trim().slice(0, 100)).slice(0, 20)
      : [],
    updatedAt: text(raw.updated_at).slice(0, 100),
  };
}

/**
 * Issue 状态 REST 路径（闭环判定“只认 Issue 关闭”用）：
 * 优先用 item 里的 projectId/iid（归一化字段）；缺失时退回解析 web_url。
 * 返回 `projects/<id>/issues/<iid>`；解析不出返回空串。
 */
export function issueApiPath(item) {
  const projectId = (typeof item?.projectId === 'string' || typeof item?.projectId === 'number') && String(item.projectId).trim()
    ? String(item.projectId).trim() : '';
  const iid = Number.isSafeInteger(item?.iid) && item.iid >= 1 ? item.iid : 0;
  if (projectId && iid) return `projects/${encodeURIComponent(projectId)}/issues/${iid}`;
  try {
    const parsed = new URL(String(item?.url ?? ''));
    const match = parsed.pathname.match(/^\/(.+?)\/-\/issues\/(\d+)\/?$/);
    if (match && !match[1].startsWith('groups/')) return `projects/${encodeURIComponent(match[1])}/issues/${match[2]}`;
  } catch {}
  return '';
}

/**
 * Issue 面板会话标题固定为“仓库名 #Issue 编号”，不带轮次。
 */
export function buildSessionTitle(issue) {
  const url = String(issue?.url ?? '');
  const repository = String(issue?.project ?? '').split('/').filter(Boolean).pop() || 'Issue';
  const number = String(issue?.iid ?? '').trim() || url.match(/\/-\/(?:issues|work_items)\/(\d+)/)?.[1] || 'unknown';
  return `ISSUE-${repository} #${number}`;
}

/**
 * Todo 目标对应的 discussions REST 路径，用于核对“原 note 讨论串里是否有我方回复”。
 * 仅支持项目级 Issue / WorkItem / MR；解析不了返回空串（核对结果按未知处理）。
 */
export function discussionsApiPath(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return '';
  }
  const match = parsed.pathname.match(/^\/(.+?)\/-\/(issues|work_items|merge_requests)\/(\d+)\/?$/);
  if (!match || match[1].startsWith('groups/')) return '';
  const kind = match[2] === 'merge_requests' ? 'merge_requests' : 'issues';
  return `projects/${encodeURIComponent(match[1])}/${kind}/${match[3]}/discussions`;
}

/** 只保留与 Todo 同源的 MR 链接，去重并限量；会话自述的其他内容一律不进入豁免清单。 */
export function normalizeMrUrls(values, originUrl = '') {
  let origin = '';
  try {
    origin = originUrl ? new URL(originUrl).origin : '';
  } catch {
    origin = '';
  }
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const candidate = safeUrl(value);
    if (!candidate || !/\/-\/merge_requests\/\d+/.test(candidate)) continue;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (origin && parsed.origin !== origin) continue;
    const clean = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    if (seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
    if (result.length >= 10) break;
  }
  return result;
}

/** 从 marker 之后截出第一个配平的 JSON 对象文本（忽略字符串内的花括号）。 */
function balancedObject(source) {
  const start = source.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

/**
 * 解析会话最后输出的结案报告：`[TODO-CLOSURE] {"status":...}`。
 * 取文本中最后一个合法报告；提示词里的格式模板（占位符）不会被误判为报告。
 * JSON 不合法时退回正则只取 status/summary，其余字段按缺省处理。
 */
export function parseClosureReport(source, originUrl = '') {
  const content = String(source ?? '');
  let cursor = content.lastIndexOf(CLOSURE_MARKER);
  while (cursor >= 0) {
    const rest = content.slice(cursor + CLOSURE_MARKER.length);
    const line = rest.split(/\r?\n/, 1)[0];
    let value = null;
    const candidate = balancedObject(rest.slice(0, 4000));
    if (candidate) {
      try {
        value = JSON.parse(candidate);
      } catch {
        value = null;
      }
    }
    if (!isRecord(value)) {
      const status = line.match(/"status"\s*:\s*"(done|waiting|needs-human)"/)?.[1];
      if (status) {
        const summary = line.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
        value = { status, summary };
      }
    }
    if (isRecord(value) && REPORT_STATUSES.includes(value.status)) {
      const minutes = Number(value.resumeAfterMinutes);
      const itemId = (typeof value.itemId === 'string' || typeof value.itemId === 'number')
        ? String(value.itemId).trim().slice(0, 100)
        : '';
      return {
        ...(itemId ? { itemId } : {}),
        status: value.status,
        summary: text(value.summary).replace(/\s+/g, ' ').slice(0, 300),
        resumeAfterMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(Math.round(minutes), 1440) : null,
        noAction: value.status === 'done' && value.noAction === true,
        openMrs: normalizeMrUrls(value.openMrs, originUrl),
      };
    }
    cursor = cursor > 0 ? content.lastIndexOf(CLOSURE_MARKER, cursor - 1) : -1;
  }
  return null;
}

/**
 * 闭环裁决（纯函数）。Todo 的 needs-human 自述优先于待办消失事实，防止仍需人接手却被归档：
 * - Todo 会话自述 needs-human（且没有确认缺回复）→ needs-human，不自动续办，等明确人工确认。
 * - 其他 Todo 已不在待办列表、且讨论串里没有确认“缺回复” → closed；Issue 仍只认实际关闭。
 * - 其余未闭环（等待 CI、回合失败、漏回复、漏标记）→ follow-up，按退避时间新开续办会话；
 *   不允许续办时（手动派发、开关关闭、轮数用尽、超时限）降级为 needs-human。
 */
export function assessClosure(input) {
  const {
    itemOpen,
    replied = null,
    turnOk = true,
    turnError = '',
    report = null,
    round = 1,
    followUpBlocked = '',
    baseDelayMinutes = DEFAULT_SETTINGS.followUpDelayMinutes,
    // 闭环口径：todo 认“待办列表消失”，issue 只认“Issue 已关闭”（unit 仅影响文案）。
    unit = 'todo',
  } = input ?? {};
  const summary = text(report?.summary);
  const closedFact = unit === 'issue' ? 'Issue 已关闭' : 'Todo 已标记完成';
  const stillOpenFact = unit === 'issue' ? 'Issue 仍未关闭' : 'Todo 未被标记完成';
  if (report?.status === 'needs-human' && replied !== false && (unit !== 'issue' || itemOpen)) {
    return { closure: 'needs-human', note: summary || '会话判定需要人工接手', delayMinutes: null };
  }
  if (!itemOpen && replied !== false) {
    return {
      closure: 'closed',
      // Todo 在 replied === null 时注明未核对；Issue 极简任务没有插件回复契约，只报告真实关闭状态。
      note: `${summary || (turnOk ? closedFact : `回合异常结束，但${closedFact}`)}${unit !== 'issue' && replied === null ? '（讨论串回复未核对）' : ''}`.slice(0, 500),
      delayMinutes: null,
    };
  }
  const issues = [];
  if (!turnOk) issues.push(`回合未正常结束${turnError ? `（${turnError}）` : ''}`);
  if (itemOpen) {
    if (report?.status === 'done') issues.push(`会话自述已完成，但 ${stillOpenFact}`);
    else if (report?.status === 'waiting') issues.push(`等待外部条件${summary ? `：${summary}` : ''}`);
    else if (report?.status === 'needs-human') issues.push(`需要人工接手${summary ? `：${summary}` : ''}`);
    else if (turnOk) issues.push(unit === 'issue' ? stillOpenFact : `${stillOpenFact}，且会话没有输出结案报告`);
  }
  if (replied === false) issues.push(unit === 'issue' ? 'Issue 讨论区没有我方回复' : '原 note 讨论串中没有我方回复');
  const note = issues.join('；').slice(0, 500);
  if (followUpBlocked) {
    return { closure: 'needs-human', note: `${note}；${followUpBlocked}`.slice(0, 500), delayMinutes: null };
  }
  const exponent = Math.max(0, Math.min(round - 1, 6));
  let delayMinutes;
  if (report?.status === 'waiting' && turnOk && replied !== false) {
    // 真正在等外部条件：以会话建议时间为首选项，但不低于逐轮翻倍的退避下限，
    // 避免会话每次自报同一时间把节奏固定住。
    const suggested = report.resumeAfterMinutes ?? 0;
    const backoff = baseDelayMinutes * 2 ** exponent;
    delayMinutes = Math.max(2, Math.min(Math.max(suggested, backoff), 1440));
  } else {
    // 回合失败、漏回复、漏标记：属于补救，快速重试（2、4、8… 分钟）。
    delayMinutes = Math.min(2 * 2 ** exponent, 240);
  }
  return { closure: 'follow-up', note, delayMinutes: Math.round(delayMinutes) };
}

/** Issue 面板只发送目标与动作；项目规则由新会话工作区的 AGENTS.md／CLAUDE.md 提供。 */
export function buildIssuePrompt(issue) {
  return [String(issue?.url ?? '').trim(), '开始处理'].filter(Boolean).join('\n');
}

export function initialState() {
  return {
    version: STATE_VERSION,
    settings: defaultSettings(),
    issues: [],
    handled: {},
    pending: {},
    recent: [],
    lastRunAt: null,
    lastSuccessAt: null,
    lastPollError: null,
    lastDispatchError: null,
    lastNewCount: 0,
  };
}

function normalizeManualHandoffs(value) {
  return (Array.isArray(value) ? value : []).filter((entry) => isRecord(entry)
    && typeof entry.requestId === 'string' && entry.requestId.length > 0 && entry.requestId.length <= 200
    && typeof entry.sourceSessionId === 'string' && entry.sourceSessionId.length > 0 && entry.sourceSessionId.length <= 200)
    .map((entry) => ({
      requestId: entry.requestId,
      ...(typeof entry.taskId === 'string' ? { taskId: entry.taskId } : {}),
      sourceSessionId: entry.sourceSessionId,
      sessionId: typeof entry.sessionId === 'string' && entry.sessionId.length <= 200 ? entry.sessionId : '',
      createdAt: timestamp(entry.createdAt),
      status: ['prepared', 'creating', 'creation-unknown', 'created', 'ready'].includes(entry.status) ? entry.status : 'creation-unknown',
      handoffText: text(entry.handoffText).slice(0, 5000),
      error: text(entry.error).slice(0, 1000),
    }));
}

/** 会话发到讨论串的我方回复快照（回复预览用）：正文限长，坏数据归 null。 */
function normalizeReplyCapture(value) {
  if (!isRecord(value)) return null;
  const body = text(value.body);
  const id = text(value.id).slice(0, 50);
  if (!body && !id) return null;
  return {
    id,
    body: body.slice(0, 2000),
    url: safeUrl(value.url),
    createdAt: timestamp(value.createdAt),
  };
}

/** 事件驱动续办的 MR 监视器：mrs 限 3 条，lastStates 记录上次观察状态。 */
function normalizeWatch(value, originUrl = '') {
  if (!isRecord(value)) return null;
  const mrs = normalizeMrUrls(value.mrs, originUrl);
  if (mrs.length === 0) return null;
  const lastStates = {};
  for (const [mrUrl, status] of Object.entries(isRecord(value.lastStates) ? value.lastStates : {})) {
    if (safeUrl(mrUrl) && typeof status === 'string') lastStates[mrUrl] = status.slice(0, 40);
  }
  return { mrs, lastStates };
}

function normalizeHistory(value) {
  return (Array.isArray(value) ? value : [])
    .filter((entry) => isRecord(entry) && typeof entry.sessionId === 'string' && entry.sessionId)
    .slice(-10)
    .map((entry) => ({
      sessionId: entry.sessionId,
      sessionTitle: text(entry.sessionTitle).slice(0, 200),
      archived: entry.archived === true,
      archiveError: text(entry.archiveError).slice(0, 300),
      round: Number.isSafeInteger(entry.round) && entry.round >= 1 ? entry.round : 1,
      endedAt: timestamp(entry.endedAt),
      status: text(entry.status).slice(0, 40),
      note: text(entry.note).slice(0, 500),
    }));
}

/** 状态里只保留 Issue 记录：id 以 issue- 开头，或条目带 source=issue 标记。Todo 记录在 v8 迁移时丢弃。 */
function isIssueRecord(id, record) {
  return String(id).startsWith('issue-') || isIssueItem(record?.item);
}

function normalizeHandledRecord(id, record) {
  const sessionId = typeof record.sessionId === 'string' && record.sessionId ? record.sessionId : null;
  const outcome = record.outcome === 'merge-request-done' ? 'merge-request-done' : 'session-accepted';
  if (!sessionId && outcome === 'session-accepted') return null;
  const acceptedAt = timestamp(record.acceptedAt) ?? Date.now();
  const url = safeUrl(record.url);
  let item = null;
  if (isRecord(record.item)) {
    try {
      item = normalizeStoredIssue(record.item);
    } catch {
      item = null;
    }
  }
  const minutes = Number(record.resumeAfterMinutes);
  return {
    id,
    sessionId,
    outcome,
    acceptedAt,
    // 闭环链路字段：round 为本条目的第几轮会话；closure 为空表示旧记录或尚未结算。
    round: Number.isSafeInteger(record.round) && record.round >= 1 ? record.round : 1,
    firstAcceptedAt: timestamp(record.firstAcceptedAt) ?? acceptedAt,
    closure: CLOSURE_STATES.includes(record.closure) ? record.closure : '',
    closureNote: text(record.closureNote).slice(0, 500),
    nextAttemptAt: timestamp(record.nextAttemptAt),
    replied: record.replied === true ? true : record.replied === false ? false : null,
    reportStatus: REPORT_STATUSES.includes(record.reportStatus) ? record.reportStatus : '',
    reportSummary: text(record.reportSummary).slice(0, 300),
    reportNoAction: record.reportNoAction === true,
    pendingUnconfirmed: record.pendingUnconfirmed === true,
    resumeAfterMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    openMrs: normalizeMrUrls(record.openMrs, url),
    // 纯等待轮计数：waiting 且无补救需求的结算轮不计入轮数预算（受 72 小时总时限约束）。
    waitRounds: Number.isSafeInteger(record.waitRounds) && record.waitRounds >= 0 ? record.waitRounds : 0,
    // 续办派发失败计数：连续失败按指数退避并最终升级需人工。
    dispatchFailures: Number.isSafeInteger(record.dispatchFailures) && record.dispatchFailures >= 0 ? record.dispatchFailures : 0,
    // 会话复用：本会话已被后续轮次接力复用的次数；reused 表示当前轮是复用上一轮会话。
    reuseCount: Number.isSafeInteger(record.reuseCount) && record.reuseCount >= 0 ? record.reuseCount : 0,
    reused: record.reused === true,
    author: text(record.author).slice(0, 200),
    excerpt: text(record.excerpt).slice(0, 300),
    // 本轮结算时捕获的“我方最新回复”快照：面板回复预览展示用。
    lastReply: normalizeReplyCapture(record.lastReply),
    // 事件驱动续办监视器字段：保留以便往返不丢失。
    watch: normalizeWatch(record.watch, url),
    // 需人工记录的人工确认时间：面板据此移出待办计数。
    acknowledgedAt: timestamp(record.acknowledgedAt),
    manualHandoffs: normalizeManualHandoffs(record.manualHandoffs),
    history: normalizeHistory(record.history),
    item,
    sessionTitle: text(record.sessionTitle),
    requestId: text(record.requestId).slice(0, 200),
    executionStatus: ['running', 'completed', 'failed'].includes(record.executionStatus) ? record.executionStatus : null,
    automatic: record.automatic !== false,
    completedAt: timestamp(record.completedAt),
    executionError: text(record.executionError),
    archived: record.archived === true,
    archiveError: text(record.archiveError).slice(0, 300),
    title: text(record.title, `Issue ${id}`),
    url,
    project: text(record.project),
  };
}

function normalizePendingRecord(record) {
  const item = normalizeStoredIssue(record.item);
  const createdAt = timestamp(record.createdAt) ?? Date.now();
  return {
    sessionId: record.sessionId,
    createdAt,
    manualHandoffs: normalizeManualHandoffs(record.manualHandoffs),
    automatic: record.automatic !== false,
    followUp: record.followUp === true,
    requestId: text(record.requestId).slice(0, 200),
    sessionTitle: text(record.sessionTitle).slice(0, 200),
    reused: record.reused === true,
    reuseCount: Number.isSafeInteger(record.reuseCount) && record.reuseCount >= 0 ? record.reuseCount : 0,
    waitRounds: Number.isSafeInteger(record.waitRounds) && record.waitRounds >= 0 ? record.waitRounds : 0,
    round: Number.isSafeInteger(record.round) && record.round >= 1 ? record.round : 1,
    firstAcceptedAt: timestamp(record.firstAcceptedAt) ?? createdAt,
    history: normalizeHistory(record.history),
    openMrs: normalizeMrUrls(record.openMrs, item.url),
    item,
  };
}

export function normalizeState(value) {
  if (!isRecord(value)) {
    throw new Error(`插件状态必须是 JSON 对象，期望 version=${STATE_VERSION}。`);
  }
  if (value.version === 1 || value.version === 2) {
    // v1/v2 → v3：移除外置 shell/Python 脚本。
    const settings = { ...(isRecord(value.settings) ? value.settings : {}) };
    delete settings.shell;
    delete settings.script;
    value = { ...value, version: 3, settings };
  }
  // 只有旧版本迁移才丢弃 Todo 形态的 handled/pending 记录；v8 状态按原样归一化。
  const legacyMigration = value.version !== STATE_VERSION;
  // v3 → v4 → v5 → v6 → v7：只改版本号；v3 时代预填的工作区规则与 Todo 台账随 Todo 功能一并删除。
  for (const from of [3, 4, 5, 6]) {
    if (value.version === from) value = { ...value, version: from + 1 };
  }
  // v7 → v8：删除 GitLab Todo 功能。ledger、Todo 条目及其 handled/pending 记录在下方统一丢弃，只保留 Issue 记录。
  if (value.version === 7) value = { ...value, version: STATE_VERSION };
  if (value.version !== STATE_VERSION) {
    throw new Error(`插件状态版本不受支持，期望 version=${STATE_VERSION}。`);
  }
  const base = initialState();
  const handled = {};
  if (isRecord(value.handled)) {
    for (const [id, record] of Object.entries(value.handled)) {
      if (!isRecord(record) || (legacyMigration && !isIssueRecord(id, record))) continue;
      const normalized = normalizeHandledRecord(id, record);
      if (normalized) handled[id] = normalized;
    }
  }
  const pending = {};
  if (isRecord(value.pending)) {
    for (const [id, record] of Object.entries(value.pending)) {
      if (!isRecord(record) || typeof record.sessionId !== 'string' || !record.sessionId || !isRecord(record.item)) continue;
      if (legacyMigration && !isIssueRecord(id, record)) continue;
      try {
        pending[id] = normalizePendingRecord(record);
      } catch {}
    }
  }
  for (const id of pruneHandled(handled).deleted) delete handled[id];
  const recent = Object.values(handled)
    .filter((record) => Boolean(record.sessionId))
    .sort((a, b) => b.acceptedAt - a.acceptedAt)
    .slice(0, 50);

  const storedSettings = isRecord(value.settings) ? { ...value.settings } : {};
  // 旧版本 Issue 与 Todo 共用设置：升级时只复制一次，之后修改任意一边都不再同步。
  if (!('issueSessionCwd' in storedSettings) && typeof storedSettings.sessionCwd === 'string') {
    storedSettings.issueSessionCwd = storedSettings.sessionCwd;
  }
  if (!('issueSessionModel' in storedSettings) && 'sessionModel' in storedSettings) {
    storedSettings.issueSessionModel = storedSettings.sessionModel;
  }
  return {
    ...base,
    settings: validateSettings(storedSettings, base.settings),
    // Issue 面板缓存：坏行直接丢弃，不击穿状态恢复。
    issues: Array.isArray(value.issues)
      ? value.issues.map((item) => {
          try {
            return isIssueItem(item) ? normalizeStoredIssue(item) : normalizeIssue(item);
          } catch {
            return null;
          }
        }).filter(Boolean)
      : [],
    handled,
    pending,
    manualHandoffs: normalizeManualHandoffs(value.manualHandoffs),
    recent,
    lastRunAt: timestamp(value.lastRunAt),
    lastSuccessAt: timestamp(value.lastSuccessAt),
    lastPollError: typeof value.lastPollError === 'string' ? value.lastPollError : null,
    lastDispatchError: typeof value.lastDispatchError === 'string' ? value.lastDispatchError : null,
    lastNewCount: Number.isSafeInteger(value.lastNewCount) && value.lastNewCount >= 0 ? value.lastNewCount : 0,
  };
}

/** handled 状态文件 GC：返回被删除的 id 列表。活跃记录（follow-up/verifying/未确认的 needs-human/pendingUnconfirmed）永不删；已结算记录按保留期清，超出上限再按结算时间删最旧。 */
export function pruneHandled(handled) {
  const now = Date.now();
  const entries = Object.entries(isRecord(handled) ? handled : {});
  const settled = [];
  const deleted = [];
  for (const [id, record] of entries) {
    if (!isRecord(record)) continue;
    const closure = record.closure ?? '';
    // 活跃保护：待续办、待核对、未人工确认、待重试确认的一律保留。
    if (closure === 'follow-up' || closure === 'verifying') continue;
    if (closure === 'needs-human' && record.acknowledgedAt == null) continue;
    if (record.pendingUnconfirmed === true) continue;
    if (closure !== 'closed' && closure !== 'needs-human') continue;
    const ref = Number.isFinite(record.acknowledgedAt) ? record.acknowledgedAt
      : (Number.isFinite(record.completedAt) ? record.completedAt : (record.acceptedAt ?? 0));
    settled.push({ id, ref });
  }
  const cutoff = now - HANDLED_CLOSED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const survivors = [];
  for (const item of settled) {
    if (item.ref < cutoff) deleted.push(item.id); else survivors.push(item);
  }
  if (survivors.length > HANDLED_SETTLED_MAX) {
    survivors.sort((a, b) => a.ref - b.ref);
    const overflow = survivors.length - HANDLED_SETTLED_MAX;
    for (const item of survivors.slice(0, overflow)) deleted.push(item.id);
  }
  return { deleted };
}

/** 工作区路径归一化：比较时忽略大小写、正反斜杠与结尾分隔符。 */
export function normalizeWorkspacePath(value) {
  return String(value ?? '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

/**
 * 组装 DSH 工作区总览。名册（session/list，含全部已存储会话与 cwd）驱动分组：
 * 按 cwd 精确匹配工作区路径，其次最长前缀（会话开在工作区子目录内），
 * 都不命中归入“未归属”桶；registry 的 sessionIds 仅作补充（名册缺项时仍列出）。
 * 不依赖 workspaceRegistry 实体 getter——它会按内部头索引过滤，旧会话可能被悄悄丢弃。
 */
export function buildWorkspaceOverview(workspaces, roster, pluginSessions = [], configuredPath = '') {
  const items = Array.isArray(workspaces) ? workspaces : [];
  const rosterItems = (Array.isArray(roster) ? roster : []).filter((item) => item && item.sessionId);
  const rosterById = new Map(rosterItems.map((item) => [String(item.sessionId), item]));
  const pluginById = new Map(
    (Array.isArray(pluginSessions) ? pluginSessions : [])
      .filter((item) => item?.sessionId)
      .map((item) => [String(item.sessionId), item]),
  );
  const configured = normalizeWorkspacePath(configuredPath);
  const sessionRow = (sessionId, summary, plugin) => ({
    sessionId,
    known: Boolean(summary),
    running: summary?.running === true,
    updatedAt: typeof summary?.updatedAt === 'number' && Number.isFinite(summary.updatedAt) ? summary.updatedAt : null,
    cwd: typeof summary?.cwd === 'string' ? summary.cwd : '',
    plugin: Boolean(plugin),
    sessionTitle: typeof plugin?.sessionTitle === 'string' ? plugin.sessionTitle : '',
    automatic: plugin ? plugin.automatic !== false : null,
    archived: plugin ? plugin.archived === true : false,
    url: typeof plugin?.url === 'string' ? plugin.url : '',
  });
  const byUpdatedAtDesc = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);

  const views = items.map((item, index) => {
    const path = String(item?.path ?? item?.cwd ?? '');
    return {
      workspaceId: String(item?.id ?? item?.workspaceId ?? `workspace-${index}`),
      path,
      normalizedPath: normalizeWorkspacePath(path),
      title: String(item?.title ?? ''),
      configured: Boolean(configured) && normalizeWorkspacePath(path) === configured,
      createdAt: item?.createdAt ?? null,
      updatedAt: item?.updatedAt ?? null,
      registryIds: Array.isArray(item?.sessionIds) ? item.sessionIds.map((id) => String(id ?? '')) : [],
      sessions: [],
    };
  });

  // 1) 名册优先：cwd 精确命中工作区 → 最长前缀（子目录）→ 未归属。空白草稿不展示。
  const unassigned = [];
  for (const summary of rosterItems) {
    if (summary.blank === true) continue;
    const sessionId = String(summary.sessionId);
    const normalizedCwd = normalizeWorkspacePath(summary.cwd);
    let target = null;
    if (normalizedCwd) {
      target = views.find((view) => view.normalizedPath && view.normalizedPath === normalizedCwd) ?? null;
      if (!target) {
        let bestLength = -1;
        for (const view of views) {
          if (view.normalizedPath && normalizedCwd.startsWith(`${view.normalizedPath}/`) && view.normalizedPath.length > bestLength) {
            target = view;
            bestLength = view.normalizedPath.length;
          }
        }
      }
    }
    const row = sessionRow(sessionId, summary, pluginById.get(sessionId));
    (target ? target.sessions : unassigned).push(row);
  }

  // 2) 注册表补充：名册中没有、但 registry 仍登记的会话（known=false）保留展示。
  const accounted = new Set(rosterItems.map((item) => String(item.sessionId)));
  for (const view of views) {
    for (const id of view.registryIds) {
      if (!id || accounted.has(id)) continue;
      accounted.add(id);
      view.sessions.push(sessionRow(id, rosterById.get(id), pluginById.get(id)));
    }
    view.sessions.sort(byUpdatedAtDesc);
  }
  unassigned.sort(byUpdatedAtDesc);

  const result = views.map((view) => ({
    workspaceId: view.workspaceId,
    unassigned: false,
    path: view.path,
    title: view.title,
    configured: view.configured,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    sessionCount: view.sessions.length,
    sessions: view.sessions,
  }));
  if (unassigned.length > 0) {
    result.push({
      workspaceId: '',
      unassigned: true,
      path: '',
      title: '',
      configured: false,
      createdAt: null,
      updatedAt: null,
      sessionCount: unassigned.length,
      sessions: unassigned,
    });
  }
  return result;
}

/**
 * Issue 面板投影：把 state.issues（指派给我的开放 Issue 快照）与 handled/pending
 * 记录按合成 id 关联，面板据此渲染“处理/打开会话/重新处理”与状态徽标。
 * orphans：有处理记录但已不在当前开放 Issue 列表里的条目（已关闭或已转移），
 * 仍列出保留会话入口，用 missing=true 标记。
 */
export function buildIssueProjection(state) {
  const issues = Array.isArray(state?.issues) ? state.issues : [];
  const present = new Set(issues.map((item) => item.id));
  const annotate = (item) => {
    const handled = state?.handled?.[item.id];
    const pending = state?.pending?.[item.id];
    return {
      ...item,
      handled: Boolean(handled) || Boolean(pending),
      sessionId: handled?.sessionId ?? pending?.sessionId ?? null,
      sessionTitle: handled?.sessionTitle ?? pending?.sessionTitle ?? '',
      outcome: handled?.outcome ?? '',
      executionStatus: handled?.executionStatus ?? (pending ? 'starting' : ''),
      executionError: handled?.executionError ?? '',
      routed: handled?.routed === true || pending?.routed === true,
      routeMode: handled?.routeMode ?? pending?.routeMode ?? '',
      closure: handled?.closure ?? '',
      closureNote: handled?.closureNote ?? '',
      reportSummary: handled?.reportSummary ?? '',
      round: handled?.round ?? 1,
      nextAttemptAt: handled?.nextAttemptAt ?? null,
      archived: handled?.archived === true,
      pending: Boolean(pending) && !handled,
      missing: false,
    };
  };
  const items = issues.map(annotate);
  const orphans = [];
  for (const record of Object.values(state?.handled ?? {})) {
    if (!isIssueItem(record?.item) || !record.sessionId) continue;
    if (present.has(record.id)) continue;
    orphans.push({ ...record.item, ...annotate({ ...record.item }), handled: true, missing: true });
  }
  for (const record of Object.values(state?.pending ?? {})) {
    if (!isIssueItem(record?.item) || !record.sessionId) continue;
    if (present.has(record.item.id)) continue;
    if (orphans.some((entry) => entry.id === record.item.id)) continue;
    orphans.push({ ...record.item, ...annotate(record.item), handled: true, missing: true });
  }
  orphans.sort((a, b) => {
    const at = state?.handled?.[a.id]?.acceptedAt ?? state?.pending?.[a.id]?.createdAt ?? 0;
    const bt = state?.handled?.[b.id]?.acceptedAt ?? state?.pending?.[b.id]?.createdAt ?? 0;
    return bt - at;
  });
  return { items, orphans };
}

/** 闭环统计：给面板显示“待续办 / 需人工”。已人工确认的需人工记录不再计数。 */
export function closureCounts(state) {
  const counts = { followUp: 0, needsHuman: 0, verifying: 0 };
  for (const record of Object.values(state.handled)) {
    if (record.closure === 'follow-up') counts.followUp += 1;
    else if (record.closure === 'needs-human' && !record.acknowledgedAt) counts.needsHuman += 1;
    else if (record.closure === 'verifying') counts.verifying += 1;
  }
  return counts;
}

/**
 * 运行时内存日志（Log Tab 用）：只进内存、不落文件的环形缓冲区。
 * 内存封顶是硬性要求，采用三条独立防线（见 host/constants.js 注释）：
 *   ① LOG_MAX_ENTRIES 条数上限 → 淘汰最旧（FIFO）；
 *   ② LOG_MAX_CHARS 合计字符数上限 → 淘汰最旧直到配额内；
 *   ③ LOG_MAX_LINE_CHARS 单条裁剪 → 长栈/长 JSON 截断标注，不塞进缓冲。
 * dropped 记录被丢弃的条数（面板显示“已丢弃 N 条”），reset 时清零。
 * list 返回副本（新→旧），防止外部意外改动内部数组。
 */
export function createLogBuffer({ maxEntries = 500, maxChars = 65536, maxLineChars = 500 } = {}) {
  const buffer = {
    entries: [],
    chars: 0,
    dropped: 0,
  };
  const api = {
    get dropped() { return buffer.dropped; },
    push(level, message) {
      const safeLevel = ['info', 'warn', 'error', 'debug'].includes(level) ? level : 'info';
      let textMessage = String(message ?? '').replace(/\s+/g, ' ').trim();
      if (textMessage.length > maxLineChars) {
        textMessage = `${textMessage.slice(0, maxLineChars)}…（截断 ${textMessage.length - maxLineChars} 字）`;
      }
      if (!textMessage) return;
      buffer.entries.push({ ts: Date.now(), level: safeLevel, message: textMessage });
      buffer.chars += textMessage.length;
      // 双维度封顶：条数与合计字符任一超限都从头部淘汰最旧。
      while (buffer.entries.length > maxEntries || buffer.chars > maxChars) {
        const removed = buffer.entries.shift();
        if (!removed) break;
        buffer.chars -= removed.message.length;
        buffer.dropped += 1;
      }
    },
    list(limit = 200) {
      const safeLimit = Number.isSafeInteger(limit) && limit >= 1 ? Math.min(limit, maxEntries) : 200;
      return buffer.entries.slice(-safeLimit).reverse();
    },
    reset() {
      buffer.dropped += buffer.entries.length;
      buffer.entries.length = 0;
      buffer.chars = 0;
    },
    get size() { return buffer.entries.length; },
  };
  return api;
}

/** 面板投影：Issue 面板需要的字段，不含 Todo 原文、台账与收件箱。 */
export function publicState(state, running = false) {
  return {
    settings: {
      ...state.settings,
      issueSessionModel: state.settings.issueSessionModel ? { ...state.settings.issueSessionModel } : null,
    },
    issueCount: Array.isArray(state.issues) ? state.issues.length : 0,
    closure: closureCounts(state),
    recent: state.recent.map(({ item, history, ...record }) => ({ ...record })),
    running,
    lastRunAt: state.lastRunAt,
    lastSuccessAt: state.lastSuccessAt,
    lastPollError: state.lastPollError,
    lastDispatchError: state.lastDispatchError,
    lastPersistError: state.lastPersistError ?? null,
    lastNewCount: state.lastNewCount,
  };
}
