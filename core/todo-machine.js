/**
 * Todo 台账状态机（v4.0）：纯函数，不碰 I/O。
 * 台账 = todos（逐条状态）+ threads（对象线程：会话绑定与在途批次）+ events（环形日志）+ breaker（熔断）。
 * 线程状态不落盘，由其 Todo 状态与 inflight 推导。
 */
import { targetKey } from '../core.js';

export const TODO_STATES = Object.freeze(['queued', 'waiting', 'attention', 'done', 'skipped']);
export const REPORT_STATUS_LIST = Object.freeze(['done', 'waiting', 'needs-human']);
export const BATCH_LIMIT = 10;
export const MAX_ATTEMPTS = 3;
export const BREAKER_LIMIT = 5;
export const RETENTION_DAYS = 30;
export const LEDGER_CAP = 3000;
export const EVENT_CAP = 500;
export const NEEDS_HUMAN_PREFIX = '等人：';
export const NO_REPORT_REASON = '上次未收到报告';
export const LEGACY_REASON = '迁移前遗留';

const DAY_MS = 24 * 60 * 60 * 1000;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value, limit = 500) => (typeof value === 'string' ? value : value == null ? '' : String(value)).slice(0, limit);
const stamp = (value, fallback = null) => (Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback);
const oneLine = (value, limit = 200) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);

export function emptyLedger() {
  return { todos: {}, threads: {}, events: [], breaker: { streak: 0, open: false, since: null }, legacyPending: false };
}

export function threadKind(url) {
  const value = String(url ?? '');
  if (/\/-\/merge_requests\/\d+/u.test(value)) return 'mr';
  if (/\/-\/work_items\/\d+/u.test(value)) return 'work_item';
  if (/\/-\/issues\/\d+/u.test(value)) return 'issue';
  return 'other';
}

function normalizeReport(value) {
  if (!isRecord(value) || !REPORT_STATUS_LIST.includes(value.status)) return null;
  return { status: value.status, summary: oneLine(value.summary, 500), at: stamp(value.at, 0) };
}

function normalizeLedgerTodo(raw, id) {
  if (!isRecord(raw)) return null;
  const threadKey = str(raw.threadKey, 500);
  if (!threadKey) return null;
  const state = TODO_STATES.includes(raw.state) ? raw.state : 'queued';
  const createdAt = stamp(raw.createdAt, Date.now());
  return {
    id,
    threadKey,
    noteId: str(raw.noteId, 40),
    discussionId: str(raw.discussionId, 80),
    author: str(raw.author, 200),
    excerpt: oneLine(raw.excerpt, 200),
    title: str(raw.title, 300),
    url: str(raw.url, 1000),
    project: str(raw.project, 300),
    createdAt,
    state,
    reason: oneLine(raw.reason, 500),
    report: normalizeReport(raw.report),
    attempts: Number.isSafeInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0,
    updatedAt: stamp(raw.updatedAt, createdAt),
  };
}

function normalizeInflight(raw) {
  if (!isRecord(raw) || !Array.isArray(raw.todoIds)) return null;
  const todoIds = [...new Set(raw.todoIds.filter((id) => typeof id === 'string' && id))];
  if (todoIds.length === 0) return null;
  return {
    todoIds,
    reportedIds: [...new Set((Array.isArray(raw.reportedIds) ? raw.reportedIds : []).filter((id) => todoIds.includes(id)))],
    sentAt: stamp(raw.sentAt, Date.now()),
    requestId: str(raw.requestId, 200),
    reported: raw.reported === true,
  };
}

export function normalizeLedger(raw) {
  const ledger = emptyLedger();
  if (!isRecord(raw)) return ledger;
  for (const [id, item] of Object.entries(isRecord(raw.todos) ? raw.todos : {})) {
    const todo = normalizeLedgerTodo(item, id);
    if (todo) ledger.todos[id] = todo;
  }
  for (const [key, item] of Object.entries(isRecord(raw.threads) ? raw.threads : {})) {
    if (!isRecord(item)) continue;
    const createdAt = stamp(item.createdAt, Date.now());
    ledger.threads[key] = {
      key,
      kind: ['mr', 'issue', 'work_item', 'other'].includes(item.kind) ? item.kind : threadKind(key),
      title: str(item.title, 300),
      project: str(item.project, 300),
      url: str(item.url, 1000),
      sessionId: typeof item.sessionId === 'string' && item.sessionId ? item.sessionId.slice(0, 200) : null,
      sessionTitle: str(item.sessionTitle, 200),
      primed: item.primed === true,
      archived: item.archived === true,
      inflight: normalizeInflight(item.inflight),
      lastReport: normalizeReport(item.lastReport),
      createdAt,
      updatedAt: stamp(item.updatedAt, createdAt),
    };
  }
  // 孤儿 Todo（线程缺失）补线程，保证引用完整。
  for (const todo of Object.values(ledger.todos)) ensureThread(ledger, todo, todo.updatedAt);
  ledger.events = (Array.isArray(raw.events) ? raw.events : [])
    .filter((event) => isRecord(event) && typeof event.kind === 'string')
    .slice(-EVENT_CAP)
    .map((event) => ({ at: stamp(event.at, 0), kind: str(event.kind, 40), todoId: str(event.todoId, 100), threadKey: str(event.threadKey, 500), message: oneLine(event.message, 300) }));
  const breaker = isRecord(raw.breaker) ? raw.breaker : {};
  ledger.breaker = {
    streak: Number.isSafeInteger(breaker.streak) && breaker.streak >= 0 ? breaker.streak : 0,
    open: breaker.open === true,
    since: stamp(breaker.since),
  };
  ledger.legacyPending = raw.legacyPending === true;
  return ledger;
}

export function pushEvent(ledger, kind, message, { todoId = '', threadKey = '', now = Date.now() } = {}) {
  ledger.events.push({ at: now, kind, todoId, threadKey, message: oneLine(message, 300) });
  if (ledger.events.length > EVENT_CAP) ledger.events.splice(0, ledger.events.length - EVENT_CAP);
}

function ensureThread(ledger, source, now) {
  const key = source.threadKey ?? targetKey(source.url);
  let thread = ledger.threads[key];
  if (!thread) {
    thread = {
      key, kind: threadKind(source.url || key), title: str(source.title, 300), project: str(source.project, 300),
      url: str(source.url ? source.url.replace(/#.*$/u, '') : key, 1000), sessionId: null, sessionTitle: '', primed: false, archived: false,
      inflight: null, lastReport: null, createdAt: now, updatedAt: now,
    };
    ledger.threads[key] = thread;
  }
  return thread;
}

function touch(todo, now) { todo.updatedAt = now; }

/** 1. 拉取结果并入台账：新 Todo 以 queued 入账（后续规则/预检可改为 skipped），返回新增 id 与涉及线程。 */
export function ingestTodos(ledger, todos, { now = Date.now(), initialState = 'queued', reason = '' } = {}) {
  const added = [];
  const threadKeys = new Set();
  for (const raw of todos) {
    if (ledger.todos[raw.id]) continue;
    const threadKey = targetKey(raw.url);
    if (!threadKey) continue;
    const parsed = Date.parse(raw.createdAt);
    const createdAt = Number.isFinite(parsed) ? parsed : now;
    const todo = {
      id: raw.id, threadKey, noteId: raw.noteId || '', discussionId: '', author: str(raw.author, 200),
      excerpt: oneLine(raw.body, 200), title: str(raw.title, 300), url: str(raw.url, 1000), project: str(raw.project, 300),
      createdAt, state: initialState, reason, report: null, attempts: 0, updatedAt: now,
    };
    ledger.todos[raw.id] = todo;
    const thread = ensureThread(ledger, todo, now);
    thread.updatedAt = now;
    if (!thread.title) thread.title = todo.title;
    added.push(raw.id);
    threadKeys.add(threadKey);
    pushEvent(ledger, 'ingest', `新 Todo（${todo.author || '未知作者'}）`, { todoId: raw.id, threadKey, now });
  }
  return { added, threadKeys };
}

/** 2. 不在 GitLab 待办列表里的非终态 Todo → done（manual）；在途批次里的先不动，回合结束后再收。 */
export function reconcileManual(ledger, pendingIds, now = Date.now()) {
  const closed = [];
  for (const todo of Object.values(ledger.todos)) {
    if (todo.state === 'done' || todo.state === 'skipped' || pendingIds.has(todo.id)) continue;
    if (ledger.threads[todo.threadKey]?.inflight?.todoIds.includes(todo.id)) continue;
    todo.state = 'done';
    todo.reason = 'manual';
    touch(todo, now);
    closed.push(todo.id);
    pushEvent(ledger, 'done', '已在 GitLab 手动完成', { todoId: todo.id, threadKey: todo.threadKey, now });
  }
  return closed;
}

export function skipTodo(ledger, id, reason, now = Date.now()) {
  const todo = ledger.todos[id];
  if (!todo) return false;
  todo.state = 'skipped';
  todo.reason = oneLine(reason, 500);
  touch(todo, now);
  pushEvent(ledger, 'skipped', reason, { todoId: id, threadKey: todo.threadKey, now });
  return true;
}

/** 4. 唤醒：线程上出现新 Todo 时，该线程 waiting 的 Todo 回到 queued。 */
export function wakeThreads(ledger, threadKeys, now = Date.now()) {
  const woken = [];
  for (const todo of Object.values(ledger.todos)) {
    if (todo.state !== 'waiting' || !threadKeys.has(todo.threadKey)) continue;
    todo.state = 'queued';
    todo.reason = '';
    touch(todo, now);
    woken.push(todo.id);
  }
  return woken;
}

/** 5. 组批：每线程至多一个在途批次，queued ≤ BATCH_LIMIT 条按创建时间；全局 free 个名额。 */
export function selectBatches(ledger, { free = 1 } = {}) {
  if (ledger.breaker.open || free < 1) return [];
  const candidates = [];
  for (const thread of Object.values(ledger.threads)) {
    if (thread.inflight) continue;
    const queued = Object.values(ledger.todos)
      .filter((todo) => todo.threadKey === thread.key && todo.state === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id, 'en', { numeric: true }));
    if (queued.length > 0) candidates.push({ thread, todos: queued.slice(0, BATCH_LIMIT) });
  }
  candidates.sort((a, b) => a.todos[0].createdAt - b.todos[0].createdAt);
  return candidates.slice(0, free);
}

export function beginInflight(ledger, threadKey, todoIds, { requestId = '', now = Date.now() } = {}) {
  const thread = ledger.threads[threadKey];
  if (!thread) throw new Error(`线程不存在：${threadKey}`);
  thread.inflight = { todoIds: [...todoIds], reportedIds: [], sentAt: now, requestId, reported: false };
  thread.updatedAt = now;
  pushEvent(ledger, 'dispatch', `投递 ${todoIds.length} 条`, { threadKey, now });
  return thread.inflight;
}

/** 投递失败：每条 attempts+1 仍为 queued；达到上限转 attention。 */
export function failDelivery(ledger, threadKey, todoIds, error, now = Date.now()) {
  for (const id of todoIds) bumpAttempt(ledger, ledger.todos[id], `投递失败：${oneLine(error, 200)}`, now);
}

function bumpAttempt(ledger, todo, reason, now) {
  if (!todo || todo.state === 'done' || todo.state === 'skipped') return;
  todo.attempts += 1;
  touch(todo, now);
  if (todo.attempts >= MAX_ATTEMPTS) {
    todo.state = 'attention';
    todo.reason = reason === NO_REPORT_REASON ? '未报告' : `${reason}（已尝试 ${todo.attempts} 次）`;
    pushEvent(ledger, 'attention', todo.reason, { todoId: todo.id, threadKey: todo.threadKey, now });
  } else {
    todo.state = 'queued';
    todo.reason = reason;
  }
}

/** 报告参数的机械校验：只验证形状与批次归属，不判断内容。 */
export function validateReport(thread, args) {
  if (!isRecord(args)) return { error: '参数必须是对象。' };
  for (const key of Object.keys(args)) if (!['status', 'todoIds', 'summary'].includes(key)) return { error: `未知字段：${key}` };
  if (!REPORT_STATUS_LIST.includes(args.status)) return { error: `status 必须是 ${REPORT_STATUS_LIST.join('/')}。` };
  if (args.summary !== undefined && typeof args.summary !== 'string') return { error: 'summary 必须是字符串。' };
  if (!thread?.inflight) return { error: '该会话当前没有在途的 Todo 批次。' };
  let ids = thread.inflight.todoIds;
  if (args.todoIds !== undefined) {
    if (!Array.isArray(args.todoIds) || args.todoIds.length === 0 || args.todoIds.some((id) => typeof id !== 'string')) {
      return { error: 'todoIds 必须是非空字符串数组。' };
    }
    const unknown = args.todoIds.filter((id) => !thread.inflight.todoIds.includes(id));
    if (unknown.length > 0) return { error: `todoIds 不在本批次内：${unknown.join(',')}` };
    ids = [...new Set(args.todoIds)];
  }
  return { ids, status: args.status, summary: oneLine(args.summary, 500) };
}

/** 记录 waiting / needs-human（done 由调用方先 mark_as_done 成功后调用 settleDone）。 */
export function recordReport(ledger, threadKey, id, status, summary, now = Date.now()) {
  const todo = ledger.todos[id];
  const thread = ledger.threads[threadKey];
  if (!todo || !thread) return;
  todo.report = { status, summary, at: now };
  thread.lastReport = todo.report;
  noteReported(ledger, thread, id, now);
  touch(todo, now);
  if (status === 'waiting') {
    todo.state = 'waiting';
    todo.reason = summary || '等待外部条件';
  } else if (status === 'needs-human') {
    todo.state = 'waiting';
    todo.reason = `${NEEDS_HUMAN_PREFIX}${summary || '需要人处理'}`;
  }
  pushEvent(ledger, 'report', `${status}${summary ? `：${summary}` : ''}`, { todoId: id, threadKey, now });
}

function noteReported(ledger, thread, id, now) {
  if (thread.inflight) {
    thread.inflight.reported = true;
    if (!thread.inflight.reportedIds.includes(id)) thread.inflight.reportedIds.push(id);
  }
  ledger.breaker.streak = 0;
  thread.updatedAt = now;
}

export function settleDone(ledger, threadKey, id, summary, now = Date.now()) {
  const todo = ledger.todos[id];
  const thread = ledger.threads[threadKey];
  if (!todo || !thread) return;
  todo.state = 'done';
  todo.reason = 'plugin';
  todo.report = { status: 'done', summary, at: now };
  thread.lastReport = todo.report;
  noteReported(ledger, thread, id, now);
  touch(todo, now);
  pushEvent(ledger, 'done', summary || '已完成', { todoId: id, threadKey, now });
}

export function settleAttention(ledger, threadKey, id, reason, now = Date.now()) {
  const todo = ledger.todos[id];
  const thread = ledger.threads[threadKey];
  if (!todo || !thread) return;
  todo.state = 'attention';
  todo.reason = oneLine(reason, 500);
  noteReported(ledger, thread, id, now);
  touch(todo, now);
  pushEvent(ledger, 'attention', reason, { todoId: id, threadKey, now });
}

export function pendingInBatch(thread) {
  return (thread?.inflight?.todoIds ?? []).filter((id) => !thread.inflight.reportedIds.includes(id));
}

/** 回合结束：未报告的 attempts+1 回到 queued（达上限 attention）；清 inflight；维护熔断计数。 */
export function finishTurn(ledger, threadKey, { failed = false, error = '', now = Date.now() } = {}) {
  const thread = ledger.threads[threadKey];
  if (!thread?.inflight) return { unreported: [], settled: false };
  const { inflight } = thread;
  const unreported = inflight.todoIds.filter((id) => !inflight.reportedIds.includes(id) && ledger.todos[id]?.state === 'queued');
  for (const id of unreported) {
    bumpAttempt(ledger, ledger.todos[id], failed ? `回合失败：${oneLine(error, 200) || '未知错误'}` : NO_REPORT_REASON, now);
  }
  if (!inflight.reported && !failed) {
    ledger.breaker.streak += 1;
    if (ledger.breaker.streak >= BREAKER_LIMIT && !ledger.breaker.open) {
      ledger.breaker.open = true;
      ledger.breaker.since = now;
      pushEvent(ledger, 'breaker', `连续 ${BREAKER_LIMIT} 个批次没有收到报告，已暂停自动投递`, { now });
    }
  }
  thread.inflight = null;
  thread.updatedAt = now;
  const settled = threadSettled(ledger, threadKey);
  return { unreported, settled };
}

export function resumeBreaker(ledger, now = Date.now()) {
  const wasOpen = ledger.breaker.open;
  ledger.breaker = { streak: 0, open: false, since: null };
  if (wasOpen) pushEvent(ledger, 'breaker', '已恢复自动投递', { now });
  return wasOpen;
}

/** 线程上所有 Todo 都已 done/skipped 且无在途批次：可归档会话。 */
export function threadSettled(ledger, threadKey) {
  const thread = ledger.threads[threadKey];
  if (!thread || thread.inflight) return false;
  const todos = Object.values(ledger.todos).filter((todo) => todo.threadKey === threadKey);
  return todos.length > 0 && todos.every((todo) => todo.state === 'done' || todo.state === 'skipped');
}

/** Leader/面板动作。retry：回到 queued 并清零 attempts；close：由调用方 mark_as_done 成功后调用。 */
export function retryTodo(ledger, id, now = Date.now()) {
  const todo = ledger.todos[id];
  if (!todo || !['attention', 'waiting'].includes(todo.state)) return false;
  todo.state = 'queued';
  todo.attempts = 0;
  todo.reason = '';
  touch(todo, now);
  pushEvent(ledger, 'retry', '人工重试', { todoId: id, threadKey: todo.threadKey, now });
  return true;
}

export function closeTodo(ledger, id, by = 'leader', now = Date.now()) {
  const todo = ledger.todos[id];
  if (!todo || todo.state === 'done' || todo.state === 'skipped') return false;
  todo.state = 'done';
  todo.reason = by;
  touch(todo, now);
  pushEvent(ledger, 'done', `由 ${by} 关闭`, { todoId: id, threadKey: todo.threadKey, now });
  return true;
}

export function threadState(ledger, thread) {
  if (thread.inflight) return 'running';
  const todos = Object.values(ledger.todos).filter((todo) => todo.threadKey === thread.key);
  for (const state of ['attention', 'queued', 'waiting']) if (todos.some((todo) => todo.state === state)) return state;
  return 'closed';
}

export function ledgerCounts(ledger) {
  const counts = { queued: 0, waiting: 0, attention: 0, done: 0, skipped: 0 };
  for (const todo of Object.values(ledger.todos)) counts[todo.state] += 1;
  return counts;
}

/** 看板：每线程一行，含派生状态、会话、各状态计数与最近一次报告摘要。 */
export function buildBoard(ledger) {
  const rows = Object.values(ledger.threads).map((thread) => {
    const counts = { queued: 0, waiting: 0, attention: 0, done: 0, skipped: 0 };
    for (const todo of Object.values(ledger.todos)) if (todo.threadKey === thread.key) counts[todo.state] += 1;
    return {
      key: thread.key, kind: thread.kind, title: thread.title, project: thread.project, url: thread.url,
      state: threadState(ledger, thread), sessionId: thread.sessionId, sessionTitle: thread.sessionTitle,
      counts, inflight: thread.inflight ? thread.inflight.todoIds.length : 0,
      lastReport: thread.lastReport ? { ...thread.lastReport } : null, updatedAt: thread.updatedAt,
    };
  });
  const order = { attention: 0, running: 1, queued: 2, waiting: 3, closed: 4 };
  rows.sort((a, b) => order[a.state] - order[b.state] || b.updatedAt - a.updatedAt);
  return rows;
}

/** 收件箱：attention + waiting 的 Todo，附原因、等待时长与线程链接。 */
export function buildLedgerInbox(ledger, { limit = 100, now = Date.now() } = {}) {
  const safe = Number.isSafeInteger(limit) && limit >= 1 ? Math.min(limit, 200) : 100;
  return Object.values(ledger.todos)
    .filter((todo) => todo.state === 'attention' || todo.state === 'waiting')
    .sort((a, b) => (a.state === b.state ? a.updatedAt - b.updatedAt : a.state === 'attention' ? -1 : 1))
    .slice(0, safe)
    .map((todo) => {
      const thread = ledger.threads[todo.threadKey];
      return {
        todoId: todo.id, state: todo.state, reason: todo.reason, author: todo.author, excerpt: todo.excerpt,
        title: todo.title || thread?.title || '', url: todo.url, threadKey: todo.threadKey, project: todo.project,
        sessionId: thread?.sessionId ?? null, attempts: todo.attempts, waitedMs: Math.max(0, now - todo.updatedAt),
        needsHuman: todo.reason.startsWith(NEEDS_HUMAN_PREFIX),
      };
    });
}

/** GC：done/skipped 保留 30 天；无 Todo 且无在途的线程删除；总量超 3000 先删最旧的终态。waiting/attention 永不自动清。 */
export function gcLedger(ledger, now = Date.now()) {
  const cutoff = now - RETENTION_DAYS * DAY_MS;
  const terminal = (todo) => todo.state === 'done' || todo.state === 'skipped';
  const removed = [];
  for (const todo of Object.values(ledger.todos)) {
    if (terminal(todo) && todo.updatedAt < cutoff && !ledger.threads[todo.threadKey]?.inflight?.todoIds.includes(todo.id)) removed.push(todo.id);
  }
  const all = Object.values(ledger.todos);
  if (all.length - removed.length > LEDGER_CAP) {
    const dropped = new Set(removed);
    const extra = all.filter((todo) => terminal(todo) && !dropped.has(todo.id)).sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, all.length - removed.length - LEDGER_CAP);
    for (const todo of extra) removed.push(todo.id);
  }
  const touched = new Set(removed.map((id) => ledger.todos[id].threadKey));
  for (const id of removed) delete ledger.todos[id];
  const used = new Set(Object.values(ledger.todos).map((todo) => todo.threadKey));
  for (const key of touched) {
    if (!used.has(key) && !ledger.threads[key]?.inflight) delete ledger.threads[key];
  }
  return removed.length;
}

/**
 * v6→v7 迁移：只迁线程绑定。handled 记录按 targetKey 分组，取最近一次 acceptedAt 的 sessionId；
 * 跳过 Issue 条目与没有会话的记录。台账 Todo 不迁移——首轮拉取时 GitLab 上仍待办的记为 waiting（迁移前遗留）。
 */
export function migrateThreads(handled, now = Date.now()) {
  const ledger = emptyLedger();
  const groups = new Map();
  for (const record of Object.values(isRecord(handled) ? handled : {})) {
    if (!isRecord(record) || !record.sessionId || record.item?.source === 'issue' || String(record.id ?? '').startsWith('issue-')) continue;
    const key = targetKey(record.url);
    if (!key) continue;
    const current = groups.get(key);
    if (!current || (record.acceptedAt ?? 0) > (current.acceptedAt ?? 0)) groups.set(key, record);
  }
  for (const [key, record] of groups) {
    ledger.threads[key] = {
      key, kind: threadKind(key), title: str(record.title, 300), project: str(record.project, 300),
      url: str(String(record.url ?? '').replace(/#.*$/u, ''), 1000), sessionId: String(record.sessionId).slice(0, 200),
      sessionTitle: str(record.sessionTitle, 200), primed: false, archived: false, inflight: null, lastReport: null,
      createdAt: record.firstAcceptedAt ?? record.acceptedAt ?? now, updatedAt: record.acceptedAt ?? now,
    };
  }
  ledger.legacyPending = true;
  return ledger;
}
