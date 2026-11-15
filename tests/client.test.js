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
  assert.match(todos, /openRouteTargets\(todo\)/);
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

test('compact styles keep controls small and wrap list content responsively', async () => {
  const source = await clientSource();
  const start = source.indexOf('    const CSS = `');
  const end = source.indexOf('`;', start);
  assert.ok(start >= 0 && end > start, 'CSS markers must remain present');
  const css = source.slice(start, end);

  assert.match(css, /\.gta-button\{[^}]*min-height:28px;[^}]*padding:4px 9px;[^}]*font-size:12px/);
  assert.match(css, /\.gta-todo\{[^}]*gap:10px;padding:9px 12px/);
  assert.match(css, /\.gta-todo-title\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.gta-todo-actions\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.gta-tabs\{[^}]*overflow-x:auto/);
  assert.match(css, /@media\(max-width:720px\)/);
});
