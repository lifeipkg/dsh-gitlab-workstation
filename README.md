# GitLab Workstation · GitLab 工作台

一个紧凑的持久化 DSH Bundle：在左侧栏添加 **GitLab 工作台** 页面，集中处理指派给我的 GitLab Issue。Host 通过 `glab` 读取 Issue，手动或由 Leader 派发 DSH 会话处理，并跟踪执行、闭环与人工接手。不需要 Python 或外置轮询脚本。

> **5.0.0 BREAKING**：删除 GitLab Todo 自动处理（@ 提及、收件箱、预检、路由、合并派发、续办、等待探测与 Todo 台账）。从 v4.x 升级的数据迁移见「存储与升级」。

仓库：[lifeipkg/dsh-gitlab-workstation](https://github.com/lifeipkg/dsh-gitlab-workstation)。这是原仓库的改名，保留原有 Git 历史，而不是另起一套插件。

## 紧凑工作台（v2.33）

- **任务与环境分区**：Issue 与 Leader 属于任务视图；工作区与日志属于环境视图。不增加大卡片首页，直接进入 Issue 列表。
- **上下文操作**：Issue 保持手动处理，独立设置工作区、模型与思考强度。
- **信息密度优先**：紧凑状态条与列表行，任务状态、错误和人工接手入口优先；设置及高级选项按需展开。
- **交互护栏**：不可逆操作保留两步确认；设置弹层关闭后，旧请求不会关闭新开的草稿或弹层。关闭界面不撤销已经发送的保存请求。
- **包身份同步**：npm 包名、加载包名及客户端模块 ID 已统一为 `@lifeipkg/dsh-gitlab-workstation`。旧 Loader 条目 ID、Bridge 路径和原有 `state.json` 继续保留（v2.37 起默认位于 `~/.dsh/storages/gitlab-workstation/`，首次启动自动从旧目录复制），以复用原任务与会话历史；这不是旧 npm 包的透明升级，须按下面说明显式切换，不可同时加载新旧消费者。

## 安装（分享给其他人）

前置条件（每个使用者各自准备）：

1. 安装 [GitLab CLI](https://gitlab.com/gitlab-org/cli)（`glab`），并登录目标 GitLab：

   ```sh
   glab auth login --hostname gitlab.example.com
   ```

   令牌需要 `api` 权限（读取指派给你的 Issue，以及 Leader 经 `glab api` 发起的 REST 调用）。`glab` 支持多主机，但插件当前只使用 GitLab 工作目录及 `glab` 配置解析出的单一主机/身份，不提供多账号同时隔离；启用前确认该目录中的 `glab` 命令访问的是目标主机。插件不保存任何令牌，全部调用走 `glab` 自身的认证配置。
2. DSH 中至少注册了一个工作区（新会话需要落在某个工作区里）。
3. 平台不限：Windows / macOS / Linux 均可，只需 `glab` 在 PATH 中。

安装方式二选一：

- **npm 安装**（新包发布后使用 `@lifeipkg/dsh-gitlab-workstation`，scope 需 `access: public` 已在 `publishConfig` 配好）：通过 DSH 插件管理安装本包后重启 DSH。源代码改名并不等于已发布到 npm；未发布时使用下面的源码方式。
- **从源码安装**：克隆本仓库，把 `package.json` 所在目录作为 bundle 放入 DSH 插件目录（或通过插件管理以 `link:<仓库目录>` 安装），重启 DSH。

**从旧包显式切换**：`package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`client.js` 的模块 `id` 三处必须完全一致，本版本均为 `@lifeipkg/dsh-gitlab-workstation`。它与旧包 `@lifeipkg/dsh-gitlab-todo-agent` 是不同安装身份，不会自动替换旧 bundle。先暂停旧插件的自动轮询，妥善结束在途处理并确认无活动派发/写入，再备份原配置与状态（备份可能含敏感设置，不要提交仓库）。停用旧 bundle，并检查手工 insert 条目，重启卸载旧客户端模块代；不要只依靠相同 Loader row ID 判断可以并装。

**保留数据，不保留并行消费者**：不要删除整个 `~/.dsh/storages/gitlab-workstation/` 数据目录（v2.37 之前为 `~/.dsh-plugins/gitlabtodo/`）；保留其中的 `state.json`。新包沿用原 `storageDirectory` 配置；若状态仍在旧包目录内的 `.runtime/state.json`，移除旧代码前先备份并显式核对 `legacyStateFile` 来源。本次改名不执行数据迁移。装好后确认只启用一份消费者，核对工作区、模型和轮询设置再启用；读入旧状态会保留原启用状态，不能假定新安装一定默认暂停。

历史说明：≤2.12.x 的 `@local/dsh-gitlab-todo-agent` 曾导致 `Cannot find package '@local/dsh-gitlab-todo-agent'`；同样须保留数据后显式移除旧加载条目并切换，不能删除父级状态目录来解决包名问题。

首次配置清单（装好后逐项确认）：

1. 打开左侧 **GitLab 工作台** 页面，在 Issue Tab 页顶确认 **Issue 会话设置** 的工作区与模型。全新安装不会创建任何 DSH 会话，只有手动点击“处理”或 Leader 派发时才会创建。
2. **设置** 中确认自动会话并发数（默认 2）与自动归档。
3. 可选：为 Issue 指定工作区与模型；留空则跟随最近使用的工作区与 DSH 默认模型。

## 使用

1. 确保 `glab` 已登录且能访问目标 GitLab。
2. 打开左侧 **GitLab 工作台** 页面。
3. 在 **设置** 中配置自动会话并发数与自动归档；闭环与续办相关设置见下文「新会话配置」。
4. 状态栏下方通过 **Issue / 工作区 / Log** Tab 切换（打开工作台默认显示 **Issue** Tab）。Leader 区域位于 Issue Tab 顶部。
5. **Issue Tab（v2.31）**：展示 GitLab 上**指派给我的开放 Issue**（按需拉取，打开 Tab 自动刷新一次，之后跟随快照缓存）。每条 Issue 只提供 **处理**；处理后的行显示执行与闭环状态，并可点 **打开会话** 跳回。点击处理会新开主线会话，标题固定为 **仓库名 #Issue 编号**，消息仅为 **Issue URL + 开始处理**；项目规则由该工作区的 AGENTS.md／CLAUDE.md 提供。Issue 已关闭或不再指派后，记录移到「已关闭或取消指派」区保留会话入口。
6. Issue 的处理动作由工作区规则指导，插件按 Issue 的真实关闭状态闭环，见下文「Issue 闭环与会话结算」。

**Log Tab（v2.32）**：显示运行时内存日志——**只进内存环形缓冲、不落盘**，新→旧，打开期间每 3 秒静默刷新。每行 `时间 [级别] 单行消息`，级别可筛「全部 / 警告及以上」，支持「清空日志」（两步确认，清空后留一条审计行）。内存有硬上限防无限增长：条数 ≤ `LOG_MAX_ENTRIES`(500) 与合计字符 ≤ `LOG_MAX_CHARS`(64KB) 双维度，任一超就从头部淘汰最旧（FIFO），单条 ≤ `LOG_MAX_LINE_CHARS`(500 字) 截断标注；被丢的条数记 dropped，面板以 `-N` 显示已丢弃条数，悬停可查看说明。写入入口统一 `this.logger.<level>()`：进缓冲 + 透传宿主日志（自动补 `[gitlab-todo-agent]` 前缀，业务消息不带前缀），消息格式为单行「<对象/动作>：<结果/细节>」。bridge 新增 `logs`（GET 投影 / POST `clear:true`）。

## WorkStation Leader（v3.0 重新设计）

Issue Tab 顶部提供折叠的 **Leader** 区域。点「创建 Leader」新建一个独立的 Leader 会话（可选模型），之后你只和它对话。Leader 没有启动／暂停、托管授权、预算或后台唤醒循环：它是一个普通的 DSH 会话，需要时由你发消息驱动。

Leader 使用 DSH 的**标准 preset**，保留读取与执行所需的通用工具（Shell、`read`／`glob`／`grep`、`skill`、`todo_write`、`web_fetch`、后台任务、`ask_user_question` 等），所以读代码、查 GitLab、跑命令都直接用这些工具，不再经插件转手。运行时插件隐藏另一批工具（`subagent`／`workflow`／Agent Team、`plugin_manager`、`schedule_*`、目标工具、`edit`／`write`）：Leader 自己不写文件、不派生子 agent，也不改插件或定时任务；要动手改东西，用 `gitlab_leader_session` 交给 worker。插件额外给它两个工具：

- `gitlab_leader_board`：看板。返回你被指派的 open Issue、需要人工处理的清单、临时任务、worker 汇报（最近 20 条，标为不可信数据）、未确认投递和插件管理的会话列表。`refresh=true` 先刷新 GitLab（失败时返回缓存和 `refreshError`）。传 `taskId` 返回单个会话详情：状态、最近事件、待回答的原生问题原文、汇报，并把该会话的汇报标为已读。
- `gitlab_leader_session`：按 `action` 操作 worker 会话：
  - `create`：传 `taskId` 为 Issue 开会话（与「处理」相同的派发逻辑，已有活动会话时直接接管）；不传 `taskId`、改传 `title`（≤70 字）和自包含的 `brief`（≤8000 字）开**临时任务**会话，可选 `workingDirectory`。数量不限。创建结果不确定时绝不自动重建，面板列出记录，由你核查后点「放弃」。
  - `send`：给空闲 worker 发一条消息（≤8000 字，标明来自 Leader、不是人类输入），可带 `requestId` 去重。
  - `steer`：在运行中的 worker 当前回合插入一条纠偏。
  - `rename`、`model`（换成宿主模型目录中的模型）、`archive`（可带理由）。
  - `resolve_delivery`：投递结果不确定时，先用 `board` 核对，再用 `requestId` 和 `outcome`（`delivered`／`not-delivered`）判定；两种结果都不会重发。

被管理的 worker 会话多一个工具 `gitlab_leader_report`（`kind`：`progress`／`blocked`／`done`／`question`，加 `text`）。Host 把汇报保存（最近 200 条，同文去重）并显示在 `board` 中，不会自动唤醒 Leader，也不让 worker 控制其他会话。

Host 守住的底线：

- 只操作插件创建的 worker 会话（Issue worker、Leader 开的临时任务），不操作 Leader 自身和你自己的会话。被管理的范围由 Host 根据插件创建记录推导，没有单独的「纳管」步骤。
- 投递结果不确定时不自动重发，只能由 `resolve_delivery` 或面板「未确认投递」判定；先严格保存 `sending` 记录再投递，同一 `requestId` 不重复执行。
- Issue 内容、worker 日志和汇报都标为不可信数据，不授予任何权限。
- 原生工具审批／问答只有你能在 worker 会话里回答；Leader 遇到时只告诉你是哪个会话。
- 发给 worker 的消息用原生 Agent 的非人类消息来源和 idle maintenance 同步校验，不使用会被宿主记作人类输入的普通 `session/prompt`；纠偏只用 `steer` 模式的 prompt，且附带非人类标识。

其他行为：

- **创建时的简报**：Leader 会话创建成功后，插件会尽力发送一条角色简报（说明工具、底线和不可信数据规则）。发送失败只写日志，不重试。
- **失败不重复操作**：Leader 的会话 ID、临时任务、汇报和投递记录保存在同一存储目录的 `leader.json`（journal 版本 2）。损坏或未知版本的 journal 只冻结此功能，不覆盖文件，也不影响 Issue 面板。创建结果不确定时，可填入核实过的 Leader 会话 ID 认领，或确认不存在后放弃该记录再创建。
- **旧版迁移**：v1 journal 加载时自动迁移并先备份为 `leader.json.v1.bak`；纳管项、预算、队列、笔记、依赖、审计等旧字段丢弃，保留 Leader 会话、模型、创建记录和临时任务，原有汇报标为已读。
- **Leader preset**：默认使用 DSH 标准 preset；需要自定义时设置 `config.leaderAgentPreset`（显式值不可用时拒绝创建）。随附的 `gitlab-issue-leader` preset 只提供 persona，可按需显式指定。
- **删除后的恢复**：Leader 会话被删除（宿主明确返回 `session/not-found`）后，面板回到“未创建”，由你重新创建；超时或仅被归档的会话不会触发重置，也绝不自动重建。

需要 DSH 已有 Agent、会话控制器与会话投影服务，以及 Cordis 4.1；缺失时明确不可用，不回退成伪人类投递。已结束的投递记录会压缩保留最近 100 条。

## 安全打开与人工接手（v2.33.1）

最低 DSH 版本为 `0.2.2-rc.3`：本修复依赖并核对了该版本的权威会话查询、客户端会话引用与归档确认接口。未核验的早期 rc 不再声明支持；宿主能力不可用时不做不安全导航。

Issue（含已关闭或取消指派记录）和工作区中的会话入口统一核验宿主真实状态，不再直接用历史 ID 跳转：

- **正常存在**：确认会话可加载且未归档后打开；加载失败留在当前面板并显示原因。
- **已归档**：显式选择「恢复并打开」。取得恢复确认后，再核验存在、归档状态和客户端加载结果；恢复失败不导航。
- **明确不存在**：显示「原会话不存在（可能已删除）」，保留任务、GitLab 链接及已有回复记录。宿主没有删除墓碑，不能仅凭不存在断言其删除原因；会话不存在也不代表 Issue 已关闭。
- **无法核验**：显示原因与重试入口；网络、权限、分页缺失或加载错误不算删除，不静默新建会话。

对于可追溯的任务记录，可以明确确认「新建接手会话」。它只创建空白人工会话，交接摘要供人查看/复制/发送，不自动启动模型任务、不重新派发、不占自动并发槽，也不覆盖原会话 ID。工作区中没有对应任务的失效会话不提供该任务接手动作。

接手记录单独持久化：关闭或刷新后，从原会话入口仍可查看已创建的接手会话与资料。已创建但模型设置或记录保存失败时，显示已知会话 ID，重试复用它；创建请求结果不确定时禁止再次创建，需先人工核查宿主。关闭弹层只停止后续界面操作，不承诺撤销已经发送的恢复或创建请求。

导航使用临时会话引用并检查实际加载状态；`openSession` 返回并不代表异步加载成功。已完成导航后发生的外部删除仍由宿主处理，没有宿主原子导航接口时不能保证阻止所有后续竞态。

## Issue 闭环与会话结算

Issue 面板的每条处理记录，在回合结束后由插件核对一次 GitLab 事实，再下闭环结论。

- **执行结算**：prompt 入队只代表“已接受”，不是完成。Host 读取会话名册（`running=true` 仍在执行）。只有 `turn/end.data.reason.kind === 'completed'` 才记为执行完成，其余（error、interrupted 等）记为执行失败。名册读取失败视为仍在执行。
- **闭环核对**：读取 Issue 当前状态（`host/gitlab.js` 经 `glab api -X GET` 请求）。Issue 已关闭 → `closed`；仍开放 → `follow-up`，并记录建议时间 `nextAttemptAt`（`followUpDelayMinutes` 分钟后）；被续办条件阻断（`followUpEnabled` 关闭、补救轮数超过 `maxFollowUps`）→ `needs-human`。API 查不到 Issue 状态时不裁决，下轮重试。
- **续办**：当前版本不会自动重新派发 `follow-up` 记录，`nextAttemptAt` 只用于展示，仍开放的 Issue 需人工再次点击 **处理**。
- **自动归档**：`autoArchive` 开启（默认）时，回合成功结束且结论为 `closed` 或 `follow-up` 的会话调用 `workspace/archiveSession` 归档（不带 `stopActivity`；仍有工作在跑会被 Host 拒绝并记录原因）。`needs-human` 保留不归档，等人工确认。
- **并发**：`maxConcurrentSessions`（默认 2，1–10）限制带未结算自动任务的会话数。Issue 手动处理不占用该槽位。
- **重启中断**：启动时由对账（`reconcileSessions`）接管仍标记为执行中的会话，继续按回合结果结算。

## 新会话配置

- **Issue 新开会话的工作区**（`issueSessionCwd`）：须为 DSH 已注册的工作区路径，未命中会显式报错；留空使用最近使用的工作区。它与 **GitLab 工作目录** 相互独立。
- **Issue 新开会话的模型**（`issueSessionModel`）：`null` 表示跟随 DSH 默认模型，也可固定为 provider/model。创建 Session 后执行 `session/rename` 与 `selectModel`。Issue 标题固定为 `仓库名 #iid`，不带续办后缀。选择支持思考强度的具体模型时，`selectModel` 额外携带所选 `reasoningEffort`；选择“提供方默认”则省略该字段。没有 `reasoning` 元数据的模型不显示强度选项。
- **设置项**（默认值见 `core.js` 的 `DEFAULT_SETTINGS`，取值范围见 `validateSettings`）：`autoArchive`（默认开）、`maxConcurrentSessions`（1–10，默认 2）、`issueSessionCwd`、`issueSessionModel`、`followUpEnabled`（默认开）、`followUpReuseSession`（默认开）、`maxFollowUps`（0–10，默认 3）、`followUpDelayMinutes`（1–1440，默认 15）。不再识别的旧设置键不会生效。
- 设置保存在 `state.json`，不修改已接受的历史 Session。旧版本升级时，原 `sessionCwd`／`sessionModel` 复制为 `issueSessionCwd`／`issueSessionModel`（仅当新键缺失）。

## 存储与升级

设置、Issue 派发记录和 Session 链接保存在 `<DSH_HOME>/storages/gitlab-workstation/state.json`，WorkStation Leader journal 保存在同目录的 `leader.json`（`DSH_HOME` 未设置时为 `~/.dsh`；每台机器、每个用户独立），采用原子写入，重启后恢复。这与其它 DSH 插件（如 dsh-context、dshmarket 的 `~/.dsh/storages/<插件>/`）一致。配置项 `storageDirectory` 可显式指定其它目录。插件不保存 GitLab 令牌，也不创建临时脚本。

数据目录迁移（v2.37）：

- 旧版默认目录是 `~/.dsh-plugins/gitlabtodo/`。未配置 `storageDirectory` 时，首次启动（或 Leader journal 首次读取）会把旧目录中的 `state.json`、`leader.json` **复制**到新目录：只复制新目录里还不存在的文件，先写临时文件再原子改名，已有数据从不覆盖。
- 旧目录与旧文件原样保留，不会删除；Host 日志会记录“插件数据已迁移…旧目录保留未删除”。确认新目录数据和界面状态无误后，可手动删除 `~/.dsh-plugins/gitlabtodo/`。
- 复制失败时插件拒绝启动并报告 `迁移插件数据 … 失败（旧文件未改动）`，不会用空状态覆盖历史；修复原因后重启即可重试。
- 显式配置了 `storageDirectory` 时不做任何迁移，直接使用该目录。
- 迁移后不要再装回 v2.36 及更早版本：旧版本仍读写旧目录，两份数据会分叉。

状态版本迁移：

- v1/v2 → v3：移除 `shell`、`script` 设置，Todo 拉取由 Host 内置完成。
- v3 → v4：会话提示词通用化；旧版内嵌的工作区专属规则自动预填进 `customRules` 设置（见上文），升级后行为不变。
- v4 → v5：增加会话路由设置与记录的 `routed/routeMode/requestId` 字段；旧记录自动补默认值，无需手工改写。
- v5 → v6：增加收件箱/批量预检/事件驱动续办相关设置与记录字段（`lastReply/watch/acknowledgedAt` 等）；旧记录自动补默认值，无需手工改写。
- v2.19（状态版本不变）：记录新增可选字段 `waitRounds`（纯等待轮计数）、`dispatchFailures`（续办派发失败计数）、`mergedInto/author/excerpt`（预检折叠来源）；旧记录缺省为 0／空，无需迁移。持久化故障改记 `lastPersistError`，不再混入 `lastDispatchError`。
- v2.20（状态版本不变）：新增设置 `waitProbeEnabled`、`followUpReuseSession`；记录新增可选字段 `waitProbes`、`reused`、`reuseCount`；面板新增 `lastPrecheckError`（预检失败原因）。**预检降级**：同一 Todo 预检连续 2 轮失败后降级为直接派发（此前每轮都跳过，会让未配置可用预检模型的环境永远不开会话）；失败原因同时写入日志与面板横幅。修复：启用轮询的瞬间若恰有一轮“未启用”的轮询在飞，启动轮询不再并入它而是等它结束后再跑完整一轮。
- 全新安装默认 `customRules` 为空，使用通用提示词。

- v6 → v7（4.0.0）：Todo 台账线程模型，升级前备份 `state.v6.bak.json`。
- v7 → v8（5.0.0，BREAKING）：删除 GitLab Todo 功能。`normalizeState`（`core.js`）丢弃 `ledger`、Todo 条目，以及 `handled`／`pending` 中非 Issue 记录（只保留 id 以 `issue-` 开头或 `source=issue` 的记录）。`settings` 经 `validateSettings` 重新校验；旧 `sessionCwd`／`sessionModel` 复制为 `issueSessionCwd`／`issueSessionModel`（仅当新键缺失）。
  - 备份：启动时（`index.js` 的 `start()`）若已存储的 `version` 为数字且不等于当前 8，先把原文件备份为 `state.v<旧版本>.bak.json`，同名已存在则不覆盖。从 v4.x 升级时旧版本为 7，备份文件是 `state.v7.bak.json`。备份保留，插件不删除。

## 去重与失败恢复

- 空结果不创建 Session。
- 只有提示词入队成功后，Issue 记录才进入派发记录（`executionStatus=running`），避免重复开会话。
- Session 已创建但提示词未入队时，记录 pending Session，避免重复创建。
- Host 重启后会从持久记录恢复仍在运行的会话监控，继续按回合结果结算。

## Bridge 安全

页面通过同源 `/api/gitlab-todo-agent` 与 Host 通信，路由注册在 DSH `connection.fetch` 上。Connection 统一完成 Host/Origin 检查、签名 Cookie 认证和 Owner Peer 校验，插件不另开无认证端点，也不自行读取或保存浏览器凭据；响应禁止缓存。

## 开发验证

```sh
npm test
npm run check
```

单元测试不会访问真实 GitLab 或创建真实模型会话。`npm run check` 覆盖客户端与全部 Host 运行模块；`npm run pack:check` 用于核对 Bundle 入口、资源和发布文件。

界面变更还应在真实 DSH GUI 中检查浅色/深色主题、窄屏、键盘切换、设置保存、Issue 刷新、危险操作确认与任务反馈。源码和纯逻辑测试不代表实际渲染验收；不要使用独立假壳替代宿主验证。

## 发布

MIT License。发布到 npm（`npm publish`，scoped 包需公开访问，`publishConfig.access` 已配置）或直接分发仓库均可；使用者的 GitLab 身份、模型选择与工作区都由各自环境决定，插件不携带任何部署方凭据。发布前可先 `npm run pack:check` 核对打包内容。
- v2.21（状态版本不变）：删除按任务类型选模型（`taskModels` 设置与预检判定的 `taskType` 字段）；所有会话统一用会话模型，预检/手动/路由行为一致；旧状态中的 `taskModels` 与记录字段 `taskType` 在读取时自动丢弃。
- v2.22（状态版本不变）：设置面板新增`高级选项`折叠区，把 maxQueuePerSession、续办等待分钟数、glab 工作目录、会话附加规则、autoRoute、waitProbeEnabled、followUpReuseSession 收入其中；`busyRouteMode` 与 `routeScope` 仍在主区。
- v2.26（状态版本不变）：新增 **已处理** Tab——分页展示全部处理记录（规则跳过、预检跳过、会话派发、投递中 pending），默认每页 50 条、打开期间每 10 秒刷新；跳过项显示判定理由、合并去向（mergedInto）与原文摘录，预检黑盒结果从此可查。新增 bridge action `handled` 与 `handledPage`/`handledProjection` 投影。
- v2.23（状态版本不变）：`handled` 历史按保留策略自动清理（closed/已确认 needs-human 90 天、预检跳过 30 天、已结算硬上限 500），`state.json` 不再无限增长；`checkThreadActivity` 拉讨论串改为按 `updated_at` 降序，通常一页命中。
- v2.24（状态版本不变）：诊断增强——预检/批量预检流式返回了分片但无正文时，把首个分片的 JSON 预览写进插件日志，便于定位 devin/swe-2 等 agentic 模型的流分片形态。
- v2.25（状态版本不变）：修复预检/批量预检在 DeepSeek Messages 协议路由下`message.content`为字符串导致`content.some is not a function`的错误——把 `messages[].content` 改为 block 数组 `[{type:'text',text:'...'}]`。
- v2.27（状态版本不变，纯结构重构）：`index.js` 巨型类按域拆分为 `host/` 下七个模块——`gitlab.js`（glab 子进程/Todo 分页/标记完成）、`precheck.js`（LLM 预检）、`slots.js`（并发槽/会话跟踪/对账结算）、`closures.js`（闭环裁决/归档/回复核对）、`followups.js`（MR 监视/等待探测/到期入队）、`dispatch.js`（派发管线/路由/手动动作）、`constants.js`+`util.js`（共享常量与工具）。方法体逐字搬迁、行为零变化；模块以 `attachRuntimeMethods` 挂到运行时原型，同名冲突在加载期即报错。
- v2.28（状态版本不变）：**预检引擎可配置**，新增 `precheckEngine`（auto/jev/llm）。auto（默认）优先用 **Jev/System One 决策模型**判定——返回带概率的结构化答案而不是生成文本，判定字段映射：needsProcessing→noul、跳过理由→choice 枚举（固定文案）、priority→score(1..5)、preferSession→choice、批内去重→同目标成对 match。P(needs) 落入 0.35–0.65 不确定带的条目自动交给 LLM 复核；Jev 整体不可用或单条判定失败时 auto 自动回退/补齐 LLM 路径，`jev` 严格模式不可用则跳过本轮。分类器通道按序：宿主 llm.classify（未来 DSH 版本）→ PATH 上的 `jev` CLI（读 jevctl 凭证）→ System One HTTP 直连（api.typesafe.ai/OpenRouter/自建兼容端，凭证链：设置 apiKey → 环境变量 → `~/.config/jev/credentials.json`）。新模块 `host/precheck-jev.js`；`mapLimit` 移入 `host/util.js` 复用。
- v2.29（状态版本不变）：**「最近会话」Tab 并入「已处理」**。两 Tab 数据同源（handled+pending 中带 sessionId 的记录），合并后：有会话的已处理行直接带「打开 Session」「归档/取消归档」按钮（原会话 Tab 的动作与条件全部保留）；无会话的行（规则/预检跳过）行内展示判定理由 skipReason 与折叠去向 mergedInto。删除 `sessionPage`/`sessionProjection` 与 bridge `sessions` action；`handledProjection` 补 `archiveError/waitProbes/replied` 字段。默认 50 条/页、加载更多不变。
- v2.30（状态版本不变）：**设置精简**——删除 `autoProcess`（与 `enabled` 主开关语义重复：旧状态里 `autoProcess:false` 的记录升级后直接由 `enabled` 决定，只想看列表就关主开关）；`routeScope` 与 `busyRouteMode` 从主区挪入「高级选项」折叠区（进阶路由策略，日常不需要碰）。`validateSettings` 读取旧状态时直接丢弃残留 `autoProcess` 字段。
- v2.31（状态版本不变）：新增 **Issue** Tab——按需拉取“指派给我的开放 Issue”（`glab api -X GET issues scope=assigned_to_me&state=opened`，最多 3 页），行内提供 **处理 / 打开 Session / 路由到已有会话**；Issue 条目走与 Todo 相同的派发、会话与已处理投影（合成 id `issue-<projectId>-<iid>`），但只手动、不占并发槽、闭环只认 Issue 关闭（提示词里 step 6 变为 `PUT .../issues/<iid> -F state_event=close`，核对走 `issueIsClosed`，API 不可判定留待下轮）。`state.issues` 缓存 + `lastIssuesAt`；`publicState.issueCount`；bridge 新增 `issues`（GET 缓存投影 / POST refresh:true 重拉）；`buildIssueProjection` join handled/pending，已关闭/不指派的进 orphans 区保留会话入口。顺带修复 v2.29 遗留：路由成功后 `refreshSessions` 未定义 → `refreshHandled()`；`acknowledgeNeedsHuman` 不再对合成 id 调 `mark_as_done`。
- v2.32（状态版本不变）：新增 **Log** Tab——运行时内存日志，只进内存环形缓冲（`createLogBuffer`）不落盘，新→旧、打开期间每 3 秒刷新、级别筛「全部/警告及以上」、「清空日志」两步确认。内存硬上限：`LOG_MAX_ENTRIES`(500 条) × `LOG_MAX_CHARS`(64 KB) 双维度淘汰最旧 + `LOG_MAX_LINE_CHARS`(500 字) 单条截断，dropped 计数被丢条目。统一写入入口 `this.logger.<level>()`（进缓冲 + 透传宿主补 `[gitlab-todo-agent]` 前缀），消息规范为单行「<对象/动作>：<结果/细节>」；全量 `this.ctx.logger` 调用点迁入并补轮询/派发/闭环/Issue 刷新/启动等生命周期 info 日志。`host/logs.js`（logProjection/clearLogEntries）+ bridge `logs`（GET 投影 / POST `clear:true`）。
- v2.32.1（状态版本不变）：修复 **Issue Tab 打开时只读空缓存、不触发远端刷新**的问题——客户端 `post()` 显式使用 POST，避免 `issues`/`logs` 等支持只读 GET 的 action 把写请求也降级成 GET；同时修复 Log「清空日志」请求。新增客户端网络层回归测试，Issue 缓存投影的 GET 行为不变。
- v2.33（历史版本，状态版本不变）：原仓库改名 **dsh-gitlab-workstation**，产品展示名改为 **GitLab Workstation / GitLab 工作台**。界面改为紧凑工作台，任务/环境分区、上下文操作、折叠设置与本地列表搜索；Todo 自动处理和 Issue 手动处理语义保持不变。npm/Loader/Bridge/存储身份保留，旧配置和会话记录无需迁移。
- v2.33.1（状态版本不变）：统一安全会话入口，按真实存在/归档状态核验、显式恢复、确认客户端可加载后导航；删除或查询失败留在当前面板，不静默新建、不把任务标记完成。可追溯任务提供明确人工接手，只创建空白会话并保留原记录。同版本后续将 npm/加载包名和客户端模块 ID 同步为 `@lifeipkg/dsh-gitlab-workstation`；旧包需要显式切换，内部数据与会话协议标识保留。
- v2.34（原 Todo 状态版本不变）：新增可选 Issue Leader（v2.44 起改名 WorkStation Leader），独立模型与会话、显式托管、进度汇总、受控非人类续办和逐 Issue 人工待办。权限变更走真实浏览器 RPC，Leader 限定工具与严格 journal/outbox，重启默认暂停；不自动代答审批或操控存量会话。
- v2.34.2（状态版本不变）：修复 DSH 0.2.2-rc.3 的 Connection 公共 RPC 包装器在自身 Context 读取未注入的 `webServer`、导致 Leader 路由落入 405 的问题；插件声明 `webServer`，并仅对该确切错误用同一 Connection 注册实现和显式 Context 兼容挂载，不重写认证或 Peer 校验。只有成功的 Host 只读快照明确证明未创建、无会话 ID 且无错误时，才恢复失败后的创建按钮；未知、失败或部分创建状态仍禁止重复创建。
- v2.33.2（状态版本不变）：新建 Todo 会话前缀由 `[协助]-` 改为 `TODO-`，保留目标类型、编号、note 与续办后缀；Issue 标题、既有路由/复用会话及历史记录不改名。归档永久删除与定时清理因当前宿主缺少安全删除能力而延期，未在本版本实现。
- v2.35.0（Todo 状态版本与 Leader journal 版本不变，旧 `leader.json` 直接兼容）：Leader 加固。已结束投递压缩、过期创建凭证清理，长期运行不再卡在 500 条上限；只在回合结束和状态转折时唤醒 Leader，并持久保存唤醒原因；启动简报失败自动回退为暂停；显式启动、恢复或受控推进可激活冷 worker；新 Leader 默认使用无通用工具的 `gitlab-issue-leader` preset；重新托管保留已用预算，新增显式重置；未确认投递与不确定创建可人工核对；投影新增运行状态、预算和未确认投递，Issue 新增「待命」「未加载」状态；Leader 作为人类主窗口逐 Issue 汇报，`snapshot` 提供全部 Issue 会话只读概览；面板提示“已创建 · 未启动”。
- v2.36.0（Todo 状态版本与 Leader journal 版本不变，旧 `leader.json` 直接兼容）：统一 Leader 能力为 9 个受限工具。新增 Issue worker 会话管理（为待办 Issue 创建/接管、重命名、归档、更换模型，均留审计）；`read_issue` 合并 worker 日志、待回答问题原文与 GitLab Issue/MR/流水线只读信息，续办改用 `evidenceToken`；新增 `relay_reply` 原样转达人类在 Leader 会话中的回复；`update_issue` 结构化笔记取代原进度/阻塞上报。worker 运行中 20 分钟无新日志时提醒 Leader 一次；唤醒通知改为每个 Issue 一行；托管到期时在 Leader 会话留言。面板显示 Leader 笔记、纳管来源和会话操作记录。移除旧工具 readManaged/advanceManaged/reportBlocker/reportProgress。既有 Leader 保留旧 persona 文本，新工具说明随启动简报下发。
- v2.37.0（Todo 状态版本与 Leader journal 版本不变）：默认数据目录从 `~/.dsh-plugins/gitlabtodo/` 改为与其它 DSH 插件一致的 `<DSH_HOME>/storages/gitlab-workstation/`（默认 `~/.dsh/storages/gitlab-workstation/`）。未配置 `storageDirectory` 时首次启动把旧 `state.json`、`leader.json` 复制到新目录，只补缺失文件、从不覆盖，旧目录保留供人工确认后删除；显式配置的目录不受影响。
- v2.38.0（状态版本不变）：工作台默认打开 **Issue** Tab。Leader 的 `gitlab_leader_session_create` 不传 `taskId`、改传 `title`＋`brief`（可选 `workingDirectory`）即可开**临时任务**会话，处理没有对应 GitLab Issue 的工作；临时任务自动纳管，可读取、续办、重命名、换模型、转达和归档，不限数量；创建结果不确定时只由人类在面板放弃，绝不自动重建。Leader journal 新增 `tasks` 记录，旧 journal 自动补空。
- v2.39.0（状态版本不变）：移除工作台顶部的「过去 24 小时」摘要卡片及其明细展开；快照不再计算和携带 `digest` 字段。闭环统计、收件箱与回复预览不受影响。
- v2.40.0（Todo 状态版本与 Leader journal 版本不变，旧数据直接兼容）：同一 Issue/MR 上的多条新 @我 Todo 合并为一个会话的一轮处理（设置「同对象 @我 合并派发」，默认开启，每条 Todo 仍单独记录和结案）；已纳管 Issue 上的新 Todo 直接转交其 worker。Leader 新增并发上限与持久排队、Issue 依赖、`gitlab_leader_complete` 验收收尾（可选完成后归档）、`gitlab_leader_steer` 纠偏、面板「交接到新会话」、默认关闭的 GitLab 进度评论 `gitlab_leader_issue_comment`；纳管 worker 新增 `gitlab_leader_report` 主动向 Leader 汇报或给其他 Issue 留言。面板显示排队、已完成、worker 汇报、历史 Leader 会话与不确定评论。
- v2.41.0（状态版本与 Leader journal 版本不变）：Issue 行「交给 Leader 托管」与「取消托管」直接执行，不再二次确认；Leader 面板移除「纳管会话」与「需人类决策」栏（单个 Issue 的暂停/恢复/重置预算入口随之移除，取消托管仍在 Issue 行）；移除「已处理」Tab 及其 bridge `handled` 接口与 `handledPage`/`handledProjection` 投影，内部处理台账保留用于去重与 Issue 映射。
- v2.42.0（状态版本与 Leader journal 版本不变）：Leader 自主管理。新增工具 `gitlab_leader_list_issues`（读取全部被指派的 open Issue，可刷新）和 `gitlab_leader_manage`（纳管／解除、暂停／恢复、重置预算、核对不确定投递、自行续期／暂停托管，全部审计）；日志截断与原生审批／问答不再暂停 Issue 等待 UI 点击，旧版因此暂停的 Issue 加载时自动解除；Leader 提示词、启动简报、状态释义与唤醒通知改为指向这些工具。原生审批／问答仍只由人类在 worker 会话回答。
- v2.43.0（状态版本与 Leader journal 版本不变，旧 `leader.json` 直接兼容）：Leader 工具精简为 6 个基础工具 `gitlab_leader_overview`／`read`／`session`／`note`／`gitlab_api`／`run`，取代原来的约 15 个工具；worker 汇报工具 `gitlab_leader_report` 保留。新增通用 GitLab REST API 工具，写方法由新设置「允许 Leader 写 GitLab」（`gitlabWrite`，默认关闭，旧 `issueComments` 自动迁移）控制。移除推进预算、托管时限与唤醒上限、单 Issue 暂停／恢复、证据 token、纠偏／评论／汇报频率与数量限制、转达人类原话校验；Leader 暂停只停自动唤醒。保留底线：不确定投递不自动重发、只操作插件创建的 worker 会话、不可信内容标注、GitLab 写入需授权、原生审批／问答只由人类回答、全部操作审计。面板移除对应的暂停 Issue／重置预算入口。
- v2.44.0（状态版本与 Leader journal 版本不变）：Leader 改名 WorkStation Leader，统一管理插件创建的 Issue、收件箱 Todo 和临时任务会话：`session create` 可为收件箱 Todo 开会话，Todo 会话可纳管、读取（附 Todo 原文）、重命名、发消息、归档和收尾；新增工具 `gitlab_leader_inbox` 读取收件箱与待人工处理清单；随附 Leader preset 增加 `@deepseek-ai/dsh-agent-instructions`，新建 Leader 自动注入工作区 `AGENTS.md`。工具名与 preset id 保持不变。
- v2.44.1：启动／交接简报不再重复列出工具用法（工具名称、说明和参数每次请求都由原生工具定义带给模型），只保留角色、汇报要求和底线规则。
- v2.44.2（状态版本不变）：Leader 会话被删除（宿主明确返回 `session/not-found`）后，面板轮询、创建或托管巡检会自动清空已存的 Leader 会话 ID 并回到“未创建”，托管项、笔记、队列与审计保留，由人类自己点“创建 Leader”重建；超时/不可验证或仅被归档的会话不会触发重置，也绝不自动重建。
- v3.0.0（Todo 状态版本不变；Leader journal 升至版本 2，旧 v1 自动迁移并备份为 `leader.json.v1.bak`）：**Leader 重新设计（不兼容变更）**。Leader 改用 DSH 标准 preset，保留 Shell／文件／`glab` 等通用工具，插件只提供 `gitlab_leader_board`（看板）与 `gitlab_leader_session`（create／send／steer／rename／model／archive／resolve_delivery）两个工具，worker 保留 `gitlab_leader_report`。移除启动／暂停、纳管／解除、预算与租约、并发队列、依赖、完成验收、笔记、会话交接、GitLab API 工具与评论设置、审计、后台唤醒循环以及 Todo 转交 Leader；被管理会话改由插件创建记录推导。面板只保留创建／模型／放弃创建／放弃任务／确认投递；创建 Leader 后发送一次角色简报。`leaderAgentPreset` 默认不再指定随附 preset。
- v3.0.1（状态版本不变）：修复 Leader 会话没有拿到插件工具的问题。宿主在写入 Leader 会话 ID 之前就触发 `agent/created`，插件把它当成普通会话，`gitlab_leader_board`／`gitlab_leader_session` 因此从未注册。现在创建流程在保存会话 ID 后立即绑定；已常驻却绑定失败时创建返回错误，不再显示就绪；未常驻时记录警告，会话打开时自动绑定。同时每次持久化后同步 worker 的 `gitlab_leader_report`。Leader 运行时隐藏 `subagent`／`workflow`／Agent Team／`plugin_manager`／`schedule_*`／目标工具／`edit`／`write`，保留 Shell、读取与搜索、`skill`、`todo_write`、`web_fetch`、后台任务和 `ask_user_question`。已存在的 Leader 会话需重新打开后才会绑定工具（宿主日志出现「Leader 工具已绑定」）。
- v3.1.0（Todo 状态版本与 Leader journal 版本不变）：Leader 新增 `gitlab_leader_inbox` 工具，可列出「需人工」收件箱并按条确认（等同「我已处理」，需写明核实依据）；用法只放在工具定义里，角色简报与 persona 不再写死插件工具数量。
- v3.1.1（状态版本不变）：Todo 会话提示词改为“非必要不回复任何人的 note”。回复默认不发，只在三种情形回复：评论向我方提出了具体问题、本回合产出了对方需要查看或据此行动的结果（如 MR）、我方被阻塞或需要人类动作（needs-human／waiting）；“已收到／已处理”之类的纯确认一律不发。不回复时会话照常完成工作并标记 Todo，以 `done` + `noAction:true` 结案，插件不再判漏回复（闭环备注显示为“无需回复：…”）。Issue 会话仍须发表结论评论，不受影响。
