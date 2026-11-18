import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DshHostClient } from './dsh-host.js';
import {
  createLogBuffer,
  initialState,
  normalizeState,
  publicState,
  STATE_VERSION,
  validateSettings,
} from './core.js';
import {
  BRIDGE_PATH,
  LOG_MAX_CHARS,
  LOG_MAX_ENTRIES,
  LOG_MAX_LINE_CHARS,
  MAX_REQUEST_BYTES,
} from './host/constants.js';
import { attachRuntimeMethods, errorMessage, jsonResponse } from './host/util.js';
import { gitlabMethods } from './host/gitlab.js';
import { issuesMethods } from './host/issues.js';
import { logsMethods } from './host/logs.js';
import { slotsMethods } from './host/slots.js';
import { closuresMethods } from './host/closures.js';
import { dispatchMethods } from './host/dispatch.js';
import { sessionEntryMethods } from './host/session-entries.js';
import { leaderMethods, createLeaderUiCaller } from './host/leader.js';
import { createLeaderAgentAdapter } from './host/leader-agent.js';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
// 与其它 DSH 插件一致：数据放在 Harness home（DSH_HOME，默认 ~/.dsh）下的 storages/<插件>/。
const STORAGE_NAME = 'gitlab-workstation';
// 2.37.0 之前的默认目录；仅在未显式配置 storageDirectory 时作为一次性复制迁移来源。
const LEGACY_STORAGE_DIRECTORY = join(homedir(), '.dsh-plugins', 'gitlabtodo');
const MIGRATED_FILES = ['state.json', 'leader.json'];
const LEGACY_STATE_FILE = join(PACKAGE_DIR, '.runtime', 'state.json');

export function resolveDshHome(env = process.env) {
  const custom = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  if (!custom) return join(homedir(), '.dsh');
  if (custom === '~') return homedir();
  if (custom.startsWith('~/') || custom.startsWith('~\\')) return resolve(join(homedir(), custom.slice(2)));
  return resolve(custom);
}

export function defaultStorageDirectory(env = process.env) {
  return join(resolveDshHome(env), 'storages', STORAGE_NAME);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
const LEADER_RPC_CHANNEL = '/gitlab-workstation-leader';
const LEADER_UI_OPERATIONS = new Set(['snapshot', 'create', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery']);

/**
 * 运行时骨架：状态生命周期（加载/迁移/持久化）、轮询与对账定时器、bridge 入口。
 * 业务方法按域拆分在 host/*.js，启动时 attachRuntimeMethods 挂到本类原型：
 *   host/gitlab.js    glab 子进程、当前用户、Issue 分页、Issue 状态核对
 *   host/issues.js    Issue 面板（刷新“指派给我的开放 Issue”缓存、面板投影）
 *   host/logs.js      运行时内存日志（Log Tab 投影、清空）
 *   host/slots.js     会话跟踪、对账结算（reconcile）
 *   host/closures.js  闭环裁决（verifySettled / assessClosures / 归档）
 *   host/dispatch.js  Issue 派发（dispatch / executeDispatch）、手动动作、工作区总览
 * 模块方法仍用 this.* 互调，与拆分前同一个实例；新增业务方法请放进对应域模块，
 * 模块方法仍用 this.* 互调，与拆分前同一个实例；新增业务方法请放进对应域模块，
 * 不要再往这个类里堆。
 */
export class GitlabTodoRuntime {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.state = null;
    this.timer = null;
    this.initialTimer = null;
    this.dispatches = new Map();
    this.activeChildren = new Set();
    this.writeChain = Promise.resolve();
    this.stopping = false;
    this.unregisterRoute = null;
    this.gitlabUserId = null;
    this.gitlabUsername = null;
    this.host = new DshHostClient(ctx);
    this.trackedSessions = new Map();
    this.statusWaiters = new Set();
    this.reconcilePromise = null;
    this.sessionTimer = null;
    // 运行时内存日志（Log Tab）：只进内存环形缓冲（条数/总字符双封顶、单行截断），不落盘。
    // this.logger.<level>() 统一入口：进缓冲 + 透传宿主 logger（自动补 [gitlab-todo-agent] 前缀）。
    // 消息规范：单行「<对象/动作>：<结果/细节>」，不要在业务代码里自己加前缀。
    this.logs = createLogBuffer({
      maxEntries: LOG_MAX_ENTRIES,
      maxChars: LOG_MAX_CHARS,
      maxLineChars: LOG_MAX_LINE_CHARS,
    });
    const upstream = this.ctx.logger ?? {};
    this.logger = {};
    for (const level of ['debug', 'info', 'warn', 'error']) {
      this.logger[level] = (message) => {
        // 历史调用点自带 [gitlab-todo-agent] 前缀：缓冲里剥掉保持整洁，透传时再补回。
        const entry = String(message ?? '').replace(/^\s*\[gitlab-todo-agent\]\s*/u, '');
        this.logs.push(level, entry);
        try { upstream[level]?.(`[gitlab-todo-agent] ${entry}`); } catch { /* 宿主日志失败不影响业务 */ }
      };
    }
  }

  storageDirectory() {
    return this.config.storageDirectory ?? (this.defaultStorage ??= defaultStorageDirectory());
  }

  legacyStorageDirectory() {
    return LEGACY_STORAGE_DIRECTORY;
  }

  /** 创建数据目录；未显式配置目录时，把旧目录的数据一次性复制过来（只复制缺失文件，旧目录保留）。 */
  prepareStorage() {
    return (this.storagePromise ??= this.migrateStorage().catch((error) => {
      this.storagePromise = null;
      throw error;
    }));
  }

  async migrateStorage() {
    const target = this.storageDirectory();
    await mkdir(target, { recursive: true });
    if (this.config.storageDirectory !== undefined) return;
    const source = this.legacyStorageDirectory();
    if (resolve(source) === resolve(target)) return;
    const copied = [];
    for (const name of MIGRATED_FILES) {
      const to = join(target, name);
      if (await pathExists(to)) continue;
      const temporary = join(target, `migrate-${process.pid}-${randomUUID()}.tmp`);
      try {
        await copyFile(join(source, name), temporary);
        await rename(temporary, to);
        copied.push(name);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        if (error?.code === 'ENOENT' && !await pathExists(join(source, name))) continue;
        throw new Error(`迁移插件数据 ${name} 失败（旧文件未改动）：${errorMessage(error)}`);
      }
    }
    if (copied.length) {
      this.logger.info(`插件数据已迁移：${copied.join('、')} 从 ${source} 复制到 ${target}；旧目录保留未删除，确认无误后可手动删除。`);
    }
  }

  stateFile() {
    return join(this.storageDirectory(), 'state.json');
  }

  legacyStateFiles() {
    return this.config.legacyStateFile ? [this.config.legacyStateFile] : [LEGACY_STATE_FILE];
  }

  async ensureStorage() {
    await this.prepareStorage();
  }

  async start() {
    await this.ensureStorage();
    let migrated = false;
    try {
      const stored = JSON.parse(await readFile(this.stateFile(), 'utf8'));
      migrated = typeof stored?.version === 'number' && stored.version !== STATE_VERSION;
      if (migrated) {
        // 升级前备份旧状态（v6 台账迁移不可逆）；已有备份不覆盖。
        const backup = join(this.storageDirectory(), `state.v${stored.version}.bak.json`);
        if (!await pathExists(backup)) await copyFile(this.stateFile(), backup);
      }
      this.state = normalizeState(stored);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`读取插件状态失败：${errorMessage(error)}`);
      for (const legacyFile of this.legacyStateFiles()) {
        try {
          const legacy = JSON.parse(await readFile(legacyFile, 'utf8'));
          this.state = normalizeState(legacy);
          migrated = true;
          break;
        } catch (legacyError) {
          if (legacyError?.code !== 'ENOENT') throw new Error(`迁移插件状态失败：${errorMessage(legacyError)}`);
        }
      }
      this.state ??= initialState();
    }
    if (migrated) await this.persistQuietly('迁移');
    await (this.leaderLoadPromise ??= this.loadLeader());
    this.leaderAdapter ??= createLeaderAgentAdapter(this);
    await this.leaderAdapter.refreshBindings();
    this.unregisterRoute = this.ctx.connection.fetch.register({
      path: BRIDGE_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: (request) => this.handleFetch(request),
    });
    await this.reconcileSessions();
    this.logger.info('运行时已启动：Issue 面板与 Leader 就绪（派发仅由面板或 Leader 手动触发）。');
  }

  async stop() {
    this.stopping = true;
    this.stopLeader();
    await this.leaderAdapter?.dispose?.();
    this.wakeWaiters();
    clearInterval(this.sessionTimer);
    if (this.unregisterRoute) await this.unregisterRoute();
    this.unregisterRoute = null;
    // 逐个终止所有在飞的 glab 子进程（poll 与核对可能并发，单槽引用会漏杀先前的进程）。
    for (const child of this.activeChildren) child.kill();
    this.activeChildren.clear();
    await Promise.allSettled([
      this.reconcilePromise?.catch(() => {}),
      this.writeChain.catch(() => {}),
      this.leaderOperationChain?.catch(() => {}),
      this.leaderWriteChain?.catch(() => {}),
    ]);
    await this.host.dispose();
  }

  snapshot() {
    return {
      ...publicState(this.state, false),
      activeSessions: this.trackedSessions.size,
      storage: {
        directory: this.storageDirectory(),
      },
    };
  }

  async persist() {
    const snapshot = JSON.stringify(this.state, null, 2);
    const operation = this.writeChain.catch(() => {}).then(async () => {
      await mkdir(this.storageDirectory(), { recursive: true });
      const temporary = join(this.storageDirectory(), `state-${process.pid}-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, this.stateFile());
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
    });
    this.writeChain = operation;
    return operation;
  }

  async persistQuietly(area) {
    try {
      await this.persist();
      // 新建的 worker 会话在这里才进入“插件创建”集合；同步给它们挂上 gitlab_leader_report。
      this.syncLeaderWorkerTools?.();
    } catch (error) {
      // 持久化故障与派发错误分账：写进独立字段，不污染面板上“最近派发错误”的语义。
      const message = `保存${area}状态失败：${errorMessage(error)}`;
      this.state.lastPersistError = message;
      this.logger.warn(message);
    }
  }

  async handleLeaderUiRpc(operation, payload, signal, peer) {
    const failure = (code, message) => ({ ok: false, error: { code, message, details: {} } });
    // Preserve Connection's real browser Peer, not a model-provided principal or owner shim.
    if (this.stopping || signal?.aborted || !peer || peer !== this.ctx.connection.browserPeer
      || peer.principal?.kind !== 'owner' || peer.signal?.aborted) {
      return failure('leader/forbidden', '只有当前原生浏览器 UI 可操作 Leader。');
    }
    if (!LEADER_UI_OPERATIONS.has(operation) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return failure('leader/invalid-request', '无效 Leader UI 操作或参数。');
    }
    try {
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_REQUEST_BYTES) {
        return failure('leader/invalid-request', 'Leader 参数超过请求体上限。');
      }
      const result = await this.leaderOperation(operation, payload, createLeaderUiCaller());
      return { ok: true, value: { ok: true, result, projection: this.leaderProjection(), state: this.snapshot() } };
    } catch (error) {
      return failure('leader/operation-failed', errorMessage(error));
    }
  }

  async updateSettings(patch) {
    const next = validateSettings(patch ?? {}, this.state.settings);
    this.state.settings = next;
    await this.persistQuietly('设置');
    this.wakeWaiters();
    return this.snapshot();
  }

  async handleFetch(request) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.searchParams.get('action') === 'state') {
        return jsonResponse(200, { ok: true, state: this.snapshot() });
      }
      if (request.method === 'GET' && url.searchParams.get('action') === 'models') {
        return jsonResponse(200, { ok: true, catalog: await this.host.modelCatalog() });
      }
      if (request.method === 'GET' && url.searchParams.get('action') === 'workspaces') {
        return jsonResponse(200, { ok: true, workspaces: await this.workspaceOverview() });
      }
      if (request.method === 'GET' && url.searchParams.get('action') === 'issues') {
        // Issue 面板：读缓存投影（不发 glab）；刷新走 POST issues {refresh:true}。
        return jsonResponse(200, { ok: true, ...this.issueProjection() });
      }
      if (request.method === 'GET' && url.searchParams.get('action') === 'logs') {
        // 运行时内存日志：只读快照（新→旧）。清空走 POST logs {clear:true}。
        return jsonResponse(200, { ok: true, ...this.logProjection() });
      }
      if (request.method !== 'POST') {
        return jsonResponse(405, { ok: false, error: '不支持的请求方法。' });
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
        return jsonResponse(415, { ok: false, error: 'POST 请求必须使用 application/json。' });
      }
      const raw = await request.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
        return jsonResponse(413, { ok: false, error: `请求体超过 ${MAX_REQUEST_BYTES} 字节上限。` });
      }
      const body = JSON.parse(raw || '{}');
      if (body.action === 'leader') {
        if (body.operation !== undefined && body.operation !== 'snapshot') {
          return jsonResponse(403, { ok: false, error: 'Leader 托管权限变更必须通过原生浏览器 UI RPC，HTTP 请求不能自报人类授权。' });
        }
        const result = await this.leaderOperation('snapshot', {}, createLeaderUiCaller());
        return jsonResponse(200, { ok: true, result, projection: this.leaderProjection(), state: this.snapshot() });
      }
      if (body.action === 'inspectSession') {
        if (typeof body.sessionId !== 'string' || !body.sessionId.trim() || body.sessionId.trim() !== body.sessionId || body.sessionId.length > 200 || /[\u0000-\u001f]/u.test(body.sessionId)) {
          return jsonResponse(400, { ok: false, error: '无效会话 ID。' });
        }
        return jsonResponse(200, { ok: true, result: await this.inspectSession(body.sessionId) });
      }
      if (body.action === 'createHandoff') {
        const result = await this.createHandoff(typeof body.taskId === 'number' ? String(body.taskId) : body.taskId, body.sessionId, body.requestId);
        return jsonResponse(200, { ok: true, result, state: this.snapshot() });
      }
      if (body.action === 'models') {
        return jsonResponse(200, { ok: true, catalog: await this.host.modelCatalog() });
      }
      if (body.action === 'workspaces') {
        return jsonResponse(200, { ok: true, workspaces: await this.workspaceOverview() });
      }
      if (body.action === 'issues') {
        // Issue 面板：refresh 显式重拉 GitLab（慢操作，90s bridge 超时内）；否则返回缓存投影。
        const projection = body.refresh === true ? await this.refreshIssues() : this.issueProjection();
        return jsonResponse(200, { ok: true, ...projection });
      }
      if (body.action === 'logs') {
        // Log Tab：clear 清空缓冲（并留一条审计行）；否则返回当前投影。
        if (body.clear === true) this.clearLogEntries();
        return jsonResponse(200, { ok: true, ...this.logProjection() });
      }
      if (body.action === 'setSessionArchived' && typeof body.sessionId === 'string') {
        const result = await this.setSessionArchived(body.sessionId, body.archived === true);
        return jsonResponse(200, { ok: true, result, state: this.snapshot() });
      }
      if (body.action === 'updateSettings') {
        const state = await this.updateSettings(body.settings);
        return jsonResponse(200, { ok: true, state });
      }
      if (body.action === 'dispatch' && (typeof body.id === 'string' || typeof body.id === 'number')) {
        const result = await this.dispatchById(String(body.id));
        return jsonResponse(200, { ok: true, result, state: this.snapshot() });
      }
      return jsonResponse(400, { ok: false, error: '未知 bridge action。' });
    } catch (error) {
      return jsonResponse(400, { ok: false, error: errorMessage(error) });
    }
  }
}

// 挂载各域方法集；同名冲突会在加载期直接报错，不会静默覆盖。
attachRuntimeMethods(GitlabTodoRuntime, [
  gitlabMethods,
  issuesMethods,
  logsMethods,
  slotsMethods,
  closuresMethods,
  dispatchMethods,
  sessionEntryMethods,
  leaderMethods,
]);

export const inject = ['connection', 'webServer', 'typertGateway', 'workspaceRegistry'];

export function apply(ctx, config = {}) {
  const runtime = new GitlabTodoRuntime(ctx, config);
  // Register with the plugin lifetime, before asynchronous journal/session startup.
  // A missing native RPC capability is explicit; silently skipping it makes the
  // browser fall through to the static-resource route and report a misleading 405.
  ctx.effect(() => {
    const rpc = ctx.connection?.rpc;
    if (typeof rpc?.handle !== 'function') throw new Error('当前 Host 不提供原生 Connection RPC，无法启用 WorkStation Leader。');
    const handler = (endpoint, payload, signal, peer) => runtime.handleLeaderUiRpc(endpoint, payload, signal, peer);
    let unregister;
    try {
      unregister = rpc.handle(LEADER_RPC_CHANNEL, handler);
    } catch (error) {
      // dsh 0.2.2-rc.3's public wrapper evaluates webServer on Connection's
      // own Context, which only injects credentials. Use the same registration
      // implementation with this plugin's declared webServer Context instead.
      // No authentication or Peer check is reimplemented or relaxed here.
      if (errorMessage(error) !== 'cannot get property "webServer" without inject'
        || typeof ctx.connection?.register !== 'function') throw error;
      unregister = ctx.connection.register(ctx, LEADER_RPC_CHANNEL, handler);
    }
    runtime.unregisterLeaderRpc = unregister;
    runtime.logger.info(`Leader 原生 RPC 通道已注册：${LEADER_RPC_CHANNEL}。`);
    return async () => {
      if (runtime.unregisterLeaderRpc === unregister) runtime.unregisterLeaderRpc = null;
      await unregister();
    };
  }, 'gitlab-todo-agent: Leader RPC');
  // Install the awaited creation barrier before any startup I/O or optional-service arrival.
  runtime.leaderAdapter = createLeaderAgentAdapter(runtime);
  // Leader capabilities are optional; profiles without them keep the Issue workbench.
  ctx.inject?.(['agents', 'agentPresets', 'sessionController', 'sessionProjections'], (leaderCtx) => {
    runtime.leaderServicesContext = leaderCtx;
    if (!runtime.stopping) {
      runtime.leaderAdapter ??= createLeaderAgentAdapter(runtime);
      void runtime.leaderAdapter.refreshBindings().catch((error) => runtime.logger.warn(`Leader 绑定失败：${errorMessage(error)}`));
      // Resident managed workers gain gitlab_leader_report once the native services arrive.
      runtime.syncLeaderWorkerTools?.(true);
    }
    return async () => {
      const adapter = runtime.leaderAdapter;
      runtime.leaderAdapter = null;
      await adapter?.dispose?.();
      // Optional services can reload while the old adapter awaits quiescence.
      // An old lifetime may revoke its own grant, but must not erase the new context.
      if (runtime.leaderServicesContext === leaderCtx) {
        runtime.leaderServicesContext = null;
        if (runtime.leaderState && !runtime.leaderJournalUnreadable) {
          await runtime.saveLeaderStrict().catch((error) => runtime.logger.warn(errorMessage(error)));
        }
      }
    };
  });
  return ctx.effect(async () => {
    await runtime.start();
    return () => runtime.stop();
  }, 'gitlab-todo-agent: runtime');
}
