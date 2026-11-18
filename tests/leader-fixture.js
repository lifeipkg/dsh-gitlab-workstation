// Shared in-memory harness for the Leader v3 tests (not a test file itself).
import { initialState, initialLeaderState } from '../core.js';
import { leaderMethods, createLeaderUiCaller, createLeaderAgentCaller, createLeaderWorkerCaller } from '../host/leader.js';

export const copy = (value) => JSON.parse(JSON.stringify(value));
export const sessionState = (patch = {}) => ({ cursor: 10, active: true, running: false, queue: [], pendingInput: [], ...patch });
export const remote = (message, code = 'session/rejected', details) => Object.assign(new Error(message), { isDSHRemoteError: true, code, ...(details ? { details } : {}) });
export const missing = (sessionId) => remote('not found', 'session/not-found', { sessionId });

export function issueItem(iid, extra = {}) {
  return { id: `issue-${iid}`, title: `Issue ${iid}`, source: 'issue', url: `https://gitlab.example/g/p/-/issues/${iid}`,
    project: 'g/p', iid, projectId: 7, state: 'opened', ...extra };
}

export function handledRecord(item, sessionId, extra = {}) {
  return { id: item.id, sessionId, item, automatic: false, outcome: 'session-accepted', sessionTitle: item.title, ...extra };
}

/** Builds a runtime with the real leaderMethods and in-memory Host stubs. */
export function fixture(options = {}) {
  const sessions = new Map([['leader', sessionState()], ['worker-a', sessionState()], ['worker-b', sessionState()], ['human', sessionState()]]);
  const calls = { create: [], rename: [], model: [], prompt: [], archive: [], deliver: [], dispatch: [], setArchived: [], persist: [], refresh: [], poll: [],
    resetModel: [], persistQuiet: [] };
  const archivedSessionIds = [];
  let counter = 0;
  const runtime = Object.assign({}, leaderMethods, {
    state: initialState(),
    leaderState: initialLeaderState(),
    config: {},
    stopping: false,
    logger: { warn() {}, error() {}, info() {} },
    ctx: { workspaceRegistry: { archivedSessionIds, list: () => [] } },
    storageDirectory() { throw new Error('storage is in memory in this fixture'); },
    resolveWorkspaceId(cwd) { if (cwd === 'bad') throw new Error('配置的工作区文件夹未在 DSH 工作区中注册：bad'); return cwd || 'issue-workspace'; },
    ensureLeaderTimer() {},
    async persistQuietly(reason) { calls.persistQuiet.push(reason); },
    async persistLeader() { calls.persist.push(copy(this.leaderState)); if (options.persistFails?.(calls.persist.length)) throw new Error('disk full'); },
    async dispatch(item, retry) {
      calls.dispatch.push({ item: copy(item), retry });
      if (options.dispatch) return options.dispatch.call(this, item, retry, sessions);
      const sessionId = `worker-new-${++counter}`;
      sessions.set(sessionId, sessionState());
      this.state.handled[item.id] = handledRecord(item, sessionId);
      return { ok: true, sessionId };
    },
    async setSessionArchived(sessionId, archived) {
      calls.setArchived.push({ sessionId, archived });
      if (options.setArchived) return options.setArchived(sessionId, archived);
      if (archived) archivedSessionIds.push(sessionId);
      return { ok: true };
    },
    host: {
      async sessionState(sessionId) {
        const value = sessions.get(sessionId);
        if (!value) throw missing(sessionId);
        return copy(value);
      },
      async createSession(request) {
        calls.create.push({ request: copy(request), journal: copy(runtime.leaderState) });
        if (options.createSession) return options.createSession(request, calls.create.length);
        const id = calls.create.length === 1 && !options.noLeaderFirst ? 'leader' : `task-session-${++counter}`;
        sessions.set(id, sessionState());
        return id;
      },
      async renameSession(sessionId, title) { calls.rename.push({ sessionId, title }); if (options.rename) return options.rename(sessionId, title); },
      async selectModel(request) { calls.model.push(copy(request)); if (options.selectModel) return options.selectModel(request); },
      async prompt(request) { calls.prompt.push(copy(request)); if (options.prompt) return options.prompt(request); return { accepted: true }; },
      async archiveSession(sessionId) { calls.archive.push(sessionId); archivedSessionIds.push(sessionId); },
      async modelCatalog() { return options.catalog ?? { groups: [{ id: 'prov', models: [{ id: 'm1' }, { id: 'm2' }] }] }; },
    },
    leaderAdapter: {
      capabilities: { atomicIdleDelivery: true, nonHumanSource: true },
      async prepare() {}, refreshBindings() { calls.refresh.push('leader'); return options.bindLeader ?? true; }, get bindingStatus() { return options.bindStatus ?? ''; }, refreshWorkerBindings() { calls.refresh.push('workers'); },
      async prepareWorker() { return { ok: true }; },
      async observe(sessionId, cursor) { return options.observe ? options.observe(sessionId, cursor) : { cursor: 10, events: [], truncated: false }; },
      async questions() { return options.questions ?? []; },
      async resetModel(sessionId) { calls.resetModel.push(sessionId); },
      async deliver(request) {
        calls.deliver.push(request);
        if (options.deliver) return options.deliver(request);
        return { ok: true, status: 'delivered', requestId: request.requestId, messageId: `msg-${calls.deliver.length}` };
      },
    },
  });
  const ui = createLeaderUiCaller();
  const agent = (sessionId = 'leader') => createLeaderAgentCaller({ sessionId, agentId: `${sessionId}-agent` });
  const worker = (sessionId = 'worker-a') => createLeaderWorkerCaller({ sessionId, agentId: `${sessionId}-agent` });
  const invoke = (operation, request, caller = ui) => runtime.leaderOperation(operation, request, caller);
  return {
    runtime, sessions, calls, archivedSessionIds, ui, agent, worker, invoke,
    board: (request = {}) => invoke('board', request, agent()),
    session: (request) => invoke('session', request, agent()),
    report: (request, sessionId = 'worker-a') => invoke('workerReport', request, worker(sessionId)),
    /** Creates the Leader through the real UI operation so the journal is in the normal "ready" state. */
    async createLeader() { const result = await invoke('create', {}); if (!result.ok) throw new Error(`Leader create failed: ${result.error}`); return result; },
    /** Registers an Issue and a handled worker session for it. */
    addIssue(iid, sessionId, record = {}) {
      const item = issueItem(iid);
      runtime.state.issues.push(item);
      if (sessionId) { runtime.state.handled[item.id] = handledRecord(item, sessionId, record); if (!sessions.has(sessionId)) sessions.set(sessionId, sessionState()); }
      return item;
    },
  };
}
