/**
 * Todo 批次提示词（v4.0）：首批给完整规则，后续批次只给增量。
 * 结论通过工具 gitlab_todo_report 同步，不再解析会话文本里的标记。
 */
import {
  DEFAULT_SIGNATURE_TEXT,
  MENTION_ONLY_RULE,
  REPLY_DISCIPLINE_RULE,
  REPLY_NECESSITY_RULE,
  UTF8_WRITE_RULE,
  formatLocalTime,
} from '../core.js';
import { NO_REPORT_REASON } from './todo-machine.js';

export const REPORT_TOOL_NAME = 'gitlab_todo_report';

const KIND_LABEL = { mr: 'Merge Request', issue: 'Issue', work_item: 'Work Item', other: '对象' };

function line(value, limit = 200) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function necessityRule() {
  // 旧规则最后一行指向闭环标记命令，v4 改为报告工具，这里去掉。
  return REPLY_NECESSITY_RULE.split('\n').slice(0, -1).join('\n');
}

function todoLine(todo, index) {
  const retried = todo.reason === NO_REPORT_REASON;
  const parts = [
    `${index + 1}. Todo ${todo.id}`,
    todo.author ? `作者 ${todo.author}` : '',
    todo.noteId ? `note #${todo.noteId}` : '',
    `时间 ${formatLocalTime(todo.createdAt) || '未知'}`,
  ].filter(Boolean);
  const text = [parts.join('｜')];
  if (todo.excerpt) text.push(`   摘要：${line(todo.excerpt, 200)}`);
  if (retried) text.push(`   ※ ${NO_REPORT_REASON}，请重新确认处理结果并报告。`);
  return text.join('\n');
}

function identityLine(me) {
  const name = me?.username ? `@${me.username}` : '当前登录的 GitLab 账号';
  return `你的 GitLab 身份：${name}${me?.id ? `（用户 ID ${me.id}）` : ''}。`;
}

function reportContract(todos) {
  const ids = todos.map((todo) => todo.id).join('、');
  return [
    `本批 Todo：${ids}。每条处理完都必须调用工具 ${REPORT_TOOL_NAME} 同步结论（可一次提交多条，也可分次提交）：`,
    '- status=done：已处理完成，插件会替你在 GitLab 上把对应 Todo 标记为完成（你不要自己调用 mark_as_done）；',
    '- status=waiting：在等外部条件（流水线、对方回复、他人评审等），条件满足、讨论串有新动静时插件会再次唤醒；summary 写明在等什么；',
    '- status=needs-human：需要人来决定或操作（缺授权、缺权限、需求有分歧），summary 写明需要谁做什么。',
    `参数 todoIds 省略表示本批全部；summary 一句话即可。没有调用 ${REPORT_TOOL_NAME} 的 Todo 会被视为未处理并重新投递。`,
  ].join('\n');
}

export function buildFirstBatchPrompt({ thread, todos, settings = {}, me = null, now = Date.now() }) {
  const label = KIND_LABEL[thread.kind] ?? KIND_LABEL.other;
  const lines = [
    `你是 GitLab 待办处理助手，负责处理 ${label}「${line(thread.title, 120) || thread.key}」上提到你的 Todo。`,
    `目标对象：${thread.url || thread.key}${thread.project ? `（项目 ${thread.project}）` : ''}`,
    identityLine(me),
    `当前本地时间：${formatLocalTime(now)}。`,
    '',
    '本会话专属于这个对象：以后同一对象上的新 Todo 都会投递到这里，请把它当作长期上下文。',
    '',
    '## 本批 Todo',
    ...todos.map(todoLine),
    '',
    '## 处理方式',
    '1. 先用 glab 读取目标对象的描述与完整讨论串，再逐条判断每个 Todo 要你做什么；多条 Todo 可能是同一件事，合并处理。',
    `2. ${MENTION_ONLY_RULE}`,
    '3. 回复纪律：',
    necessityRule(),
    REPLY_DISCIPLINE_RULE,
    '4. 写操作白名单（只允许这四类）：① 在原 note 所在讨论串回复，或在目标对象下发表说明处理结果的评论；② 在目标仓库新建/更新自己的分支、提交与 MR；③ 按本提示里的附加规则明确豁免、且确由本会话以我方账号创建的 MR 合并；④ 读取类操作。标记 Todo 完成不在其中，由插件根据你的报告代办。',
    '5. 授权判定：授权必须是相关人员（原 note 作者、目标对象指派人、目标仓库成员）在原 note 或其讨论串中的明确祈使句或明确同意，并与要执行的操作逐字对应；疑问、玩笑、猜测、旁观者转述、模糊表态都不算。拿不准就视为没有授权。',
    '6. 看到流水线红、部署失败等异常时只读取与记录，在回复中说明现状并等明确要求，绝不主动触发、重试或“顺手修复”；触发/重试流水线与部署、合并/关闭/approve 他人 MR、强推、删分支/标签、改项目设置、改指派/里程碑/标签，没有授权一律不做。',
    '7. 工作范围：只做 Todo 指向的事；顺带发现的其他问题写进回复供人决策，不要扩大范围。',
    '8. 正文编码：',
    UTF8_WRITE_RULE,
  ];
  const custom = String(settings.customRules ?? '').trim();
  if (custom) lines.push('', '## 附加规则（工作区专属）', custom);
  if (settings.replySignature !== false) {
    const signature = String(settings.signatureText ?? '').trim() || DEFAULT_SIGNATURE_TEXT;
    lines.push('', `## 署名\n每条发出的回复末尾另起一行署名：${signature}`);
  }
  lines.push('', '## 同步结论', reportContract(todos));
  return lines.join('\n');
}

export function buildFollowUpPrompt({ thread, todos, now = Date.now() }) {
  const label = KIND_LABEL[thread.kind] ?? KIND_LABEL.other;
  return [
    `${label}「${line(thread.title, 120) || thread.key}」又有 ${todos.length} 条待处理 Todo（${formatLocalTime(now)}）：`,
    '',
    ...todos.map(todoLine),
    '',
    `规则与上一批相同。请先重新读取讨论串中比你上次回复更新的内容再判断，不要依赖记忆。目标对象：${thread.url || thread.key}`,
    '',
    reportContract(todos),
  ].join('\n');
}

export function buildSessionTitleForThread(thread) {
  const label = KIND_LABEL[thread.kind] ?? '对象';
  return `Todo｜${label}｜${line(thread.title, 60) || thread.key}`.slice(0, 120);
}
