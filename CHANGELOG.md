# Changelog

## 4.0.0

- Todo 路径重写为台账 + 线程模型（core/todo-machine.js、host/todo-cycle.js）：一线程一会话、批次追加、`gitlab_todo_report` 报告工具、熔断器、30 天保留。
- 收件箱改为 attention/waiting 条目，动作 重试/我已处理；Leader inbox 工具改为 list/retry/close/resume，board 新增 threads/breaker。
- 状态版本 6 → 7，升级前备份 state.v6.bak.json。
- 移除 Todo 的续办、会话路由、同对象合并、等待探测面板设置（Issue 路径保持不变）。
