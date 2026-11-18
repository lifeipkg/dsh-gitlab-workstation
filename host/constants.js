/**
 * 运行时调参常量集中地：Issue 分页、续办、会话结算、桥接、日志等全部魔法数字。
 * 拆模块时统一集中到这里，避免同一常量被多个模块各自重复定义。
 */

/** Issue 面板“指派给我的开放 Issue”最多翻页数（每页 100，覆盖 300 条）。 */
export const ISSUE_PAGE_SIZE = 100;
export const MAX_ISSUE_PAGES = 3;
/** 自首轮派发起超过这个时长的链路不再自动续办，避免升级或长期遗留记录触发续办风暴。 */
export const FOLLOW_UP_MAX_AGE_MS = 72 * 60 * 60 * 1000;
/** 会话空闲且没有回合结束记录，连续这么多次核对后按“被中断”结算（默认约 2 分钟）。 */
export const IDLE_SETTLE_POLLS = 40;
export const BRIDGE_PATH = '/api/gitlab-todo-agent';
export const MAX_REQUEST_BYTES = 128 * 1024;

/**
 * 运行时内存日志（Log Tab）的内存上限——只进内存、不落文件，必须双维度封顶
 * 防止日志洪峰把插件进程内存顶穿：
 * - LOG_MAX_ENTRIES：条数上限。即使每条都很短也限制对象数量（环形 FIFO 淘汰最旧）。
 * - LOG_MAX_CHARS：所有 message 合计字符数上限。兜底“条数不多但单条超长”的洪峰。
 * - LOG_MAX_LINE_CHARS：单条消息裁剪上限，超出部分截断标注，避免单条塞满整页。
 * 按条目 ≈ (message UTF-16 + {ts,level,message} 对象开销 ~150B) 估算，满配额约 100–150 KB 常驻。
 */
export const LOG_MAX_ENTRIES = 500;
export const LOG_MAX_CHARS = 64 * 1024;
export const LOG_MAX_LINE_CHARS = 500;
