# Changelog

## 5.0.0

- **BREAKING：删除 GitLab Todo 自动处理。** 移除 @ 提及自动处理、Todo 收件箱、预检（含 Jev 分类器）、会话路由、同对象合并、批量预检、续办、等待探测、Todo 台账及对应面板与设置（如 `enabled`、`intervalSeconds`、`maxSessionsPerPoll`、`routeScope`、`autoRoute`、`customRules`、`replySignature`、`precheck*`、`waitProbeEnabled`）。
- 保留 Issue 面板（处理指派给我的开放 Issue、闭环核对、打开会话）与 WorkStation Leader（`gitlab_leader_board`、`gitlab_leader_session`）。
- 状态版本 7 → 8。升级时若 `state.json` 的版本不等于 8，先备份为 `state.v<旧版本>.bak.json`（同名已存在则不覆盖，备份保留）。Todo 台账及非 Issue 的 handled／pending 记录被丢弃，设置按新规则校验。

## 4.0.0

- Todo 路径重写为台账 + 线程模型（core/todo-machine.js、host/todo-cycle.js）：一线程一会话、批次追加、`gitlab_todo_report` 报告工具、熔断器、30 天保留。
- 收件箱改为 attention/waiting 条目，动作 重试/我已处理；Leader inbox 工具改为 list/retry/close/resume，board 新增 threads/breaker。
- 状态版本 6 → 7，升级前备份 state.v6.bak.json。
- 移除 Todo 的续办、会话路由、同对象合并、等待探测面板设置（Issue 路径保持不变）。
- 清理 Todo 旧路径死代码：分组派发（enqueueDispatch/dispatchGroup/executeGroupDispatch）、pending 自动重试（enqueuePendingRetries）、等待探测（probeWaitingFollowUps/checkThreadActivity/WAIT_PROBE_MAX_DEFERS）、同对象合并关联字段（batchId/mergedWith/normalizeDispatchLinks）、面板批量徽标与 waitProbes 展示。
