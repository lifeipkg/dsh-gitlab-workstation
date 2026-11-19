# Changelog
## 5.1.0

- **新增：uncertain 投递自动核对。** `send` 结果不确定时，插件自动在 worker 日志里核对本次投递（按消息 source operationId 匹配 requestId），命中即自动结算为 sent——不再需要 Leader 手动 `board` 翻日志 + `resolve_delivery`；仍不确定时才冻结等待人工核对。
- **新增：重要 worker 汇报即时推送。** worker 的 `blocked`/`done`/`question` 汇报落账后会向 Leader 会话排一条通知（含摘要，幂等 requestId），Leader 即时感知；`progress` 保持看板轮询读取。未读期间不叠加通知，Leader 读过看板后恢复。
- **Leader token 瘦身：** 精简 `gitlab_leader_board`/`gitlab_leader_session` 工具描述、`gitlab_leader_report` 描述、Leader 角色说明（bootstrap 与可选 preset persona）；看板 Issue 标题截断 120->80、未读汇报文本截断 500->300。

## 5.0.1

- **修复：Issue 条目的失效会话绑定清理不掉。** `gitlab_leader_session archive` 遇到「宿主中已不存在的会话」时，Issue 记录改为删除 handled 绑定（返回 `cleared: true`），条目回到「无会话」状态、可重新派发；此前该场景一律报「无可归档对象」把记录锁死。临时任务路径行为不变（仍标记 archived 释放 slot）。
- **修复：`session create` 按 taskId 不再依赖 Issue 面板缓存。** 缓存未命中时回落到 handled/pending 保存的条目快照重新派发，避免 Leader 在缓存陈旧时被迫建临时任务顶替。
- 改进：`send`/`steer` 对失效会话的失败文案给出下一步指引（create 重新派发 / archive 清理）；看板 detail 对 missing/archived 会话附 `sessionNote` 说明可执行动作。

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
