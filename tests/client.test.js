import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function clientSource() {
  return (await readFile(new URL('../client.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
}

async function loadClientBridge(fetchImpl) {
  const source = await clientSource();
  const marker = '    function formatTime(value, fallback) {';
  assert.ok(source.includes(marker), 'client bridge test marker must remain present');
  // 只暴露文件内已有的 bridge/post，不改被测实现；factory 仍在原 ModuleLoader 中执行。
  const instrumented = source.replace(marker,
    `    globalThis.__clientBridgeForTest = { bridge, post };\n${marker}`);
  let definition;
  const context = vm.createContext({
    AbortSignal,
    fetch: fetchImpl,
    window: {
      __ModuleLoader__: {
        load(value) { definition = value; },
      },
    },
  });
  vm.runInContext(instrumented, context, { filename: 'client.js' });
  assert.ok(definition, 'client module must register itself');
  definition.factory((name) => {
    assert.equal(name, 'react');
    return { createElement() { assert.fail('bridge tests never render React'); }, Component: class {} };
  });
  return context.__clientBridgeForTest;
}

test('issue refresh and log clearing use POST while cached issue reads stay GET', async () => {
  const calls = [];
  const { bridge, post } = await loadClientBridge(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, items: [], orphans: [] }; },
    };
  });

  await post('issues', { refresh: true });
  await bridge('issues');
  await post('logs', { clear: true });

  assert.deepEqual(calls.map((call) => call.options.method), ['POST', 'GET', 'POST']);
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'issues', refresh: true });
  assert.deepEqual(JSON.parse(calls[2].options.body), { action: 'logs', clear: true });
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[1].url, '/api/gitlab-todo-agent?action=issues');
  assert.equal(calls[1].options.body, undefined);
});

test('issue rows have no manual route action while todo routing remains available', async () => {
  const source = await clientSource();
  const panel = (name, nextName) => {
    const start = source.indexOf(`activeTab === '${name}' && snapshot && h('section'`);
    const end = source.indexOf(`activeTab === '${nextName}' &&`, start);
    assert.ok(start >= 0 && end > start, `${name} panel markers must remain present`);
    return source.slice(start, end);
  };

  const issues = panel('issues', 'workspaces');
  const todos = panel('todos', 'issues');
  assert.doesNotMatch(issues, /openRouteTargets\(issue\)/);
  assert.doesNotMatch(issues, /t\('routeToSession'\)/);
  assert.match(todos, /openRouteTargets\(todo, event\.currentTarget\)/);
  assert.match(todos, /t\('routeToSession'\)/);
});

test('panel drops repeated introductions and long settings help while retaining feedback', async () => {
  const source = await clientSource();
  const start = source.indexOf("\n      return h('div', { className: 'gta-root' }");
  const end = source.indexOf('    const CSS = `', start);
  assert.ok(start >= 0 && end > start, 'panel render markers must remain present');
  const render = source.slice(start, end);

  for (const key of ['subtitle', 'defaultPaused', 'sessionModelFixedHint', 'judgeModelHint',
    'precheckEngineHint', 'classifierHint', 'sessionCwdHint', 'signatureHint', 'customRulesHint', 'followUpHint']) {
    assert.doesNotMatch(render, new RegExp(`h\\('(?:p|span)',[^\\n]*t\\('${key}'\\)`), `${key} should not be rendered as permanent copy`);
  }
  for (const key of ['localError', 'issuesError', 'confirmReprocess', 'confirmClearLogs']) {
    assert.match(render, new RegExp(`t\\('${key}'\\)`), `${key} feedback must remain available`);
  }
});

test('issue session controls use exact-model reasoning metadata and independent settings', async () => {
  const source = await clientSource();
  const marker = '    function PanelIcon({ size = 20 }) {';
  assert.ok(source.includes(marker), 'client model helper test marker must remain present');
  const instrumented = source.replace(marker,
    `    globalThis.__clientModelForTest = { reasoningForSelection, withReasoningEffort, issueModelFromOption, changedSettingsPatch };\n${marker}`);
  let definition;
  const context = vm.createContext({
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
  });
  vm.runInContext(instrumented, context, { filename: 'client.js' });
  definition.factory(() => ({ createElement() { assert.fail('model helper tests never render React'); }, Component: class {} }));
  const {
    reasoningForSelection, withReasoningEffort, issueModelFromOption, changedSettingsPatch,
  } = context.__clientModelForTest;
  const catalog = {
    groups: [{
      id: 'deepseek',
      models: [
        { id: 'plain', name: 'Plain' },
        { id: 'reasoning', name: 'Reasoning', reasoning: {
          defaultEffort: 'low',
          efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
        } },
      ],
    }],
  };
  const route = { provider: 'deepseek', model: 'reasoning' };
  const reasoning = reasoningForSelection(catalog, route);
  assert.equal(reasoning.defaultEffort, 'low');
  assert.deepEqual(Array.from(reasoning.efforts, (effort) => effort.id), ['low', 'high']);
  assert.equal(reasoningForSelection(catalog, { provider: 'deepseek', model: 'plain' }), null);
  assert.equal(reasoningForSelection(catalog, { provider: 'other', model: 'reasoning' }), null);
  assert.equal(reasoningForSelection(catalog, null), null);
  assert.deepEqual(JSON.parse(JSON.stringify(withReasoningEffort(route, 'high'))), { ...route, reasoningEffort: 'high' });
  assert.deepEqual(JSON.parse(JSON.stringify(withReasoningEffort({ ...route, reasoningEffort: 'high' }, ''))), route);

  const previous = { ...route, reasoningEffort: 'high' };
  assert.deepEqual(JSON.parse(JSON.stringify(issueModelFromOption(JSON.stringify(route), previous))), previous);
  assert.deepEqual(JSON.parse(JSON.stringify(issueModelFromOption(JSON.stringify({ provider: 'deepseek', model: 'plain' }), previous))), {
    provider: 'deepseek', model: 'plain',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(issueModelFromOption(JSON.stringify({ provider: 'other', model: 'reasoning' }), previous))), {
    provider: 'other', model: 'reasoning',
  });
  assert.equal(issueModelFromOption('', previous), null);
  const staleDraft = {
    intervalSeconds: 300,
    issueSessionCwd: 'D:\\stale-issue',
    issueSessionModel: previous,
  };
  const current = {
    intervalSeconds: 60,
    issueSessionCwd: 'D:\\current-issue',
    issueSessionModel: { provider: 'other', model: 'new', reasoningEffort: 'maximum' },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(changedSettingsPatch(staleDraft, current))), { intervalSeconds: 300 });
  assert.deepEqual(JSON.parse(JSON.stringify(changedSettingsPatch({ issueSessionModel: previous }, { issueSessionModel: previous }))), {});

  const issueStart = source.indexOf("activeTab === 'issues' && snapshot && h('section'");
  const issueEnd = source.indexOf("activeTab === 'handled' &&", issueStart);
  const issues = source.slice(issueStart, issueEnd);
  assert.match(issues, /t\('issueSessionSettings'\)/);
  assert.match(issues, /modelOptions\(issueModel\)/);
  assert.match(issues, /updateSettings\(\{ issueSessionCwd/);
  assert.match(issues, /settings\.issueSessionCwd/);
  assert.match(issues, /updateIssueModel\(event\.target\.value\)/);
  assert.match(issues, /updateIssueEffort\(event\.target\.value\)/);
  assert.match(issues, /issueSessionCwdUnregistered && h\('option'/);
  assert.match(issues, /issueReasoning && h\('label'/);
  assert.match(issues, /reasoningEffort/);
  assert.match(source, /const needWorkspacePolling = [^;]*activeTab === 'issues'/);
  assert.match(issues, /workspaceError && h\('div'/);
  assert.match(issues, /workspaceData === null && !workspaceError/);
  assert.match(issues, /disabled: busySet\.has\('settings'\) \|\| busySet\.has\(`dispatch:\$\{issue\.id\}`\)/);
  assert.match(source, /const dispatchIssue = \(issue\) => \{\s*if \(busyKeysRef\.current\.has\('settings'\)\) return Promise\.resolve\(false\)/);
});

test('inbox exposes the real archived state and unarchive errors', async () => {
  const source = await clientSource();
  const start = source.indexOf("activeTab === 'inbox' && snapshot && h('section'");
  const end = source.indexOf("activeTab === 'todos' &&", start);
  assert.ok(start >= 0 && end > start, 'inbox panel markers must remain present');
  const inbox = source.slice(start, end);
  assert.match(inbox, /item\.archived/);
  assert.match(inbox, /t\('sessionArchived'\)/);
  assert.match(inbox, /item\.archiveError/);
  assert.match(source, /\.gta-banner\{[^}]*overflow-wrap:anywhere/);
});

test('compact styles keep controls small and wrap list content responsively', async () => {
  const source = await clientSource();
  const start = source.indexOf('    const CSS = `');
  const end = source.indexOf('`;', start);
  assert.ok(start >= 0 && end > start, 'CSS markers must remain present');
  const css = source.slice(start, end);

  assert.match(css, /\.gta-button\{[^}]*min-height:28px;[^}]*padding:4px 9px;[^}]*font-size:12px/);
  assert.match(css, /\.gta-todo\{[^}]*gap:10px;padding:7px 10px;[^}]*border-bottom:/);
  assert.match(css, /\.gta-list\{[^}]*gap:0;[^}]*overflow:hidden/);
  assert.doesNotMatch(css, /\.gta-todo\{[^}]*border-radius:/);
  assert.match(css, /\.gta-todo-title\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.gta-todo-actions\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.gta-tabs\{[^}]*overflow-x:auto/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /minmax\(min\(100%,240px\),1fr\)/);
  assert.doesNotMatch(css, /(?:rgb|rgba|hsl|hsla)\(|#[0-9a-f]{3,8}\b/i);
  // Explicit two-class specificity must beat the later neutral base .gta-tag rule.
  assert.match(css, /\.gta-tag\.gta-tag-attention\{color:var\(--dsw-alias-state-warn-primary\);border-color:/);
  assert.match(css, /\.gta-tag\.gta-tag-error\{color:var\(--dsw-alias-state-error-primary\);border-color:/);
});

async function loadWorkstationHelpers() {
  const source = await clientSource();
  const marker = '    function PanelIcon({ size = 20 }) {';
  assert.ok(source.includes(marker));
  const instrumented = source.replace(marker,
    `    globalThis.__workstationForTest = { WORKSTATION_TABS, nextWorkstationTab, filterWorkstationItems, recordStatusClass, issueSettingsSummary, changedSettingsPatch, canProcessTodo, finishCurrentViewOperation };\n${marker}`);
  let definition;
  const context = vm.createContext({
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
  });
  vm.runInContext(instrumented, context, { filename: 'client.js' });
  definition.factory(() => ({
    createElement() { assert.fail('pure helper tests must never render a component'); },
    Component: class {},
  }));
  return context.__workstationForTest;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

async function loadSessionEntryHelpers() {
  const source = await clientSource();
  const marker = '    function PanelIcon({ size = 20 }) {';
  const instrumented = source.replace(marker,
    `    globalThis.__entryHelpers = { inspectSessionEntry, clientSessionArchive, navigateSessionSafely, createSessionEntryGuard, handoffsForTask, canCreateSessionHandoff, readHandoffResult, refreshedSessionHandoff, en, zh };\n${marker}`);
  let definition;
  const context = vm.createContext({ AbortController, AbortSignal,
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
  });
  vm.runInContext(instrumented, context, { filename: 'client.js' });
  definition.factory(() => ({
    createElement() { assert.fail('safe-entry tests exercise pure logic only, not React or DOM'); },
    Component: class {},
  }));
  return context.__entryHelpers;
}

function sessionEntryFixture({ statuses = ['active'], loaded = { openState: 'open', removed: false }, archived = [], phase = 'ready' } = {}) {
  const calls = [];
  let index = 0;
  const workspace = { phase, state: 'idle', archivedSessionIds: archived };
  const binding = { session: { getSnapshot() { calls.push('snapshot'); return loaded; } } };
  const ctx = {
    workspaces: { list: { getSnapshot() { return workspace; } } },
    sessions: {
      async refresh() { calls.push('refresh'); },
      retain(id, options) {
        calls.push('retain'); assert.equal(id, 'session-a'); assert.equal(options.source, 'controllerOperation');
        return { ready: Promise.resolve(binding), release() { calls.push('release'); } };
      },
    },
    uiWorkspace: {
      async unarchiveSession(id) { calls.push('unarchive'); workspace.archivedSessionIds = workspace.archivedSessionIds.filter((item) => item !== id); },
      openSession(id) { calls.push('open'); assert.equal(id, 'session-a'); },
    },
  };
  const request = async (action, payload) => {
    calls.push('inspect'); assert.equal(action, 'inspectSession'); assert.equal(payload.sessionId, 'session-a');
    return { ok: true, result: { sessionId: 'session-a', status: statuses[Math.min(index++, statuses.length - 1)] } };
  };
  return { ctx, request, sessionId: 'session-a', calls, workspace };
}

test('safe navigation transfers a retained open session only after final live and archive checks', async () => {
  const { navigateSessionSafely } = await loadSessionEntryHelpers();
  const fixture = sessionEntryFixture();
  assert.equal((await navigateSessionSafely(fixture)).status, 'opened');
  assert.deepEqual(fixture.calls, ['inspect', 'refresh', 'retain', 'inspect', 'snapshot', 'open', 'release']);
});

test('missing, unknown and archived inspection do not navigate, load or silently restore', async () => {
  const { navigateSessionSafely } = await loadSessionEntryHelpers();
  for (const status of ['missing', 'unknown', 'archived']) {
    const fixture = sessionEntryFixture({ statuses: [status] });
    assert.equal((await navigateSessionSafely(fixture)).status, status);
    assert.deepEqual(fixture.calls, ['inspect']);
  }
});

test('explicit recovery waits for Client acknowledgement then rechecks existence and loaded state', async () => {
  const { navigateSessionSafely } = await loadSessionEntryHelpers();
  const fixture = sessionEntryFixture({ statuses: ['archived', 'active', 'active'], archived: ['session-a'] });
  assert.equal((await navigateSessionSafely({ ...fixture, restore: true })).status, 'opened');
  assert.deepEqual(fixture.calls, ['inspect', 'unarchive', 'inspect', 'refresh', 'retain', 'inspect', 'snapshot', 'open', 'release']);
  const deleted = sessionEntryFixture({ statuses: ['archived', 'missing'], archived: ['session-a'] });
  assert.equal((await navigateSessionSafely({ ...deleted, restore: true })).status, 'missing');
  assert.deepEqual(deleted.calls, ['inspect', 'unarchive', 'inspect']);
});

test('Client stale archive requires explicit recovery and a superseding archive refuses navigation', async () => {
  const { navigateSessionSafely } = await loadSessionEntryHelpers();
  const stale = sessionEntryFixture({ archived: ['session-a'] });
  assert.equal((await navigateSessionSafely(stale)).status, 'archived');
  assert.deepEqual(stale.calls, ['inspect']);
  const superseded = sessionEntryFixture({ statuses: ['archived', 'active', 'active'], archived: ['session-a'] });
  superseded.ctx.uiWorkspace.unarchiveSession = async () => { superseded.calls.push('unarchive'); };
  assert.equal((await navigateSessionSafely({ ...superseded, restore: true })).status, 'archived');
  assert.ok(!superseded.calls.includes('open'));
  assert.equal(superseded.calls.at(-1), 'release');
});

test('settled ready in error, removed or cold state is not a successful open', async () => {
  const { navigateSessionSafely } = await loadSessionEntryHelpers();
  for (const loaded of [
    { openState: 'error', removed: false, openError: { code: 'session/not-found', message: 'load failed' } },
    { openState: 'open', removed: true }, { openState: 'cold', removed: false }, { openState: 'open' },
  ]) {
    const fixture = sessionEntryFixture({ loaded });
    assert.equal((await navigateSessionSafely(fixture)).status, 'unknown');
    assert.ok(!fixture.calls.includes('open'));
    assert.equal(fixture.calls.at(-1), 'release');
  }
  const deleted = sessionEntryFixture({ statuses: ['active', 'missing'] });
  assert.equal((await navigateSessionSafely(deleted)).status, 'missing');
  assert.equal(deleted.calls.at(-1), 'release');
});

test('catalog errors and malformed or unavailable capabilities fail closed, never imply deletion', async () => {
  const { navigateSessionSafely, clientSessionArchive, inspectSessionEntry } = await loadSessionEntryHelpers();
  for (const alter of [
    (f) => { f.ctx.sessions.refresh = async () => { throw new Error('permission denied'); }; },
    (f) => { f.ctx.sessions.retain = () => { throw new Error('sessions.retain: unknown session session-a'); }; },
    (f) => { delete f.ctx.sessions; },
    (f) => { f.workspace.phase = 'pending'; },
    (f) => { f.workspace.archivedSessionIds = [false]; },
    (f) => { f.workspace.state = 'error'; },
  ]) {
    const fixture = sessionEntryFixture(); alter(fixture);
    assert.equal((await navigateSessionSafely(fixture)).status, 'unknown');
    assert.ok(!fixture.calls.includes('open'));
  }
  assert.equal(clientSessionArchive({}, 'session-a'), null);
  for (const data of [null, { ok: false }, { ok: true, result: { sessionId: 'wrong', status: 'missing' } },
    { ok: true, result: { sessionId: 'session-a', status: 'deleted' } }]) {
    assert.equal((await inspectSessionEntry(async () => data, 'session-a')).status, 'unknown');
  }
});

test('reference readiness and navigation throws release the temporary reference', async () => {
  const { navigateSessionSafely } = await loadSessionEntryHelpers();
  const fixture = sessionEntryFixture();
  fixture.ctx.uiWorkspace.openSession = () => { fixture.calls.push('open'); throw new Error('main acquisition failed'); };
  assert.equal((await navigateSessionSafely(fixture)).status, 'unknown');
  assert.equal(fixture.calls.at(-1), 'release');
  const rejected = sessionEntryFixture();
  rejected.ctx.sessions.retain = () => ({ ready: Promise.reject(new Error('generation disposed')), release() { rejected.calls.push('release'); } });
  assert.equal((await navigateSessionSafely(rejected)).status, 'unknown');
  assert.equal(rejected.calls.at(-1), 'release');
});

test('duplicate entry operations are rejected and closing or reopening invalidates old callbacks', async () => {
  const { createSessionEntryGuard, navigateSessionSafely } = await loadSessionEntryHelpers();
  const guard = createSessionEntryGuard();
  let resolve; let completed = 0;
  const first = guard.run(() => new Promise((done) => { resolve = done; }), () => { completed += 1; });
  assert.equal(await guard.run(() => assert.fail('duplicate operation'), () => assert.fail('duplicate callback')), false);
  guard.reset();
  assert.equal(await guard.run(async () => 'new', () => { completed += 1; }), true);
  resolve('old'); assert.equal(await first, false); assert.equal(completed, 1);
  const fixture = sessionEntryFixture();
  let settle;
  fixture.request = () => new Promise((done) => { settle = done; });
  const pending = guard.run((options) => navigateSessionSafely({ ...fixture, ...options }), () => assert.fail('stale navigation callback'));
  guard.reset(); settle({ ok: true, result: { sessionId: 'session-a', status: 'active' } });
  assert.equal(await pending, false); assert.ok(!fixture.calls.includes('open'));
});

test('handoff history preserves unknown creation and existing sessions, with safe partial response handling', async () => {
  const { handoffsForTask, canCreateSessionHandoff, readHandoffResult } = await loadSessionEntryHelpers();
  const journal = [{ taskId: '7', sessionId: '', status: 'creation-unknown', requestId: 'same' },
    { taskId: '8', sessionId: 'other' }, { taskId: '7', sessionId: 'new', status: 'created', handoffText: 'context' }];
  assert.deepEqual(plain(handoffsForTask({ manualHandoffs: journal }, 7)), [journal[0], journal[2]]);
  const entry = { taskId: '7', sessionId: 'old', result: { status: 'missing', sessionId: 'old' } };
  assert.equal(canCreateSessionHandoff(entry), true);
  assert.equal(canCreateSessionHandoff({ ...entry, manualHandoffs: [journal[0]] }), false);
  assert.equal(canCreateSessionHandoff({ ...entry, handoff: journal[2] }), true);
  assert.equal(canCreateSessionHandoff({ ...entry, handoff: { ...journal[2], status: 'ready' } }), false);
  assert.equal(canCreateSessionHandoff({ ...entry, taskId: undefined }), false);
  assert.equal(canCreateSessionHandoff({ ...entry, busy: true }), false);
  assert.equal(canCreateSessionHandoff({ ...entry, result: { status: 'unknown', sessionId: 'old' } }), false);
  const t = (key) => key;
  const partial = readHandoffResult({ ok: true, result: { ok: false, sessionId: 'new', handoffText: 'context', error: 'rename failed' } }, t);
  assert.equal(partial.handoff.sessionId, 'new'); assert.equal(partial.handoff.handoffText, 'context'); assert.equal(partial.error, 'rename failed');
  const missingText = readHandoffResult({ ok: true, result: { ok: true, sessionId: 'new' } }, t);
  assert.equal(missingText.handoff.sessionId, 'new'); assert.equal(missingText.handoff.handoffText, ''); assert.ok(missingText.error);
  assert.equal(readHandoffResult({ ok: true, result: { ok: true, sessionId: '  ', handoffText: 'bad' } }, t).handoff, null);
});

test('fresh handoff inspection updates selected requests without losing historical selection', async () => {
  const { refreshedSessionHandoff } = await loadSessionEntryHelpers();
  const creating = { requestId: 'selected', sessionId: '', status: 'creating', error: '' };
  const ready = { requestId: 'selected', sessionId: 'new-session', status: 'ready', error: '', handoffText: 'context' };
  const newerHistory = { requestId: 'newer', sessionId: 'another-session', status: 'ready' };
  assert.deepEqual(plain(refreshedSessionHandoff(creating, [ready, newerHistory])), ready);
  const partial = { ...ready, status: 'created', error: 'rename failed' };
  const refreshed = refreshedSessionHandoff(partial, [ready, newerHistory]);
  assert.equal(refreshed.status, 'ready'); assert.equal(refreshed.error, '');
  assert.equal(refreshedSessionHandoff(ready, [ready, newerHistory]).requestId, 'selected');
  assert.deepEqual(plain(refreshedSessionHandoff(creating, [newerHistory])), creating);
  assert.deepEqual(plain(refreshedSessionHandoff(null, [ready, newerHistory])), newerHistory);
  assert.equal(refreshedSessionHandoff(null, []), undefined);
  const legacyPartial = { sessionId: 'new-session', error: 'rename failed' };
  const legacyFresh = refreshedSessionHandoff(legacyPartial, [ready, newerHistory]);
  assert.equal(legacyFresh.requestId, 'selected'); assert.equal(legacyFresh.error, ''); assert.equal(legacyFresh.status, 'ready');
});

test('journal rollback preserves known handoff identity and text while adopting fresh uncertainty', async () => {
  const { refreshedSessionHandoff, canCreateSessionHandoff } = await loadSessionEntryHelpers();
  const known = { requestId: 'same', sessionId: 'known-new', handoffText: 'known-context', status: 'created', error: 'save failed' };
  for (const status of ['creating', 'creation-unknown']) {
    const rolledBack = { requestId: 'same', sessionId: '', handoffText: '', status, error: 'Host outcome unknown' };
    const selected = refreshedSessionHandoff(known, [rolledBack]);
    assert.equal(selected.sessionId, 'known-new'); assert.equal(selected.handoffText, 'known-context');
    assert.equal(selected.status, status); assert.equal(selected.error, 'Host outcome unknown');
    assert.equal(canCreateSessionHandoff({ taskId: 'task', sessionId: 'old', result: { sessionId: 'old', status: 'missing' },
      handoff: selected, manualHandoffs: [rolledBack] }), false);
  }
  const source = await clientSource();
  assert.match(source, /\['creating', 'creation-unknown'\]\.includes\(sessionEntry\.handoff\.status\) \? 'sessionHandoffUncertain'/);
});

test('all five session entries share the guard, archived rows remain reachable, and locales match', async () => {
  const source = await clientSource();
  assert.equal((source.match(/=> openSession\(\{/g) || []).length, 5);
  assert.equal((source.match(/ctx\.uiWorkspace\.openSession\(sessionId\)/g) || []).length, 1);
  assert.doesNotMatch(source, /item\.sessionId && !item\.archived && h\(Button/);
  assert.doesNotMatch(source, /session\.archived\s*\? h\('span'/);
  assert.match(source, /taskId: item\.todoId/); assert.match(source, /taskId: todo\.id/); assert.match(source, /taskId: issue\.id/);
  assert.match(source, /requestId = entry\.handoff\?\.requestId/);
  assert.match(source, /readOnly: true, rows: 7/);
  assert.match(source, /inject: \['slots', 'locale', 'uiWorkspace', 'sessions', 'workspaces', 'connection'\]/);
  assert.match(source, /handoff: result\.handoff \|\| sessionEntryRef\.current\.handoff/);
  assert.match(source, /sessionEntry\.handoff\.sessionId && h\(Button/);
  const handoff = source.slice(source.indexOf('      const createHandoff ='), source.indexOf('      const copyHandoff ='));
  assert.doesNotMatch(handoff, /dispatch|prompt|acknowledge|routeToSession/);
  const { en, zh } = await loadSessionEntryHelpers();
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});

test('grouped workstation tabs navigate across groups, wrap, and ignore unrelated keys', async () => {
  const { WORKSTATION_TABS: tabs, nextWorkstationTab } = await loadWorkstationHelpers();
  assert.deepEqual(Array.from(tabs, (tab) => tab.id), ['inbox', 'todos', 'issues', 'workspaces', 'logs']);
  assert.deepEqual(Array.from(tabs, (tab) => tab.group), ['tasksGroup', 'tasksGroup', 'tasksGroup', 'environmentGroup', 'environmentGroup']);
  assert.equal(nextWorkstationTab('issues', 'ArrowRight'), 'workspaces');
  assert.equal(nextWorkstationTab('workspaces', 'ArrowLeft'), 'issues');
  assert.equal(nextWorkstationTab('inbox', 'ArrowLeft'), 'logs');
  assert.equal(nextWorkstationTab('logs', 'ArrowRight'), 'inbox');
  assert.equal(nextWorkstationTab('issues', 'Home'), 'inbox');
  assert.equal(nextWorkstationTab('todos', 'End'), 'logs');
  assert.equal(nextWorkstationTab('todos', 'Enter'), null);
  assert.equal(nextWorkstationTab('missing', 'ArrowRight'), null);

  const source = await clientSource();
  assert.match(source, /const \[activeTab, setActiveTab\] = React\.useState\('issues'\)/);
  assert.match(source, /tabIndex: activeTab === tab\.id \? 0 : -1/);
  assert.match(source, /tabRefs\.current\.get\(next\)\?\.focus\(\)/);
  for (const tab of tabs) {
    assert.match(source, new RegExp(`role: 'tabpanel'[^\\n]*panel-${tab.id}[^\\n]*tab-${tab.id}[^\\n]*tabIndex: 0`));
  }
});

test('local list search filters loaded metadata without mutating records or pagination', async () => {
  const { filterWorkstationItems } = await loadWorkstationHelpers();
  const items = Object.freeze([
    Object.freeze({ id: 'issue:alpha:7', title: 'Fix focus', project: 'Team/Workbench', author: 'Ada', labels: Object.freeze(['UX', '紧凑']) }),
    Object.freeze({ todoId: 81, title: 'Pipeline failed', project: 'Team/CI', sessionTitle: 'Investigate', closure: 'needs-human' }),
    Object.freeze({ id: 9, title: 'Literal [test].', project: 'Docs' }),
  ]);
  assert.equal(filterWorkstationItems(items, '   '), items);
  assert.deepEqual(plain(filterWorkstationItems(items, '  TEAM   ux ')), [items[0]]);
  assert.deepEqual(plain(filterWorkstationItems(items, '紧凑 Ada')), [items[0]]);
  assert.deepEqual(plain(filterWorkstationItems(items, '81 needs-human')), [items[1]]);
  assert.deepEqual(plain(filterWorkstationItems(items, '[test].')), [items[2]]);
  assert.equal(filterWorkstationItems(items, 'pipeline ux').length, 0);
  assert.equal(filterWorkstationItems(null, 'any').length, 0);
  assert.equal(items.length, 3);

  const source = await clientSource();
  assert.match(source, /visibleOrphans = filterWorkstationItems\(issuesData\?\.orphans, listQuery\)/);
  assert.doesNotMatch(source, /activeTab === 'handled'|handledData|fetchHandled|post\('handled'/);
});

test('status tones prioritize live execution and human closure over completed green', async () => {
  const { recordStatusClass, issueSettingsSummary } = await loadWorkstationHelpers();
  assert.equal(recordStatusClass({ executionStatus: 'completed', closure: 'needs-human' }), 'gta-tag-attention');
  assert.equal(recordStatusClass({ executionStatus: 'completed', closure: 'follow-up' }), 'gta-tag-attention');
  assert.equal(recordStatusClass({ executionStatus: 'completed', closure: 'verifying' }), 'gta-tag-attention');
  assert.equal(recordStatusClass({ executionStatus: 'running', closure: 'closed' }), 'gta-tag-mention');
  assert.equal(recordStatusClass({ pending: true, executionStatus: 'completed' }), 'gta-tag-mention');
  assert.equal(recordStatusClass({ executionStatus: 'starting' }), 'gta-tag-mention');
  assert.equal(recordStatusClass({ executionStatus: 'failed' }), 'gta-tag-error');
  assert.equal(recordStatusClass({ closure: 'closed' }), 'gta-tag-success');
  assert.equal(recordStatusClass({ outcome: 'rule-skipped' }), 'gta-tag-success');
  assert.equal(recordStatusClass({}), 'gta-tag-neutral');
  const t = (key) => ({ modelSummary: '模型', workspaceSummary: '工作区', colon: '：', defaultModelShort: 'DSH 默认', autoWorkspaceShort: '自动' }[key]);
  assert.equal(issueSettingsSummary({ provider: 'p', model: 'm', reasoningEffort: 'high' }, 'D:\\code\\repo\\', t), '模型：p/m · high · 工作区：repo');
  assert.equal(issueSettingsSummary(null, '', t), '模型：DSH 默认 · 工作区：自动');
});

test('general settings only save user-edited baseline fields and preserve quick Issue and Todo updates', async () => {
  const { changedSettingsPatch } = await loadWorkstationHelpers();
  const baseline = { enabled: false, intervalSeconds: 60, sessionModel: { provider: 'p', model: 'old' }, issueSessionCwd: 'old-cwd', issueSessionModel: null };
  const draft = { ...baseline, intervalSeconds: 300 };
  const current = { ...baseline, enabled: true, sessionModel: { provider: 'p', model: 'new' }, issueSessionCwd: 'new-cwd', issueSessionModel: { provider: 'issue', model: 'independent' } };
  assert.deepEqual(plain(changedSettingsPatch(draft, current, baseline)), { intervalSeconds: 300 });
  assert.deepEqual(plain(changedSettingsPatch({ ...draft, sessionModel: { provider: 'p', model: 'picked' } }, current, baseline)), {
    intervalSeconds: 300, sessionModel: { provider: 'p', model: 'picked' },
  });
  assert.deepEqual(plain(changedSettingsPatch(draft, { ...current, intervalSeconds: 300 }, baseline)), {});
  assert.deepEqual(plain(changedSettingsPatch({ ...draft, issueSessionModel: { provider: 'x', model: 'ignored' } }, current, baseline)), { intervalSeconds: 300 });
});

test('Todo quick controls stay in Todo context and MR completion cannot bypass confirmation', async () => {
  const { canProcessTodo } = await loadWorkstationHelpers();
  assert.equal(canProcessTodo({ targetType: 'MergeRequest', directMention: false, handled: false }), false);
  assert.equal(canProcessTodo({ url: 'https://gitlab.local/project/-/merge_requests/8', handled: false }), false);
  assert.equal(canProcessTodo({ targetType: 'MergeRequest', directMention: true, handled: false }), true);
  assert.equal(canProcessTodo({ targetType: 'Issue', handled: false }), true);
  assert.equal(canProcessTodo({ targetType: 'Issue', handled: true, outcome: 'session-accepted' }), true);
  assert.equal(canProcessTodo({ targetType: 'MergeRequest', directMention: true, handled: true, outcome: 'merge-request-done' }), false);
  const source = await clientSource();
  const header = source.slice(source.indexOf("h('header', { className: 'gta-header' }"), source.indexOf("!snapshot && !error"));
  assert.doesNotMatch(header, /quickModelKey|post\('poll'\)|updateSettings\(\{ enabled:/);
  const todos = source.slice(source.indexOf("activeTab === 'todos' && snapshot && h('section'"), source.indexOf("activeTab === 'issues' && snapshot && h('section'"));
  assert.match(todos, /quickModelKey/);
  assert.match(todos, /post\('poll'\)/);
  assert.match(todos, /pressed: settings\.enabled/);
  assert.match(todos, /canProcessTodo\(todo\) && h\(Button/);
  assert.match(todos, /todo\.executionStatus === 'running' \|\| todo\.executionStatus === 'starting'/);
  assert.match(todos, /guardedRun\(`markdone:\$\{todo\.id\}`/);
  assert.match(todos, /guardedRun\(`reprocess:\$\{todo\.id\}`/);
  assert.match(source, /Date\.now\(\) - pendingAt <= 3000/);
  assert.match(source, /confirmTimers\.current\.forEach\(\(timer\) => clearTimeout\(timer\)\)/);
});

test('routing uses native radios with dialog initial focus, focus containment and restoration', async () => {
  const source = await clientSource();
  assert.match(source, /type: 'radio', name: `\$\{PANEL_ID\}-route-target`/);
  assert.doesNotMatch(source, /role: 'listbox'|role: 'option'/);
  assert.match(source, /dialog\?\.querySelector\('button:not\(:disabled\)'\)\?\.focus\(\)/);
  assert.match(source, /event\.shiftKey && \(focused === first/);
  assert.match(source, /!event\.shiftKey && \(focused === last/);
  assert.match(source, /trigger\?\.focus\(\)/);
  assert.match(source, /radios\.find\(\(node\) => node\.checked\) \?\? radios\[0\]/);
  assert.match(source, /window\.removeEventListener\('keydown', onKeyDown\)/);
  assert.match(source, /selectedRouteTarget = routeItems\.find\(/);
  assert.doesNotMatch(source, /selectedRouteTarget = allRouteItems\.find\(/);
});

test('old route and settings completions cannot close a reopened view', async () => {
  const { finishCurrentViewOperation } = await loadWorkstationHelpers();
  for (const view of ['route', 'settings']) {
    const generation = { current: 1 };
    let completed = 0;
    let resolve;
    const operation = new Promise((done) => { resolve = done; });
    const finish = finishCurrentViewOperation(operation, 1, generation, () => { completed += 1; });
    generation.current += 2; // Close the original view and open a different one before success.
    resolve(true);
    assert.equal(await finish, true, `${view}: the sent operation still completes`);
    assert.equal(completed, 0, `${view}: the newer view must remain open`);
    await finishCurrentViewOperation(Promise.resolve(true), 3, generation, () => { completed += 1; });
    assert.equal(completed, 1, `${view}: success closes the current submitting view`);
    await finishCurrentViewOperation(Promise.resolve(false), 3, generation, () => { completed += 1; });
    assert.equal(completed, 1, `${view}: failure must keep the view open`);
    await assert.rejects(finishCurrentViewOperation(Promise.reject(new Error('failed operation')), 3, generation, () => { completed += 1; }), /failed operation/);
    assert.equal(completed, 1);
  }
  const source = await clientSource();
  assert.match(source, /finishCurrentViewOperation\(perform\(`route:/);
  assert.match(source, /generation, routeGeneration, closeRouteTargets\)/);
  assert.match(source, /routeGeneration\.current === generation && data\.result\?\.ok === false/);
  assert.match(source, /if \(routeGeneration\.current === generation\) setRouteError\(cause\.message\)/);
  assert.match(source, /finishCurrentViewOperation\(saveGeneralSettings\(\), generation, draftGeneration, closeGeneralSettings\)/);
  assert.match(source, /onClick: closeGeneralSettings/);
  assert.match(source, /draftGeneration\.current \+= 1; draftBaseline\.current = settings/);
});

async function loadLeaderHelpers() {
  const source = await clientSource();
  const marker = '    function PanelIcon({ size = 20 }) {';
  assert.ok(source.includes(marker));
  const instrumented = source.replace(marker,
    `    globalThis.__leaderHelpers = { callLeader, LEADER_RPC_OPERATIONS, normalizeLeaderProjection, readLeaderResponse, validLeaderSessionId, canCreateLeader, canRetryLeaderSetup, createSessionEntryGuard, issueModelFromOption, withReasoningEffort, en, zh };\n${marker}`);
  let definition;
  const context = vm.createContext({ AbortController, AbortSignal,
    fetch() { assert.fail('Leader mutations must never fall back to HTTP'); },
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
  });
  vm.runInContext(instrumented, context, { filename: 'client.js' });
  definition.factory(() => ({
    createElement() { assert.fail('Leader tests exercise pure helpers only, never render React or mock DOM'); },
    Component: class {},
  }));
  return context.__leaderHelpers;
}

function leaderProjection(overrides = {}) {
  return { sessionId: null, phase: 'not-created', runState: 'not-created', settings: { model: null }, creation: null,
    deliveries: [], tasks: [], reports: [], unseenReports: 0, error: '', ...overrides };
}

const translateKey = (key) => key;
const LEADER_OPERATIONS = ['snapshot', 'create', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery'];

test('Leader snapshot alone uses read-only POST and carries no session creation', async () => {
  const calls = [];
  const { post } = await loadClientBridge(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, async json() {
      return { ok: true, result: { ok: true }, projection: leaderProjection() };
    } };
  });
  await post('leader', { operation: 'snapshot' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/gitlab-todo-agent');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'leader', operation: 'snapshot' });
});

test('all Leader mutations use authenticated native RPC and unwrap ConnectionRpcResult.value; only the v3 operations exist', async () => {
  const { callLeader, LEADER_RPC_OPERATIONS } = await loadLeaderHelpers();
  const calls = [];
  const value = { ok: true, result: { ok: true }, projection: leaderProjection() };
  const rpc = { async call(channel, operation, payload, signal) {
    assert.equal(this, rpc); calls.push({ channel, operation, payload, signal }); return { ok: true, value };
  } };
  const ctx = { connection: { rpc } };
  const operations = LEADER_OPERATIONS.filter((operation) => operation !== 'snapshot');
  assert.deepEqual(Array.from(LEADER_RPC_OPERATIONS), LEADER_OPERATIONS);
  const payloads = {
    create: {}, configure: { settings: { model: { provider: 'p', model: 'm', reasoningEffort: 'high' } } },
    resolveCreation: { resolution: 'claim', sessionId: 'leader-1' }, resolveTask: { taskId: 'leader-task-0123456789ab', action: 'dismiss' },
    resolveDelivery: { requestId: 'r1', resolution: 'delivered' },
  };
  for (const operation of operations) assert.equal(await callLeader(ctx, operation, payloads[operation]), value);
  assert.equal(calls.length, operations.length);
  calls.forEach((call, index) => {
    assert.equal(call.channel, '/gitlab-workstation-leader'); assert.equal(call.operation, operations[index]);
    assert.equal(call.signal.aborted, false); assert.equal(typeof call.signal.addEventListener, 'function');
    assert.equal(Object.hasOwn(call.payload, 'action') && operations[index] !== 'resolveTask', false);
    assert.equal(Object.hasOwn(call.payload, 'operation'), false);
  });
  assert.deepEqual(calls[1].payload.settings, { model: { provider: 'p', model: 'm', reasoningEffort: 'high' } });
  assert.deepEqual(calls[3].payload, { taskId: 'leader-task-0123456789ab', action: 'dismiss' });
  // Removed v2 operations are rejected locally, never sent.
  for (const operation of ['start', 'pause', 'enroll', 'unenroll', 'handoff', 'cancelQueued', 'pauseIssue', 'resumeIssue']) {
    await assert.rejects(callLeader(ctx, operation, {}));
  }
  assert.equal(calls.length, operations.length);
  const partialValue = { ok: true, result: { ok: false, sessionId: 'known-partial', error: 'save failed' }, projection: leaderProjection({ phase: 'uncertain' }) };
  assert.equal(await callLeader({ connection: { rpc: { async call() { return { ok: true, value: partialValue }; } } } }, 'create'), partialValue);
});

test('Leader native RPC errors, missing value, absent connection and cancellation fail closed without HTTP fallback', async () => {
  const { callLeader } = await loadLeaderHelpers();
  await assert.rejects(callLeader({}, 'create'), /Authenticated browser connection is unavailable/);
  await assert.rejects(callLeader({ connection: { rpc: { async call() { return { ok: false, error: { code: 'forbidden', message: 'browser owner required' } }; } } } }, 'configure'), /browser owner required/);
  for (const response of [null, {}, { ok: true }, { ok: true, value: null }, { ok: true, value: {} }, { ok: true, value: [] }, { ok: true, value: { ok: false } }]) {
    await assert.rejects(callLeader({ connection: { rpc: { async call() { return response; } } } }, 'create'));
  }
  const rpc = { async call() { assert.fail('already-aborted or removed operations must not use native RPC'); } };
  await assert.rejects(callLeader({ connection: { rpc } }, 'start'));
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(callLeader({ connection: { rpc } }, 'resolveTask', { taskId: 'leader-task-0123456789ab', action: 'dismiss' }, cancelled.signal));
  const controller = new AbortController(); let forwardedSignal;
  await callLeader({ connection: { rpc: { async call(channel, operation, payload, signal) {
    forwardedSignal = signal; return { ok: true, value: { ok: true } };
  } } } }, 'create', {}, controller.signal);
  controller.abort(); assert.equal(forwardedSignal.aborted, true);
  const source = await clientSource();
  const lifecycle = source.slice(source.indexOf('      const runLeader ='), source.indexOf('      // Log Tab'));
  assert.match(lifecycle, /callLeader\(ctx, operation, payload, signal\)/);
  assert.doesNotMatch(lifecycle, /post\(|bridge\(|fetch\(|Origin|token/);
  assert.match(source, /inject: \['slots', 'locale', 'uiWorkspace', 'sessions', 'workspaces', 'connection'\]/);
});

test('Leader projections require a real phase and settings, tolerate missing lists, and sanitize ad-hoc tasks and reports', async () => {
  const { normalizeLeaderProjection, canCreateLeader, validLeaderSessionId } = await loadLeaderHelpers();
  const initial = normalizeLeaderProjection(leaderProjection());
  assert.deepEqual(plain(initial), leaderProjection({ creation: null }));
  assert.equal(canCreateLeader(initial, null, false), true);
  assert.equal(canCreateLeader(initial, 'known-id', false), false);
  assert.equal(canCreateLeader(initial, null, true), false);
  assert.equal(canCreateLeader(normalizeLeaderProjection(leaderProjection({ sessionId: 'leader-1', phase: 'ready' })), null, false), false);
  for (const value of [null, {}, leaderProjection({ phase: 'enabled' }), leaderProjection({ phase: 'paused' }), leaderProjection({ phase: 'constructor' }),
    leaderProjection({ settings: undefined }), leaderProjection({ sessionId: '  invalid  ' }),
    leaderProjection({ settings: { model: { provider: 'p' } } })]) {
    assert.equal(normalizeLeaderProjection(value), null);
  }
  for (const id of ['', ' ', ' id', 'id\n', 7, null]) assert.equal(validLeaderSessionId(id), false);
  const sparse = normalizeLeaderProjection({ sessionId: null, phase: 'not-created', settings: {} });
  assert.deepEqual(plain(sparse), leaderProjection({ runState: '' }));
  assert.equal(normalizeLeaderProjection(leaderProjection({ runState: 'bogus' })).runState, '');
  for (const runState of ['not-created', 'creation-uncertain', 'setup-incomplete', 'error', 'ready']) {
    assert.equal(normalizeLeaderProjection(leaderProjection({ runState })).runState, runState);
  }
  const ready = normalizeLeaderProjection(leaderProjection({ sessionId: 'leader-1', phase: 'ready', runState: 'ready', unseenReports: 2,
    settings: { model: { provider: 'kiro', model: 'deep', reasoningEffort: 'high' } },
    creation: { status: 'ready', createdAt: 5, agentPreset: 'standard' },
    tasks: [{ taskId: 'leader-task-0123456789ab', sessionId: null, title: '调查 IAM', status: 'uncertain', createdAt: 3, error: 'timeout' },
      { taskId: 'leader-task-aaaaaaaaaaaa', sessionId: 'task-s', title: 'x', status: 'bogus' }, { taskId: '' }, null],
    reports: [{ id: 'r1', taskId: 'leader-task-aaaaaaaaaaaa', sessionId: 'task-s', kind: 'done', text: '完成', at: 9, seen: false },
      { id: 'r2', kind: 'message', text: 'dropped' }, { id: 'r3', kind: 'progress', text: 7, seen: 'yes' }, null] }));
  assert.deepEqual(plain(ready.settings.model), { provider: 'kiro', model: 'deep', reasoningEffort: 'high' });
  assert.equal(ready.creation.agentPreset, 'standard'); assert.equal(ready.unseenReports, 2);
  assert.deepEqual(plain(ready.tasks.map((task) => [task.taskId, task.sessionId, task.status, task.error])),
    [['leader-task-0123456789ab', null, 'uncertain', 'timeout'], ['leader-task-aaaaaaaaaaaa', 'task-s', 'created', '']]);
  assert.deepEqual(plain(ready.reports.map((entry) => [entry.id, entry.kind, entry.text, entry.seen])),
    [['r1', 'done', '完成', false], ['r3', 'progress', '', false]]);
  for (const removed of ['enabled', 'items', 'audit', 'queue', 'completed', 'previousSessions', 'comments', 'run']) assert.equal(Object.hasOwn(ready, removed), false, removed);
  assert.equal(Object.hasOwn(ready.settings, 'autoEnrollNew'), false);
  const deliveries = normalizeLeaderProjection(leaderProjection({ deliveries: [
    { requestId: 'r1', kind: 'steer', taskId: 'leader-task-0123456789ab', sessionId: 'w', status: 'uncertain', error: 'lost', at: 9 },
    { requestId: 'r2', kind: 'relay' }, { requestId: 'r3', kind: 'advance' }, { kind: 'send' }, null] })).deliveries;
  assert.deepEqual(plain(deliveries.map((entry) => entry.requestId)), ['r1']);
});

test('Leader snapshot prefers projection, supports direct result, and mutation errors preserve known IDs', async () => {
  const { readLeaderResponse } = await loadLeaderHelpers();
  const ready = leaderProjection({ sessionId: 'leader-good', phase: 'ready', runState: 'ready' });
  const other = leaderProjection({ sessionId: 'leader-old', phase: 'error', error: 'setup failed' });
  const preferred = readLeaderResponse({ ok: true, projection: ready, result: other }, 'snapshot', null, translateKey);
  assert.equal(preferred.projection.phase, 'ready'); assert.equal(preferred.sessionId, 'leader-good'); assert.equal(preferred.error, '');
  const direct = readLeaderResponse({ ok: true, result: other }, 'snapshot', null, translateKey);
  assert.equal(direct.sessionId, 'leader-old'); assert.equal(direct.error, 'setup failed');
  const partial = readLeaderResponse({ ok: true, result: { ok: false, sessionId: 'partial-known', error: 'save failed' },
    projection: leaderProjection({ phase: 'uncertain' }) }, 'create', null, translateKey);
  assert.equal(partial.sessionId, 'partial-known'); assert.equal(partial.error, 'save failed');
  const rollback = readLeaderResponse({ ok: true, result: { ok: false, error: 'journal rollback' }, projection: leaderProjection() },
    'create', partial.sessionId, translateKey);
  assert.equal(rollback.sessionId, 'partial-known'); assert.equal(rollback.error, 'journal rollback');
  const malformed = readLeaderResponse({ ok: true, result: { ok: true, sessionId: 'known-without-projection' } }, 'create', null, translateKey);
  assert.equal(malformed.sessionId, 'known-without-projection'); assert.equal(malformed.error, 'leaderInvalidResponse');
  assert.equal(readLeaderResponse({ ok: true, result: { ok: false, error: 'snapshot failed' }, projection: ready }, 'snapshot', null, translateKey).error, 'snapshot failed');
});

test('only a successful authoritative not-created snapshot or abandon releases an attempted Leader creation', async () => {
  const { readLeaderResponse, canCreateLeader } = await loadLeaderHelpers();
  const snapshot = (projection, extra = {}, knownId = null, operation = 'snapshot') =>
    readLeaderResponse({ ok: true, result: { ok: true }, projection, ...extra }, operation, knownId, translateKey);
  const absent = snapshot(leaderProjection());
  assert.equal(absent.creationAbsent, true);
  assert.equal(canCreateLeader(absent.projection, absent.sessionId, !absent.creationAbsent), true);
  for (const phase of ['uncertain', 'error', 'ready']) {
    assert.equal(snapshot(leaderProjection({ phase })).creationAbsent, false);
  }
  assert.equal(snapshot(leaderProjection({ error: 'journal unreadable' })).creationAbsent, false);
  assert.equal(snapshot(leaderProjection({ sessionId: 'leader-known' })).creationAbsent, false);
  assert.equal(snapshot(leaderProjection(), {}, 'leader-known').creationAbsent, false);
  assert.equal(snapshot(leaderProjection(), { ok: false }).creationAbsent, false);
  assert.equal(snapshot(leaderProjection(), { result: { ok: false, error: 'read failed' } }).creationAbsent, false);
  assert.equal(snapshot({}).creationAbsent, false);
  assert.equal(snapshot(leaderProjection(), {}, null, 'create').creationAbsent, false);
  assert.equal(snapshot(leaderProjection(), {}, null, 'resolveDelivery').creationAbsent, false);
  assert.equal(snapshot(leaderProjection({ runState: 'not-created' }), {}, null, 'resolveCreation').creationAbsent, true);
  assert.equal(snapshot(leaderProjection(), { result: { ok: false, error: 'x' } }, null, 'resolveCreation').creationAbsent, false);
  const source = await clientSource();
  assert.match(source, /creationAttempted: result\.creationAbsent \? false : previous\.creationAttempted/);
});

test('known partial Leader setup can retry only the authoritative same ID while unknown creation stays blocked', async () => {
  const { canRetryLeaderSetup, canCreateLeader, callLeader, normalizeLeaderProjection } = await loadLeaderHelpers();
  const projection = (overrides) => normalizeLeaderProjection(leaderProjection(overrides));
  for (const phase of ['error', 'uncertain']) {
    const partial = projection({ sessionId: 'known-leader', phase, error: 'setup failed' });
    assert.equal(canRetryLeaderSetup(partial, 'known-leader'), true);
    assert.equal(canCreateLeader(partial, 'known-leader', true), false);
    assert.equal(canRetryLeaderSetup(partial, 'different-leader'), false);
    assert.equal(canRetryLeaderSetup({ ...partial, sessionId: null }, 'known-leader'), false);
    assert.equal(canRetryLeaderSetup(partial, null), false);
  }
  assert.equal(canRetryLeaderSetup(projection({ sessionId: 'known-leader', phase: 'ready', runState: 'setup-incomplete' }), 'known-leader'), true);
  for (const phase of ['ready', 'not-created']) {
    assert.equal(canRetryLeaderSetup(projection({ sessionId: 'known-leader', phase, runState: phase }), 'known-leader'), false);
  }
  assert.equal(canRetryLeaderSetup(null, 'known-leader'), false);
  assert.equal(canCreateLeader(projection({ phase: 'uncertain' }), null, true), false);
  assert.equal(canRetryLeaderSetup(projection({ phase: 'uncertain' }), null), false);
  let actualPayload;
  await callLeader({ connection: { rpc: { async call(channel, operation, payload) {
    assert.equal(channel, '/gitlab-workstation-leader'); assert.equal(operation, 'create'); actualPayload = payload;
    return { ok: true, value: { ok: true, result: { ok: true, sessionId: 'known-leader' }, projection: leaderProjection({ sessionId: 'known-leader', phase: 'ready' }) } };
  } } } }, 'create', { sessionId: 'known-leader' });
  assert.deepEqual(actualPayload, { sessionId: 'known-leader' });
  const source = await clientSource();
  const gate = source.slice(source.indexOf('      const runLeader ='), source.indexOf('      // Log Tab'));
  assert.match(gate, /operation === 'create' && \(!leaderFresh/);
  assert.match(gate, /!canCreateLeader\(leaderViewRef\.current\.projection/);
  assert.match(gate, /&& !canRetryLeaderSetup\(leaderViewRef\.current\.projection, leaderViewRef\.current\.sessionId\)/);
  assert.match(gate, /\['resolveDelivery', 'resolveCreation', 'resolveTask'\]\.includes\(operation\) && !leaderFresh/);
  assert.match(gate, /payload = \{ settings: \{ model: payload\.settings\?\.model \?\? null \} \}/);
  const issues = source.slice(source.indexOf("activeTab === 'issues' && snapshot && h('section'"), source.indexOf("activeTab === 'workspaces' &&"));
  assert.match(issues, /canRetryLeaderSetup\(leaderProjection, leaderView\.sessionId\) && h\(Button/);
  assert.match(issues, /runLeader\('create', \{ sessionId: leaderView\.sessionId \}\)/);
  assert.match(issues, /t\('leaderRetrySetup'\)/);
});

test('Leader read and action guard rejects duplicates, aborts old reads, and ignores tab-exit results', async () => {
  const { createSessionEntryGuard } = await loadLeaderHelpers();
  const guard = createSessionEntryGuard();
  let settleRead; let oldSignal; let completes = 0;
  const read = guard.run(({ signal }) => { oldSignal = signal; return new Promise((done) => { settleRead = done; }); },
    () => assert.fail('old snapshot must not overwrite mutation'));
  guard.reset(); assert.equal(oldSignal.aborted, true);
  let settleWrite; let actionSignal;
  const write = guard.run(({ signal }) => { actionSignal = signal; return new Promise((done) => { settleWrite = done; }); },
    () => assert.fail('leaving Issue tab must suppress mutation callback'));
  assert.equal(await guard.run(() => assert.fail('duplicate mutation'), () => assert.fail('duplicate completion')), false);
  settleRead('old snapshot'); assert.equal(await read, false);
  guard.reset(); assert.equal(actionSignal.aborted, true);
  settleWrite('old mutation'); assert.equal(await write, false);
  assert.equal(await guard.run(async () => 'fresh status', () => { completes += 1; }), true);
  assert.equal(completes, 1);
  const source = await clientSource();
  const lifecycle = source.slice(source.indexOf('      // Leader has its own'), source.indexOf('      // Log Tab'));
  assert.match(lifecycle, /activeTab !== 'issues'/);
  assert.match(lifecycle, /setInterval\(\(\) => void fetchLeaderSnapshot\(\), 15000\)/);
  assert.match(lifecycle, /clearInterval\(timer\); leaderActiveRef\.current = false/);
  assert.match(lifecycle, /leaderGuard\.current\.reset\(\); leaderActionRef\.current = ''/);
  assert.match(lifecycle, /post\('leader', \{ operation: 'snapshot' \}, signal\)/);
  assert.match(lifecycle, /callLeader\(ctx, operation, payload, signal\)/);
  assert.match(lifecycle, /creationAttempted: leaderViewRef\.current\.creationAttempted \|\| operation === 'create'/);
});

test('Leader entry points reuse safeSessionOpener, keep worker task identity, and never create handoffs for Leader', async () => {
  const source = await clientSource();
  const entries = source.slice(source.indexOf('      const safeSessionOpener ='), source.indexOf('      const createHandoff ='));
  assert.match(entries, /const safeSessionOpener = openSession/);
  assert.match(entries, /safeSessionOpener\(\{ sessionId, title: 'WorkStation Leader' \}, trigger\)/);
  assert.match(entries, /safeSessionOpener\(\{ sessionId: item\.sessionId, taskId: item\.taskId/);
  assert.doesNotMatch(entries, /uiWorkspace|createHandoff|post\(/);
  assert.equal((source.match(/ctx\.uiWorkspace\.openSession\(sessionId\)/g) || []).length, 1);
  const { en, zh } = await loadLeaderHelpers();
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});

test('Leader panel is a compact v3 card: no enrollment, supervision, budgets or approvals; only create/model/recovery controls', async () => {
  const source = await clientSource();
  const start = source.indexOf("activeTab === 'issues' && snapshot && h('section'");
  const end = source.indexOf("activeTab === 'workspaces' &&", start);
  const issues = source.slice(start, end);
  const leader = issues.slice(0, issues.indexOf("h('div', { className: 'gta-issue-toolbar' }"));
  assert.match(source, /const \[leaderOpen, setLeaderOpen\] = React\.useState\(false\)/);
  assert.match(source, /const LEADER_RPC_OPERATIONS = \['snapshot', 'create', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery'\];/);
  assert.match(leader, /runLeader\('configure', \{ settings: \{ model: issueModelFromOption\(event\.target\.value, leaderModel\) \} \}\)/);
  assert.match(leader, /runLeader\('resolveCreation', \{ resolution: 'claim', sessionId: leaderClaimId\.trim\(\) \}\)/);
  assert.match(leader, /runLeader\('resolveCreation', \{ resolution: 'abandon' \}\)/);
  assert.match(leader, /runLeader\('resolveTask', \{ taskId: task\.taskId, action: 'dismiss' \}\)/);
  assert.match(leader, /runLeader\('resolveDelivery', \{ requestId: entry\.requestId, resolution: 'delivered' \}\)/);
  assert.match(leader, /runLeader\('resolveDelivery', \{ requestId: entry\.requestId, resolution: 'not-delivered' \}\)/);
  assert.match(leader, /t\('leaderTaskTag'\)/);
  assert.match(leader, /t\('leaderReports'\)/);
  assert.match(leader, /modelOptions\(leaderModel\)/);
  assert.match(leader, /withReasoningEffort\(leaderModel, event\.target\.value\)/);
  assert.doesNotMatch(leader, /role: 'dialog'|aria-modal|prompt\(|post\('answer'|post\('approval'|question\/answer|approval\/answer/);
  assert.doesNotMatch(leader, /updateSettings\(|issueSessionModel|issueSessionCwd/);
  assert.doesNotMatch(source, /runLeader\('(start|pause|enroll|unenroll|handoff|cancelQueued|pauseIssue|resumeIssue|resetIssueBudget)'/);
  assert.doesNotMatch(source, /confirmLeaderAccess|issueLeaderControl|leaderItemForSession|canGrantLeaderAccess|leaderAuditDetail|autoEnrollNew|todo\.leaderTaskId|leaderEnrolled/);
  assert.equal((issues.match(/leaderItemForSession|issueLeaderControl/g) || []).length, 0);
  assert.match(source, /\.gta-leader-settings select\{min-height:28px\}/);
});

test('Leader i18n exposes the v3 keys in both languages and drops removed supervision keys', async () => {
  const { en, zh } = await loadLeaderHelpers();
  for (const key of ['leaderIntro', 'leaderUnseen', 'leaderSetupIncomplete', 'leaderTasks', 'leaderTaskTag', 'leaderTaskCreating', 'leaderTaskCreated',
    'leaderTaskUncertain', 'leaderTasksUncertain', 'leaderTasksUncertainHint', 'leaderTaskDismiss', 'leaderReports', 'leaderReportsHint', 'leaderReportUnseen',
    'leaderReportProgress', 'leaderReportBlocked', 'leaderReportDone', 'leaderReportQuestion', 'leaderDeliveries', 'leaderDeliveriesHint',
    'leaderDelivered', 'leaderNotDelivered', 'leaderCreationUnresolved', 'leaderClaim', 'leaderAbandon']) {
    assert.ok(en[key] && zh[key], key);
  }
  for (const key of ['leaderStart', 'leaderPause', 'leaderAutoEnroll', 'leaderEnroll', 'leaderUnenroll', 'leaderConfirm', 'leaderAudit', 'leaderQueue',
    'leaderCompleted', 'leaderHandoff', 'leaderMaxRunning', 'leaderGitlabWrite', 'leaderStandby', 'leaderCold', 'leaderNeverStartedHint', 'leaderReportMessage',
    'todoLeaderTag', 'todoLeaderHint']) {
    assert.equal(Object.hasOwn(en, key), false, key);
    assert.equal(Object.hasOwn(zh, key), false, key);
  }
  assert.equal(zh.leaderTaskTag, '临时任务');
  for (const key of Object.keys(en).filter((name) => name.startsWith('leader'))) assert.doesNotMatch(en[key], /enroll|supervis|grant access|start supervision/i, key);
});
