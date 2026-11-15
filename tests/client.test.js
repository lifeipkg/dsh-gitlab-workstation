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
    return { createElement() {}, Component: class {} };
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

  const issues = panel('issues', 'handled');
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
  definition.factory(() => ({ createElement() {}, Component: class {} }));
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

test('grouped workstation tabs navigate across groups, wrap, and ignore unrelated keys', async () => {
  const { WORKSTATION_TABS: tabs, nextWorkstationTab } = await loadWorkstationHelpers();
  assert.deepEqual(Array.from(tabs, (tab) => tab.id), ['inbox', 'todos', 'issues', 'handled', 'workspaces', 'logs']);
  assert.deepEqual(Array.from(tabs, (tab) => tab.group), ['tasksGroup', 'tasksGroup', 'tasksGroup', 'tasksGroup', 'environmentGroup', 'environmentGroup']);
  assert.equal(nextWorkstationTab('handled', 'ArrowRight'), 'workspaces');
  assert.equal(nextWorkstationTab('workspaces', 'ArrowLeft'), 'handled');
  assert.equal(nextWorkstationTab('inbox', 'ArrowLeft'), 'logs');
  assert.equal(nextWorkstationTab('logs', 'ArrowRight'), 'inbox');
  assert.equal(nextWorkstationTab('issues', 'Home'), 'inbox');
  assert.equal(nextWorkstationTab('todos', 'End'), 'logs');
  assert.equal(nextWorkstationTab('todos', 'Enter'), null);
  assert.equal(nextWorkstationTab('missing', 'ArrowRight'), null);

  const source = await clientSource();
  assert.match(source, /const \[activeTab, setActiveTab\] = React\.useState\('todos'\)/);
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
  assert.match(source, /activeTab === 'handled' \? t\('searchLoaded'\) : t\('searchList'\)/);
  assert.match(source, /handledData && handledData\.items\.length < handledData\.total[^\n]*gta-load-more/);
  assert.doesNotMatch(source, /fetchHandled\([^)]*listQuery/);
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
