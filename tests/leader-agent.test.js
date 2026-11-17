import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLeaderAgentAdapter, LEADER_MESSAGE_SOURCE, LEADER_TOOL_NAMES, LEADER_TOOLS, LEADER_WORKER_TOOL, LEADER_SESSION_ACTIONS, LEADER_INBOX_ACTIONS } from '../host/leader-agent.js';

function setup(options = {}) {
  const residents = new Map();
  const listeners = new Map();
  const definitions = new Map();
  const registered = [];
  const removals = [];
  const pending = [];
  const calls = [];
  const operations = [];
  const warnings = [];
  let admitted = true;
  let maintenanceBusy = false;
  const scope = { effect: () => {} };
  const leader = { id: 'leader', session: { id: 'leader', seq: 10, header: { cwd: 'D:/workspace' } }, status: 'idle', ctx: scope };
  const worker = { id: 'worker', session: { id: 'worker', seq: 20, header: { cwd: 'D:/workspace' } }, status: 'idle', ctx: scope, inbox: { nextTurn: [], nextStep: [] },
    runMaintenance(job) { if (maintenanceBusy) throw new Error('already has active work'); return job(new AbortController().signal); },
    followup(message) { calls.push(message); this.session.seq++; options.followup?.(); } };
  leader.inbox = { nextTurn: [], nextStep: [] };
  leader.cancel = () => assert.fail('the plugin never cancels the Leader');
  leader.runMaintenance = worker.runMaintenance;
  leader.followup = worker.followup;
  residents.set('leader', leader); residents.set('worker', worker);
  // v3: the tools stub deliberately has no restrict()/guard(); calling them would throw.
  const tools = { register(definition, config) { registered.push(definition.name); definitions.set(definition.name, { definition, config });
    return () => { removals.push(definition.name); definitions.delete(definition.name); }; } };
  // Like the real tools service, restrict() throws for names the host does not have. Only present when a test asks for it.
  const hidden = new Set();
  if (options.knownTools) {
    tools.restrict = ({ deny }) => {
      for (const name of deny) if (!options.knownTools.includes(name)) throw new Error(`tools.restrict() names unknown global tool "${name}"`);
      for (const name of deny) hidden.add(name);
      return () => { for (const name of deny) hidden.delete(name); };
    };
  }
  const ctx = { agents: { get: (id) => residents.get(id) }, typertGateway: { getPendingRemoteEvents: () => pending },
    workspaceRegistry: { archivedSessionIds: [] },
    sessionProjections: { snapshot: (session) => ({ asOfSeq: session.seq - 1, values: { userQuestions: { active: [], settled: [] } } }) },
    agentPresets: { serviceFor(agent, name) { assert.equal(name, 'tools'); assert.ok(agent.id); return tools; } },
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); }, effect: () => {} };
  const runtime = { ctx, leaderState: { sessionId: 'leader' }, logger: { warn: (message) => warnings.push(message) },
    host: { sessionState: async () => ({ cursor: 19 }), invoke: async () => { throw new Error('unexpected history'); } },
    validateLeaderAdmission: () => admitted,
    managed: new Set(['worker']),
    isLeaderManagedSession(id) { return this.managed.has(id); },
    leaderManagedSessionIds() { return [...this.managed]; },
    leaderOperation: async (operation, request, caller) => { operations.push({ operation, request, caller }); return { ok: true, result: { operation, request, branded: Object.keys(caller).length === 0 } }; } };
  const dependencies = { getTraceable(context, value) { assert.equal(context, scope); assert.equal(value, tools); return tools; },
    createUserMessage: (input) => Object.freeze({ ...structuredClone(input), id: randomUUID(), role: 'user' }) };
  const adapter = createLeaderAgentAdapter(runtime, { dependencies: options.dependencies ?? dependencies });
  const request = (values = {}) => Object.freeze({ sessionId: 'worker', leaderSessionId: 'leader', taskId: 'issue', requestId: randomUUID(),
    body: '继续原 Issue 已授权范围；无法判断则反馈。', expectedCursor: 19, ...values });
  return { hidden, info: (runtime.infos = []), adapter, runtime, ctx, residents, leader, worker, listeners, definitions, registered, removals, pending, calls, operations, warnings, request, tools,
    setAdmitted: (value) => { admitted = value; }, setBusy: (value) => { maintenanceBusy = value; } };
}

async function ready(options) { const fixture = setup(options); assert.equal(await fixture.adapter.refreshBindings(), true); return fixture; }
const exec = (fixture, agent = fixture.leader) => ({ agent, signal: new AbortController().signal });

test('the Leader gets exactly the three plugin tools without restrict/guard; only the exact live Leader can see or call them', async () => {
  const fixture = await ready();
  assert.deepEqual(LEADER_TOOLS.map(([name, operation]) => [name, operation]),
    [['gitlab_leader_board', 'board'], ['gitlab_leader_session', 'session'], ['gitlab_leader_inbox', 'inbox']]);
  assert.deepEqual([...fixture.definitions.keys()], [...LEADER_TOOL_NAMES]);
  assert.equal('restrict' in fixture.tools, false); assert.equal('guard' in fixture.tools, false);
  const { definition, config } = fixture.definitions.get('gitlab_leader_board');
  assert.equal(config.when({ agent: fixture.leader }), true);
  assert.equal(config.when({ agent: { ...fixture.leader } }), false);
  assert.equal(config.when({ agent: fixture.worker }), false);
  const result = await definition.execute({ refresh: true }, exec(fixture));
  assert.equal(result.result.branded, true);
  assert.deepEqual(fixture.operations[0], { operation: 'board', request: { refresh: true }, caller: fixture.operations[0].caller });
  await assert.rejects(definition.execute({ leaderSessionId: 'leader' }, exec(fixture)), /未知权限/);
  await assert.rejects(definition.execute({}, exec(fixture, { ...fixture.leader })), /伪造/);
  await assert.rejects(definition.execute({}, exec(fixture, fixture.worker)), /伪造/);
  fixture.residents.set('leader', { ...fixture.leader });
  assert.equal(config.when({ agent: fixture.leader }), false);
  await assert.rejects(definition.execute({}, exec(fixture)), /伪造/);
});

test('session tool schema is strict and exposes the seven actions; unknown fields are refused before the Host operation', async () => {
  const fixture = await ready();
  const { definition } = fixture.definitions.get('gitlab_leader_session');
  assert.deepEqual(definition.parameters.properties.action.enum, [...LEADER_SESSION_ACTIONS]);
  assert.deepEqual(LEADER_SESSION_ACTIONS, ['create', 'send', 'steer', 'rename', 'model', 'archive', 'resolve_delivery']);
  assert.equal(definition.parameters.additionalProperties, false);
  assert.deepEqual(definition.parameters.required, ['action']);
  assert.equal(definition.parameters.properties.model.additionalProperties, false);
  await definition.execute({ action: 'send', taskId: 'issue-1', text: 'x' }, exec(fixture));
  assert.equal(fixture.operations.at(-1).operation, 'session');
  assert.equal(fixture.operations.at(-1).request.action, 'send');
  const before = fixture.operations.length;
  for (const bad of [{ action: 'send', leaderSessionId: 'x' }, { action: 'send', epoch: 1 }, { action: 'create', agentPreset: 'p' }]) {
    await assert.rejects(definition.execute(bad, exec(fixture)), /未知权限/);
  }
  await assert.rejects(definition.execute([], exec(fixture)), /未知权限/);
  assert.equal(fixture.operations.length, before);
  // The Leader caller is the opaque branded identity created by the Host, never plain request fields.
  const caller = fixture.operations[0].caller;
  assert.deepEqual(Object.keys(caller), []);
});

test('inbox tool schema is strict, describes its semantics, and forwards to the inbox operation', async () => {
  const fixture = await ready();
  const { definition } = fixture.definitions.get('gitlab_leader_inbox');
  assert.deepEqual(definition.parameters.properties.action.enum, [...LEADER_INBOX_ACTIONS]);
  assert.deepEqual(LEADER_INBOX_ACTIONS, ['list', 'acknowledge']);
  assert.equal(definition.parameters.additionalProperties, false);
  assert.deepEqual(definition.parameters.required, []);
  assert.equal(definition.parameters.properties.todoIds.maxItems, 50);
  assert.match(definition.description, /needs-human/u);
  assert.match(definition.description, /我已处理/u);
  await definition.execute({ action: 'acknowledge', todoIds: ['t1'], reason: 'MR merged' }, exec(fixture));
  assert.equal(fixture.operations.at(-1).operation, 'inbox');
  assert.deepEqual(fixture.operations.at(-1).request.todoIds, ['t1']);
  await assert.rejects(definition.execute({ action: 'list', sessionId: 'x' }, exec(fixture)), /未知权限/);
});

test('idle followup keeps explicit nonhuman attribution; no prompt or human-authority source', async () => {
  const fixture = await ready();
  fixture.runtime.host.prompt = () => assert.fail('never use prompt');
  const request = fixture.request();
  const receipt = await fixture.adapter.deliver(request);
  assert.equal(receipt.status, 'delivered'); assert.equal(receipt.requestId, request.requestId);
  const message = fixture.calls[0];
  assert.equal(message.role, 'user'); assert.equal(message.source.kind, LEADER_MESSAGE_SOURCE);
  assert.equal(message.source.senderSessionId, 'leader'); assert.equal(message.source.operationId, request.requestId);
  assert.equal(message.source.purpose, 'send'); assert.equal(message.source.form, 'relay');
  assert.equal([{ type: 'user/message', data: message }].some((event) => event.data.source.kind === 'user'), false);
  assert.deepEqual(await fixture.adapter.deliver(request), receipt); assert.equal(fixture.calls.length, 1);
  const altered = Object.freeze({ ...request, body: '另一正文' });
  assert.equal((await fixture.adapter.deliver(altered)).status, 'rejected'); assert.equal(fixture.calls.length, 1);
});

test('unfrozen or malformed delivery requests are rejected without touching the worker', async () => {
  const fixture = await ready();
  assert.equal((await fixture.adapter.deliver({ ...fixture.request() })).status, 'rejected');
  assert.equal((await fixture.adapter.deliver(fixture.request({ body: '   ' }))).status, 'rejected');
  assert.equal((await fixture.adapter.deliver(fixture.request({ body: 'x'.repeat(12001) }))).status, 'rejected');
  assert.equal((await fixture.adapter.deliver(fixture.request({ expectedCursor: -2 }))).status, 'rejected');
  assert.equal((await fixture.adapter.deliver(null)).status, 'rejected');
  assert.equal(fixture.calls.length, 0);
});

test('same request in flight is never inserted twice', async () => {
  let release;
  const fixture = setup({ dependencies: new Promise((resolve) => { release = resolve; }) });
  const binding = fixture.adapter.refreshBindings();
  release({ getTraceable: (_ctx, value) => value, createUserMessage: (input) => ({ ...input, id: randomUUID(), role: 'user' }) });
  await binding;
  const request = fixture.request();
  const [first, second] = await Promise.all([fixture.adapter.deliver(request), fixture.adapter.deliver(request)]);
  assert.equal(first.status, 'delivered'); assert.equal(second.status, 'uncertain'); assert.equal(fixture.calls.length, 1);
});

for (const [name, mutate] of [
  ['maintenance busy even if public status idle', (f) => f.setBusy(true)],
  ['running', (f) => { f.worker.status = 'running'; }],
  ['queued turn', (f) => f.worker.inbox.nextTurn.push({})],
  ['queued context/steering', (f) => f.worker.inbox.nextStep.push({})],
  ['unknown queue', (f) => { f.worker.inbox = null; }],
  ['approval', (f) => f.pending.push({ agentId: 'worker', event: 'approval/request' })],
  ['question', (f) => f.pending.push({ agentId: 'worker', event: 'user-questions/request' })],
  ['other input', (f) => f.pending.push({ agentId: 'worker', event: 'custom/request' })],
  ['changed cursor', (f) => { f.worker.session.seq++; }],
  ['changed exact instance', (f) => f.residents.set('worker', { ...f.worker, id: 'another' })],
  ['archived', (f) => f.ctx.workspaceRegistry.archivedSessionIds.push('worker')],
  ['unknown archive', (f) => { f.ctx.workspaceRegistry = null; }],
  ['ledger/mapping authorization revoked', (f) => f.setAdmitted(false)],
  ['cold session', (f) => f.residents.delete('worker')],
  ['subagent rather than standalone session', (f) => { f.worker.session.header.origin = 'subagent'; }],
  ['Leader storage fault', (f) => { f.runtime.leaderStorageFault = true; }],
  ['Leader stopping', (f) => { f.runtime.leaderStopping = true; }],
  ['unbound Leader tools', (f) => { f.residents.set('leader', { ...f.leader }); }],
]) test(`atomic guarded admission rejects ${name}`, async () => {
  const fixture = await ready(); mutate(fixture);
  const receipt = await fixture.adapter.deliver(fixture.request());
  assert.equal(receipt.ok, false); assert.equal(receipt.status, 'rejected'); assert.equal(fixture.calls.length, 0);
});

test('last-mile mutation inside maintenance rejects rather than using an earlier snapshot', async () => {
  const fixture = await ready();
  fixture.worker.runMaintenance = (job) => { fixture.pending.push({ agentId: 'worker', event: 'approval/request' }); return job(new AbortController().signal); };
  assert.equal((await fixture.adapter.deliver(fixture.request())).status, 'rejected'); assert.equal(fixture.calls.length, 0);
});

test('possible accepted failure keeps an uncertain tombstone and never retries', async () => {
  const fixture = await ready({ followup: () => { throw new Error('persistence unconfirmed'); } });
  const request = fixture.request();
  const first = await fixture.adapter.deliver(request);
  assert.equal(first.status, 'uncertain'); assert.deepEqual(await fixture.adapter.deliver(request), first); assert.equal(fixture.calls.length, 1);
});

test('a rejected delivery is cached too: the same frozen request is not retried, a new requestId is', async () => {
  const fixture = await ready(); fixture.worker.status = 'running';
  const request = fixture.request();
  const first = await fixture.adapter.deliver(request);
  assert.equal(first.status, 'rejected');
  fixture.worker.status = 'idle';
  assert.deepEqual(await fixture.adapter.deliver(request), first); assert.equal(fixture.calls.length, 0);
  assert.equal((await fixture.adapter.deliver(fixture.request())).status, 'delivered'); assert.equal(fixture.calls.length, 1);
});

test('the Leader cannot deliver to itself and the adapter has no notify entry point', async () => {
  const fixture = await ready();
  assert.equal((await fixture.adapter.deliver(fixture.request({ sessionId: 'leader' }))).status, 'rejected');
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.adapter.notify, undefined);
  assert.equal(fixture.adapter.humanMessages, undefined);
  assert.deepEqual(Object.keys(fixture.adapter).sort(), ['bindingStatus', 'capabilities', 'deliver', 'dispose', 'observe', 'prepare', 'prepareWorker', 'questions',
    'refreshBindings', 'refreshWorkerBindings', 'state']);
});

test('capabilities require native infrastructure and a bound Leader', async () => {
  const fixture = setup();
  assert.deepEqual(fixture.adapter.capabilities, { atomicIdleDelivery: false, nonHumanSource: false });
  await fixture.adapter.refreshBindings();
  assert.deepEqual(fixture.adapter.capabilities, { atomicIdleDelivery: true, nonHumanSource: true });
  const bare = setup(); bare.runtime.validateLeaderAdmission = undefined; await bare.adapter.refreshBindings();
  assert.equal(bare.adapter.capabilities.atomicIdleDelivery, false);
  assert.equal((await bare.adapter.deliver(bare.request())).status, 'rejected');
});

test('public prepare restores only selected Leader; ordinary reads/delivery never activate workers', async () => {
  const fixture = setup(); fixture.residents.delete('leader');
  let resumed = 0;
  fixture.ctx.sessionController = { resolveAgent: async (id) => { assert.equal(id, 'leader'); resumed++; fixture.residents.set(id, fixture.leader); return { agent: fixture.leader }; } };
  assert.equal((await fixture.adapter.prepare('worker')).status, 'rejected');
  assert.equal((await fixture.adapter.prepare('leader')).status, 'prepared'); assert.equal(resumed, 1);
  assert.deepEqual([...fixture.definitions.keys()], [...LEADER_TOOL_NAMES]);
  fixture.residents.delete('worker');
  await fixture.adapter.observe('worker', null);
  assert.equal((await fixture.adapter.deliver(fixture.request())).status, 'rejected'); assert.equal(resumed, 1);
});

test('prepare refuses an archived or unverifiable-archive Leader', async () => {
  const fixture = setup();
  fixture.ctx.workspaceRegistry.archivedSessionIds.push('leader');
  assert.equal((await fixture.adapter.prepare('leader')).ok, false);
  fixture.ctx.workspaceRegistry.archivedSessionIds.length = 0; fixture.ctx.workspaceRegistry.archivedSessionIds.push(7);
  assert.equal((await fixture.adapter.prepare('leader')).ok, false);
});

test('baseline is high-water only, no historical text flood; arbitrary read rejected', async () => {
  const fixture = await ready();
  assert.deepEqual(await fixture.adapter.observe('worker', null), { cursor: 19, highWater: 19, events: [], truncated: false });
  await assert.rejects(fixture.adapter.observe('arbitrary', 0), /拒绝读取/);
  await assert.rejects(fixture.adapter.observe('leader', 0), /拒绝读取/);
  await assert.rejects(fixture.adapter.observe('worker', -5), /游标无效/);
  fixture.runtime.host.sessionState = async () => ({ cursor: 5 });
  await assert.rejects(fixture.adapter.observe('worker', 9), /游标未知或倒退/);
});

test('fixed-cut recent pages include bounded text/result evidence but omit raw args/approval/attachment', async () => {
  const fixture = await ready();
  const requests = [];
  fixture.runtime.host.invoke = async (method, request) => {
    assert.equal(method, 'page'); requests.push(request);
    return { cursor: 19, hasMore: false, records: [
      { event: { seq: 15, type: 'user/message', data: { content: [{ text: 'secret prompt' }], source: { kind: 'user' } } } },
      { event: { seq: 16, type: 'approval/asked', data: { secret: 'never include' } } },
      { event: { seq: 17, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'glpat-TOKEN123 Bearer token123 完成片段' }, { type: 'image', imageId: 'private' }] } } } },
      { event: { seq: 18, type: 'tool/result', data: { message: { toolCallId: 'call', isError: false, content: [{ type: 'text', text: 'test passed' }] }, meta: { secret: 'never include' } } } },
      { event: { seq: 19, type: 'turn/end', data: { reason: { kind: 'completed' } } } },
    ] };
  };
  const result = await fixture.adapter.observe('worker', 14);
  assert.equal(result.truncated, false); assert.equal(result.cursor, 19); assert.equal(requests[0].throughSeq, 19);
  const text = JSON.stringify(result);
  for (const secret of ['secret prompt', 'never include', 'TOKEN123', 'token123', 'private']) assert.equal(text.includes(secret), false);
  assert.ok(text.includes('test passed')); assert.ok(text.includes('[redacted]'));
});

test('observe(-1) reads the newest page and returns events oldest-first', async () => {
  const fixture = await ready();
  fixture.runtime.host.invoke = async () => ({ cursor: 19, hasMore: false, records: [
    { event: { seq: 17, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第一' }] } } } },
    { event: { seq: 19, type: 'turn/end', data: { reason: { kind: 'completed' } } } },
  ] });
  const result = await fixture.adapter.observe('worker', -1);
  assert.deepEqual(result.events.map((event) => event.seq), [17, 19]);
  assert.equal(result.truncated, false);
});

test('log gaps beyond fixed page budget are explicit truncated rather than trusted idle evidence', async () => {
  const fixture = await ready(); let pages = 0;
  fixture.runtime.host.invoke = async (_method, request) => {
    pages++; const end = request.beforeSeq ?? 20;
    return { cursor: 19, hasMore: true, records: [{ event: { seq: end - 1, type: 'step/end', data: {} } }] };
  };
  assert.equal((await fixture.adapter.observe('worker', 0)).truncated, true); assert.equal(pages, 4);
});

test('unknown raw events also consume record budget rather than allowing an unbounded scan', async () => {
  const fixture = await ready(); fixture.runtime.host.sessionState = async () => ({ cursor: 1000 });
  fixture.runtime.host.invoke = async () => ({ cursor: 1000, hasMore: false, records: Array.from({ length: 1001 }, (_, seq) => ({ event: { seq, type: 'private/unknown', data: { secret: 'untrusted' } } })) });
  const result = await fixture.adapter.observe('worker', 0); assert.equal(result.truncated, true); assert.deepEqual(result.events, []);
});

test('shutdown removes Leader tools twice safely and never cancels the Leader or any worker', async () => {
  const fixture = await ready(); const entry = fixture.definitions.get(LEADER_TOOL_NAMES[0]);
  fixture.worker.cancel = () => assert.fail('never cancel a managed worker');
  const disposing = fixture.adapter.dispose(); assert.equal(fixture.adapter.dispose(), disposing); await disposing;
  assert.equal(fixture.definitions.size, 0); assert.equal(fixture.adapter.capabilities.atomicIdleDelivery, false);
  assert.deepEqual([...fixture.removals].sort(), [...LEADER_TOOL_NAMES].sort());
  await assert.rejects(entry.definition.execute({}, exec(fixture)), /伪造/);
  assert.equal((await fixture.adapter.prepare('leader')).status, 'rejected');
  assert.equal((await fixture.adapter.deliver(fixture.request())).status, 'rejected');
  assert.equal(fixture.listeners.size, 0);
});

test('dispose also removes worker report registrations', async () => {
  const fixture = await ready();
  await fixture.adapter.refreshWorkerBindings();
  assert.ok(fixture.definitions.has(LEADER_WORKER_TOOL));
  await fixture.adapter.dispose();
  assert.equal(fixture.definitions.size, 0);
  assert.ok(fixture.removals.includes(LEADER_WORKER_TOOL));
  assert.equal(await fixture.adapter.refreshWorkerBindings(), false);
});

for (const [label, snapshot] of [
  ['continued', (s) => ({ asOfSeq: s.seq - 1, values: { userQuestions: { active: [{ state: 'continued' }], settled: [] } } })],
  ['open', (s) => ({ asOfSeq: s.seq - 1, values: { userQuestions: { active: [{ state: 'open' }], settled: [] } } })],
  ['missing unit', (s) => ({ asOfSeq: s.seq - 1, values: {} })],
  ['stale snapshot', (s) => ({ asOfSeq: s.seq - 2, values: { userQuestions: { active: [], settled: [] } } })],
  ['malformed', (s) => ({ asOfSeq: s.seq - 1, values: { userQuestions: { active: [], settled: null } } })],
  ['throw', () => { throw new Error('projection unavailable'); }],
]) test(`authoritative native question fence rejects ${label} without a foreground Gateway wait`, async () => {
  const fixture = await ready(); fixture.ctx.sessionProjections.snapshot = snapshot;
  assert.equal((await fixture.adapter.deliver(fixture.request())).status, 'rejected');
  assert.equal(fixture.calls.length, 0);
  fixture.runtime.host.sessionState = async () => ({ cursor: 19, active: true, pendingInput: [] });
  assert.ok((await fixture.adapter.state('worker')).pendingInput.length);
});

test('cold state remains passive and does not invent a human question', async () => {
  const fixture = await ready(); fixture.residents.delete('worker');
  fixture.runtime.host.sessionState = async () => ({ cursor: 19, active: false, running: false, queue: null, pendingInput: [] });
  assert.deepEqual((await fixture.adapter.state('worker')).pendingInput, []);
});

test('state() serves only the Leader itself and managed workers', async () => {
  const fixture = await ready();
  fixture.runtime.host.sessionState = async () => ({ cursor: 19, active: false });
  assert.equal((await fixture.adapter.state('leader')).cursor, 19);
  assert.equal((await fixture.adapter.state('worker')).cursor, 19);
  await assert.rejects(fixture.adapter.state('human'), /拒绝读取/);
});

test('questions() renders active native questions as untrusted text for managed workers only', async () => {
  const fixture = await ready();
  fixture.ctx.sessionProjections.snapshot = (session) => ({ asOfSeq: (session?.seq ?? 1) - 1, values: { userQuestions: { active: [
    { questions: [{ question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] }, { question: '单独问题' }] }, '纯文本问题'], settled: [] } } });
  assert.deepEqual(fixture.adapter.questions('worker'), ['选哪个？（选项：A / B）', '单独问题', '纯文本问题']);
  assert.throws(() => fixture.adapter.questions('leader'), /拒绝读取/);
  assert.throws(() => fixture.adapter.questions('human'), /拒绝读取/);
  fixture.residents.delete('worker');
  assert.deepEqual(fixture.adapter.questions('worker'), []);
});

test('an agent/created for the Leader binds its tools; binding failure only logs and never blocks the agent', async () => {
  const fixture = setup();
  await fixture.listeners.get('agent/created')({ agent: fixture.leader });
  assert.deepEqual([...fixture.definitions.keys()].filter((name) => LEADER_TOOL_NAMES.includes(name)), [...LEADER_TOOL_NAMES]);
  assert.equal(fixture.leader.inbox.nextTurn.length, 0);

  const broken = setup({ dependencies: {} });
  await broken.listeners.get('agent/created')({ agent: broken.leader });
  assert.equal(broken.definitions.size, 0);
  const throwing = setup({ dependencies: { getTraceable: () => { throw new Error('trace down'); }, createUserMessage: () => ({}) } });
  await throwing.listeners.get('agent/created')({ agent: throwing.leader });
  assert.equal(throwing.definitions.size, 0);
  assert.match(throwing.warnings.join('\n'), /Leader 工具绑定失败：trace down/);
});

test('startup created barrier awaits shared Leader journal before deciding selection and releasing driver', async () => {
  const fixture = setup(); fixture.runtime.leaderState = undefined;
  let release; let loads = 0; let driverReleased = false;
  fixture.ctx.sessionController = { resolveAgent: () => assert.fail('created barrier must not activate sessions') };
  fixture.runtime.loadLeader = () => { loads++; return new Promise((resolve) => { release = () => { fixture.runtime.leaderState = { sessionId: 'leader' }; resolve(); }; }); };
  const created = fixture.listeners.get('agent/created');
  const selected = created({ agent: fixture.leader }).then(() => { driverReleased = true; assert.ok(fixture.definitions.has(LEADER_TOOL_NAMES[0])); });
  const unselected = created({ agent: fixture.worker });
  assert.equal(loads, 1); assert.equal(driverReleased, false); assert.equal(fixture.definitions.size, 0);
  assert.ok(fixture.runtime.leaderLoadPromise instanceof Promise);
  release(); await Promise.all([selected, unselected]);
  assert.equal(driverReleased, true); assert.equal(loads, 1); assert.equal(fixture.worker.inbox.nextTurn.length, 0);
});

test('startup created barrier reuses journal load already started by Host startup', async () => {
  const fixture = setup(); fixture.runtime.leaderState = undefined; let release;
  fixture.runtime.loadLeader = () => assert.fail('must reuse Host startup load');
  fixture.runtime.leaderLoadPromise = new Promise((resolve) => { release = () => { fixture.runtime.leaderState = { sessionId: 'leader' }; resolve(); }; });
  let released = false;
  const done = fixture.listeners.get('agent/created')({ agent: fixture.leader }).then(() => { released = true; });
  assert.equal(released, false); release(); await done;
  assert.equal(released, true); assert.equal(fixture.adapter.capabilities.atomicIdleDelivery, true);
});

test('prepareWorker activates only plugin-created workers through the trusted session controller', async () => {
  const fixture = setup(); fixture.residents.delete('worker');
  const resolved = [];
  fixture.ctx.sessionController = { resolveAgent: async (id) => { resolved.push(id); fixture.residents.set(id, fixture.worker); return { agent: fixture.worker }; } };
  assert.equal((await fixture.adapter.prepareWorker('leader')).ok, false);
  assert.equal((await fixture.adapter.prepareWorker('outside')).ok, false);
  assert.deepEqual(resolved, []);
  const prepared = await fixture.adapter.prepareWorker('worker'); assert.equal(prepared.ok, true); assert.equal(prepared.status, 'prepared');
  assert.deepEqual(resolved, ['worker']);
  assert.equal((await fixture.adapter.prepareWorker('worker')).ok, true); assert.deepEqual(resolved, ['worker']);
  fixture.residents.delete('worker'); fixture.ctx.workspaceRegistry.archivedSessionIds.push('worker');
  assert.equal((await fixture.adapter.prepareWorker('worker')).ok, false); assert.deepEqual(resolved, ['worker']);
  fixture.ctx.workspaceRegistry.archivedSessionIds.length = 0;
  fixture.ctx.sessionController = { resolveAgent: async () => ({ agent: { ...fixture.worker } }) };
  assert.equal((await fixture.adapter.prepareWorker('worker')).ok, false);
});

// ---- worker → Leader report tool ----

test('the report tool is registered only on resident plugin-created workers, never on the Leader or unmanaged sessions', async () => {
  const fixture = await ready();
  const human = { id: 'human', session: { id: 'human', seq: 1, header: { cwd: 'D:/workspace' } }, status: 'idle', ctx: { effect: () => {} } };
  fixture.residents.set('human', human);
  fixture.runtime.managed = new Set(['leader', 'worker']); // even a bogus Leader entry must be ignored
  assert.equal(await fixture.adapter.refreshWorkerBindings(), true);
  assert.equal(fixture.registered.filter((name) => name === LEADER_WORKER_TOOL).length, 1);
  const { definition, config } = fixture.definitions.get(LEADER_WORKER_TOOL);
  assert.equal(config.when({ agent: fixture.worker }), true);
  assert.equal(config.when({ agent: fixture.leader }), false);
  assert.equal(config.when({ agent: human }), false);
  assert.deepEqual(definition.parameters.required, ['kind', 'text']);
  assert.deepEqual(definition.parameters.properties.kind.enum, ['progress', 'blocked', 'done', 'question']);
  assert.equal(definition.parameters.additionalProperties, false);
  // Workers keep their tools: only the report tool is added, nothing is restricted or guarded.
  assert.equal('restrict' in fixture.tools, false); assert.equal('guard' in fixture.tools, false);
});

test('report tool calls reach workerReport with an opaque worker identity and reject forged callers or extra fields', async () => {
  const fixture = await ready(); await fixture.adapter.refreshWorkerBindings();
  const { definition } = fixture.definitions.get(LEADER_WORKER_TOOL);
  const result = await definition.execute({ kind: 'progress', text: '已完成一半' }, exec(fixture, fixture.worker));
  assert.equal(result.result.branded, true);
  assert.deepEqual([fixture.operations.at(-1).operation, fixture.operations.at(-1).request], ['workerReport', { kind: 'progress', text: '已完成一半' }]);
  const before = fixture.operations.length;
  await assert.rejects(definition.execute({ kind: 'done', text: 'x', taskId: 'issue-1' }, exec(fixture, fixture.worker)), /未知字段/);
  await assert.rejects(definition.execute({ kind: 'done', text: 'x' }, exec(fixture, { ...fixture.worker })), /不是插件创建的 worker/);
  await assert.rejects(definition.execute({ kind: 'done', text: 'x' }, exec(fixture, fixture.leader)), /不是插件创建的 worker/);
  assert.equal(fixture.operations.length, before);
});

test('revoking management removes the report tool and blocks calls already registered', async () => {
  const fixture = await ready(); await fixture.adapter.refreshWorkerBindings();
  const { definition, config } = fixture.definitions.get(LEADER_WORKER_TOOL);
  fixture.runtime.managed.clear();
  assert.equal(config.when({ agent: fixture.worker }), false);
  await assert.rejects(definition.execute({ kind: 'done', text: 'x' }, exec(fixture, fixture.worker)), /不是插件创建的 worker/);
  await fixture.adapter.refreshWorkerBindings();
  assert.equal(fixture.definitions.has(LEADER_WORKER_TOOL), false);
  assert.ok(fixture.removals.includes(LEADER_WORKER_TOOL));
  // Managing it again re-binds one fresh registration.
  fixture.runtime.managed.add('worker');
  await fixture.adapter.refreshWorkerBindings();
  assert.equal(fixture.definitions.has(LEADER_WORKER_TOOL), true);
});

test('cold or replaced worker agents get no stale report registration; agent/disposed removes it', async () => {
  const fixture = await ready();
  fixture.residents.delete('worker');
  await fixture.adapter.refreshWorkerBindings();
  assert.equal(fixture.definitions.has(LEADER_WORKER_TOOL), false);
  // The resident worker appears (agent/created): it gains the tool without Leader involvement.
  fixture.residents.set('worker', fixture.worker);
  await fixture.listeners.get('agent/created')({ agent: fixture.worker });
  assert.equal(fixture.definitions.has(LEADER_WORKER_TOOL), true);
  await fixture.listeners.get('agent/disposed')({ agent: fixture.worker });
  assert.equal(fixture.definitions.has(LEADER_WORKER_TOOL), false);
  // An unmanaged agent never gets one.
  fixture.runtime.managed.clear();
  await fixture.listeners.get('agent/created')({ agent: fixture.worker });
  assert.equal(fixture.definitions.has(LEADER_WORKER_TOOL), false);
});

test('worker binding failure is logged and never throws into the worker', async () => {
  const fixture = setup({ dependencies: { getTraceable: () => { throw new Error('trace down'); }, createUserMessage: () => ({}) } });
  assert.equal(await fixture.adapter.refreshWorkerBindings(), false);
  assert.match(fixture.warnings.join('\n'), /worker 汇报工具绑定失败：trace down/);
  assert.equal(fixture.definitions.size, 0);
});

test('Leader replacement rebinds tools to the new Leader and drops the old registration', async () => {
  const fixture = await ready();
  const old = fixture.definitions.get(LEADER_TOOL_NAMES[0]);
  const next = { id: 'leader-2', session: { id: 'leader-2', seq: 3, header: { cwd: 'D:/workspace' } }, status: 'idle', ctx: fixture.leader.ctx, inbox: { nextTurn: [], nextStep: [] } };
  fixture.residents.set('leader-2', next); fixture.runtime.leaderState.sessionId = 'leader-2';
  assert.equal(await fixture.adapter.refreshBindings(), true);
  assert.deepEqual([...fixture.definitions.keys()].filter((name) => LEADER_TOOL_NAMES.includes(name)).sort(), [...LEADER_TOOL_NAMES].sort());
  const current = fixture.definitions.get(LEADER_TOOL_NAMES[0]);
  assert.notEqual(current, old);
  assert.equal(current.config.when({ agent: next }), true);
  assert.equal(current.config.when({ agent: fixture.leader }), false);
  assert.equal(old.config.when({ agent: fixture.leader }), false);
  assert.ok(fixture.removals.length >= LEADER_TOOL_NAMES.length);
});
test('the Leader hides only the denied standard tools the host really has, and restores them on unbind', async () => {
  const { LEADER_DENIED_TOOLS } = await import('../host/leader-agent.js');
  assert.ok(LEADER_DENIED_TOOLS.includes('subagent') && LEADER_DENIED_TOOLS.includes('plugin_manager'));
  for (const kept of ['pwsh', 'bash', 'read', 'glob', 'grep', 'skill', 'todo_write', 'web_fetch']) assert.equal(LEADER_DENIED_TOOLS.includes(kept), false, kept);
  // The host has only these two of the denied tools; the rest must be skipped silently instead of aborting the binding.
  const fixture = await ready({ knownTools: ['subagent', 'schedule_create', 'pwsh', 'read'] });
  assert.deepEqual([...fixture.hidden].sort(), ['schedule_create', 'subagent']);
  assert.deepEqual([...fixture.definitions.keys()], [...LEADER_TOOL_NAMES]);
  fixture.listeners.get('agent/disposed')({ agent: fixture.leader });
  assert.equal(fixture.hidden.size, 0);
});

test('an unbound Leader reports why: not resident, no Leader recorded', async () => {
  const fixture = setup();
  fixture.residents.delete('leader');
  assert.equal(await fixture.adapter.refreshBindings(), false);
  assert.match(fixture.adapter.bindingStatus, /不在宿主 agent 注册表/);
  fixture.runtime.leaderState = { sessionId: null };
  assert.equal(await fixture.adapter.refreshBindings(), false);
  assert.match(fixture.adapter.bindingStatus, /尚未记录/);
  const prepared = await fixture.adapter.prepare('leader');
  assert.equal(prepared.ok, false);
});

test('agent/created warns with the reason when the selected Leader cannot be bound', async () => {
  const fixture = setup();
  fixture.runtime.leaderState = { sessionId: 'leader' };
  fixture.residents.delete('leader'); // agent/created fires, but the registry does not return it yet
  await fixture.listeners.get('agent/created')({ agent: fixture.leader });
  assert.ok(fixture.warnings.some((line) => /Leader 工具未绑定：.*不在宿主 agent 注册表/.test(line)), fixture.warnings.join('|'));
  fixture.residents.set('leader', fixture.leader);
  await fixture.listeners.get('agent/created')({ agent: fixture.leader });
  assert.ok(LEADER_TOOL_NAMES.every((name) => fixture.definitions.has(name)));
});