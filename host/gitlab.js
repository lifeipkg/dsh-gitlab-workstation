import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueApiPath, normalizeIssue, normalizeTodos } from '../core.js';
import { MAX_ISSUE_PAGES, MAX_TODO_PAGES, TODO_PAGE_SIZE } from './constants.js';
import { errorMessage } from './util.js';

/**
 * GitLab 访问层：glab 子进程、当前用户、Todo 分页拉取、标记完成。
 * 全部方法挂在 GitlabTodoRuntime 原型上（见 index.js attachRuntimeMethods），
 * this 指向运行时实例：state/config/activeChildren/gitlabUserId 等字段共享。
 */
export const gitlabMethods = {

  async currentGitlabUserId() {
    if (this.gitlabUserId) return this.gitlabUserId;
    const stdout = await this.runGlab(['api', 'user']);
    let user;
    try {
      user = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`解析 GitLab 当前用户失败：${errorMessage(error)}`);
    }
    if ((typeof user?.id !== 'number' && typeof user?.id !== 'string') || !String(user.id).trim()) {
      throw new Error('GitLab 当前用户响应缺少有效 id。');
    }
    this.gitlabUserId = String(user.id).trim();
    this.gitlabUsername = typeof user.username === 'string' && user.username.trim() ? user.username.trim() : null;
    return this.gitlabUserId;
  },

  async fetchTodos() {
    await this.currentGitlabUserId();
    const items = [];
    for (let page = 1; page <= MAX_TODO_PAGES; page += 1) {
      const stdout = await this.runGlab([
        'api', '-X', 'GET', 'todos',
        '-F', `per_page=${TODO_PAGE_SIZE}`,
        '-F', `page=${page}`,
      ]);
      let pageItems;
      try {
        pageItems = JSON.parse(stdout);
      } catch (error) {
        throw new Error(`解析 GitLab Todo 第 ${page} 页失败：${errorMessage(error)}`);
      }
      if (!Array.isArray(pageItems)) throw new Error(`GitLab Todo 第 ${page} 页响应不是数组。`);
      if (pageItems.length === 0) break;
      items.push(...pageItems);
      if (pageItems.length < TODO_PAGE_SIZE) break;
    }
    return normalizeTodos(items);
  },

  async markTodoDone(todo) {
    await this.runGlab(['api', '-X', 'POST', `todos/${encodeURIComponent(todo.id)}/mark_as_done`]);
  },

  /**
   * 指派给我的开放 Issue 列表（Issue 面板数据源）：REST /issues 跨项目聚合接口，
   * scope=assigned_to_me 固定；只取 opened。坏行（缺 iid/project_id）由 normalizeIssue 丢弃。
   */
  async fetchIssues() {
    await this.currentGitlabUserId();
    const items = [];
    for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
      const stdout = await this.runGlab([
        'api', '-X', 'GET', 'issues',
        '-F', 'scope=assigned_to_me',
        '-F', 'state=opened',
        '-F', 'order_by=updated_at',
        '-F', 'sort=desc',
        '-F', `per_page=${TODO_PAGE_SIZE}`,
        '-F', `page=${page}`,
      ]);
      let pageItems;
      try {
        pageItems = JSON.parse(stdout);
      } catch (error) {
        throw new Error(`解析 GitLab Issue 第 ${page} 页失败：${errorMessage(error)}`);
      }
      if (!Array.isArray(pageItems)) throw new Error(`GitLab Issue 第 ${page} 页响应不是数组。`);
      for (const raw of pageItems) {
        const item = normalizeIssue(raw);
        if (item) items.push(item);
      }
      if (pageItems.length < TODO_PAGE_SIZE) break;
    }
    return items;
  },

  /**
   * 闭环核对“只认 Issue 关闭”的事实来源：返回 true 已关闭 / false 仍开放 / null 无法判定。
   * 无法判定（接口失败、解析不出路径）时调用方不得按“已关闭”结算。
   */
  async issueIsClosed(item) {
    const api = issueApiPath(item);
    if (!api) return null;
    try {
      const stdout = await this.runGlab(['api', '-X', 'GET', api]);
      const issue = JSON.parse(stdout);
      if (typeof issue?.state !== 'string') return null;
      return issue.state === 'closed';
    } catch (error) {
      this.logger.warn(`核对 Issue 状态失败（${api}）：${errorMessage(error)}`);
      return null;
    }
  },

  /**
   * 在 Issue 下发一条评论（note）。正文先落成 UTF-8 JSON 文件，经 `glab api --input <file>` 作为
   * application/json 请求体发送：不经命令行参数传中文，也不触发 --field 的类型转换/@文件/占位符解析。
   * target 为 issueApiPath 结果（projects/<enc>/issues/<iid>）或可交给 issueApiPath 的 Issue 对象。
   * 请求前的本地失败抛出带 `beforeRequest: true` 的错误（未发出，可视为确定未发送）；其余错误由调用方按不确定处理。
   */
  async postIssueNote(target, body) {
    const api = typeof target === 'string' ? target : issueApiPath(target);
    const prepare = (message) => Object.assign(new Error(message), { beforeRequest: true });
    if (!/^projects\/[^/\s]+\/issues\/\d+$/u.test(api ?? '')) throw prepare('无法定位该 Issue 的 GitLab API 路径。');
    if (typeof body !== 'string' || !body.trim()) throw prepare('评论正文不能为空。');
    let directory = null;
    try {
      try {
        directory = await mkdtemp(join(tmpdir(), 'dsh-gitlab-note-'));
        await writeFile(join(directory, 'body.json'), JSON.stringify({ body }), 'utf8');
      } catch (error) { throw prepare(`评论正文落盘失败：${errorMessage(error)}`); }
      const stdout = await this.runGlab(['api', '-X', 'POST', `${api}/notes`, '--input', join(directory, 'body.json')]);
      let note = null;
      try { note = JSON.parse(stdout); } catch {}
      return { id: Number.isSafeInteger(note?.id) ? note.id : null, createdAt: typeof note?.created_at === 'string' ? note.created_at : null };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  },

  async runGlab(args) {
    const timeoutMs = Number.isFinite(this.config.requestTimeoutMs)
      ? Math.max(1000, this.config.requestTimeoutMs)
      : 90000;
    const maxOutputBytes = Number.isSafeInteger(this.config.maxOutputBytes)
      ? Math.max(1024, this.config.maxOutputBytes)
      : 2097152;
    const executable = process.platform === 'win32' ? 'glab.exe' : 'glab';
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: this.state.settings.cwd || process.cwd(),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.activeChildren.add(child);
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let failure = null;
      let settled = false;
      let forceTimer = null;
      const timeout = setTimeout(() => {
        failure = new Error(`GitLab 请求超过 ${timeoutMs}ms，已终止。`);
        child.kill();
        forceTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
        forceTimer.unref?.();
      }, timeoutMs);
      timeout.unref?.();

      const finish = (error, code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(forceTimer);
        this.activeChildren.delete(child);
        const out = Buffer.concat(stdout).toString('utf8');
        const err = Buffer.concat(stderr).toString('utf8');
        if (error) {
          reject(error);
          return;
        }
        if (failure) {
          const detail = err.trim();
          reject(new Error(`${failure.message}${detail ? `：${detail.slice(0, 2000)}` : ''}`));
          return;
        }
        if (code !== 0) {
          const detail = err.trim() || out.trim();
          reject(new Error(`glab 退出码 ${code ?? 'null'}（${signal ?? '无信号'}）${detail ? `：${detail.slice(0, 2000)}` : ''}`));
          return;
        }
        resolve(out);
      };

      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxOutputBytes) {
          failure = new Error(`GitLab 标准输出超过 ${maxOutputBytes} 字节上限。`);
          child.kill();
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > maxOutputBytes) {
          failure = new Error(`GitLab 标准错误超过 ${maxOutputBytes} 字节上限。`);
          child.kill();
          return;
        }
        stderr.push(chunk);
      });
      child.once('error', (error) => finish(error));
      child.once('close', (code, signal) => finish(null, code, signal));
    });
  },
};
