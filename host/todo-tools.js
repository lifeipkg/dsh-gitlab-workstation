/**
 * gitlab_todo_report 工具绑定（v4.0）。
 * 只绑定到“台账线程会话的根 Agent”；绑定模式沿用 leader-agent.js 的 worker 汇报工具。
 */
import { REPORT_STATUS_LIST } from '../core/todo-machine.js';

export const TODO_REPORT_TOOL = 'gitlab_todo_report';

const DESCRIPTION = '向 GitLab Todo 插件同步本批 Todo 的处理结论。每条 Todo 处理完都必须调用：'
  + 'status=done（已处理完成，插件会替你在 GitLab 把 Todo 标记完成，你不要自己 mark_as_done）、'
  + 'waiting（在等外部条件，summary 写明等什么，讨论串有新动静时会再次唤醒）、'
  + 'needs-human（需要人决定或操作，summary 写明需要谁做什么）。'
  + 'todoIds 省略表示本批全部；返回 accepted 与仍未报告的 pending。summary 一句话即可（≤500 字）。';

export const TODO_REPORT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { type: 'string', enum: [...REPORT_STATUS_LIST] },
    todoIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, minItems: 1, maxItems: 50, uniqueItems: true },
    summary: { type: 'string', maxLength: 500 },
  },
});

const boundedId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f]/u.test(value);

const nativeDependencies = async () => {
  const cordis = await import('@deepseek-ai/cordis');
  return { getTraceable: cordis.getTraceable };
};

export function createTodoReportBinder(runtime, options = {}) {
  const bindings = new Map(); // agent → dispose
  const cleanups = [];
  let stopped = false;
  let depsPromise;
  const serviceContext = () => runtime.leaderServicesContext ?? options.context ?? null;
  const live = (id) => serviceContext()?.agents?.get?.(id);
  const dependencies = () => depsPromise ??= options.dependencies ? Promise.resolve(options.dependencies) : nativeDependencies();
  const sessionOf = (agent) => agent?.session?.id;
  const eligible = (agent) => {
    const sessionId = sessionOf(agent);
    return !stopped && boundedId(sessionId) && agent.id === sessionId && live(sessionId) === agent
      && Boolean(runtime.todoThreadForSession?.(sessionId));
  };

  function bind(agent, deps) {
    const raw = serviceContext()?.agentPresets?.serviceFor?.(agent, 'tools') ?? agent.ctx?.tools;
    if (!raw || typeof deps.getTraceable !== 'function') return false;
    const tools = deps.getTraceable(agent.ctx, raw);
    if (typeof tools?.register !== 'function') return false;
    const definition = {
      name: TODO_REPORT_TOOL,
      description: DESCRIPTION,
      parameters: TODO_REPORT_SCHEMA,
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        exec.signal?.throwIfAborted?.();
        if (exec.agent !== agent || !eligible(agent) || !bindings.has(agent)) throw new Error('该会话当前不是 Todo 处理会话，不能提交 Todo 报告。');
        if (!args || typeof args !== 'object' || Array.isArray(args)
          || Object.keys(args).some((key) => !Object.hasOwn(TODO_REPORT_SCHEMA.properties, key))) {
          throw new Error('报告参数包含未知字段。');
        }
        return runtime.handleTodoReport(sessionOf(agent), args);
      },
    };
    let removed = false;
    const remove = tools.register(definition, { when: ({ agent: caller }) => caller === agent && eligible(caller) });
    const dispose = () => { if (removed) return; removed = true; bindings.delete(agent); remove?.(); };
    agent.ctx?.effect?.(() => dispose, 'gitlab-workstation.todo-report');
    bindings.set(agent, dispose);
    return true;
  }

  /** 保证 sessionId 对应的常驻 Agent 已绑定报告工具；冷会话先经公开 SessionController 激活。绝不抛出。 */
  async function ensureBound(sessionId) {
    if (stopped) return { ok: false, error: '工具绑定器已停止。' };
    try {
      if (!boundedId(sessionId)) return { ok: false, error: '会话 ID 无效。' };
      const deps = await dependencies();
      let agent = live(sessionId);
      if (!agent) {
        const controller = serviceContext()?.sessionController;
        if (typeof controller?.resolveAgent !== 'function') return { ok: false, error: '宿主未提供 SessionController，无法激活会话。' };
        const result = await controller.resolveAgent(sessionId);
        if (result?.error || !result?.agent || result.agent !== live(sessionId)) {
          return { ok: false, error: String(result?.error?.message ?? '会话激活身份不可验证。').slice(0, 300) };
        }
        agent = result.agent;
      }
      if (!agent.ctx) return { ok: false, error: '会话缺少 ctx。' };
      if (!eligible(agent)) return { ok: false, error: '该会话不是台账线程会话。' };
      if (bindings.has(agent)) return { ok: true };
      return bind(agent, deps) ? { ok: true } : { ok: false, error: '宿主未提供 tools 服务。' };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error).slice(0, 300) };
    }
  }

  function refresh() {
    for (const [agent, dispose] of [...bindings]) if (!eligible(agent)) dispose();
  }

  const ctx = runtime.ctx;
  if (typeof ctx?.on === 'function') {
    cleanups.push(ctx.on('agent/created', async ({ agent }) => {
      // 线程会话被宿主恢复（如重启后用户打开）时先于模型工作绑定；失败不影响会话。
      const sessionId = sessionOf(agent);
      if (sessionId && runtime.todoThreadForSession?.(sessionId)) await ensureBound(sessionId);
    }));
    cleanups.push(ctx.on('agent/disposed', ({ agent }) => { bindings.get(agent)?.(); }));
  }

  function dispose() {
    stopped = true;
    for (const remove of cleanups.splice(0).reverse()) remove?.();
    for (const remove of [...bindings.values()]) remove();
    bindings.clear();
  }

  return { ensureBound, refresh, dispose, get bound() { return bindings.size; } };
}
