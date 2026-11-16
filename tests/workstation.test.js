import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { STATE_VERSION } from '../core.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const json = async (path) => JSON.parse(await read(path));

test('Workstation branding names the same successor repository and both task types', async () => {
  const manifest = await json('package.json');
  const zh = await json('locale/zh.json');
  const en = await json('locale/en.json');
  assert.equal(manifest.repository.url, 'git+https://github.com/lifeipkg/dsh-gitlab-workstation.git');
  assert.equal(manifest.homepage, 'https://github.com/lifeipkg/dsh-gitlab-workstation#readme');
  assert.equal(manifest.bugs.url, 'https://github.com/lifeipkg/dsh-gitlab-workstation/issues');
  assert.equal(zh.meta.title, 'GitLab 工作台');
  assert.equal(en.meta.title, 'GitLab Workstation');
  for (const description of [manifest.description, zh.meta.description, en.meta.description]) {
    assert.match(description, /Todo/i);
    assert.match(description, /Issue/i);
  }
  const client = await read('client.js');
  assert.ok(client.includes(zh.meta.title));
  assert.ok(client.includes(en.meta.title));
});

test('Workstation package identity aligns while legacy runtime and task protocols remain stable', async () => {
  const manifest = await json('package.json');
  const patch = await read('cordis.patch.yml');
  const client = await read('client.js');
  const runtime = await read('index.js');
  const core = await read('core.js');
  const constants = await read('host/constants.js');
  const dispatch = await read('host/dispatch.js');
  const host = await read('dsh-host.js');
  assert.equal(manifest.name, '@lifeipkg/dsh-gitlab-workstation');
  assert.match(patch, /id: gitlab-todo-agent/);
  assert.ok(patch.includes(`name: '${manifest.name}'`));
  assert.ok(client.includes(`id: '${manifest.name}'`));
  assert.match(client, /const NS = 'gitlab-todo-agent'/);
  assert.match(client, /const PANEL_ID = 'gitlab-todos'/);
  for (const source of [client, constants]) assert.ok(source.includes('/api/gitlab-todo-agent'));
  assert.match(runtime, /join\(homedir\(\), '\.dsh-plugins', 'gitlabtodo'\)/);
  assert.equal(STATE_VERSION, 6);
  assert.ok(core.includes("CLOSURE_MARKER = '[TODO-CLOSURE]'"));
  assert.ok(dispatch.includes('`gitlab-todo-${randomUUID()}`'));
  assert.ok(host.includes("startsWith('gitlab-todo-')"));
});

test('package rename documents explicit consumer switching without deleting state or claiming publication', async () => {
  const docs = await read('README.md');
  assert.match(docs, /新包发布后使用 `@lifeipkg\/dsh-gitlab-workstation`/);
  assert.match(docs, /不会自动替换旧 bundle/);
  assert.match(docs, /不要删除整个 `~\/\.dsh-plugins\/gitlabtodo\/` 数据目录/);
  assert.match(docs, /storageDirectory/);
  assert.match(docs, /legacyStateFile/);
  assert.match(docs, /确认只启用一份消费者/);
});

test('safe entry declares the verified runtime baseline and its actual client services', async () => {
  const manifest = await json('package.json');
  assert.equal(manifest.engines.dsh, '>=0.2.2-rc.3 <0.3.0-0');
  const client = await read('client.js');
  const declaration = client.match(/inject:\s*\[([^\]]+)\]/)?.[1] ?? '';
  const services = [...declaration.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(services.sort(), ['connection', 'locale', 'sessions', 'slots', 'uiWorkspace', 'workspaces'].sort());
  assert.match(await read('README.md'), /最低 DSH 版本为 `0\.2\.2-rc\.3`/);
});

test('packaged entrypoints exist and the syntax check covers every runtime module', async () => {
  const manifest = await json('package.json');
  const rootModules = ['index.js', 'core.js', 'client.js', 'dsh-host.js'];
  const hostModules = (await readdir(new URL('../host/', import.meta.url)))
    .filter((name) => name.endsWith('.js')).map((name) => `host/${name}`);
  for (const path of [...rootModules, ...hostModules]) {
    await access(new URL(`../${path}`, import.meta.url));
    assert.ok(manifest.scripts.check.includes(`node --check ${path}`), `${path} must be syntax-checked`);
  }
  for (const path of Object.values(manifest.exports).filter((value) => !value.includes('*'))) {
    await access(new URL(`../${path}`, import.meta.url));
  }
  assert.ok(manifest.files.includes('host/*.js'));
  assert.ok(manifest.files.includes('locale/*.json'));
  assert.ok(manifest.files.includes('icon.svg'));
});

test('bundle ships the tool-less Issue Leader preset used by default', async () => {
  const { DEFAULT_LEADER_AGENT_PRESET } = await import('../core.js');
  const patch = await read('cordis.patch.yml');
  assert.equal(DEFAULT_LEADER_AGENT_PRESET, 'gitlab-issue-leader');
  assert.match(patch, /- id: preset-gitlab-issue-leader\r?\n\s+name: '@deepseek-ai\/dsh-agent-preset'\r?\n\s+config:\r?\n\s+id: gitlab-issue-leader\r?\n/);
  const names = [...patch.matchAll(/name: '(@deepseek-ai\/[^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(names, ['@deepseek-ai/dsh-agent-preset', '@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-command-compact']);
  assert.doesNotMatch(patch, /tool-|shell|web-fetch|dsh-tool/);
});
