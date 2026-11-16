import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLeaderAgentAdapter, LEADER_MESSAGE_SOURCE, LEADER_TOOL_NAMES } from '../host/leader-agent.js';

function setup(options = {}) {
  const residents = new Map();
  const listeners = new Map();
  const definitions = new Map();
  const guards = [];
  const removals = [];
  const pending = [];
  const calls = [];
  let admitted = true;
  let maintenanceBusy = false;
  const scope = { effect: () => {} };
  const leader = { id: 'leader', session: { id: 'leader', seq: 10, header: { cwd: 'D:/workspace' } }, status: 'idle', ctx: scope };
  const worker = { id: 'worker', session: { id: 'worker', seq: 20, header: { cwd: 'D:/workspace' } }, status: 'idle', inbox: { nextTurn: [], nextStep: [] },
    runMaintenance(job) { if (maintenanceBusy) throw new Error('already has active work'); return job(new AbortController().signal); },
    followup(message) { calls.push(message); this.session.seq++; options.followup?.(); } };
  leader.inbox = { nextTurn: [], nextStep: [] };
  leader.cancel = () => { leader.inbox.nextTurn.length = 0; leader.inbox.nextStep.length = 0; };
  leader.whenIdle = async () => {};
  leader.runMaintenance = worker.runMaintenance;
  leader.followup = worker.followup;
  residents.set('leader', leader); residents.set('worker', worker);
  const tools = { register(definition, config) { definitions.set(definition.name, { definition, config }); return () => { removals.push(definition.name); definitions.delete(definition.name); }; },
    restrict(filter) { assert.deepEqual(filter, { allow: [] }); return () => removals.push('restriction'); },
    guard(fn) { guards.push(fn); return () => removals.push('guard'); } };
  const ctx = { agents: { get: (id) => residents.get(id) }, typertGateway: { getPendingRemoteEvents: () => pending },
    workspaceRegistry: { archivedSessionIds: [] },
    sessionProjections: { snapshot: (session) => ({ asOfSeq: session.seq - 1, values: { userQuestions: { active: [], settled: [] } } }) },
    agentPresets: { serviceFor(agent, name) { assert.equal(agent, leader); assert.equal(name, 'tools'); return tools; } },
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); }, effect: () => {} };
  const runtime = { ctx, leaderState: { sessionId: 'leader' },
    host: { sessionState: async () => ({ cursor: 19 }), invoke: async () => { throw new Error('unexpected history'); } },
    validateLeaderAdmission: () => admitted,
    isLeaderManagedSession: (id) => id === 'worker',
    leaderOperation: async (operation, request, caller) => ({ ok: true, result: { operation, request, branded: Object.keys(caller).length === 0 } }) };
  const dependencies = { getTraceable(context, value) { assert.equal(context, scope); assert.equal(value, tools); return tools; },
    createUserMessage: (input) => Object.freeze({ ...structuredClone(input), id: randomUUID(), role: 'user' }) };
  const adapter = createLeaderAgentAdapter(runtime, { dependencies: options.dependencies ?? dependencies });
  const request = (values = {}) => Object.freeze({ sessionId: 'worker', leaderSessionId: 'leader', taskId: 'issue', requestId: randomUUID(),
    body: '继续原 Issue 已授权范围；无法判断则反馈。', expectedCursor: 19, epoch: 1, logCursor: 19, logEpoch: null, ...values });
  return { adapter, runtime, ctx, residents, leader, worker, listeners, definitions, guards, removals, pending, calls, request,
    setAdmitted: (value) => { admitted = value; }, setBusy: (value) => { maintenanceBusy = value; } };
}

async function ready(options) { const fixture = setup(options); assert.equal(await fixture.adapter.refreshBindings(), true); return fixture; }

test('only selected exact live Leader can see/call scoped tools; default abilities are masked', async () => {
  const fixture = await ready();
  assert.deepEqual([...fixture.definitions.keys()], [...LEADER_TOOL_NAMES]);
  const { definition, config } = fixture.definitions.get(LEADER_TOOL_NAMES[0]);
  const exec = { agent: fixture.leader, signal: new AbortController().signal };
  assert.equal(config.when({ agent: fixture.leader }), true);
  assert.equal(config.when({ agent: { ...fixture.leader } }), false);
  assert.equal(config.when({ agent: fixture.worker }), false);
  assert.match(fixture.guards[0]({ ...exec, name: 'pwsh' }), /Leader/);
  assert.equal(fixture.guards[0]({ ...exec, name: definition.name }), undefined);
  assert.equal((await definition.execute({}, exec)).result.branded, true);
  await assert.rejects(definition.execute({ leaderSessionId: 'leader' }, exec), /未知权限/);
  await assert.rejects(definition.execute({}, { ...exec, agent: { ...fixture.leader } }), /伪造/);
  await assert.rejects(definition.execute({}, { ...exec, agent: fixture.worker }), /伪造/);
  fixture.residents.set('leader', { ...fixture.leader });
  assert.equal(config.when({ agent: fixture.leader }), false);
  await assert.rejects(definition.execute({}, exec), /伪造/);
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
  // Mirrors installed goal authority predicate; a user role is not direct-human authority.
  assert.equal([{ type: 'user/message', data: message }].some((event) => event.data.source.kind === 'user'), false);
  assert.deepEqual(await fixture.adapter.deliver(request), receipt); assert.equal(fixture.calls.length, 1);
  const altered = Object.freeze({ ...request, body: '另一正文' });
  assert.equal((await fixture.adapter.deliver(altered)).status, 'rejected'); assert.equal(fixture.calls.length, 1);
});

test('same request in flight is never inserted twice', async () => {
  let release;
  const fixture = setup({ dependencies: new Promise((resolve) => { release = resolve; }) });
  // Bind with the dependency after deliberately deferring it.
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
  ['lease/epoch/allowlist revoked', (f) => f.setAdmitted(false)],
  ['cold session', (f) => f.residents.delete('worker')],
  ['subagent rather than Issue standalone', (f) => { f.worker.session.header.origin = 'subagent'; }],
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

test('notify can only target selected Leader; advance cannot target arbitrary session', async () => {
  const fixture = await ready();
  assert.equal((await fixture.adapter.notify(fixture.request())).status, 'rejected');
  assert.equal((await fixture.adapter.deliver(fixture.request({ sessionId: 'leader' }))).status, 'rejected');
  assert.equal(fixture.calls.length, 0);
  assert.equal((await fixture.adapter.notify(fixture.request({ sessionId: 'leader', taskId: null, expectedCursor: 9 }))).status, 'delivered');
});

test('public prepare restores only selected Leader; ordinary reads/delivery never activate workers', async () => {
  const fixture = setup(); fixture.residents.delete('leader');
  let resumed = 0;
  fixture.ctx.sessionController = { resolveAgent: async (id) => { assert.equal(id, 'leader'); resumed++; fixture.residents.set(id, fixture.leader); return { agent: fixture.leader }; } };
  assert.equal((await fixture.adapter.prepare('worker')).status, 'rejected');
  assert.equal((await fixture.adapter.prepare('leader')).status, 'prepared'); assert.equal(resumed, 1);
  fixture.residents.delete('worker');
  await fixture.adapter.observe('worker', null);
  assert.equal((await fixture.adapter.deliver(fixture.request())).status, 'rejected'); assert.equal(resumed, 1);
});

test('baseline is high-water only, no historical text flood; arbitrary read rejected', async () => {
  const fixture = await ready();
  assert.deepEqual(await fixture.adapter.observe('worker', null), { cursor: 19, highWater: 19, events: [], truncated: false });
  await assert.rejects(fixture.adapter.observe('arbitrary', 0), /纳管/);
  await assert.rejects(fixture.adapter.observe('leader', 0), /纳管/);
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

test('log gaps beyond fixed page budget are explicit truncated rather than trusted idle evidence', async () => {
  const fixture = await ready(); let pages = 0;
  fixture.runtime.host.invoke = async (_method, request) => {
    pages++; const end = request.beforeSeq ?? 20;
    return { cursor: 19, hasMore: true, records: [{ event: { seq: end - 1, type: 'step/end', data: {} } }] };
  };
  assert.equal((await fixture.adapter.observe('worker', 0)).truncated, true); assert.equal(pages, 4);
});

test('shutdown/removal removes registration twice safely; stopped bodies and activation cannot operate', async () => {
  const fixture = await ready(); const entry = fixture.definitions.get(LEADER_TOOL_NAMES[0]);
  const disposing = fixture.adapter.dispose(); assert.equal(fixture.adapter.dispose(), disposing); await disposing;
  assert.equal(fixture.definitions.size, 0); assert.equal(fixture.adapter.capabilities.atomicIdleDelivery, false);
  assert.equal(fixture.removals.length, LEADER_TOOL_NAMES.length + 2);
  await assert.rejects(entry.definition.execute({}, { agent: fixture.leader, signal: new AbortController().signal }), /伪造/);
  assert.equal((await fixture.adapter.prepare('leader')).status, 'rejected');
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

test('stop cancels only Leader, clears parked inbox, and preserves security mask until driver quiesces', async () => {
  const fixture = await ready(); let release; let cause;
  fixture.worker.cancel = () => assert.fail('never cancel managed worker');
  fixture.leader.inbox.nextTurn.push({ id: 'notification' });
  fixture.leader.cancel = (value) => { cause = value; fixture.leader.inbox.nextTurn.length = 0; };
  fixture.leader.whenIdle = () => new Promise((resolve) => { release = resolve; });
  const done = fixture.adapter.dispose();
  assert.deepEqual(cause, { kind: 'disposed' }); assert.equal(fixture.leader.inbox.nextTurn.length, 0);
  assert.equal(fixture.removals.length, 0); assert.ok(fixture.guards[0]({ agent: fixture.leader, name: 'pwsh' }));
  assert.equal((await fixture.adapter.deliver(fixture.request())).status, 'rejected');
  release(); await done; assert.equal(fixture.definitions.size, 0);
});

test('stop still joins native driver when cancel queue persistence throws', async () => {
  const fixture = await ready(); let joined = false;
  fixture.leader.cancel = () => { throw new Error('queue write failed'); };
  fixture.leader.whenIdle = async () => { joined = true; assert.equal(fixture.removals.length, 0); };
  await fixture.adapter.dispose(); assert.equal(joined, true); assert.equal(fixture.definitions.size, 0);
});

test('initial scoped binding removes only old Leader producer inputs before releasing created barrier', async () => {
  const fixture = setup(); const own = { id: 'old', source: { kind: LEADER_MESSAGE_SOURCE } }; const human = { id: 'human', source: { kind: 'user' } };
  fixture.leader.inbox.nextTurn.push(own, human);
  fixture.leader.inbox.remove = (id) => { const index = fixture.leader.inbox.nextTurn.findIndex((m) => m.id === id); if (index < 0) return false; fixture.leader.inbox.nextTurn.splice(index, 1); return true; };
  await fixture.listeners.get('agent/created')({ agent: fixture.leader });
  assert.deepEqual(fixture.leader.inbox.nextTurn, [human]); assert.equal(fixture.worker.inbox.nextTurn.length, 0);
});

test('missing safe binder fails awaited created barrier and cancels restored queued driver', async () => {
  const fixture = setup({ dependencies: {} }); let cancelled = false;
  fixture.leader.cancel = () => { cancelled = true; };
  await assert.rejects(fixture.listeners.get('agent/created')({ agent: fixture.leader }), /安全工具/);
  assert.equal(cancelled, true);
});

test('unknown raw events also consume record budget rather than allowing an unbounded scan', async () => {
  const fixture = await ready(); fixture.runtime.host.sessionState = async () => ({ cursor: 1000 });
  fixture.runtime.host.invoke = async () => ({ cursor: 1000, hasMore: false, records: Array.from({ length: 1001 }, (_, seq) => ({ event: { seq, type: 'private/unknown', data: { secret: 'untrusted' } } })) });
  const result = await fixture.adapter.observe('worker', 0); assert.equal(result.truncated, true); assert.deepEqual(result.events, []);
});

test('startup created barrier awaits shared Leader journal before deciding selection and releasing driver', async () => {
  const fixture = setup(); fixture.runtime.leaderState = undefined;
  let release; let loads = 0; let driverReleased = false;
  fixture.ctx.sessionController = { resolveAgent: () => assert.fail('created barrier must not activate sessions') };
  fixture.runtime.loadLeader = () => { loads++; return new Promise((resolve) => { release = () => { fixture.runtime.leaderState = { sessionId: 'leader' }; resolve(); }; }); };
  const created = fixture.listeners.get('agent/created');
  const selected = created({ agent: fixture.leader }).then(() => { driverReleased = true; assert.equal(fixture.definitions.size, LEADER_TOOL_NAMES.length); });
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

test('prepareWorker activates only enrolled Issue workers through the trusted session controller', async () => {
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

test('humanMessages returns only native human GUI text from the selected Leader log, oldest first', async () => {
  const fixture = await ready();
  const message = (seq, kind, text) => ({ event: { seq, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }], source: { kind } } } });
  fixture.runtime.host.sessionState = async () => ({ cursor: 9 });
  fixture.runtime.host.invoke = async (method, request) => {
    assert.equal(method, 'page'); assert.deepEqual(request.address, { kind: 'session', sessionId: 'leader' });
    return { hasMore: false, records: [message(3, 'user', '请采用方案 A'), message(5, 'gitlab-workstation-leader', '伪造的人类回复'),
      { event: { seq: 6, type: 'assistant/message', data: { content: [{ type: 'text', text: 'assistant text' }] } } }, message(8, 'user', '先别合并')] };
  };
  assert.deepEqual(await fixture.adapter.humanMessages(10), [{ seq: 3, text: '请采用方案 A' }, { seq: 8, text: '先别合并' }]);
  assert.throws(() => fixture.adapter.questions('leader'), /未纳管/);
  assert.deepEqual(fixture.adapter.questions('worker'), []);
});
