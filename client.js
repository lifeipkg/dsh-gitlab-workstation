window.__ModuleLoader__.load({
  id: '@lifeipkg/dsh-gitlab-workstation',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'gitlab-todo-agent';
    const PANEL_ID = 'gitlab-todos';
    const BRIDGE_PATH = '/api/gitlab-todo-agent';
    const en = {
      panel: 'GitLab Workstation', title: 'GitLab Workstation',
      subtitle: 'A compact workspace for GitLab tasks, sessions and human follow-up.',
      enable: 'Enable Todo auto-polling', disable: 'Pause Todo auto-polling', checkNow: 'Check Todos', checking: 'Checking…',
      todoPolling: 'Todo auto-polling', todoSettings: 'Todo settings', tasksGroup: 'Tasks', environmentGroup: 'Environment',
      workstationViews: 'Workstation views', searchList: 'Search this list', searchLoaded: 'Search loaded records only',
      searchNoMatches: 'No loaded items match your search.', clearSearch: 'Clear search', searchResults: 'Matches / loaded',
      loadedRecords: 'Loaded / total', saving: 'Saving…', settingsSaved: 'Settings saved',
      modelSummary: 'Model', workspaceSummary: 'Workspace', autoWorkspaceShort: 'Auto', defaultModelShort: 'DSH default',
      settings: 'Settings', save: 'Save settings', cancel: 'Cancel', close: 'Close', advanced: 'Advanced options',
      enabled: 'Enabled', disabled: 'Disabled', running: 'Running', idle: 'Idle',
      activeSessions: 'Active sessions', queuedSessions: 'Queued',
      pending: 'Pending', handled: 'Handled', lastSuccess: 'Last poll', never: 'Never',
      mrDone: 'MR marked done without processing', markDone: 'Mark done',
      newFound: 'New this round',
      todoList: 'Todo', noTodos: 'No pending todos.',
      directMention: 'Comment @ me',
      sessionsTitle: 'Recent sessions', noSessions: 'No session has been dispatched yet.', autoDispatch: 'auto', manualDispatch: 'manual',
      loadMore: 'Load more', sessionsError: 'Could not load recent sessions',
      archiveSession: 'Archive', unarchiveSession: 'Unarchive',
      sessionStarting: 'Starting', sessionAccepted: 'Queued', waitProbesLabel: 'Wait probes: ',
      process: 'Process', reprocess: 'Process again', dispatched: 'Accepted', waiting: 'Waiting',
      executionRunning: 'Running', executionCompleted: 'Completed', executionFailed: 'Failed',
      precheckSkipped: 'Skipped (no handling needed)',
      ruleSkipped: 'Skipped (rule)',
      sessionArchived: 'Archived',
      openSession: 'Open session',
      sessionEntryTitle: 'Session access', sessionChecking: 'Checking session…', sessionRestoreOpen: 'Restore and open',
      sessionArchivedNotice: 'This session is archived. Restore it explicitly before opening.',
      sessionMissingNotice: 'The linked session does not exist (possibly deleted). Task records and replies are retained; nothing is marked done.',
      sessionUnknownNotice: 'Session status could not be verified. Stay here and retry.', sessionRetry: 'Check again',
      sessionInvalidResponse: 'Invalid inspection response.', sessionCapabilityMissing: 'This Host does not expose the required safe session APIs.',
      sessionCatalogNotReady: 'Workspace archive status is unavailable. Retry after the Host is ready.',
      sessionClientArchived: 'The current Client catalog still marks this session archived.', sessionLoadFailed: 'Session loading could not be verified.',
      sessionHandoff: 'Create handoff session', sessionConfirmHandoff: 'Confirm create blank session',
      sessionHandoffHint: 'Creates a blank session only. No task is dispatched or marked done. Review and send the handoff text yourself.',
      sessionHandoffReady: 'Blank handoff session created. Copy the context below before opening; sending it is your decision.',
      sessionHandoffContext: 'Handoff context', sessionCopyContext: 'Copy context', sessionCopied: 'Copied',
      sessionHandoffFailed: 'Could not confirm handoff creation. Retry uses the same request, not a new dispatch.',
      sessionHandoffPartial: 'A session ID is known, but setup or saving is incomplete. Retrying reuses it; no task has been started.',
      sessionCloseHint: 'Closing cancels navigation, not recovery or creation already sent to the Host.',
      sessionHandoffUncertain: 'A handoff record already exists, but creation or saving is not confirmed. Check the Host; do not create another.',
      sessionRetryHandoff: 'Retry handoff setup', sessionConfirmHandoffSetup: 'Confirm retry on the same session',
      interval: 'Poll interval (seconds)', limit: 'Maximum new sessions per poll', concurrency: 'Automatic dispatch concurrency',
      cwd: 'GitLab working directory', cwdHint: 'Leave empty to use the Host process directory.',
      sessionCwd: 'Todo session workspace', sessionCwdHint: 'Pick the DSH workspace for new Todo sessions. "Auto" follows the most recently used workspace.',
      sessionCwdAuto: 'Auto (most recently used workspace)', sessionCwdUnregistered: 'Current setting (not registered)',
      customRules: 'Todo session rules', customRulesHint: 'Appended to Todo prompts only. Issue prompts contain just the issue link and a start instruction. Todo rules override the generic prompt on conflict; empty keeps the generic prompt.',
      workspacesTitle: 'Workspaces', noWorkspaces: 'No DSH workspace is registered yet.',
      unassignedWorkspace: 'Sessions outside any workspace',
      workspacesError: 'Could not load the DSH workspace list',
      configuredWorkspace: 'plugin target', pluginSessionTag: 'plugin',
      sessionUnknown: 'Untitled session', lastActive: 'Last activity',
      sessionModel: 'Todo session model', sessionModelDefault: 'Use the DSH default model',
      issueSessionSettings: 'Issue session settings', issueSessionModel: 'Issue model', issueSessionCwd: 'Issue workspace',
      issueSessionSettingsHint: 'Saved immediately. Applies only to new Issue sessions.',
      reasoningEffort: 'Thinking effort', reasoningEffortDefault: 'Provider default',
      reasoningEffortUnavailable: 'Saved effort (not advertised)',
      judgeModel: 'Precheck model', judgeModelDefault: 'Follow the session model',
      judgeModelHint: 'Pin a fast, lightweight model here so the need-to-handle judgment returns quickly; new sessions keep using the session model above.',
      precheckEngine: 'Precheck engine',
      precheckEngineAuto: 'Auto (Jev first, fall back to LLM)',
      precheckEngineJev: 'Jev only (skip the round when unavailable)',
      precheckEngineLlm: 'LLM only (batch chat judgment)',
      precheckEngineHint: 'Jev returns typed probabilities instead of generated text — cheaper and faster. In Auto, Jev takes over whenever available and the LLM covers unavailable or low-confidence cases.',
      classifierProvider: 'Classifier provider',
      classifierProviderCustom: 'Custom (System One compatible)',
      classifierModel: 'Classifier model',
      classifierBaseUrl: 'Classifier base URL',
      classifierApiKeyEnv: 'API key env var',
      classifierApiKey: 'API key (stored in plain text)',
      classifierApiKeyPlaceholder: 'Leave empty to use env var or jev CLI credentials',
      classifierApiKeyKeep: 'Key saved — leave empty to keep it, type to replace',
      classifierHint: 'Used only by the Jev path. Discovery order: host classifier → `jev` CLI on PATH → HTTP here. The API key is written to state.json; prefer the env var name above when possible.',
      classifierSettings: 'Classifier connection', classifierSecurity: 'API keys are stored in plain text in state.json; prefer an environment variable.',
      sessionModelPinDefault: 'Pin the current default model', sessionModelFixedHint: 'Selecting a concrete model pins every new session to that provider/model; it will not follow future default changes.',
      sessionModelUnavailable: 'Currently configured model (not in the available catalog)',
      modelCatalogError: 'Could not load the available model catalog',
      precheckEnabled: 'Precheck and skip mentions that need no handling',
      ruleSkipEnabled: 'Skip notifications and invalid mentions by rule',
      autoArchive: 'Archive plugin sessions after closure',
      followUpEnabled: 'Follow up automatically when a todo remains open',
      waitProbeEnabled: 'Check for changes before a follow-up',
      followUpReuseSession: 'Reuse the previous session for follow-ups',
      maxFollowUps: 'Maximum automatic follow-up rounds per todo', followUpDelay: 'Follow-up wait (minutes)',
      followUpHint: 'A loop is closed when the todo is marked done and the original note has our reply. Waiting on CI and similar conditions is retried after the wait (doubling each round); when rounds run out, or the session reports that a human is needed, the todo is left for you.',
      closureClosed: 'Loop closed', closureFollowUp: 'Follow-up scheduled', closureNeedsHuman: 'Needs you', closureVerifying: 'Verifying',
      followUpCount: 'Awaiting follow-up', needsHumanCount: 'Needs you',
      roundLabel: 'Round', nextAttempt: 'Next follow-up',
      routeScope: 'Scope', routeScopePlugin: 'Only plugin-created sessions', routeScopeAny: 'Any unarchived session',
      autoRoute: 'Continue the same item in its most recent session',
      busyRouteMode: 'When busy', busyRouteQueue: 'Queue after the current turn', busyRouteSteer: 'Insert at the next step of the current turn',
      maxQueuePerSession: 'Queue limit',
      routeToSession: 'Route to session', routeSearch: 'Search sessions',
      routeLoading: 'Loading routable sessions…', routeEmpty: 'No sessions are available for routing.', routeNoMatches: 'No sessions match your search.',
      refresh: 'Refresh', routeSameTarget: 'Same MR/Issue', routeModeQueue: 'Queue', routeModeSteer: 'Steer',
      routeLoad: 'Load', routeNotAccepting: 'Not accepting', routeConfirm: 'Route to session',
      routedQueue: 'Routed · queued', routedSteer: 'Routed · steering', routeFailed: 'Could not route the todo',
      loading: 'Loading GitLab Workstation…', renderError: 'The panel failed to render', retry: 'Retry rendering',
      localError: 'Action failed',
      defaultPaused: 'Polling starts paused so installation never dispatches your real todos automatically.',
      inboxTitle: 'Inbox', inboxEmpty: 'Nothing is waiting for you.', inboxTakeover: 'Open session to take over',
      inboxAcknowledge: 'Mark handled', inboxPendingUnconfirmed: 'Legacy message unconfirmed', inboxError: 'Could not load the inbox',
      digestTitle: 'Last 24 hours', digestShow: 'Details', digestHide: 'Hide', digestEmpty: 'No settled records in the last 24 hours.',
      handledTitle: 'Handled', handledEmpty: 'No handled records.',
      mergedIntoLabel: 'Merged into', pendingStarting: 'Dispatching', acceptedLabel: 'Accepted', outcomeSessionAccepted: 'Session accepted',
      replyPreview: 'Our reply',
      signatureLabel: 'Sign replies as AI-generated', signatureText: 'Signature text', signatureHint: 'When enabled, Todo session prompts require a one-line AI signature on GitLab replies. Applies to new Todo prompts only.',
      confirmMarkDone: 'Confirm mark done?', confirmReprocess: 'Confirm process again?', confirmAcknowledge: 'Confirm mark handled?',
      issuesTitle: 'Issues', issuesEmpty: 'No open issues assigned to you on GitLab.',
      issuesError: 'Could not load the issue list', issuesHint: 'Open issues assigned to you',
      issuesOrphans: 'Closed or unassigned', issueTag: 'Issue',
      leaderTitle: 'Issue Leader', leaderCreate: 'Create Leader', leaderOpen: 'Open Leader',
      leaderStart: 'Start supervision', leaderPause: 'Pause all', leaderModel: 'Leader model',
      leaderAutoEnroll: 'Manage new Issue sessions by default', leaderAutoEnrollHint: 'Off by default. Never enrolls existing sessions.',
      leaderScope: 'Enrollment lets Leader read the selected session and send instructions only within its original task scope. It grants no human approval or question-answering authority.',
      leaderStartHint: 'Start supervision of the explicitly enrolled sessions. Unselected sessions remain untouched.',
      leaderResumeHint: 'First handle any native approval or question yourself in the actual session. Resume only confirms your follow-up decision; the Host refuses while native input or work is pending.',
      leaderAutoEnrollConfirm: 'Apply this access to future sessions created from the Issue tab only. Existing sessions remain untouched.',
      leaderConfirm: 'Confirm access', leaderEnrolled: 'Managed', leaderEnroll: 'Manage with Leader', leaderUnenroll: 'Unmanage',
      leaderPauseIssue: 'Pause Issue', leaderResumeIssue: 'Resume Issue', leaderManaged: 'Managed sessions',
      leaderManagedEmpty: 'No sessions enrolled. Select an existing Issue session below; nothing is enrolled automatically.',
      leaderHuman: 'Needs your decision', leaderHumanEmpty: 'No human follow-up reported.',
      leaderNativeHuman: 'Handle native approvals and questions yourself in the actual session. Leader cannot approve or answer them; other Issues can continue.',
      leaderHumanOpen: 'Open actual session', leaderError: 'Leader action failed', leaderSnapshotError: 'Could not read Leader status',
      leaderInvalidResponse: 'Leader response could not be verified. Refresh status before granting access.',
      leaderRpcUnavailable: 'Authenticated browser connection is unavailable. Leader access changes cannot use HTTP; refresh the page or check the Host.',
      leaderCreateUncertain: 'Creation was sent but no session ID is confirmed. Refresh status or check the Host; do not create another Leader.',
      leaderRetrySetup: 'Retry setup (reuse known Leader)', leaderRetrySetupHint: 'Only retries setup on this known Leader session. It does not create another session, start supervision, or grant access to any Issue.',
      leaderNotCreated: 'Not created · off', leaderReady: 'Ready', leaderPaused: 'Paused', leaderUncertain: 'Uncertain', leaderErrorPhase: 'Error',
      leaderWatching: 'Watching', leaderRunning: 'Running', leaderNeedsHuman: 'Needs you', leaderArchived: 'Archived', leaderMissing: 'Missing', leaderUnknown: 'Unknown',
      leaderRefresh: 'Refresh Leader status', leaderWorking: 'Updating Leader…', leaderSaved: 'Leader updated',
      leaderStandby: 'Standby', leaderCold: 'Not loaded', leaderNeverStartedPhase: 'Created · not started', leaderDeliveryUncertain: 'Delivery unconfirmed',
      leaderNeverStartedHint: 'Leader is created but supervision has not started. Until you click "Start supervision", the Leader session stays blank and DSH shows it as "New Session". This is not a failed creation; do not create another Leader.',
      leaderPausedHint: 'Supervision is paused. Managed Issues are on standby; start supervision again to let Leader report progress here.',
      leaderMainWindow: 'Leader is your main window: once supervision runs, it posts progress for every Issue session in its own conversation.',
      leaderBudget: 'Actions', leaderResetBudget: 'Reset budget',
      leaderResetBudgetHint: 'Grants this Issue a fresh action budget and lease. A paused Issue still needs an explicit resume.',
      leaderNoteDecisions: 'Decisions', leaderNoteDeliverables: 'Deliverables',
      leaderProvenanceUi: 'Added by you', leaderProvenanceCreated: 'Auto-enrolled', leaderProvenanceLeader: 'Opened by Leader',
      leaderAudit: 'Leader session actions', leaderAuditHint: 'Sessions Leader created, renamed, archived or switched models for, and replies it relayed. Display only.',
      leaderAuditCreate: 'Created session', leaderAuditEnroll: 'Took over session', leaderAuditRename: 'Renamed', leaderAuditArchive: 'Archived',
      leaderAuditModel: 'Switched model', leaderAuditRelay: 'Relayed your reply', leaderAuditTaskCreate: 'Opened ad-hoc task', leaderAuditTaskDismiss: 'Dismissed uncertain task',
      leaderTaskTag: 'Ad-hoc task', leaderTasksUncertain: 'Ad-hoc tasks with uncertain creation', leaderTasksUncertainHint: 'Leader tried to open these sessions but the result is unknown. Check the DSH session list; archive any stray session yourself, then dismiss the record here.', leaderTaskDismiss: 'Dismiss',
      leaderRelayHint: 'You can also answer in the Leader session; Leader forwards your exact words to the Issue session. Native approvals and questions still need you in the actual session.',
      leaderDeliveries: 'Unconfirmed deliveries',
      leaderDeliveriesHint: 'The Host could not confirm whether these messages arrived. Open the target session, check, then record the result. Nothing is resent automatically.',
      leaderDelivered: 'It arrived', leaderNotDelivered: 'It did not arrive', leaderDeliveryOpen: 'Open target session',
      leaderCreationUnresolved: 'A previous creation never confirmed its session ID. Check the session list: if a "GitLab Issue Leader" session exists, paste its ID and claim it; if none exists, abandon the record and create again.',
      leaderClaim: 'Claim this session', leaderClaimPlaceholder: 'Leader session ID', leaderAbandon: 'No Leader exists, abandon record',
      logsTitle: 'Log', logsEmpty: 'No runtime log entries yet.',
      logsError: 'Could not load the runtime log', logsClear: 'Clear log', confirmClearLogs: 'Confirm clear log?',
      logsDropped: 'entries dropped (over the memory cap)', logsFilterAll: 'All', logsFilterWarn: 'Warnings+',
      logsHint: 'In-memory only, not written to disk. Ring buffer caps', logsEntriesSuffix: 'entries',
      signaturePlaceholder: '— Replied by the AI assistant',
      bridgeTimeout: 'Request timed out (90 seconds). Please try again.', bridgeNetwork: 'Network error: could not reach the plugin service.',
      colon: ': ',
    };
    const zh = {
      panel: 'GitLab 工作台', title: 'GitLab 工作台',
      subtitle: '集中处理 GitLab 任务、会话与需人工接手的事项。',
      enable: '启用 Todo 自动轮询', disable: '暂停 Todo 自动轮询', checkNow: '检查 Todo', checking: '检查中…',
      todoPolling: 'Todo 自动轮询', todoSettings: 'Todo 设置', tasksGroup: '任务', environmentGroup: '环境',
      workstationViews: '工作台视图', searchList: '搜索当前列表', searchLoaded: '仅搜索已加载记录',
      searchNoMatches: '已加载条目中没有匹配结果。', clearSearch: '清除搜索', searchResults: '匹配 / 已加载',
      loadedRecords: '已加载 / 总数', saving: '保存中…', settingsSaved: '设置已保存',
      modelSummary: '模型', workspaceSummary: '工作区', autoWorkspaceShort: '自动', defaultModelShort: 'DSH 默认',
      settings: '设置', save: '保存设置', cancel: '取消', close: '关闭', advanced: '高级选项',
      enabled: '已启用', disabled: '已停用', running: '运行中', idle: '空闲',
      activeSessions: '运行会话', queuedSessions: '排队',
      pending: '待处理', handled: '已处理', lastSuccess: '最近轮询', never: '从未',
      mrDone: 'MR 已直接标记完成', markDone: '标记完成',
      newFound: '本轮新增',
      todoList: 'Todo', noTodos: '暂无待处理 Todo。',
      directMention: '评论中 @ 我',
      sessionsTitle: '最近会话', noSessions: '还没有分派过会话。', autoDispatch: '自动', manualDispatch: '手动',
      loadMore: '加载更多', sessionsError: '无法加载最近会话列表',
      archiveSession: '归档', unarchiveSession: '取消归档',
      sessionStarting: '启动中', sessionAccepted: '已入队', waitProbesLabel: '等待探测：',
      process: '处理', reprocess: '重新处理', dispatched: '已接受', waiting: '待处理',
      executionRunning: '执行中', executionCompleted: '执行完成', executionFailed: '执行失败',
      precheckSkipped: '已跳过（无需处理）',
      ruleSkipped: '已跳过（规则）',
      sessionArchived: '已归档',
      openSession: '打开会话',
      sessionEntryTitle: '会话入口', sessionChecking: '正在核验会话…', sessionRestoreOpen: '恢复并打开',
      sessionArchivedNotice: '此会话已归档，请明确恢复后再打开。',
      sessionMissingNotice: '关联会话不存在（可能已删除）。任务记录和回复仍保留，不会标记完成。',
      sessionUnknownNotice: '暂时无法核实会话状态，请留在这里重试。', sessionRetry: '重新核验',
      sessionInvalidResponse: '会话核验响应无效。', sessionCapabilityMissing: '当前 Host 未提供安全打开所需的会话接口。',
      sessionCatalogNotReady: '工作区归档状态尚不可用，请在 Host 就绪后重试。',
      sessionClientArchived: '当前客户端目录仍显示此会话已归档。', sessionLoadFailed: '无法确认会话加载成功。',
      sessionHandoff: '新建接手会话', sessionConfirmHandoff: '确认新建空白会话',
      sessionHandoffHint: '只创建空白人工会话，不分派任务、不标记完成；请自行审阅并发送交接摘要。',
      sessionHandoffReady: '空白接手会话已建立，请先复制下方摘要再打开；是否发送由你决定。',
      sessionHandoffContext: '交接摘要', sessionCopyContext: '复制摘要', sessionCopied: '已复制',
      sessionHandoffFailed: '未能确认接手会话创建结果。重试使用同一请求，不重新分派。',
      sessionHandoffPartial: '已确认会话 ID，但设置或保存尚未完成。重试复用此会话，未启动任务处理。',
      sessionCloseHint: '关闭会取消导航，但不会撤销已发送给 Host 的恢复或创建操作。',
      sessionHandoffUncertain: '已有接手记录，但创建或保存结果尚不确定；请核查 Host，避免另建会话。',
      sessionRetryHandoff: '重试补齐接手设置', sessionConfirmHandoffSetup: '确认复用原会话重试',
      interval: '轮询间隔（秒）', limit: '每轮最多创建 Session 数', concurrency: '自动处理并发数',
      cwd: 'GitLab 工作目录', cwdHint: '留空使用 Host 进程目录。',
      sessionCwd: 'Todo 新开会话的工作区', sessionCwdHint: '选择 Todo 新会话归属的 DSH 工作区；“自动”跟随最近使用的工作区。',
      sessionCwdAuto: '自动（最近使用的工作区）', sessionCwdUnregistered: '当前配置（未注册）',
      customRules: 'Todo 会话附加规则', customRulesHint: '仅追加到 Todo 会话提示词；Issue 只发送链接和“开始处理”。Todo 附加规则与其他条款冲突时优先适用；留空使用通用提示词。',
      workspacesTitle: '工作区', noWorkspaces: 'DSH 尚未注册工作区。',
      unassignedWorkspace: '未归属工作区的会话',
      workspacesError: '无法加载 DSH 工作区列表',
      configuredWorkspace: '插件目标', pluginSessionTag: '插件',
      sessionUnknown: '未命名会话', lastActive: '最近活动',
      sessionModel: 'Todo 会话模型', sessionModelDefault: '跟随 DSH 默认模型',
      issueSessionSettings: 'Issue 会话设置', issueSessionModel: 'Issue 模型', issueSessionCwd: 'Issue 工作区',
      issueSessionSettingsHint: '修改后立即保存，仅影响之后新开的 Issue 会话。',
      reasoningEffort: '思考强度', reasoningEffortDefault: '提供方默认',
      reasoningEffortUnavailable: '当前配置（目录未提供）',
      judgeModel: '预检模型', judgeModelDefault: '跟随会话模型',
      judgeModelHint: '固定一个更快的轻量模型可显著缩短“是否需要处理”的判断耗时；新会话仍使用上面的会话模型。',
      precheckEngine: '预检引擎',
      precheckEngineAuto: '自动（Jev 优先，不可用时回退 LLM）',
      precheckEngineJev: '仅 Jev（不可用则跳过本轮）',
      precheckEngineLlm: '仅 LLM（聊天模型批量判定）',
      precheckEngineHint: 'Jev 返回带概率的结构化判定而不是生成文本——更便宜也更快。自动模式下 Jev 可用即用，不可用或低置信条目自动交给 LLM。',
      classifierProvider: '分类器提供方',
      classifierProviderCustom: '自定义（System One 兼容端）',
      classifierModel: '分类器模型',
      classifierBaseUrl: '分类器 baseUrl',
      classifierApiKeyEnv: 'API key 环境变量名',
      classifierApiKey: 'API key（明文存储）',
      classifierApiKeyPlaceholder: '留空则走环境变量或 jev CLI 凭证',
      classifierApiKeyKeep: '已保存密钥——留空保留，输入替换',
      classifierHint: '仅 Jev 路径使用。通道按序：宿主分类器 → PATH 上的 jev CLI → 这里配置的 HTTP。API key 会写入 state.json；能用上面的环境变量名就优先用环境变量。',
      classifierSettings: '分类器连接', classifierSecurity: '密钥将明文写入 state.json，建议优先使用环境变量。',
      sessionModelPinDefault: '固定当前默认模型', sessionModelFixedHint: '选择具体模型后，新会话会固定使用该 provider/model，不再随 DSH 默认模型变化。',
      sessionModelUnavailable: '当前配置模型（不在可用目录中）',
      modelCatalogError: '无法加载可用模型目录',
      precheckEnabled: '预检并跳过无需处理的提及',
      ruleSkipEnabled: '按规则跳过通知和无效提及',
      autoArchive: '闭环后自动归档插件会话',
      followUpEnabled: 'Todo 未闭环时自动续办',
      waitProbeEnabled: '续办前检查是否仍无变化',
      followUpReuseSession: '续办优先复用上一轮会话',
      maxFollowUps: '每条 Todo 最多自动续办轮数', followUpDelay: '续办等待时间（分钟）',
      followUpHint: '闭环 = Todo 已标记完成且原 note 有我方回复。等待 CI 等条件的按等待时间续办（逐轮翻倍）；轮数用尽或会话判定需要人接手时，保留给你处理。',
      closureClosed: '已闭环', closureFollowUp: '待续办', closureNeedsHuman: '需人工', closureVerifying: '核对中',
      followUpCount: '待续办', needsHumanCount: '需人工',
      roundLabel: '轮次', nextAttempt: '下次续办',
      routeScope: '范围', routeScopePlugin: '仅插件创建的会话', routeScopeAny: '任意未归档会话',
      autoRoute: '同一事项自动续到最近会话',
      busyRouteMode: '忙碌时', busyRouteQueue: '当前回合结束后处理', busyRouteSteer: '插入当前回合的下一步引导',
      maxQueuePerSession: '队列上限',
      routeToSession: '路由到会话', routeSearch: '搜索会话',
      routeLoading: '正在加载可路由会话…', routeEmpty: '当前没有可路由的会话。', routeNoMatches: '没有符合搜索条件的会话。',
      refresh: '刷新', routeSameTarget: '同目标', routeModeQueue: '排队', routeModeSteer: '引导',
      routeLoad: '负载', routeNotAccepting: '不接受', routeConfirm: '路由到所选会话',
      routedQueue: '已路由·排队', routedSteer: '已路由·引导', routeFailed: '路由 Todo 失败',
      loading: '正在加载 GitLab 工作台…', renderError: '面板渲染失败', retry: '重新渲染',
      localError: '操作失败',
      defaultPaused: '插件默认停用，避免安装后立即处理真实 Todo。',
      inboxTitle: '收件箱', inboxEmpty: '没有等待你处理的 Todo。', inboxTakeover: '打开会话接手',
      inboxAcknowledge: '我已处理', inboxPendingUnconfirmed: '旧消息未确认', inboxError: '无法加载收件箱',
      digestTitle: '过去 24 小时', digestShow: '查看明细', digestHide: '收起明细', digestEmpty: '过去 24 小时没有结算记录。',
      handledTitle: '已处理', handledEmpty: '暂无处理记录。',
      mergedIntoLabel: '合并进', pendingStarting: '投递中', acceptedLabel: '接受于', outcomeSessionAccepted: '会话处理',
      replyPreview: '我方回复',
      signatureLabel: '回复署名（AI 代发标识）', signatureText: '署名文本', signatureHint: '开启后，Todo 会话提示词会要求 GitLab 回复末尾添加 AI 署名。只影响之后派发的 Todo 提示词。',
      confirmMarkDone: '确认标记完成？', confirmReprocess: '确认重新处理？', confirmAcknowledge: '确认已处理？',
      issuesTitle: 'Issue', issuesEmpty: 'GitLab 上没有指派给你的开放 Issue。',
      issuesError: '无法加载 Issue 列表', issuesHint: 'GitLab 上指派给我的开放 Issue',
      issuesOrphans: '已关闭或取消指派', issueTag: 'Issue',
      leaderTitle: 'Issue Leader', leaderCreate: '创建 Leader', leaderOpen: '打开 Leader',
      leaderStart: '启动托管', leaderPause: '暂停全部', leaderModel: 'Leader 模型',
      leaderAutoEnroll: '新 Issue 会话默认托管', leaderAutoEnrollHint: '默认关闭，不会纳管既有会话。',
      leaderScope: '选入即允许 Leader 读取所选会话，并仅在原任务范围内发送指令；不授予人类审批或代答问答权限。',
      leaderStartHint: '启动对明确选入会话的托管，未选入会话不受影响。',
      leaderResumeHint: '请先在实际会话入口亲自处理原生审批或问答。恢复仅确认你的续办决策；存在未决原生输入或正在执行时 Host 会拒绝恢复。',
      leaderAutoEnrollConfirm: '仅对之后从 Issue 页创建的会话授予此访问权限；既有会话保持不变。',
      leaderConfirm: '确认授权', leaderEnrolled: '已托管', leaderEnroll: '交给 Leader 托管', leaderUnenroll: '解除托管',
      leaderPauseIssue: '暂停此 Issue', leaderResumeIssue: '恢复此 Issue', leaderManaged: '纳管会话',
      leaderManagedEmpty: '暂无纳管会话。可在下方明确选入已有 Issue 会话，不会自动选入。',
      leaderHuman: '需人类决策', leaderHumanEmpty: '暂无需人工接手事项。',
      leaderNativeHuman: '原生审批与问答只能由你在实际会话入口处理；Leader 不能审批或代答，其他 Issue 可继续。',
      leaderHumanOpen: '打开实际会话', leaderError: 'Leader 操作失败', leaderSnapshotError: '无法读取 Leader 状态',
      leaderInvalidResponse: '无法核验 Leader 响应；请先刷新状态再授予访问权限。',
      leaderRpcUnavailable: '已认证浏览器连接不可用。Leader 权限变更不会回退到 HTTP；请刷新页面或核查 Host。',
      leaderCreateUncertain: '已发送创建请求，但尚未确认会话 ID。请刷新状态或核查 Host，不要重复创建 Leader。',
      leaderRetrySetup: '重试设置（复用已知 Leader）', leaderRetrySetupHint: '只重试此已知 Leader 会话的设置，不创建新会话、不启动托管，也不授予任何 Issue 访问权限。',
      leaderNotCreated: '未创建 · 关闭', leaderReady: '就绪', leaderPaused: '已暂停', leaderUncertain: '不确定', leaderErrorPhase: '错误',
      leaderWatching: '观察中', leaderRunning: '执行中', leaderNeedsHuman: '需人工', leaderArchived: '已归档', leaderMissing: '不存在', leaderUnknown: '未知',
      leaderRefresh: '刷新 Leader 状态', leaderWorking: '正在更新 Leader…', leaderSaved: 'Leader 已更新',
      leaderStandby: '待命', leaderCold: '未加载', leaderNeverStartedPhase: '已创建 · 未启动', leaderDeliveryUncertain: '投递待核对',
      leaderNeverStartedHint: 'Leader 已创建，但尚未启动托管。点击“启动托管”之前，Leader 会话是空白的，DSH 会把它显示为“New Session”。这不是创建失败，请不要重复创建 Leader。',
      leaderPausedHint: '托管已暂停，纳管的 Issue 处于待命状态；重新启动托管后，Leader 会继续在其会话里汇报进度。',
      leaderMainWindow: 'Leader 会话是你的主窗口：托管运行时，它会在自己的对话里汇报每个 Issue 会话的进度。',
      leaderBudget: '推进次数', leaderResetBudget: '重置预算',
      leaderResetBudgetHint: '为该 Issue 重新发放推进预算和托管时限；已暂停的 Issue 仍需显式恢复。',
      leaderNoteDecisions: '决定', leaderNoteDeliverables: '产出',
      leaderProvenanceUi: '你选入', leaderProvenanceCreated: '自动纳管', leaderProvenanceLeader: 'Leader 开启',
      leaderAudit: 'Leader 会话操作', leaderAuditHint: 'Leader 创建、重命名、归档、换模型的会话，以及它转达的回复。仅供查看。',
      leaderAuditCreate: '创建会话', leaderAuditEnroll: '接管会话', leaderAuditRename: '重命名', leaderAuditArchive: '归档',
      leaderAuditModel: '更换模型', leaderAuditRelay: '转达你的回复', leaderAuditTaskCreate: '开启临时任务', leaderAuditTaskDismiss: '放弃不确定的临时任务',
      leaderTaskTag: '临时任务', leaderTasksUncertain: '创建结果不确定的临时任务', leaderTasksUncertainHint: 'Leader 尝试开启这些会话但结果未知。请在 DSH 会话列表核查，如有多余会话请自行归档，再在此放弃该记录。', leaderTaskDismiss: '放弃记录',
      leaderRelayHint: '也可以直接在 Leader 会话里回复，Leader 会把你的原话转给对应 Issue 会话；原生审批与问答仍需你在实际会话中处理。',
      leaderDeliveries: '未确认投递',
      leaderDeliveriesHint: 'Host 无法确认这些消息是否已送达。请打开目标会话核对后记录结果；无论选择哪项都不会自动重发。',
      leaderDelivered: '已送达', leaderNotDelivered: '未送达', leaderDeliveryOpen: '打开目标会话',
      leaderCreationUnresolved: '之前的一次创建没有确认会话 ID。请检查会话列表：如果存在“GitLab Issue Leader”会话，填入它的 ID 并认领；如果不存在，放弃该记录后重新创建。',
      leaderClaim: '认领此会话', leaderClaimPlaceholder: 'Leader 会话 ID', leaderAbandon: '确认不存在，放弃该记录',
      logsTitle: '日志', logsEmpty: '暂无运行时日志。',
      logsError: '无法加载运行时日志', logsClear: '清空日志', confirmClearLogs: '确认清空日志？',
      logsDropped: '条因超出内存上限被丢弃', logsFilterAll: '全部', logsFilterWarn: '警告及以上',
      logsHint: '只进内存、不落盘；环形缓冲上限', logsEntriesSuffix: '条',
      signaturePlaceholder: '—— 由 AI 助手代复',
      bridgeTimeout: '请求超时（90 秒），请重试。', bridgeNetwork: '网络错误：无法连接插件服务。',
      colon: '：',
    };

    // bridge 网络层错误文案：apply 注入 bind 后的 t 之前先用 en 兜底（面板渲染必然晚于 apply）。
    let bridgeText = (key) => en[key] ?? key;

    async function bridge(action, options = {}) {
      const method = options.method ?? (action === 'state' || action === 'models' || action === 'workspaces' || action === 'issues' || action === 'logs' ? 'GET' : 'POST');
      const headers = { Accept: 'application/json' };
      if (method === 'POST') headers['Content-Type'] = 'application/json';
      const query = method === 'GET' ? `?action=${encodeURIComponent(action)}` : '';
      let response;
      try {
        response = await fetch(`${BRIDGE_PATH}${query}`, {
          method,
          headers,
          body: method === 'POST' ? JSON.stringify({ action, ...(options.payload ?? {}) }) : undefined,
          // 与 cordis.patch.yml 的 requestTimeoutMs 对齐：poll 等长操作与其他操作统一 90 秒超时。
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
        });
      } catch (cause) {
        if (cause && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) throw new Error(bridgeText('bridgeTimeout'));
        throw new Error(bridgeText('bridgeNetwork'));
      }
      const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (!response.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${response.status}`);
      return data;
    }

    const getState = async () => (await bridge('state')).state;
    // 写操作必须显式覆盖 issues/logs 等只读 action 的默认 GET，否则刷新和清空只会读取缓存。
    const post = (action, payload, signal) => bridge(action, { method: 'POST', payload, signal });

    const LEADER_RPC_OPERATIONS = ['create', 'configure', 'start', 'pause', 'enroll', 'unenroll', 'pauseIssue', 'resumeIssue',
      'resetIssueBudget', 'resolveDelivery', 'resolveCreation', 'resolveTask'];
    /** Native ConnectionRpcResult, not RemoteResult or HTTP: Host authenticates the browser peer. */
    async function callLeader(ctx, operation, payload = {}, signal) {
      if (!LEADER_RPC_OPERATIONS.includes(operation)) throw new Error(bridgeText('leaderInvalidResponse'));
      if (typeof ctx.connection?.rpc?.call !== 'function') throw new Error(bridgeText('leaderRpcUnavailable'));
      if (signal?.aborted) throw new Error(bridgeText('bridgeTimeout'));
      const rpcSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000);
      const response = await ctx.connection.rpc.call('/gitlab-workstation-leader', operation, payload, rpcSignal);
      if (response?.ok !== true) throw new Error(response?.error?.message || bridgeText('leaderRpcUnavailable'));
      if (!response.value || typeof response.value !== 'object' || Array.isArray(response.value) || response.value.ok !== true) {
        throw new Error(bridgeText('leaderInvalidResponse'));
      }
      return response.value;
    }

    // Existence is established only by the Host's typed inspection, never catalog absence.
    async function inspectSessionEntry(request, sessionId, signal) {
      const data = await request('inspectSession', { sessionId }, signal);
      const result = data?.result;
      if (data?.ok !== true || result?.sessionId !== sessionId
        || !['active', 'archived', 'missing', 'unknown'].includes(result?.status)) {
        return { sessionId, status: 'unknown', reasonKey: 'sessionInvalidResponse' };
      }
      return result;
    }

    function clientSessionArchive(ctx, sessionId) {
      const value = ctx.workspaces?.list?.getSnapshot?.();
      if (value?.phase !== 'ready' || value.state === 'error' || (!Array.isArray(value.archivedSessionIds) || !value.archivedSessionIds.every((id) => typeof id === 'string'))) return null;
      return value.archivedSessionIds.includes(sessionId);
    }

    /** Keep a reference until synchronous main-view acquisition; ready alone may settle in error. */
    async function navigateSessionSafely({ ctx, request, sessionId, restore = false, signal, isCurrent = () => true }) {
      let reference;
      const current = () => !signal?.aborted && isCurrent();
      const cancelled = { sessionId, status: 'cancelled' };
      try {
        let result = await inspectSessionEntry(request, sessionId, signal);
        if (!current()) return cancelled;
        if (!['active', 'archived'].includes(result.status)) return result;
        if (result.status === 'archived' && !restore) return result;
        if (!ctx.sessions?.refresh || !ctx.sessions?.retain || !ctx.uiWorkspace?.openSession) {
          return { sessionId, status: 'unknown', reasonKey: 'sessionCapabilityMissing' };
        }
        const archive = clientSessionArchive(ctx, sessionId);
        if (archive === null) return { sessionId, status: 'unknown', reasonKey: 'sessionCatalogNotReady' };
        if (archive && !restore) return { sessionId, status: 'archived', reasonKey: 'sessionClientArchived' };
        if (restore) {
          if (!ctx.uiWorkspace.unarchiveSession) return { sessionId, status: 'unknown', reasonKey: 'sessionCapabilityMissing' };
          await ctx.uiWorkspace.unarchiveSession(sessionId);
          if (!current()) return cancelled;
          result = await inspectSessionEntry(request, sessionId, signal);
          if (!current()) return cancelled;
          if (result.status !== 'active') return result;
        }
        await ctx.sessions.refresh();
        if (!current()) return cancelled;
        reference = ctx.sessions.retain(sessionId, { source: 'controllerOperation', signal });
        const binding = await reference.ready;
        if (!current()) return cancelled;
        // A recovery acknowledgement is not proof of existence; loading may have raced deletion.
        result = await inspectSessionEntry(request, sessionId, signal);
        if (!current()) return cancelled;
        if (result.status !== 'active') return result;
        const loaded = binding.session.getSnapshot();
        if (loaded.openState !== 'open' || loaded.removed !== false) {
          return { sessionId, status: 'unknown', reasonKey: 'sessionLoadFailed', reason: loaded.openError?.message };
        }
        const latestArchive = clientSessionArchive(ctx, sessionId);
        if (latestArchive === null) return { sessionId, status: 'unknown', reasonKey: 'sessionCatalogNotReady' };
        if (latestArchive) return { sessionId, status: 'archived', reasonKey: 'sessionClientArchived' };
        if (!current()) return cancelled;
        ctx.uiWorkspace.openSession(sessionId);
        return { sessionId, status: 'opened' };
      } catch (cause) {
        return current() ? { sessionId, status: 'unknown', reason: cause?.message, reasonKey: 'sessionLoadFailed' } : cancelled;
      } finally {
        reference?.release();
      }
    }

    function readHandoffResult(data, t) {
      const result = data?.result;
      const knownId = typeof result?.sessionId === 'string' && result.sessionId.length > 0
        && result.sessionId.trim() === result.sessionId && !/[\u0000-\u001f]/u.test(result.sessionId);
      const handoff = knownId ? { ...result, handoffText: typeof result.handoffText === 'string' ? result.handoffText : '' } : null;
      const valid = data?.ok === true && result?.ok === true && knownId && typeof result.handoffText === 'string';
      return { handoff, state: data?.state, error: valid ? null : result?.error || t('sessionHandoffFailed') };
    }

    function handoffsForTask(result, taskId) {
      return taskId == null || !Array.isArray(result?.manualHandoffs) ? []
        : result.manualHandoffs.filter((entry) => entry && String(entry.taskId) === String(taskId));
    }

    function refreshedSessionHandoff(selected, handoffs) {
      if (selected) {
        const fresh = selected.requestId ? handoffs.find((entry) => entry.requestId === selected.requestId)
          : selected.sessionId ? handoffs.find((entry) => entry.sessionId === selected.sessionId) : null;
        if (fresh) return { ...fresh, sessionId: fresh.sessionId || selected.sessionId,
          handoffText: fresh.handoffText || selected.handoffText };
      }
      return selected || handoffs[handoffs.length - 1];
    }

    function canCreateSessionHandoff(entry) {
      if (!entry || entry.taskId == null || entry.busy || entry.result?.status !== 'missing'
        || entry.result.sessionId !== entry.sessionId) return false;
      if (entry.manualHandoffs?.some((item) => !item.sessionId && ['creating', 'creation-unknown'].includes(item.status))) return false;
      return !entry.handoff || Boolean(entry.error || entry.handoff.error) || ['prepared', 'created'].includes(entry.handoff.status);
    }

    // One operation per current entry. Closing/reopening invalidates callbacks and navigation.
    function createSessionEntryGuard() {
      let generation = 0;
      let controller = null;
      let busy = false;
      return {
        reset() { controller?.abort(); controller = null; busy = false; generation += 1; },
        async run(operation, complete) {
          if (busy) return false;
          busy = true;
          const captured = generation;
          controller = new AbortController();
          const signal = controller.signal;
          const isCurrent = () => captured === generation && !signal.aborted;
          try {
            const result = await operation({ signal, isCurrent });
            if (isCurrent()) complete(result);
            return isCurrent();
          } finally {
            if (captured === generation) { busy = false; controller = null; }
          }
        },
      };
    }

    function formatTime(value, fallback) {
      return value ? new Date(value).toLocaleString() : fallback;
    }

    function isMergeRequest(todo) {
      return String(todo.targetType ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'mergerequest'
        || /\/-\/merge_requests(?:\/|$)/i.test(todo.url ?? '');
    }

    /** 路由与 dispatch 共用可见性边界，但不接受“MR 直接完成”和规则跳过项。 */
    function canRouteTodo(todo) {
      if (todo.outcome === 'rule-skipped' || String(todo.action ?? '').toLowerCase() === 'assigned') return false;
      if (isMergeRequest(todo) && !todo.directMention) return false;
      return !todo.handled || todo.outcome !== 'merge-request-done';
    }

    /** 非直接提及的 MR 只能走独立的两击“标记完成”，不能从“处理”绕过确认。 */
    function canProcessTodo(todo) {
      return !(isMergeRequest(todo) && !todo.directMention)
        && (!todo.handled || todo.outcome !== 'merge-request-done');
    }

    function routedLabel(record, t) {
      if (record.routed !== true) return '';
      return record.routeMode === 'steer' ? t('routedSteer') : t('routedQueue');
    }

    function todoStatusLabel(todo, t) {
      if (todo.outcome === 'merge-request-done') return t('mrDone');
      if (todo.outcome === 'precheck-skipped') return t('precheckSkipped');
      if (todo.outcome === 'rule-skipped') return t('ruleSkipped');
      if (todo.executionStatus === 'starting') return t('sessionStarting');
      if (todo.executionStatus === 'running') return t('executionRunning');
      const closure = closureLabel(todo.closure, t);
      if (closure) return closure;
      if (todo.executionStatus === 'completed') return t('executionCompleted');
      if (todo.executionStatus === 'failed') return t('executionFailed');
      return todo.handled ? t('dispatched') : t('waiting');
    }

    /** “已处理”页的状态标签：覆盖跳过原因、启动中、执行态与闭环态。 */
    function handledStatusLabel(item, t) {
      if (item.pending === true || item.executionStatus === 'starting') return t('pendingStarting');
      if (item.outcome === 'merge-request-done') return t('mrDone');
      if (item.outcome === 'precheck-skipped') return t('precheckSkipped');
      if (item.outcome === 'rule-skipped') return t('ruleSkipped');
      if (item.executionStatus === 'running') return t('executionRunning');
      const closure = closureLabel(item.closure, t);
      if (closure) return closure;
      if (item.executionStatus === 'completed') return t('executionCompleted');
      if (item.executionStatus === 'failed') return t('executionFailed');
      return t('outcomeSessionAccepted');
    }

    /** 闭环状态标签；旧记录或尚未结算的记录没有闭环状态，返回空串。 */
    function closureLabel(closure, t) {
      if (closure === 'closed') return t('closureClosed');
      if (closure === 'follow-up') return t('closureFollowUp');
      if (closure === 'needs-human') return t('closureNeedsHuman');
      if (closure === 'verifying') return t('closureVerifying');
      return '';
    }

    /** 列表里的闭环补充信息：第几轮、结论说明、下次续办时间。 */
    function closureMeta(record, t) {
      return [
        record.round > 1 && `${t('roundLabel')} ${record.round}`,
        record.closureNote,
        record.closure === 'follow-up' && record.nextAttemptAt && `${t('nextAttempt')} ${formatTime(record.nextAttemptAt, '')}`,
      ].filter(Boolean);
    }

    /** 回复预览：展开显示本轮发到讨论串的我方回复正文（来自插件结算时的捕获快照）。 */
    function ReplyPreview({ reply, t }) {
      const [open, setOpen] = React.useState(false);
      if (!reply || (!reply.body && !reply.url)) return null;
      return h('div', { className: 'gta-reply' },
        h('button', {
          type: 'button', className: 'gta-reply-toggle',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
        }, `${t('replyPreview')} ${open ? '▲' : '▼'}`),
        open && h('div', { className: 'gta-reply-body' },
          reply.url && h('a', { className: 'gta-reply-link', href: reply.url, target: '_blank', rel: 'noreferrer' }, '#'),
          h('div', { className: 'gta-reply-text' }, reply.body || '—'),
        ),
      );
    }

    /**
     * 模型选项的 value 编码：JSON.stringify({provider, model})。
     * 必须与 sessionModel 设置的对象形状一一对应（onChange 直接 JSON.parse 回对象），
     * 不可用数组形式，否则解析结果缺少 provider/model 字段。
     */
    function sessionModelKey(selection) {
      if (!selection) return '';
      return JSON.stringify({
        provider: typeof selection.provider === 'string' ? selection.provider : '',
        model: typeof selection.model === 'string' ? selection.model : '',
      });
    }

    /** 精确 provider/model 的 Host 思考能力；未声明或元数据无效时不显示强度选择。 */
    function reasoningForSelection(catalog, selection) {
      if (typeof selection?.provider !== 'string' || typeof selection?.model !== 'string') return null;
      for (const group of Array.isArray(catalog?.groups) ? catalog.groups : []) {
        if ((group?.id ?? group?.provider) !== selection.provider || !Array.isArray(group?.models)) continue;
        const model = group.models.find((entry) => entry?.id === selection.model);
        const efforts = Array.isArray(model?.reasoning?.efforts)
          ? model.reasoning.efforts.filter((effort) => typeof effort?.id === 'string' && effort.id
            && typeof effort?.name === 'string' && effort.name)
          : [];
        if (efforts.length === 0) return null;
        const defaultEffort = efforts.some((effort) => effort.id === model.reasoning.defaultEffort)
          ? model.reasoning.defaultEffort
          : undefined;
        return { efforts, ...(defaultEffort === undefined ? {} : { defaultEffort }) };
      }
      return null;
    }

    /** 构造 Host selectModel 的完整 Issue 选择；空强度表示省略字段、跟随提供方默认。 */
    function withReasoningEffort(selection, reasoningEffort) {
      if (!selection) return null;
      return {
        provider: selection.provider,
        model: selection.model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      };
    }

    /** Issue 模型下拉变更：只有 exact provider/model 不变才保留原强度。 */
    function issueModelFromOption(raw, previous) {
      const selected = raw ? JSON.parse(raw) : null;
      const keepEffort = selected && previous
        && selected.provider === previous.provider && selected.model === previous.model
        ? previous.reasoningEffort ?? '' : '';
      return withReasoningEffort(selected, keepEffort);
    }

    /**
     * 设置字段级比较：原始值直接比对；sessionModel 等嵌套对象递归按字段比对，
     * 引用不同但等值不算变更；undefined 与 null 归一后视为相同。
     */
    function settingsValueEqual(next, prev) {
      const a = next === undefined ? null : next;
      const b = prev === undefined ? null : prev;
      if (a === b) return true;
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && settingsValueEqual(a[key], b[key]));
    }

    /** General 设置草稿的变更补丁；Issue Tab 的即时设置永远不由旧草稿回盖。 */
    function changedSettingsPatch(draft, current, baseline = current) {
      const patch = {};
      for (const key of Object.keys(draft ?? {})) {
        if (key === 'issueSessionCwd' || key === 'issueSessionModel') continue;
        if (!settingsValueEqual(draft[key], baseline?.[key])
          && !settingsValueEqual(draft[key], current?.[key])) patch[key] = draft[key];
      }
      return patch;
    }

    const WORKSTATION_TABS = [
      { id: 'inbox', label: 'inboxTitle', group: 'tasksGroup' },
      { id: 'todos', label: 'todoList', group: 'tasksGroup' },
      { id: 'issues', label: 'issuesTitle', group: 'tasksGroup' },
      { id: 'handled', label: 'handledTitle', group: 'tasksGroup' },
      { id: 'workspaces', label: 'workspacesTitle', group: 'environmentGroup' },
      { id: 'logs', label: 'logsTitle', group: 'environmentGroup' },
    ];

    /** 自动激活的水平 Tabs：只消费导航键，其余键交给原生按钮行为。 */
    function nextWorkstationTab(current, key) {
      const index = WORKSTATION_TABS.findIndex((tab) => tab.id === current);
      if (index < 0) return null;
      if (key === 'Home') return WORKSTATION_TABS[0].id;
      if (key === 'End') return WORKSTATION_TABS[WORKSTATION_TABS.length - 1].id;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
      const step = key === 'ArrowRight' ? 1 : -1;
      return WORKSTATION_TABS[(index + step + WORKSTATION_TABS.length) % WORKSTATION_TABS.length].id;
    }

    /** 仅过滤当前已加载数据；不改分页范围、不请求远端、不写入记录。 */
    function filterWorkstationItems(items, query) {
      const source = Array.isArray(items) ? items : [];
      const normalized = String(query ?? '').trim().toLowerCase();
      if (!normalized) return source;
      const terms = normalized.split(/\s+/);
      return source.filter((item) => {
        const text = [item.title, item.project, item.author, item.id, item.todoId, item.iid,
          item.sessionTitle, item.closure, item.closureNote, item.skipReason,
          ...(Array.isArray(item.labels) ? item.labels : [])].filter((value) => value != null).join(' ').toLowerCase();
        return terms.every((term) => text.includes(term));
      });
    }

    /** 与状态文案保持同一优先级，失败/需人工不能被 completed 的绿色覆盖。 */
    function recordStatusClass(record) {
      if (record.pending === true || record.executionStatus === 'starting' || record.executionStatus === 'running') return 'gta-tag-mention';
      if (['merge-request-done', 'precheck-skipped', 'rule-skipped'].includes(record.outcome)) return 'gta-tag-success';
      if (record.closure === 'needs-human') return 'gta-tag-attention';
      if (record.closure === 'follow-up' || record.closure === 'verifying') return 'gta-tag-attention';
      if (record.closure === 'closed') return 'gta-tag-success';
      if (record.executionStatus === 'failed') return 'gta-tag-error';
      if (record.executionStatus === 'completed') return 'gta-tag-success';
      return 'gta-tag-neutral';
    }

    function issueSettingsSummary(selection, cwd, t) {
      const model = selection?.model ? `${selection.provider}/${selection.model}` : t('defaultModelShort');
      const workspace = cwd ? String(cwd).split(/[\\/]+/).filter(Boolean).pop() || cwd : t('autoWorkspaceShort');
      return `${t('modelSummary')}${t('colon')}${model}${selection?.reasoningEffort ? ` · ${selection.reasoningEffort}` : ''} · ${t('workspaceSummary')}${t('colon')}${workspace}`;
    }

    /** Only finish the view that submitted the operation; closing a view never cancels its sent POST. */
    function finishCurrentViewOperation(operation, generation, currentGeneration, complete) {
      return operation.then((done) => {
        if (done && currentGeneration.current === generation) complete();
        return done;
      });
    }

    const LEADER_PHASE_LABELS = { 'not-created': 'leaderNotCreated', ready: 'leaderReady', paused: 'leaderPaused', error: 'leaderErrorPhase', uncertain: 'leaderUncertain' };
    const LEADER_STATUS_LABELS = { watching: 'leaderWatching', running: 'leaderRunning', 'needs-human': 'leaderNeedsHuman', paused: 'leaderPaused', archived: 'leaderArchived', missing: 'leaderMissing', unknown: 'leaderUnknown',
      standby: 'leaderStandby', cold: 'leaderCold' };
    const LEADER_RUN_STATES = ['error', 'creation-uncertain', 'not-created', 'setup-incomplete', 'delivery-uncertain', 'running', 'paused', 'never-started'];

    const LEADER_PROVENANCE_LABELS = { ui: 'leaderProvenanceUi', created: 'leaderProvenanceCreated', leader: 'leaderProvenanceLeader' };
    const LEADER_AUDIT_LABELS = { 'session-create': 'leaderAuditCreate', 'session-enroll': 'leaderAuditEnroll', 'session-rename': 'leaderAuditRename',
      'session-archive': 'leaderAuditArchive', 'session-model': 'leaderAuditModel', 'relay-reply': 'leaderAuditRelay',
      'task-create': 'leaderAuditTaskCreate', 'task-dismiss': 'leaderAuditTaskDismiss' };

    /** Leader's structured Issue notes as short display lines (untrusted text, rendered as plain text). */
    function leaderNoteLines(notes, t) {
      if (!notes) return [];
      const colonText = t('colon') || ': ';
      // stage / next / waitingOn are already folded into the Host-written summary line.
      return [['leaderNoteDecisions', notes.decisions.join('；')], ['leaderNoteDeliverables', notes.deliverables.join('；')]]
        .filter(([, value]) => value).map(([key, value]) => `${t(key)}${colonText}${value}`);
    }

    /** Audit detail is a Host-written JSON string; show only the human-meaningful field. */
    function leaderAuditDetail(detail) {
      try {
        const value = JSON.parse(detail || '{}');
        if (typeof value.title === 'string') return value.title;
        if (typeof value.reason === 'string') return value.reason;
        if (typeof value.provider === 'string' && typeof value.model === 'string') return `${value.provider}/${value.model}`;
        return '';
      } catch { return ''; }
    }

    function validLeaderSessionId(value) {
      return typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
    }

    /** Read-only projection decoding: malformed status never becomes a grantable default. */
    function normalizeLeaderProjection(value) {
      if (!value || !Object.hasOwn(LEADER_PHASE_LABELS, value.phase) || typeof value.enabled !== 'boolean'
        || (value.sessionId !== null && !validLeaderSessionId(value.sessionId))
        || !value.settings || typeof value.settings.autoEnrollNew !== 'boolean' || !Array.isArray(value.items)) return null;
      const text = (item) => typeof item === 'string' ? item : '';
      const count = (item) => Number.isSafeInteger(item) && item >= 0 ? item : null;
      const model = value.settings.model;
      if (model !== null && (!model || !text(model.provider) || !text(model.model)
        || (model.reasoningEffort !== undefined && !text(model.reasoningEffort)))) return null;
      return {
        enabled: value.enabled, sessionId: validLeaderSessionId(value.sessionId) ? value.sessionId : null, phase: value.phase,
        // Hosts before the hardening release omit these; '' / null keep the old behaviour.
        runState: LEADER_RUN_STATES.includes(value.runState) ? value.runState : '',
        creation: value.creation && typeof value.creation === 'object'
          ? { status: text(value.creation.status), createdAt: count(value.creation.createdAt), agentPreset: text(value.creation.agentPreset) } : null,
        run: { expiresAt: count(value.run?.expiresAt), wakeups: count(value.run?.wakeups), maxWakeups: count(value.run?.maxWakeups),
          lastStartedAt: count(value.run?.lastStartedAt) },
        deliveries: (Array.isArray(value.deliveries) ? value.deliveries : [])
          .filter((entry) => entry && text(entry.requestId) && ['advance', 'notify', 'relay'].includes(entry.kind))
          .map((entry) => ({ requestId: entry.requestId, kind: entry.kind, taskId: text(entry.taskId),
            sessionId: validLeaderSessionId(entry.sessionId) ? entry.sessionId : null, status: text(entry.status),
            error: text(entry.error), createdAt: count(entry.createdAt) })),
        settings: { model: model && text(model.provider) && text(model.model)
          ? withReasoningEffort({ provider: model.provider, model: model.model }, text(model.reasoningEffort)) : null,
          autoEnrollNew: value.settings.autoEnrollNew },
        items: value.items.filter((item) => item && item.taskId != null).map((item) => ({
          taskId: String(item.taskId), sessionId: validLeaderSessionId(item.sessionId) ? item.sessionId : null,
          title: text(item.title), url: text(item.url),
          status: Object.hasOwn(LEADER_STATUS_LABELS, item.status) ? item.status : 'unknown',
          summary: text(item.summary), error: text(item.error),
          paused: item.paused === true, actions: count(item.actions), maxActions: count(item.maxActions), expiresAt: count(item.expiresAt),
          alerts: (Array.isArray(item.alerts) ? item.alerts : []).filter((alert) => alert && text(alert.question)).map((alert) => ({
            id: text(alert.id), question: alert.question, status: text(alert.status), createdAt: alert.createdAt,
          })),
          provenance: ['ui', 'created', 'leader'].includes(item.provenance) ? item.provenance : '',
          kind: item.kind === 'task' ? 'task' : 'issue',
          notes: item.notes && typeof item.notes === 'object' ? { stage: text(item.notes.stage), next: text(item.notes.next), waitingOn: text(item.notes.waitingOn),
            decisions: (Array.isArray(item.notes.decisions) ? item.notes.decisions : []).filter((entry) => typeof entry === 'string'),
            deliverables: (Array.isArray(item.notes.deliverables) ? item.notes.deliverables : []).filter((entry) => typeof entry === 'string'),
            updatedAt: count(item.notes.updatedAt) } : null,
        })),
        // Display-only Leader session-management trail (create/rename/archive/model/relay), newest last.
        audit: (Array.isArray(value.audit) ? value.audit : []).filter((entry) => entry && text(entry.action)).map((entry) => ({
          action: entry.action, taskId: text(entry.taskId), sessionId: text(entry.sessionId), at: count(entry.at), detail: text(entry.detail),
        })),
        // Leader-dispatched ad-hoc task sessions (no GitLab Issue); only uncertain ones need the human.
        tasks: (Array.isArray(value.tasks) ? value.tasks : []).filter((entry) => entry && text(entry.taskId)).map((entry) => ({
          taskId: entry.taskId, sessionId: validLeaderSessionId(entry.sessionId) ? entry.sessionId : null, title: text(entry.title),
          status: text(entry.status), createdAt: count(entry.createdAt), error: text(entry.error),
        })),
        events: Array.isArray(value.events) ? value.events : [], error: text(value.error),
      };
    }

    /** projection wins over snapshot result; partial mutations retain an independently known ID. */
    function readLeaderResponse(data, operation, previousSessionId, t) {
      const projection = normalizeLeaderProjection(data?.projection) || normalizeLeaderProjection(data?.result);
      const sessionId = projection?.sessionId || (validLeaderSessionId(data?.result?.sessionId) ? data.result.sessionId : null)
        || (validLeaderSessionId(previousSessionId) ? previousSessionId : null);
      const success = data?.ok === true && Boolean(projection)
        && (operation === 'snapshot' ? data.result?.ok !== false : data.result?.ok === true);
      // Only a successful serialized Host snapshot can release an attempted create.
      // Unknown, failed or partial reads must retain the latch and any known ID.
      // A successful serialized abandon of the uncertain record is equally authoritative.
      const creationAbsent = ['snapshot', 'resolveCreation'].includes(operation) && success && !projection.error
        && projection.phase === 'not-created' && !projection.enabled && !sessionId;
      return { projection, sessionId, state: data?.state, creationAbsent,
        error: !success ? data?.result?.error || projection?.error || t('leaderInvalidResponse') : projection.error || '' };
    }

    function leaderItemForSession(projection, taskId, sessionId) {
      return projection?.items.find((item) => String(item.taskId) === String(taskId) && item.sessionId === sessionId) || null;
    }

    function canGrantLeaderAccess(projection) {
      return Boolean(projection?.sessionId && ['ready', 'paused'].includes(projection.phase));
    }

    function canCreateLeader(projection, knownSessionId, creationAttempted) {
      return projection?.phase === 'not-created' && !projection.enabled && !projection.sessionId && !knownSessionId && !creationAttempted;
    }

    function canRetryLeaderSetup(projection, knownSessionId) {
      return Boolean(projection && !projection.enabled && validLeaderSessionId(knownSessionId)
        && projection.sessionId === knownSessionId
        && (['error', 'uncertain'].includes(projection.phase) || (projection.phase === 'paused' && projection.error)));
    }

    function leaderHumanItems(projection) {
      return (projection?.items || []).filter((item) => item.status === 'needs-human'
        || item.alerts.some((alert) => alert.status === 'pending'));
    }

    function PanelIcon({ size = 20 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        h('path', { d: 'M3 8h18M8 8v12M11 11h6M11 14h6M11 17h4' }),
      );
    }

    function Button(props) {
      return h('button', {
        type: 'button',
        className: ['gta-button', props.primary && 'gta-primary', props.className].filter(Boolean).join(' '),
        disabled: props.disabled,
        onClick: props.onClick,
        title: props.title,
        'aria-pressed': props.pressed,
        'aria-label': props.label,
        'aria-expanded': props.expanded,
        'aria-controls': props.controls,
      }, props.children);
    }

    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error, info) {
        console.error('[gitlab-todo-agent] panel render failed', error, info);
      }
      render() {
        if (!this.state.error) return this.props.children;
        const t = this.props.t;
        return h('div', { className: 'gta-root' },
          h('style', { children: CSS }),
          h('div', { className: 'gta-fatal', role: 'alert' },
            h('h1', null, t('renderError')),
            h('p', null, this.state.error.message ?? String(this.state.error)),
            h(Button, { onClick: () => this.setState({ error: null }) }, t('retry')),
          ),
        );
      }
    }

    function TodoPanel({ ctx, t }) {
      const [snapshot, setSnapshot] = React.useState(null);
      // 按 key 隔离的请求互斥：state 驱动各按钮自己的禁用态，ref 保证同 key 重复触发被同步拒绝。
      const [busyKeys, setBusyKeys] = React.useState([]);
      const busyKeysRef = React.useRef(new Set());
      const busySet = new Set(busyKeys);
      const [error, setError] = React.useState(null);
      // 轮询类错误单独存放：轮询成功即自动清除；操作类错误仍由下一次主动操作清除。
      const [pollError, setPollError] = React.useState(null);
      const [draft, setDraft] = React.useState(null);
      const draftBaseline = React.useRef(null);
      const draftGeneration = React.useRef(0);
      const [activeTab, setActiveTab] = React.useState('issues');
      const tabRefs = React.useRef(new Map());
      const [listSearches, setListSearches] = React.useState({});
      const [settingsFeedback, setSettingsFeedback] = React.useState('');
      const activateTabByKey = (event, id) => {
        const next = nextWorkstationTab(id, event.key);
        if (!next) return;
        event.preventDefault();
        setActiveTab(next);
        tabRefs.current.get(next)?.focus();
      };
      const [modelCatalog, setModelCatalog] = React.useState(null);
      const [modelCatalogError, setModelCatalogError] = React.useState(null);
      const [workspaceData, setWorkspaceData] = React.useState(null);
      const [workspaceError, setWorkspaceError] = React.useState(null);
      const [routeTodo, setRouteTodo] = React.useState(null);
      const [routeData, setRouteData] = React.useState(null);
      const [routeLoading, setRouteLoading] = React.useState(false);
      const [routeError, setRouteError] = React.useState(null);
      const [routeSearch, setRouteSearch] = React.useState('');
      const [routeSelection, setRouteSelection] = React.useState('');
      const routeRequest = React.useRef(0);
      const routeGeneration = React.useRef(0);
      const routeDialogRef = React.useRef(null);
      const routeTriggerRef = React.useRef(null);
      const [sessionEntry, setSessionEntry] = React.useState(null);
      const sessionEntryRef = React.useRef(null);
      const sessionDialogRef = React.useRef(null);
      const sessionTriggerRef = React.useRef(null);
      const sessionGuard = React.useRef(null);
      if (!sessionGuard.current) sessionGuard.current = createSessionEntryGuard();
      const handoffRequests = React.useRef(new Map());
      const updateSessionEntry = (value) => { sessionEntryRef.current = value; setSessionEntry(value); };
      const closeSessionEntry = () => { sessionGuard.current.reset(); updateSessionEntry(null); };
      React.useEffect(() => () => { sessionGuard.current.reset(); }, []);
      React.useEffect(() => {
        if (!sessionEntry) return undefined;
        const trigger = sessionTriggerRef.current;
        const dialog = sessionDialogRef.current;
        dialog?.querySelector('button:not(:disabled)')?.focus();
        const onKeyDown = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); closeSessionEntry(); return; }
          if (event.key !== 'Tab' || !dialog) return;
          const controls = Array.from(dialog.querySelectorAll('button:not(:disabled), a[href], textarea:not(:disabled)'));
          const first = controls[0]; const last = controls[controls.length - 1];
          const focused = dialog.ownerDocument.activeElement;
          if (!first) { event.preventDefault(); dialog.focus(); }
          else if (event.shiftKey && (focused === first || !dialog.contains(focused))) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (focused === last || !dialog.contains(focused))) { event.preventDefault(); first.focus(); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => { window.removeEventListener('keydown', onKeyDown); if (trigger?.isConnected) trigger.focus(); };
      }, [Boolean(sessionEntry)]);

      React.useEffect(() => {
        let disposed = false;
        bridge('models').then((data) => {
          if (!disposed) setModelCatalog(data.catalog);
        }).catch((cause) => {
          if (!disposed) setModelCatalogError(cause.message);
        });
        return () => { disposed = true; };
      }, []);

      // 工作区列表：挂载时先拉一次；打开相关 Tab 时再按 10s 间隔刷新。
      React.useEffect(() => {
        let disposed = false;
        bridge('workspaces').then((data) => {
          if (!disposed) setWorkspaceData(Array.isArray(data.workspaces) ? data.workspaces : []);
        }).catch((cause) => {
          if (!disposed) setWorkspaceError(cause.message);
        });
        return () => { disposed = true; };
      }, []);

      // 已处理（分页，v2.29 起含会话入口/归档）：规则跳过、预检跳过、会话派发与
      // 投递中记录全部在列；打开期间每 10s 静默刷新已加载范围（刷新不重置已翻页）。
      const [handledData, setHandledData] = React.useState(null);
      const [handledError, setHandledError] = React.useState(null);
      const [handledBusy, setHandledBusy] = React.useState(false);
      const handledInFlight = React.useRef(false);
      const handledDataRef = React.useRef(null);
      const applyHandledPage = (page, append) => {
        const previous = handledDataRef.current;
        const items = append && previous ? [...previous.items, ...page.items] : page.items;
        const next = { ...page, items };
        handledDataRef.current = next;
        setHandledData(next);
      };
      const fetchHandled = async (append) => {
        if (handledInFlight.current) return;
        handledInFlight.current = true;
        setHandledBusy(true);
        try {
          const loaded = handledDataRef.current?.items?.length ?? 0;
          const request = append
            ? { offset: loaded, limit: 50 }
            : { offset: 0, limit: Math.max(50, loaded) };
          applyHandledPage(await post('handled', request), append);
          setHandledError(null);
        } catch (cause) {
          setHandledError(cause.message);
        } finally {
          handledInFlight.current = false;
          setHandledBusy(false);
        }
      };
      const refreshHandled = () => fetchHandled(false);
      React.useEffect(() => {
        if (activeTab !== 'handled') return undefined;
        void refreshHandled();
        const timer = setInterval(() => void refreshHandled(), 10000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [activeTab]);

      // 收件箱（需人工待办）：打开期间每 10s 刷新；确认动作后立即重拉。
      const [inboxData, setInboxData] = React.useState(null);
      const [inboxError, setInboxError] = React.useState(null);
      const inboxInFlight = React.useRef(false);
      const fetchInbox = async () => {
        if (inboxInFlight.current) return;
        inboxInFlight.current = true;
        try {
          const data = await post('inbox', {});
          setInboxData(Array.isArray(data.items) ? data.items : []);
          setInboxError(null);
        } catch (cause) {
          setInboxError(cause.message);
        } finally {
          inboxInFlight.current = false;
        }
      };
      React.useEffect(() => {
        if (activeTab !== 'inbox') return undefined;
        void fetchInbox();
        const timer = setInterval(() => void fetchInbox(), 10000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [activeTab]);

      // Issue 面板：指派给我的开放 Issue + 处理记录投影。打开 Tab 时重拉一次 GitLab，
      // 之后跟随快照轮询缓存投影（GET issues 不触发远端请求）；「刷新」按钮走显式 refresh。
      const [issuesData, setIssuesData] = React.useState(null);
      const [issuesError, setIssuesError] = React.useState(null);
      const [issuesBusy, setIssuesBusy] = React.useState(false);
      const issuesInFlight = React.useRef(false);
      const fetchIssues = async (refresh = false) => {
        if (issuesInFlight.current) return;
        issuesInFlight.current = true;
        if (refresh) setIssuesBusy(true);
        try {
          const data = refresh ? await post('issues', { refresh: true }) : await bridge('issues');
          setIssuesData({
            items: Array.isArray(data.items) ? data.items : [],
            orphans: Array.isArray(data.orphans) ? data.orphans : [],
          });
          setIssuesError(null);
        } catch (cause) {
          setIssuesError(cause.message);
        } finally {
          issuesInFlight.current = false;
          if (refresh) setIssuesBusy(false);
        }
      };
      React.useEffect(() => {
        if (activeTab !== 'issues') return undefined;
        void fetchIssues(true);
        const timer = setInterval(() => void fetchIssues(false), 5000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [activeTab]);

      // Leader has its own read-only, low-frequency polling lane. Mutations invalidate any old read.
      const [leaderView, setLeaderView] = React.useState({ projection: null, sessionId: null, creationAttempted: false, error: '', pollError: '' });
      const leaderViewRef = React.useRef(leaderView);
      const [leaderOpen, setLeaderOpen] = React.useState(false);
      const [leaderBusy, setLeaderBusy] = React.useState('');
      const [leaderFresh, setLeaderFresh] = React.useState(false);
      const [leaderFeedback, setLeaderFeedback] = React.useState('');
      const [leaderConfirm, setLeaderConfirm] = React.useState(null);
      const [leaderClaimId, setLeaderClaimId] = React.useState('');
      const leaderActiveRef = React.useRef(false);
      const leaderActionRef = React.useRef('');
      const leaderGuard = React.useRef(null);
      if (!leaderGuard.current) leaderGuard.current = createSessionEntryGuard();
      const updateLeaderView = (value) => { leaderViewRef.current = value; setLeaderView(value); };
      const applyLeaderResponse = (data, operation) => {
        const previous = leaderViewRef.current;
        const result = readLeaderResponse(data, operation, previous.sessionId, t);
        updateLeaderView({ ...previous, projection: result.projection || previous.projection, sessionId: result.sessionId,
          error: operation === 'snapshot' ? previous.error : result.error,
          creationAttempted: result.creationAbsent ? false : previous.creationAttempted,
          pollError: operation === 'snapshot' ? result.error : '' });
        setLeaderFresh(Boolean(result.projection));
        if (result.state) setSnapshot(result.state);
        if (result.error) setLeaderOpen(true);
        else if (operation !== 'snapshot') setLeaderFeedback(t('leaderSaved'));
      };
      const fetchLeaderSnapshot = () => {
        if (!leaderActiveRef.current || leaderActionRef.current) return Promise.resolve(false);
        return leaderGuard.current.run(async ({ signal }) => {
          try { return { data: await post('leader', { operation: 'snapshot' }, signal) }; }
          catch (cause) { return { error: cause.message }; }
        }, (result) => {
          if (result.data) applyLeaderResponse(result.data, 'snapshot');
          else {
            updateLeaderView({ ...leaderViewRef.current, pollError: result.error });
            setLeaderFresh(false); setLeaderOpen(true);
          }
        });
      };
      React.useEffect(() => {
        if (activeTab !== 'issues') return undefined;
        leaderActiveRef.current = true;
        leaderGuard.current.reset(); leaderActionRef.current = '';
        setLeaderBusy(''); setLeaderFresh(false); setLeaderConfirm(null);
        void fetchLeaderSnapshot();
        const timer = setInterval(() => void fetchLeaderSnapshot(), 15000);
        return () => {
          clearInterval(timer); leaderActiveRef.current = false;
          leaderGuard.current.reset(); leaderActionRef.current = '';
        };
        // The guard owns generation + AbortSignal; leaving never replays a sent mutation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [activeTab]);
      const runLeader = (operation, payload = {}) => {
        if (!leaderActiveRef.current || leaderActionRef.current) return Promise.resolve(false);
        if (typeof ctx.connection?.rpc?.call !== 'function') {
          updateLeaderView({ ...leaderViewRef.current, error: t('leaderRpcUnavailable') }); setLeaderOpen(true);
          return Promise.resolve(false);
        }
        // An attempted create stays latched across tab changes, including lost/aborted responses.
        if (operation === 'create' && (!leaderFresh
          || (!canCreateLeader(leaderViewRef.current.projection, leaderViewRef.current.sessionId, leaderViewRef.current.creationAttempted)
            && !canRetryLeaderSetup(leaderViewRef.current.projection, leaderViewRef.current.sessionId)))) return Promise.resolve(false);
        if (['start', 'enroll', 'resumeIssue'].includes(operation)
          && (!leaderFresh || !canGrantLeaderAccess(leaderViewRef.current.projection))) return Promise.resolve(false);
        // Recovery operations are human assertions about the latest Host state; never act on a stale view.
        if (['resetIssueBudget', 'resolveDelivery', 'resolveCreation', 'resolveTask'].includes(operation) && !leaderFresh) return Promise.resolve(false);
        if (operation === 'configure') {
          if (!leaderFresh || !leaderViewRef.current.projection || ['error', 'uncertain'].includes(leaderViewRef.current.projection.phase)) return Promise.resolve(false);
          payload = { settings: { ...leaderViewRef.current.projection.settings, ...payload.settings } };
        }
        leaderGuard.current.reset(); leaderActionRef.current = operation;
        setLeaderBusy(operation); setLeaderFresh(false); setLeaderFeedback(''); setLeaderConfirm(null); setLeaderOpen(true);
        updateLeaderView({ ...leaderViewRef.current, error: '', pollError: '',
          creationAttempted: leaderViewRef.current.creationAttempted || operation === 'create' });
        return leaderGuard.current.run(async ({ signal }) => {
          try { return { data: await callLeader(ctx, operation, payload, signal) }; }
          catch (cause) { return { error: cause.message }; }
        }, (result) => {
          leaderActionRef.current = ''; setLeaderBusy('');
          if (result.data) applyLeaderResponse(result.data, operation);
          else { updateLeaderView({ ...leaderViewRef.current, error: result.error }); setLeaderFresh(false); }
        });
      };
      const confirmLeaderAccess = (operation, payload = {}, title = '') => {
        if (leaderActionRef.current) return;
        setLeaderOpen(true); setLeaderFeedback(''); setLeaderConfirm({ operation, payload, title });
      };

      // Log Tab：运行时内存日志（只进内存环形缓冲，不落盘）。打开期间每 3s 轮询快照。
      const [logData, setLogData] = React.useState(null);
      const [logError, setLogError] = React.useState(null);
      const [logFilter, setLogFilter] = React.useState('all');
      const logsInFlight = React.useRef(false);
      const fetchLogs = async () => {
        if (logsInFlight.current) return;
        logsInFlight.current = true;
        try {
          const data = await bridge('logs');
          setLogData({
            items: Array.isArray(data.items) ? data.items : [],
            dropped: Number.isFinite(data.dropped) ? data.dropped : 0,
            total: Number.isFinite(data.total) ? data.total : 0,
            capacity: data.capacity ?? null,
          });
          setLogError(null);
        } catch (cause) {
          setLogError(cause.message);
        } finally {
          logsInFlight.current = false;
        }
      };
      React.useEffect(() => {
        if (activeTab !== 'logs') return undefined;
        void fetchLogs();
        const timer = setInterval(() => void fetchLogs(), 3000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [activeTab]);

      const [digestOpen, setDigestOpen] = React.useState(false);

      const needWorkspacePolling = activeTab === 'workspaces' || activeTab === 'issues' || Boolean(draft);
      React.useEffect(() => {
        if (!needWorkspacePolling) return undefined;
        let disposed = false;
        const load = async () => {
          try {
            const data = await bridge('workspaces');
            if (!disposed) {
              setWorkspaceData(Array.isArray(data.workspaces) ? data.workspaces : []);
              setWorkspaceError(null);
            }
          } catch (cause) {
            if (!disposed) setWorkspaceError(cause.message);
          }
        };
        void load();
        const timer = setInterval(load, 10000);
        return () => { disposed = true; clearInterval(timer); };
      }, [needWorkspacePolling]);

      React.useEffect(() => {
        let disposed = false;
        const load = async () => {
          try {
            const next = await getState();
            if (!disposed) {
              setSnapshot(next);
              setPollError(null);
            }
          } catch (cause) {
            if (!disposed) setPollError(cause.message);
          }
        };
        void load();
        const timer = setInterval(load, 3000);
        return () => {
          disposed = true;
          clearInterval(timer);
        };
      }, []);

      const perform = async (key, operation) => {
        if (busyKeysRef.current.has(key)) return false;
        busyKeysRef.current.add(key);
        setBusyKeys([...busyKeysRef.current]);
        setError(null);
        try {
          const data = await operation();
          if (data.state) setSnapshot(data.state);
          if (data.result && data.result.ok === false) throw new Error(data.result.error);
          return true;
        } catch (cause) {
          setError(cause.message);
          return false;
        } finally {
          busyKeysRef.current.delete(key);
          setBusyKeys([...busyKeysRef.current]);
        }
      };

      // 双段确认：不可逆操作第一击只把按钮切到确认文案，3 秒内再次点击才真正执行，超时自动还原。
      // Map<key, timestamp>：每个按钮独立状态；时间戳兜底，即便还原定时器被节流也不放行过期确认。
      const [confirmKeys, setConfirmKeys] = React.useState(new Map());
      const confirmTimers = React.useRef(new Map());
      const clearConfirm = (key) => {
        const timer = confirmTimers.current.get(key);
        if (timer) clearTimeout(timer);
        confirmTimers.current.delete(key);
        setConfirmKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      };
      const guardedRun = (confirmKey, action) => () => {
        const pendingAt = confirmKeys.get(confirmKey);
        if (pendingAt && Date.now() - pendingAt <= 3000) {
          clearConfirm(confirmKey);
          void action();
          return;
        }
        setConfirmKeys((prev) => {
          const next = new Map(prev);
          next.set(confirmKey, Date.now());
          return next;
        });
        clearTimeout(confirmTimers.current.get(confirmKey));
        confirmTimers.current.set(confirmKey, setTimeout(() => clearConfirm(confirmKey), 3000));
      };
      React.useEffect(() => () => {
        draftGeneration.current += 1;
        routeGeneration.current += 1;
        confirmTimers.current.forEach((timer) => clearTimeout(timer));
        confirmTimers.current.clear();
      }, []);

      // 模板拼接用冒号：zh 全角“：”，en 半角“: ”，随当前 locale 取词典。
      const colon = () => t('colon');

      const closeRouteTargets = () => {
        routeGeneration.current += 1;
        routeRequest.current += 1;
        setRouteTodo(null);
        setRouteData(null);
        setRouteLoading(false);
        setRouteError(null);
        setRouteSearch('');
        setRouteSelection('');
      };
      const loadRouteTargets = async (todoId) => {
        const request = ++routeRequest.current;
        setRouteLoading(true);
        setRouteError(null);
        setRouteSelection('');
        try {
          const data = await post('routeTargets', { todoId });
          if (request !== routeRequest.current) return;
          setRouteData({ ...data, items: Array.isArray(data.items) ? data.items : [] });
        } catch (cause) {
          if (request !== routeRequest.current) return;
          setRouteError(cause.message);
        } finally {
          if (request === routeRequest.current) setRouteLoading(false);
        }
      };
      const openRouteTargets = (todo, trigger) => {
        routeGeneration.current += 1;
        routeTriggerRef.current = trigger ?? null;
        setRouteTodo(todo);
        setRouteData(null);
        setRouteSearch('');
        setRouteSelection('');
        setRouteError(null);
        void loadRouteTargets(todo.id);
      };
      React.useEffect(() => {
        if (!routeTodo) return undefined;
        const trigger = routeTriggerRef.current;
        const dialog = routeDialogRef.current;
        dialog?.querySelector('button:not(:disabled)')?.focus();
        const onKeyDown = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); closeRouteTargets(); return; }
          if (event.key !== 'Tab' || !dialog) return;
          const controls = Array.from(dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)'));
          // 原生 radio 一组只有选中项（未选时第一项）参与 Tab，方向键由浏览器负责。
          const radios = controls.filter((node) => node.type === 'radio');
          const radioTabStop = radios.find((node) => node.checked) ?? radios[0];
          const stops = controls.filter((node) => node.type !== 'radio' || node === radioTabStop);
          const first = stops[0];
          const last = stops[stops.length - 1];
          const focused = dialog.ownerDocument.activeElement;
          if (!first) { event.preventDefault(); dialog.focus(); }
          else if (event.shiftKey && (focused === first || !dialog.contains(focused))) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (focused === last || !dialog.contains(focused))) { event.preventDefault(); first.focus(); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => { window.removeEventListener('keydown', onKeyDown); trigger?.focus(); };
        // 关闭函数只需跟随当前弹层生命周期，无需随每次渲染重建监听。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [routeTodo]);
      const routeToSession = (target) => {
        if (!routeTodo || !target || target.accepting === false || busySet.has(`route:${routeTodo.id}`)) return;
        const todoId = routeTodo.id;
        const generation = routeGeneration.current;
        setRouteError(null);
        void finishCurrentViewOperation(perform(`route:${todoId}`, async () => {
          try {
            const data = await post('route', { id: todoId, sessionId: target.sessionId });
            if (routeGeneration.current === generation && data.result?.ok === false) setRouteError(data.result.error || t('routeFailed'));
            return data;
          } catch (cause) {
            if (routeGeneration.current === generation) setRouteError(cause.message);
            throw cause;
          }
        }), generation, routeGeneration, closeRouteTargets).then((done) => {
          if (!done) return;
          // v2.29 遗留笔误：refreshSessions 已不存在；路由成功的记录进已处理投影，
          // Issue 条目再顺带刷新 Issue 面板。
          void refreshHandled();
          if (routeTodo?.source === 'issue') void fetchIssues(false);
        });
      };

      const updateSettings = (settings) => {
        setSettingsFeedback('');
        return perform('settings', () => post('updateSettings', { settings }))
          .then((saved) => { if (saved) setSettingsFeedback(t('settingsSaved')); return saved; });
      };
      // 对比打开时 baseline，仅提交用户在草稿中改动且当前值尚未生效的字段。
      // Todo 快捷启停/模型和 Issue 即时设置不会被未编辑的旧草稿回盖（Host 仍浅合并 patch）。
      const saveGeneralSettings = () => {
        const patch = changedSettingsPatch(draft, snapshot?.settings ?? null, draftBaseline.current);
        return Object.keys(patch).length > 0 ? updateSettings(patch) : Promise.resolve(true);
      };
      const closeGeneralSettings = () => {
        draftGeneration.current += 1;
        setDraft(null);
      };
      const saveAndCloseGeneralSettings = () => {
        const generation = draftGeneration.current;
        return finishCurrentViewOperation(saveGeneralSettings(), generation, draftGeneration, closeGeneralSettings);
      };
      const runSessionAccess = (restore = false, sessionId = sessionEntryRef.current?.sessionId) => {
        const entry = sessionEntryRef.current;
        if (!entry || entry.busy) return;
        updateSessionEntry({ ...entry, busy: true, error: null, confirmCreate: false });
        void sessionGuard.current.run(({ signal, isCurrent }) => navigateSessionSafely({
          ctx, request: post, sessionId, restore, signal, isCurrent,
        }), (result) => {
          if (result.status === 'opened') { closeSessionEntry(); return; }
          const latest = sessionEntryRef.current;
          const handoffs = handoffsForTask(result, latest.taskId);
          updateSessionEntry({ ...latest, busy: false, result, manualHandoffs: handoffs.length ? handoffs : latest.manualHandoffs,
            handoff: refreshedSessionHandoff(latest.handoff, handoffs) });
        });
      };
      const openSession = (entry, trigger) => {
        if (sessionEntryRef.current?.busy && sessionEntryRef.current.sessionId === entry.sessionId) return;
        sessionGuard.current.reset();
        sessionTriggerRef.current = trigger ?? null;
        updateSessionEntry({ ...entry, busy: false, result: null, error: null, confirmCreate: false, copied: false });
        runSessionAccess();
      };
      // All Leader entry points reuse the same typed inspection/retain/archive guard.
      const safeSessionOpener = openSession;
      const openLeader = (trigger) => {
        const sessionId = leaderViewRef.current.sessionId;
        if (validLeaderSessionId(sessionId)) safeSessionOpener({ sessionId, title: 'Issue Leader' }, trigger);
      };
      const openManagedIssue = (item, trigger) => {
        if (validLeaderSessionId(item.sessionId)) safeSessionOpener({ sessionId: item.sessionId, taskId: item.taskId, title: item.title, url: item.url }, trigger);
      };
      const createHandoff = () => {
        const entry = sessionEntryRef.current;
        if (!canCreateSessionHandoff(entry)) return;
        if (!entry.confirmCreate) { updateSessionEntry({ ...entry, confirmCreate: true }); return; }
        const key = JSON.stringify([entry.taskId, entry.sessionId]);
        let requestId = entry.handoff?.requestId || handoffRequests.current.get(key);
        if (!requestId) { requestId = globalThis.crypto.randomUUID(); handoffRequests.current.set(key, requestId); }
        updateSessionEntry({ ...entry, busy: true, error: null, confirmCreate: false });
        void sessionGuard.current.run(async ({ signal }) => {
          try {
            const data = await post('createHandoff', { taskId: String(entry.taskId), sessionId: entry.sessionId, requestId }, signal);
            return readHandoffResult(data, t);
          } catch (cause) { return { error: cause?.message || t('sessionHandoffFailed') }; }
        }, (result) => {
          if (result.state) setSnapshot(result.state);
          updateSessionEntry({ ...sessionEntryRef.current, busy: false, error: result.error, handoff: result.handoff || sessionEntryRef.current.handoff });
        });
      };
      const copyHandoff = async () => {
        const entry = sessionEntryRef.current;
        try {
          await navigator.clipboard.writeText(entry.handoff.handoffText);
          if (sessionEntryRef.current === entry) updateSessionEntry({ ...entry, copied: true, error: null });
        } catch (cause) {
          if (sessionEntryRef.current === entry) updateSessionEntry({ ...entry, error: cause.message });
        }
      };
      // 收件箱“我已处理”：成功后连同收件箱一起刷新（snapshot 已由 perform 更新）。
      const acknowledgeInboxItem = (item) => perform(`ack:${item.todoId}`, () => post('acknowledge', { todoId: item.todoId }))
        .then((done) => { if (done) void fetchInbox(); });
      // Todo 主按钮（开会话/重新处理）与“标记完成”都走 dispatch：Host 端会把非 directMention 的 MR 直接标记完成。
      const dispatchTodo = (todo) => perform(`dispatch:${todo.id}`, () => post('dispatch', { id: todo.id }));
      // Issue 面板「处理」：同一 dispatch 通道（Host 端按合成 id 找到缓存条目）；
      // 成功后立刻刷新投影，把行状态换成“执行中”。
      const dispatchIssue = (issue) => {
        if (busyKeysRef.current.has('settings')) return Promise.resolve(false);
        return perform(`dispatch:${issue.id}`, () => post('dispatch', { id: issue.id }))
          .then((done) => { if (done) void fetchIssues(false); });
      };
      // 快捷切换归档状态：成功后连同已处理页一起刷新。
      const toggleSessionArchive = (record) => perform(`archive:${record.sessionId}`, () => post('setSessionArchived', {
        sessionId: record.sessionId,
        archived: record.archived !== true,
      })).then((done) => {
        if (done) void refreshHandled();
      });
      const settings = snapshot?.settings;
      // 与 task-board 的 model-options 实现一致：直接遍历目录 groups，不按 routableProviders 二次过滤。
      const modelGroups = (Array.isArray(modelCatalog?.groups) ? modelCatalog.groups : [])
        .filter((group) => Array.isArray(group?.models) && group.models.length > 0);
      const availableModelKeys = new Set(modelGroups.flatMap((group) => group.models.map((model) => sessionModelKey({ provider: group.id ?? group.provider, model: model.id }))));
      const pinnedDefaultKey = sessionModelKey(modelCatalog?.default);
      const modelOptions = (selection, followLabel) => {
        const follow = followLabel ?? t('sessionModelDefault');
        const hasFields = typeof selection?.provider === 'string' && selection.provider
          && typeof selection?.model === 'string' && selection.model;
        const selectedKey = hasFields ? sessionModelKey(selection) : '';
        return [
          h('option', { value: '' }, `${follow}${modelCatalog?.default ? ` (${modelCatalog.default.model})` : ''}`),
          pinnedDefaultKey && !availableModelKeys.has(pinnedDefaultKey) && h('option', { value: pinnedDefaultKey }, `${t('sessionModelPinDefault')} (${modelCatalog.default.model} · ${modelCatalog.default.provider})`),
          selectedKey && selectedKey !== pinnedDefaultKey && !availableModelKeys.has(selectedKey) && h('option', { value: selectedKey }, `${t('sessionModelUnavailable')}: ${selection.provider}/${selection.model}`),
          modelGroups.map((group) => h('optgroup', { key: group.id ?? group.provider, label: group.name ?? group.id ?? group.provider }, group.models.map((model) =>
            h('option', { key: model.id, value: sessionModelKey({ provider: group.id ?? group.provider, model: model.id }) }, `${model.name ?? model.id} · ${model.id}`),
          ))),
        ];
      };
      const quickModelKey = sessionModelKey(settings?.sessionModel);
      const issueModel = settings?.issueSessionModel ?? null;
      const issueReasoning = reasoningForSelection(modelCatalog, issueModel);
      const issueEffort = issueModel?.reasoningEffort ?? '';
      const issueEffortAdvertised = !issueEffort || issueReasoning?.efforts.some((effort) => effort.id === issueEffort);
      const updateIssueModel = (raw) => updateSettings({
        issueSessionModel: issueModelFromOption(raw, issueModel),
      });
      const updateIssueEffort = (effort) => updateSettings({
        issueSessionModel: withReasoningEffort(issueModel, effort),
      });
      const leaderProjection = leaderView.projection;
      const leaderSettings = leaderProjection?.settings ?? { model: null, autoEnrollNew: false };
      const leaderModel = leaderSettings.model;
      const leaderReasoning = reasoningForSelection(modelCatalog, leaderModel);
      const leaderEffort = leaderModel?.reasoningEffort ?? '';
      const leaderEffortAdvertised = !leaderEffort || leaderReasoning?.efforts.some((effort) => effort.id === leaderEffort);
      const leaderCanGrant = leaderFresh && !leaderBusy && canGrantLeaderAccess(leaderProjection);
      const leaderCanConfigure = leaderFresh && !leaderBusy && leaderProjection && !['error', 'uncertain'].includes(leaderProjection.phase);
      const leaderItems = leaderProjection?.items ?? [];
      const leaderHuman = leaderHumanItems(leaderProjection);
      const leaderRunState = leaderProjection?.runState || '';
      const leaderPhaseLabel = !leaderFresh ? t('leaderUncertain') : leaderProjection?.enabled && leaderProjection.phase === 'ready'
        ? t('enabled') : leaderRunState === 'never-started' ? t('leaderNeverStartedPhase')
          : leaderRunState === 'delivery-uncertain' ? t('leaderDeliveryUncertain') : t(LEADER_PHASE_LABELS[leaderProjection?.phase] || 'leaderUncertain');
      const leaderDeliveries = (leaderProjection?.deliveries ?? []).filter((entry) => entry.status === 'uncertain');
      const leaderAudit = [...(leaderProjection?.audit ?? [])].reverse().slice(0, 30);
      const leaderUncertainTasks = (leaderProjection?.tasks ?? []).filter((task) => task.status === 'uncertain');
      const leaderCreationUnresolved = leaderFresh && leaderRunState === 'creation-uncertain';
      const leaderBudgetSpent = (item) => item.actions !== null && item.maxActions !== null && item.actions >= item.maxActions
        || (item.expiresAt !== null && item.expiresAt <= Date.now());
      const leaderItemActions = (item) => h('div', { className: 'gta-todo-actions' },
        item.sessionId && h(Button, { onClick: (event) => openManagedIssue(item, event.currentTarget) }, t('openSession')),
        ['watching', 'running', 'needs-human', 'standby', 'cold'].includes(item.status) && !item.paused && h(Button, { disabled: !leaderFresh || Boolean(leaderBusy),
          onClick: () => { void runLeader('pauseIssue', { taskId: item.taskId, sessionId: item.sessionId }); } }, t('leaderPauseIssue')),
        leaderBudgetSpent(item) && h(Button, { disabled: !leaderFresh || Boolean(leaderBusy) || !item.sessionId, title: t('leaderResetBudgetHint'),
          onClick: () => { void runLeader('resetIssueBudget', { taskId: item.taskId, sessionId: item.sessionId }); } }, t('leaderResetBudget')),
        (item.paused || ['paused', 'needs-human'].includes(item.status)) && h(Button, { disabled: !leaderCanGrant || !item.sessionId,
          onClick: () => confirmLeaderAccess('resumeIssue', { taskId: item.taskId, sessionId: item.sessionId }, item.title) }, t('leaderResumeIssue')),
        h(Button, { disabled: !leaderFresh || Boolean(leaderBusy),
          onClick: () => { void runLeader('unenroll', { taskId: item.taskId, ...(item.sessionId ? { sessionId: item.sessionId } : {}) }); } }, t('leaderUnenroll')),
      );
      const issueLeaderControl = (issue) => {
        if (!issue.sessionId) return null;
        const item = leaderItemForSession(leaderProjection, issue.id, issue.sessionId);
        return h(Button, {
          disabled: Boolean(leaderBusy) || (item ? !leaderFresh : !leaderCanGrant),
          title: item ? t('leaderEnrolled') : t('leaderScope'),
          onClick: () => item ? void runLeader('unenroll', { taskId: String(issue.id), sessionId: issue.sessionId })
            : confirmLeaderAccess('enroll', { taskId: String(issue.id), sessionId: issue.sessionId }, issue.title),
        }, item ? t('leaderUnenroll') : t('leaderEnroll'));
      };
      // 工作区下拉：值仍是工作区路径（sessionCwd 语义不变）；比较忽略大小写/斜杠差异。
      const workspaceOptions = Array.isArray(workspaceData) ? workspaceData : [];
      const normalizePathKey = (value) => String(value ?? '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
      const registeredWorkspacePaths = new Set(workspaceOptions.map((workspace) => normalizePathKey(workspace.path)));
      const draftSessionCwdUnregistered = Boolean(draft?.sessionCwd) && !registeredWorkspacePaths.has(normalizePathKey(draft.sessionCwd));
      const issueSessionCwdUnregistered = Boolean(settings?.issueSessionCwd)
        && !registeredWorkspacePaths.has(normalizePathKey(settings.issueSessionCwd));
      const sessionDisplayName = (session, label, workspacePath) => {
        if (session.sessionTitle) return session.sessionTitle;
        const sameAsWorkspace = workspacePath && normalizePathKey(session.cwd) === normalizePathKey(workspacePath);
        if (session.cwd && !sameAsWorkspace) {
          return String(session.cwd).split(/[\\/]+/).filter(Boolean).pop();
        }
        return label;
      };
      const allRouteItems = Array.isArray(routeData?.items) ? routeData.items : [];
      const routeQuery = routeSearch.trim().toLowerCase();
      const routeUpdatedAt = (value) => {
        const parsed = typeof value === 'number' ? value : Date.parse(value ?? '');
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const routeItems = allRouteItems
        .filter((item) => !routeQuery || [item.title, item.sessionId, item.cwd]
          .some((value) => String(value ?? '').toLowerCase().includes(routeQuery)))
        .sort((a, b) => Number(b.sameTarget === true) - Number(a.sameTarget === true)
          || routeUpdatedAt(b.updatedAt) - routeUpdatedAt(a.updatedAt));
      const selectedRouteTarget = routeItems.find((item) => item.sessionId === routeSelection) ?? null;
      const routeMaxQueue = routeData?.maxQueuePerSession ?? 3;
      const listQuery = listSearches[activeTab] ?? '';
      const visibleTodos = filterWorkstationItems(snapshot?.todos, listQuery);
      const visibleInbox = filterWorkstationItems(inboxData, listQuery);
      const visibleIssues = filterWorkstationItems(issuesData?.items, listQuery);
      const visibleOrphans = filterWorkstationItems(issuesData?.orphans, listQuery);
      const visibleHandled = filterWorkstationItems(handledData?.items, listQuery);
      const searchableList = {
        todos: { loaded: snapshot?.todos.length ?? 0, matches: visibleTodos.length, ready: Boolean(snapshot) },
        inbox: { loaded: inboxData?.length ?? 0, matches: visibleInbox.length, ready: inboxData !== null },
        issues: { loaded: (issuesData?.items.length ?? 0) + (issuesData?.orphans.length ?? 0), matches: visibleIssues.length + visibleOrphans.length, ready: issuesData !== null },
        handled: { loaded: handledData?.items.length ?? 0, matches: visibleHandled.length, ready: handledData !== null },
      }[activeTab];
      const tabCounts = {
        inbox: snapshot?.closure?.needsHuman ?? 0,
        todos: snapshot?.todos.length ?? 0,
        issues: issuesData?.items.length ?? snapshot?.issueCount ?? 0,
        handled: handledData?.total ?? snapshot?.handledCount ?? 0,
        workspaces: workspaceOptions.length,
        logs: logData?.items.length ?? 0,
      };

      return h('div', { className: 'gta-root' },
        h('style', { children: CSS }),
        h('header', { className: 'gta-header' },
          h('div', { className: 'gta-heading' },
            h('div', { className: 'gta-title-row' },
              h('span', { className: 'gta-title-icon' }, h(PanelIcon, { size: 20 })),
              h('h1', null, t('title')),
            ),
          ),
          h('div', { className: 'gta-actions' },
            snapshot && h('span', { className: `gta-poll-state ${settings.enabled ? 'gta-success' : 'gta-muted'}` },
              `${t('todoPolling')}${colon()}${settings.enabled ? t('enabled') : t('disabled')}`),
            snapshot && h(Button, {
              className: (snapshot.closure?.needsHuman ?? 0) > 0 ? 'gta-needs-human' : '',
              onClick: () => setActiveTab('inbox'),
            }, `${t('needsHumanCount')} ${snapshot.closure?.needsHuman ?? 0}`),
            h(Button, {
              disabled: !snapshot,
              expanded: Boolean(draft), controls: `${PANEL_ID}-settings`,
              onClick: () => {
                if (draft) closeGeneralSettings();
                else { draftGeneration.current += 1; draftBaseline.current = settings; setDraft({ ...settings }); }
              },
            }, draft ? t('close') : t('todoSettings')),
          ),
        ),
        (busySet.has('settings') || settingsFeedback) && h('div', { className: 'gta-feedback gta-muted', role: 'status' }, busySet.has('settings') ? t('saving') : settingsFeedback),
        !snapshot && !error && h('div', { className: 'gta-empty' }, t('loading')),
        (error || pollError) && h('div', { className: 'gta-banner gta-error', role: 'alert' }, `${t('localError')}${colon()}${error || pollError}`),
        snapshot?.lastPollError && h('div', { className: 'gta-banner gta-error', role: 'alert' }, snapshot.lastPollError),
        snapshot?.lastDispatchError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, snapshot.lastDispatchError),
        snapshot?.lastPrecheckError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, snapshot.lastPrecheckError),
        modelCatalogError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, `${t('modelCatalogError')}${colon()}${modelCatalogError}`),
        snapshot?.digest && h('section', { className: 'gta-card gta-digest' },
          h('div', { className: 'gta-digest-head' },
            h('h2', null, `${t('digestTitle')} (${snapshot.digest.counts.total})`),
            h('span', { className: 'gta-muted' },
              `${t('closureClosed')} ${snapshot.digest.counts.closed} · ${t('closureFollowUp')} ${snapshot.digest.counts.followUp} · ${t('closureNeedsHuman')} ${snapshot.digest.counts.needsHuman}`),
            h(Button, { onClick: () => setDigestOpen(!digestOpen) }, digestOpen ? t('digestHide') : t('digestShow')),
          ),
          digestOpen && (snapshot.digest.items.length === 0
            ? h('div', { className: 'gta-muted' }, t('digestEmpty'))
            : h('ul', { className: 'gta-digest-list' }, snapshot.digest.items.map((item) => h('li', { key: item.todoId },
              item.url
                ? h('a', { href: item.url, target: '_blank', rel: 'noreferrer' }, item.title || `Todo ${item.todoId}`)
                : h('span', null, item.title || `Todo ${item.todoId}`),
              h('span', { className: `gta-tag ${recordStatusClass({ closure: item.closure })}` }, closureLabel(item.closure, t) || item.closure || '—'),
              item.round > 1 && h('span', { className: 'gta-muted' }, `${t('roundLabel')} ${item.round}`),
              item.closureNote && h('span', { className: 'gta-muted gta-digest-note' }, item.closureNote),
              item.replyExcerpt && h('span', { className: 'gta-muted gta-digest-reply' },
                `${t('replyPreview')}${colon()}`,
                item.replyUrl
                  ? h('a', { href: item.replyUrl, target: '_blank', rel: 'noreferrer' }, item.replyExcerpt)
                  : item.replyExcerpt),
            )))),
        ),
        draft && h('section', { className: 'gta-card gta-settings', id: `${PANEL_ID}-settings` },
          h('h2', null, t('todoSettings')),
          h('div', { className: 'gta-form-grid' },
            h('label', null, t('interval'), h('input', {
              type: 'number', min: 30, max: 86400, value: draft.intervalSeconds,
              onChange: (event) => setDraft({ ...draft, intervalSeconds: Number(event.target.value) }),
            })),
            h('label', null, t('limit'), h('input', {
              type: 'number', min: 1, max: 10, value: draft.maxSessionsPerPoll,
              onChange: (event) => setDraft({ ...draft, maxSessionsPerPoll: Number(event.target.value) }),
            })),
            h('label', null, t('concurrency'), h('input', {
              type: 'number', min: 1, max: 10, value: draft.maxConcurrentSessions,
              onChange: (event) => setDraft({ ...draft, maxConcurrentSessions: Number(event.target.value) }),
            })),
            h('label', { title: t('sessionModelFixedHint') }, t('sessionModel'), h('select', {
              value: sessionModelKey(draft.sessionModel),
              onChange: (event) => setDraft({
                ...draft,
                sessionModel: event.target.value ? JSON.parse(event.target.value) : null,
              }),
            }, modelOptions(draft.sessionModel))),
            h('label', { title: t('judgeModelHint') }, t('judgeModel'), h('select', {
              value: sessionModelKey(draft.judgeModel),
              onChange: (event) => setDraft({
                ...draft,
                judgeModel: event.target.value ? JSON.parse(event.target.value) : null,
              }),
            }, modelOptions(draft.judgeModel, t('judgeModelDefault')))),
            h('label', { title: t('precheckEngineHint') }, t('precheckEngine'), h('select', {
              value: draft.precheckEngine ?? 'auto',
              onChange: (event) => setDraft({ ...draft, precheckEngine: event.target.value }),
            },
              h('option', { value: 'auto' }, t('precheckEngineAuto')),
              h('option', { value: 'jev' }, t('precheckEngineJev')),
              h('option', { value: 'llm' }, t('precheckEngineLlm')),
            )),
            (draft.precheckEngine ?? 'auto') !== 'llm' && h('details', { className: 'gta-advanced gta-wide' },
              h('summary', null, t('classifierSettings')),
              h('div', { className: 'gta-classifier' },
                h('div', { className: 'gta-form-grid' },
                h('label', null, t('classifierProvider'), h('select', {
                  value: draft.precheckClassifier?.provider ?? 'typesafe',
                  onChange: (event) => setDraft({ ...draft, precheckClassifier: { ...(draft.precheckClassifier ?? {}), provider: event.target.value } }),
                },
                  h('option', { value: 'typesafe' }, 'TypeSafe'),
                  h('option', { value: 'openrouter' }, 'OpenRouter'),
                  h('option', { value: 'custom' }, t('classifierProviderCustom')),
                )),
                h('label', null, t('classifierModel'), h('input', {
                  type: 'text', value: draft.precheckClassifier?.model ?? '', placeholder: 'jev-latest',
                  onChange: (event) => setDraft({ ...draft, precheckClassifier: { ...(draft.precheckClassifier ?? {}), model: event.target.value } }),
                })),
                (draft.precheckClassifier?.provider === 'custom') && h('label', null, t('classifierBaseUrl'), h('input', {
                  type: 'text', value: draft.precheckClassifier?.baseUrl ?? '', placeholder: 'https://api.typesafe.ai/v1',
                  onChange: (event) => setDraft({ ...draft, precheckClassifier: { ...(draft.precheckClassifier ?? {}), baseUrl: event.target.value } }),
                })),
                (draft.precheckClassifier?.provider === 'custom') && h('label', null, t('classifierApiKeyEnv'), h('input', {
                  type: 'text', value: draft.precheckClassifier?.apiKeyEnv ?? '', placeholder: 'TYPESAFE_API_KEY',
                  onChange: (event) => setDraft({ ...draft, precheckClassifier: { ...(draft.precheckClassifier ?? {}), apiKeyEnv: event.target.value } }),
                })),
                h('label', null, t('classifierApiKey'), h('input', {
                  type: 'password', value: draft.precheckClassifier?.apiKey ?? '',
                  placeholder: draft.precheckClassifier?.apiKeySet ? t('classifierApiKeyKeep') : t('classifierApiKeyPlaceholder'),
                  autoComplete: 'off',
                  onChange: (event) => setDraft({ ...draft, precheckClassifier: { ...(draft.precheckClassifier ?? {}), apiKey: event.target.value } }),
                })),
                ),
                h('p', { className: 'gta-muted gta-security-hint' }, t('classifierSecurity')),
              ),
            ),
            h('label', { className: 'gta-wide', title: t('sessionCwdHint') }, t('sessionCwd'), h('select', {
              value: draft.sessionCwd,
              onChange: (event) => setDraft({ ...draft, sessionCwd: event.target.value }),
            },
              h('option', { value: '' }, t('sessionCwdAuto')),
              draftSessionCwdUnregistered && h('option', { value: draft.sessionCwd }, `${t('sessionCwdUnregistered')}${colon()}${draft.sessionCwd}`),
              workspaceOptions.map((workspace) => h('option', { key: workspace.workspaceId, value: workspace.path },
                `${workspace.title || workspace.path} · ${workspace.path}`)),
            )),
            h('label', { className: 'gta-wide', title: t('signatureHint') }, t('signatureText'), h('input', {
              type: 'text', maxLength: 100, value: draft.signatureText ?? '',
              disabled: draft.replySignature !== true, placeholder: t('signaturePlaceholder'),
              onChange: (event) => setDraft({ ...draft, signatureText: event.target.value }),
            })),
            h('label', null, t('maxFollowUps'), h('input', {
              type: 'number', min: 0, max: 10, value: draft.maxFollowUps ?? 3, disabled: draft.followUpEnabled === false,
              onChange: (event) => setDraft({ ...draft, maxFollowUps: Number(event.target.value) }),
            })),
            h('details', { className: 'gta-advanced gta-wide' },
              h('summary', null, t('advanced')),
              h('div', { className: 'gta-form-grid' },
                h('label', null, t('maxQueuePerSession'), h('input', {
                  type: 'number', min: 1, max: 10, value: draft.maxQueuePerSession ?? 3,
                  onChange: (event) => setDraft({ ...draft, maxQueuePerSession: Number(event.target.value) }),
                })),
                h('label', null, t('followUpDelay'), h('input', {
                  type: 'number', min: 1, max: 1440, value: draft.followUpDelayMinutes ?? 15, disabled: draft.followUpEnabled === false,
                  onChange: (event) => setDraft({ ...draft, followUpDelayMinutes: Number(event.target.value) }),
                })),
                h('label', null, t('routeScope'), h('select', {
                  value: draft.routeScope ?? 'plugin',
                  onChange: (event) => setDraft({ ...draft, routeScope: event.target.value }),
                },
                  h('option', { value: 'plugin' }, t('routeScopePlugin')),
                  h('option', { value: 'any' }, t('routeScopeAny')),
                )),
                h('label', null, t('busyRouteMode'), h('select', {
                  value: draft.busyRouteMode ?? 'queue',
                  onChange: (event) => setDraft({ ...draft, busyRouteMode: event.target.value }),
                },
                  h('option', { value: 'queue' }, t('busyRouteQueue')),
                  h('option', { value: 'steer' }, t('busyRouteSteer')),
                )),
                h('label', { className: 'gta-wide' }, t('cwd'), h('input', {
                  type: 'text', value: draft.cwd, placeholder: t('cwdHint'),
                  onChange: (event) => setDraft({ ...draft, cwd: event.target.value }),
                })),
                h('label', { className: 'gta-wide', title: t('customRulesHint') }, t('customRules'), h('textarea', {
                  className: 'gta-rules', rows: 3, maxLength: 4000, value: draft.customRules ?? '',
                  onChange: (event) => setDraft({ ...draft, customRules: event.target.value }),
                })),
                h('div', { className: 'gta-checks' },
                  h('label', { className: 'gta-check' }, h('input', {
                    type: 'checkbox', checked: draft.autoRoute !== false,
                    onChange: (event) => setDraft({ ...draft, autoRoute: event.target.checked }),
                  }), t('autoRoute')),
                  h('label', { className: 'gta-check' }, h('input', {
                    type: 'checkbox', checked: draft.waitProbeEnabled !== false, disabled: draft.followUpEnabled === false,
                    onChange: (event) => setDraft({ ...draft, waitProbeEnabled: event.target.checked }),
                  }), t('waitProbeEnabled')),
                  h('label', { className: 'gta-check' }, h('input', {
                    type: 'checkbox', checked: draft.followUpReuseSession !== false, disabled: draft.followUpEnabled === false,
                    onChange: (event) => setDraft({ ...draft, followUpReuseSession: event.target.checked }),
                  }), t('followUpReuseSession')),
                ),
              ),
            ),
          ),
          h('div', { className: 'gta-checks gta-checks-main' },
            h('label', { className: 'gta-check' }, h('input', {
              type: 'checkbox', checked: draft.precheckEnabled,
              onChange: (event) => setDraft({ ...draft, precheckEnabled: event.target.checked }),
            }), t('precheckEnabled')),
            h('label', { className: 'gta-check' }, h('input', {
              type: 'checkbox', checked: draft.ruleSkipEnabled,
              onChange: (event) => setDraft({ ...draft, ruleSkipEnabled: event.target.checked }),
            }), t('ruleSkipEnabled')),
            h('label', { className: 'gta-check' }, h('input', {
              type: 'checkbox', checked: draft.autoArchive,
              onChange: (event) => setDraft({ ...draft, autoArchive: event.target.checked }),
            }), t('autoArchive')),
            h('label', { className: 'gta-check', title: t('followUpHint') }, h('input', {
              type: 'checkbox', checked: draft.followUpEnabled !== false,
              onChange: (event) => setDraft({ ...draft, followUpEnabled: event.target.checked }),
            }), t('followUpEnabled')),
            h('label', { className: 'gta-check' }, h('input', {
              type: 'checkbox', checked: draft.replySignature === true,
              onChange: (event) => setDraft({ ...draft, replySignature: event.target.checked }),
            }), t('signatureLabel')),
          ),
          h('div', { className: 'gta-form-actions' },
            h(Button, { primary: true, disabled: busySet.has('settings'), onClick: saveAndCloseGeneralSettings }, t('save')),
            h(Button, { onClick: closeGeneralSettings }, t('cancel')),
          ),
        ),
        snapshot && h('section', { className: 'gta-stats', 'aria-label': t('todoPolling') },
          h('div', { className: 'gta-stat' }, h('strong', { className: snapshot.running ? 'gta-success' : 'gta-muted' }, snapshot.running ? t('running') : t('idle'))),
          h('div', { className: 'gta-stat' }, h('span', null, t('pending')), h('strong', null, snapshot.pendingCount)),
          h('div', { className: 'gta-stat' }, h('span', null, t('activeSessions')), h('strong', null, `${snapshot.activeSessions ?? 0}/${snapshot.settings.maxConcurrentSessions}`)),
          h('div', { className: 'gta-stat' }, h('span', null, t('queuedSessions')), h('strong', null, snapshot.queuedSessions ?? 0)),
          h('div', { className: 'gta-stat' }, h('span', null, t('followUpCount')), h('strong', null, snapshot.closure?.followUp ?? 0)),
          h('div', { className: 'gta-stat gta-stat-time' }, h('span', null, t('lastSuccess')), h('strong', null, formatTime(snapshot.lastSuccessAt, t('never')))),
        ),
        snapshot && h('div', { className: 'gta-tabs', role: 'tablist', 'aria-label': t('workstationViews'), 'aria-orientation': 'horizontal' },
          WORKSTATION_TABS.map((tab, index) => h(React.Fragment, { key: tab.id },
            (index === 0 || WORKSTATION_TABS[index - 1].group !== tab.group) && h('span', {
              className: `gta-tab-group${index > 0 ? ' gta-tab-group-environment' : ''}`, role: 'presentation',
            }, t(tab.group)),
            h('button', {
              type: 'button', role: 'tab', id: `${PANEL_ID}-tab-${tab.id}`,
              'aria-selected': activeTab === tab.id, 'aria-controls': `${PANEL_ID}-panel-${tab.id}`,
              tabIndex: activeTab === tab.id ? 0 : -1,
              ref: (node) => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id); },
              className: `gta-tab${activeTab === tab.id ? ' gta-tab-active' : ''}`,
              onClick: () => setActiveTab(tab.id), onKeyDown: (event) => activateTabByKey(event, tab.id),
            }, t(tab.label), h('span', {
              className: `gta-tab-count${tab.id === 'inbox' && tabCounts.inbox > 0 ? ' gta-attention' : ''}`,
            }, tabCounts[tab.id])),
          )),
        ),
        snapshot && searchableList && h('div', { className: 'gta-list-tools' },
          h('label', { className: 'gta-list-search' },
            h('span', null, activeTab === 'handled' ? t('searchLoaded') : t('searchList')),
            h('input', {
              type: 'search', value: listQuery, disabled: !searchableList.ready,
              placeholder: activeTab === 'handled' ? t('searchLoaded') : t('searchList'),
              onChange: (event) => setListSearches({ ...listSearches, [activeTab]: event.target.value }),
            }),
          ),
          listQuery && h(Button, { onClick: () => setListSearches({ ...listSearches, [activeTab]: '' }) }, t('clearSearch')),
          searchableList.ready && h('span', { className: 'gta-muted', role: 'status' },
            `${listQuery ? t('searchResults') : t('loadedRecords')}${colon()}${listQuery ? `${searchableList.matches}/${searchableList.loaded}` : `${searchableList.loaded}/${activeTab === 'handled' ? handledData.total : searchableList.loaded}`}`),
        ),
        activeTab === 'inbox' && snapshot && h('section', { className: 'gta-section', role: 'tabpanel', id: `${PANEL_ID}-panel-inbox`, 'aria-labelledby': `${PANEL_ID}-tab-inbox`, tabIndex: 0 },
          inboxError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, `${t('inboxError')}${colon()}${inboxError}`),
          !inboxData && !inboxError && h('div', { className: 'gta-empty' }, t('loading')),
          inboxData && inboxData.length === 0 && h('div', { className: 'gta-empty' }, t('inboxEmpty')),
          inboxData && inboxData.length > 0 && visibleInbox.length === 0 && h('div', { className: 'gta-empty', role: 'status' }, t('searchNoMatches')),
          visibleInbox.length > 0 && h('div', { className: 'gta-list gta-scroll-list', role: 'list', 'aria-label': t('inboxTitle') },
            visibleInbox.map((item) => h('article', { role: 'listitem', className: 'gta-todo', key: item.todoId },
              h('div', { className: 'gta-todo-main' },
                h('div', { className: 'gta-todo-title' },
                  item.url
                    ? h('a', { href: item.url, target: '_blank', rel: 'noreferrer' }, item.title)
                    : h('span', null, item.title),
                  h('span', { className: 'gta-tag gta-tag-attention' }, t('closureNeedsHuman')),
                  item.archived && h('span', { className: 'gta-tag' }, t('sessionArchived')),
                  item.pendingUnconfirmed && h('span', { className: 'gta-tag' }, t('inboxPendingUnconfirmed')),
                  item.routed && routedLabel(item, t) && h('span', { className: 'gta-tag gta-tag-routed' }, routedLabel(item, t)),
                ),
                h('div', { className: 'gta-muted gta-meta' },
                  [item.closureNote, item.project, item.sessionTitle, item.round > 1 && `${t('roundLabel')} ${item.round}`,
                    item.completedAt && formatTime(item.completedAt, '')].filter(Boolean).join(' · ')),
                item.archiveError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, item.archiveError),
                h(ReplyPreview, { reply: item.lastReply, t }),
              ),
              h('div', { className: 'gta-todo-actions' },
                item.sessionId && h(Button, { onClick: (event) => openSession({ sessionId: item.sessionId, taskId: item.todoId, title: item.title, url: item.url, manualHandoffs: item.manualHandoffs }, event.currentTarget) }, t('inboxTakeover')),
                h(Button, {
                  primary: true,
                  disabled: busySet.has(`ack:${item.todoId}`),
                  onClick: guardedRun(`ack:${item.todoId}`, () => { void acknowledgeInboxItem(item); }),
                }, busySet.has(`ack:${item.todoId}`) ? '…'
                  : confirmKeys.has(`ack:${item.todoId}`) ? t('confirmAcknowledge') : t('inboxAcknowledge')),
              ),
            ))),
        ),
        activeTab === 'todos' && snapshot && h('section', { className: 'gta-section', role: 'tabpanel', id: `${PANEL_ID}-panel-todos`, 'aria-labelledby': `${PANEL_ID}-tab-todos`, tabIndex: 0 },
          h('div', { className: 'gta-todo-toolbar' },
            h('label', { className: 'gta-model-quick', title: t('sessionModelFixedHint') },
              h('span', null, t('sessionModel')),
              h('select', {
                value: quickModelKey, disabled: busySet.has('settings'), 'aria-label': t('sessionModel'),
                onChange: (event) => updateSettings({ sessionModel: event.target.value ? JSON.parse(event.target.value) : null }),
              }, modelOptions(settings.sessionModel)),
            ),
            h(Button, {
              pressed: settings.enabled, disabled: busySet.has('settings'),
              title: settings.enabled ? t('disable') : t('defaultPaused'),
              label: settings.enabled ? t('disable') : t('enable'),
              onClick: () => updateSettings({ enabled: !settings.enabled }),
            }, settings.enabled ? t('disable') : t('enable')),
            h(Button, {
              disabled: busySet.has('poll'), onClick: () => perform('poll', () => post('poll')),
            }, busySet.has('poll') ? t('checking') : t('checkNow')),
            h('span', { className: 'gta-muted gta-new-count' }, `${t('newFound')}${colon()}${snapshot.lastNewCount}`),
          ),
          snapshot.todos.length === 0
            ? h('div', { className: 'gta-empty' }, t('noTodos'))
            : visibleTodos.length === 0 ? h('div', { className: 'gta-empty', role: 'status' }, t('searchNoMatches'))
            : h('div', { className: 'gta-list gta-scroll-list', role: 'list', 'aria-label': t('todoList') }, visibleTodos.map((todo) =>
                h('article', { role: 'listitem', className: 'gta-todo', key: todo.id },
                  h('div', { className: 'gta-todo-main' },
                    h('div', { className: 'gta-todo-title' },
                      todo.url
                        ? h('a', { href: todo.url, target: '_blank', rel: 'noreferrer' }, todo.title)
                        : h('span', null, todo.title),
                      todo.directMention && h('span', { className: 'gta-tag gta-tag-mention' }, t('directMention')),
                      h('span', { className: `gta-tag ${recordStatusClass(todo)}` }, todoStatusLabel(todo, t)),
                      routedLabel(todo, t) && h('span', { className: 'gta-tag gta-tag-routed' }, routedLabel(todo, t)),
                    ),
                    h('div', { className: 'gta-muted gta-meta' }, [`#${todo.id}`, todo.project, todo.targetType, todo.action, todo.author && `@${todo.author}`, todo.skipReason, ...closureMeta(todo, t)].filter(Boolean).join(' · ')),
                    h(ReplyPreview, { reply: todo.lastReply, t }),
                  ),
                  h('div', { className: 'gta-todo-actions' },
                    todo.sessionId && h(Button, { onClick: (event) => openSession({ sessionId: todo.sessionId, taskId: todo.id, title: todo.title, url: todo.url, manualHandoffs: todo.manualHandoffs }, event.currentTarget) }, t('openSession')),
                    // 主按钮只负责开会话：未处理开新会话；已处理为“重新处理”（不可逆，需二次确认）。
                    canProcessTodo(todo) && h(Button, {
                      primary: !todo.handled,
                      disabled: busySet.has(`dispatch:${todo.id}`) || (todo.executionStatus === 'running' || todo.executionStatus === 'starting'),
                      onClick: todo.handled
                        ? guardedRun(`reprocess:${todo.id}`, () => { void dispatchTodo(todo); })
                        : () => { void dispatchTodo(todo); },
                    }, busySet.has(`dispatch:${todo.id}`) ? '…'
                      : todo.handled && confirmKeys.has(`reprocess:${todo.id}`) ? t('confirmReprocess')
                      : todo.handled ? t('reprocess') : t('process')),
                    // “标记完成”独立为次级按钮（沿用原显示条件：非 directMention 的 MR），
                    // 不再与开会话共用按钮；同样不可逆，需二次确认。
                    !todo.handled && isMergeRequest(todo) && !todo.directMention && h(Button, {
                      disabled: busySet.has(`dispatch:${todo.id}`) || (todo.executionStatus === 'running' || todo.executionStatus === 'starting'),
                      onClick: guardedRun(`markdone:${todo.id}`, () => { void dispatchTodo(todo); }),
                    }, busySet.has(`dispatch:${todo.id}`) ? '…'
                      : confirmKeys.has(`markdone:${todo.id}`) ? t('confirmMarkDone') : t('markDone')),
                    canRouteTodo(todo) && h(Button, {
                      disabled: (todo.executionStatus === 'running' || todo.executionStatus === 'starting'),
                      onClick: (event) => openRouteTargets(todo, event.currentTarget),
                    }, t('routeToSession')),
                  ),
                ),
              )),
        ),
        activeTab === 'issues' && snapshot && h('section', { className: 'gta-section', role: 'tabpanel', id: `${PANEL_ID}-panel-issues`, 'aria-labelledby': `${PANEL_ID}-tab-issues`, tabIndex: 0 },
          h('section', { className: 'gta-card gta-leader', 'aria-label': t('leaderTitle') },
            h('div', { className: 'gta-leader-head' },
              h(Button, { expanded: leaderOpen, controls: `${PANEL_ID}-leader-body`,
                onClick: () => { setLeaderOpen(!leaderOpen); if (leaderOpen) setLeaderConfirm(null); } },
              `${leaderOpen ? '▾' : '▸'} ${t('leaderTitle')} · ${leaderPhaseLabel} · ${t('leaderManaged')} ${leaderItems.length}`),
              leaderHuman.length > 0 && h(Button, { className: 'gta-needs-human', onClick: () => setLeaderOpen(true) }, `${t('leaderHuman')} ${leaderHuman.length}`),
              h('label', { className: 'gta-check', title: t('leaderAutoEnrollHint') }, h('input', {
                type: 'checkbox', checked: leaderSettings.autoEnrollNew === true, disabled: !leaderCanConfigure,
                onChange: (event) => event.target.checked
                  ? confirmLeaderAccess('configure', { settings: { autoEnrollNew: true } }, t('leaderAutoEnroll'))
                  : void runLeader('configure', { settings: { autoEnrollNew: false } }),
              }), t('leaderAutoEnroll')),
              h('span', { className: 'gta-muted' }, t('leaderAutoEnrollHint')),
            ),
            leaderOpen && h('div', { id: `${PANEL_ID}-leader-body`, className: 'gta-leader-body' },
              h('p', { className: 'gta-muted' }, t('leaderScope')),
              h('div', { className: 'gta-form-actions' },
                !leaderView.sessionId && h(Button, { disabled: !leaderFresh || Boolean(leaderBusy)
                  || !canCreateLeader(leaderProjection, leaderView.sessionId, leaderView.creationAttempted),
                  onClick: () => { void runLeader('create'); } }, t('leaderCreate')),
                leaderView.sessionId && h(Button, { onClick: (event) => openLeader(event.currentTarget) }, t('leaderOpen')),
                canRetryLeaderSetup(leaderProjection, leaderView.sessionId) && h(Button, {
                  disabled: !leaderFresh || Boolean(leaderBusy), title: t('leaderRetrySetupHint'),
                  onClick: () => { void runLeader('create', { sessionId: leaderView.sessionId }); },
                }, t('leaderRetrySetup')),
                h(Button, { primary: !leaderProjection?.enabled, disabled: !leaderCanGrant || leaderProjection.enabled,
                  onClick: () => confirmLeaderAccess('start', {}, t('leaderStart')) }, t('leaderStart')),
                h(Button, { disabled: Boolean(leaderBusy) || !leaderView.sessionId,
                  onClick: () => { void runLeader('pause'); } }, t('leaderPause')),
                h(Button, { disabled: Boolean(leaderBusy), onClick: () => { void fetchLeaderSnapshot(); } }, t('leaderRefresh')),
              ),
              leaderView.creationAttempted && !leaderView.sessionId && h('div', { className: 'gta-banner gta-warn', role: 'status' }, t('leaderCreateUncertain')),
              (leaderView.error || leaderView.pollError || leaderProjection?.error) && h('div', { className: 'gta-banner gta-warn', role: 'status' },
                `${t(leaderView.pollError && !leaderView.error ? 'leaderSnapshotError' : 'leaderError')}${colon()}${leaderView.error || leaderView.pollError || leaderProjection.error}`),
              (leaderBusy || leaderFeedback) && h('div', { className: 'gta-feedback gta-muted', role: 'status' }, leaderBusy ? t('leaderWorking') : leaderFeedback),
              leaderFresh && leaderRunState === 'never-started' && h('div', { className: 'gta-banner gta-warn', role: 'status' }, t('leaderNeverStartedHint')),
              leaderFresh && leaderRunState === 'paused' && h('p', { className: 'gta-muted' }, t('leaderPausedHint')),
              leaderFresh && leaderRunState === 'running' && h('p', { className: 'gta-muted' }, t('leaderMainWindow')),
              leaderCreationUnresolved && h('div', { className: 'gta-banner gta-warn gta-leader-confirm', role: 'region', 'aria-label': t('leaderCreateUncertain') },
                h('p', null, t('leaderCreationUnresolved')),
                h('div', { className: 'gta-form-actions' },
                  h('input', { type: 'text', value: leaderClaimId, placeholder: t('leaderClaimPlaceholder'), 'aria-label': t('leaderClaimPlaceholder'),
                    onChange: (event) => setLeaderClaimId(event.target.value) }),
                  h(Button, { disabled: Boolean(leaderBusy) || !validLeaderSessionId(leaderClaimId.trim()),
                    onClick: () => { void runLeader('resolveCreation', { resolution: 'claim', sessionId: leaderClaimId.trim() }); } }, t('leaderClaim')),
                  h(Button, { disabled: Boolean(leaderBusy),
                    onClick: () => { void runLeader('resolveCreation', { resolution: 'abandon' }); } }, t('leaderAbandon')),
                )),
              leaderFresh && leaderDeliveries.length > 0 && h('div', { className: 'gta-banner gta-warn', role: 'region', 'aria-label': t('leaderDeliveries') },
                h('strong', null, `${t('leaderDeliveries')} ${leaderDeliveries.length}`),
                h('p', null, t('leaderDeliveriesHint')),
                leaderDeliveries.map((entry) => h('div', { key: entry.requestId, className: 'gta-form-actions' },
                  h('span', { className: 'gta-muted gta-meta' }, `${entry.kind === 'notify' ? t('leaderTitle') : entry.taskId} · ${entry.sessionId || ''}${entry.createdAt ? ` · ${formatTime(entry.createdAt, '')}` : ''}`),
                  entry.sessionId && h(Button, { onClick: (event) => entry.kind === 'notify' ? openLeader(event.currentTarget)
                    : openManagedIssue({ taskId: entry.taskId, sessionId: entry.sessionId, title: entry.taskId, url: '' }, event.currentTarget) }, t('leaderDeliveryOpen')),
                  h(Button, { disabled: Boolean(leaderBusy),
                    onClick: () => { void runLeader('resolveDelivery', { requestId: entry.requestId, resolution: 'delivered' }); } }, t('leaderDelivered')),
                  h(Button, { disabled: Boolean(leaderBusy),
                    onClick: () => { void runLeader('resolveDelivery', { requestId: entry.requestId, resolution: 'not-delivered' }); } }, t('leaderNotDelivered')),
                ))),
              h('div', { className: 'gta-form-grid gta-leader-settings' },
                h('label', null, t('leaderModel'), h('select', {
                  value: sessionModelKey(leaderModel), disabled: !leaderCanConfigure, 'aria-label': t('leaderModel'),
                  onChange: (event) => { void runLeader('configure', { settings: { model: issueModelFromOption(event.target.value, leaderModel) } }); },
                }, modelOptions(leaderModel))),
                leaderReasoning && h('label', null, t('reasoningEffort'), h('select', {
                  value: leaderEffort, disabled: !leaderCanConfigure, 'aria-label': `${t('leaderModel')} · ${t('reasoningEffort')}`,
                  onChange: (event) => { void runLeader('configure', { settings: { model: withReasoningEffort(leaderModel, event.target.value) } }); },
                },
                  h('option', { value: '' }, t('reasoningEffortDefault')),
                  !leaderEffortAdvertised && h('option', { value: leaderEffort }, `${t('reasoningEffortUnavailable')}${colon()}${leaderEffort}`),
                  leaderReasoning.efforts.map((effort) => h('option', { key: effort.id, value: effort.id, title: effort.description ?? '' }, `${effort.name} · ${effort.id}`)),
                )),
              ),
              leaderConfirm && h('div', { className: 'gta-banner gta-warn gta-leader-confirm', role: 'region', 'aria-label': t('leaderConfirm') },
                h('strong', null, leaderConfirm.title || t('leaderStart')),
                leaderConfirm.payload.taskId && h('div', { className: 'gta-muted' }, `${leaderConfirm.payload.taskId} · ${leaderConfirm.payload.sessionId}`),
                h('p', null, t('leaderScope')),
                leaderConfirm.operation === 'start' && h('p', null, t('leaderStartHint')),
                leaderConfirm.operation === 'resumeIssue' && h('p', null, t('leaderResumeHint')),
                leaderConfirm.operation === 'configure' && h('p', null, t('leaderAutoEnrollConfirm')),
                h('div', { className: 'gta-form-actions' },
                  h(Button, { primary: true, disabled: leaderConfirm.operation === 'configure' ? !leaderCanConfigure : !leaderCanGrant,
                    onClick: () => { void runLeader(leaderConfirm.operation, leaderConfirm.payload); } }, t('leaderConfirm')),
                  h(Button, { onClick: () => setLeaderConfirm(null) }, t('cancel')),
                ),
              ),
              h('div', { className: 'gta-section-title gta-subsection-title' }, h('h2', null, t('leaderManaged')), h('span', { className: 'gta-muted' }, leaderItems.length)),
              leaderItems.length === 0 ? h('p', { className: 'gta-muted' }, t('leaderManagedEmpty'))
                : h('div', { className: 'gta-list gta-leader-list', role: 'list', 'aria-label': t('leaderManaged') }, leaderItems.map((item) =>
                  h('article', { className: 'gta-todo', role: 'listitem', key: `${item.taskId}:${item.sessionId}` },
                    h('div', { className: 'gta-todo-main' },
                      h('div', { className: 'gta-todo-title' }, h('span', null, item.title || item.taskId),
                        h('span', { className: `gta-tag ${['needs-human', 'unknown', 'missing'].includes(item.status) ? 'gta-tag-attention' : 'gta-tag-neutral'}` }, t(LEADER_STATUS_LABELS[item.status])),
                        item.kind === 'task' && h('span', { className: 'gta-tag gta-tag-neutral' }, t('leaderTaskTag')),
                        LEADER_PROVENANCE_LABELS[item.provenance] && h('span', { className: 'gta-tag gta-tag-neutral' }, t(LEADER_PROVENANCE_LABELS[item.provenance]))),
                      item.summary && h('div', { className: 'gta-muted gta-meta gta-leader-summary' }, item.summary),
                      leaderNoteLines(item.notes, t).map((line) => h('div', { key: line, className: 'gta-muted gta-meta' }, line)),
                      item.actions !== null && item.maxActions !== null && h('div', { className: 'gta-muted gta-meta' },
                        `${t('leaderBudget')} ${item.actions}/${item.maxActions}${item.expiresAt ? ` · ${formatTime(item.expiresAt, '')}` : ''}`),
                      item.error && h('div', { className: 'gta-muted gta-attention gta-meta' }, item.error),
                    ), leaderItemActions(item),
                  ))),
              leaderUncertainTasks.length > 0 && h('div', { className: 'gta-banner gta-warn', role: 'status' },
                h('strong', null, t('leaderTasksUncertain')), h('p', { className: 'gta-muted' }, t('leaderTasksUncertainHint')),
                leaderUncertainTasks.map((task) => h('div', { key: task.taskId, className: 'gta-form-actions' },
                  h('span', null, [task.title || task.taskId, task.sessionId, task.error].filter(Boolean).join(' · ')),
                  h(Button, { disabled: !leaderFresh, onClick: () => { void runLeader('resolveTask', { taskId: task.taskId, action: 'dismiss' }); } }, t('leaderTaskDismiss'))))),
              leaderAudit.length > 0 && h('details', { className: 'gta-advanced gta-leader-audit' },
                h('summary', null, `${t('leaderAudit')} · ${leaderAudit.length}`),
                h('p', { className: 'gta-muted' }, t('leaderAuditHint')),
                h('div', { className: 'gta-list', role: 'list', 'aria-label': t('leaderAudit') }, leaderAudit.map((entry, index) =>
                  h('div', { key: `${entry.at}:${index}`, role: 'listitem', className: 'gta-muted gta-meta' },
                    [entry.at ? formatTime(entry.at, '') : '', LEADER_AUDIT_LABELS[entry.action] ? t(LEADER_AUDIT_LABELS[entry.action]) : entry.action,
                      entry.taskId, leaderAuditDetail(entry.detail)].filter(Boolean).join(' · '))))),
              h('div', { className: 'gta-section-title gta-subsection-title' }, h('h2', null, t('leaderHuman')), h('span', { className: 'gta-muted' }, leaderHuman.length)),
              h('p', { className: 'gta-muted' }, t('leaderNativeHuman')),
              h('p', { className: 'gta-muted' }, t('leaderRelayHint')),
              leaderHuman.length === 0 ? h('p', { className: 'gta-muted' }, t('leaderHumanEmpty'))
                : h('div', { className: 'gta-list gta-leader-list', role: 'list', 'aria-label': t('leaderHuman') }, leaderHuman.map((item) =>
                  h('article', { className: 'gta-todo', role: 'listitem', key: `human:${item.taskId}:${item.sessionId}` },
                    h('div', { className: 'gta-todo-main' }, h('div', { className: 'gta-todo-title' }, item.title || item.taskId),
                      item.alerts.filter((alert) => alert.status === 'pending').map((alert, index) =>
                        h('div', { key: alert.id || index, className: 'gta-muted gta-meta gta-leader-summary' }, alert.question,
                          alert.createdAt && h('span', null, ` · ${formatTime(alert.createdAt, '')}`))),
                      item.summary && h('div', { className: 'gta-muted gta-meta' }, item.summary),
                    ),
                    item.sessionId && h(Button, { onClick: (event) => openManagedIssue(item, event.currentTarget) }, t('leaderHumanOpen')),
                  ))),
            ),
          ),
          h('div', { className: 'gta-issue-toolbar' },
            workspaceError && h('div', { className: 'gta-banner gta-warn gta-issue-settings-error', role: 'status' }, `${t('workspacesError')}${colon()}${workspaceError}`),
            h('details', { className: 'gta-advanced gta-issue-settings', title: t('issueSessionSettingsHint') },
              h('summary', null, t('issueSessionSettings'),
                h('span', { className: 'gta-muted gta-issue-summary', title: settings.issueSessionCwd || '' }, issueSettingsSummary(issueModel, settings.issueSessionCwd, t)),
                busySet.has('settings') && h('span', { className: 'gta-muted', role: 'status' }, t('saving'))),
              workspaceData === null && !workspaceError && h('div', { className: 'gta-muted', role: 'status' }, t('loading')),
              h('div', { className: 'gta-form-grid' },
                h('label', null, t('issueSessionModel'), h('select', {
                  value: sessionModelKey(issueModel),
                  disabled: busySet.has('settings'),
                  'aria-label': t('issueSessionModel'),
                  onChange: (event) => { void updateIssueModel(event.target.value); },
                }, modelOptions(issueModel))),
                issueReasoning && h('label', null, t('reasoningEffort'), h('select', {
                  value: issueEffort,
                  disabled: busySet.has('settings'),
                  'aria-label': t('reasoningEffort'),
                  onChange: (event) => { void updateIssueEffort(event.target.value); },
                },
                  h('option', { value: '' }, `${t('reasoningEffortDefault')}${issueReasoning.defaultEffort
                    ? ` (${issueReasoning.efforts.find((effort) => effort.id === issueReasoning.defaultEffort)?.name ?? issueReasoning.defaultEffort})` : ''}`),
                  !issueEffortAdvertised && h('option', { value: issueEffort }, `${t('reasoningEffortUnavailable')}${colon()}${issueEffort}`),
                  issueReasoning.efforts.map((effort) => h('option', {
                    key: effort.id, value: effort.id, title: effort.description ?? '',
                  }, `${effort.name} · ${effort.id}`)),
                )),
                h('label', null, t('issueSessionCwd'), h('select', {
                  value: settings.issueSessionCwd ?? '',
                  disabled: busySet.has('settings'),
                  'aria-label': t('issueSessionCwd'),
                  onChange: (event) => { void updateSettings({ issueSessionCwd: event.target.value }); },
                },
                  h('option', { value: '' }, t('sessionCwdAuto')),
                  issueSessionCwdUnregistered && h('option', { value: settings.issueSessionCwd }, `${t('sessionCwdUnregistered')}${colon()}${settings.issueSessionCwd}`),
                  workspaceOptions.map((workspace) => h('option', { key: workspace.workspaceId, value: workspace.path },
                    `${workspace.title || workspace.path} · ${workspace.path}`)),
                )),
              ),
            ),
            h('div', { className: 'gta-todo-actions' },
              h(Button, { disabled: issuesBusy, onClick: () => { void fetchIssues(true); } },
                issuesBusy ? '…' : t('refresh')),
            ),
          ),
          issuesError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, `${t('issuesError')}${colon()}${issuesError}`),
          !issuesData && !issuesError && h('div', { className: 'gta-empty' }, t('loading')),
          issuesData && issuesData.items.length === 0 && issuesData.orphans.length === 0 && h('div', { className: 'gta-empty' }, t('issuesEmpty')),
          issuesData && searchableList.loaded > 0 && searchableList.matches === 0 && h('div', { className: 'gta-empty', role: 'status' }, t('searchNoMatches')),
          visibleIssues.length > 0 && h('div', { className: 'gta-list gta-scroll-list', role: 'list', 'aria-label': t('issuesTitle') },
            visibleIssues.map((issue) =>
              h('article', { role: 'listitem', className: 'gta-todo', key: issue.id },
                h('div', { className: 'gta-todo-main' },
                  h('div', { className: 'gta-todo-title' },
                    issue.url
                      ? h('a', { href: issue.url, target: '_blank', rel: 'noreferrer' }, issue.title)
                      : h('span', null, issue.title),
                    ...(Array.isArray(issue.labels) ? [
                      ...issue.labels.slice(0, 2).map((label) => h('span', { key: `label:${label}`, className: 'gta-tag gta-tag-neutral' }, label)),
                      issue.labels.length > 2 && h('span', {
                        key: 'label:more', className: 'gta-tag gta-tag-neutral', title: issue.labels.slice(2).join(', '),
                      }, `+${issue.labels.length - 2}`),
                    ] : []),
                    issue.handled && h('span', { className: `gta-tag ${recordStatusClass(issue)}` }, handledStatusLabel(issue, t)),
                    leaderItemForSession(leaderProjection, issue.id, issue.sessionId) && h('span', { className: 'gta-tag gta-tag-mention' }, t('leaderEnrolled')),
                    routedLabel(issue, t) && h('span', { className: 'gta-tag gta-tag-routed' }, routedLabel(issue, t)),
                  ),
                  h('div', { className: 'gta-muted gta-meta' }, [
                    `#${issue.iid ?? ''}`, issue.project,
                    issue.author && `@${issue.author}`,
                    issue.updatedAt && formatTime(Date.parse(issue.updatedAt), ''),
                    ...closureMeta(issue, t),
                  ].filter(Boolean).join(' · ')),
                ),
                h('div', { className: 'gta-todo-actions' },
                  issue.sessionId && h(Button, { onClick: (event) => openSession({ sessionId: issue.sessionId, taskId: issue.id, title: issue.title, url: issue.url, manualHandoffs: issue.manualHandoffs }, event.currentTarget) }, t('openSession')),
                  issueLeaderControl(issue),
                  h(Button, {
                    primary: !issue.handled,
                    disabled: busySet.has('settings') || busySet.has(`dispatch:${issue.id}`) || issue.executionStatus === 'running' || issue.executionStatus === 'starting',
                    onClick: issue.handled
                      ? guardedRun(`reprocess:${issue.id}`, () => { void dispatchIssue(issue); })
                      : () => { void dispatchIssue(issue); },
                  }, busySet.has(`dispatch:${issue.id}`) ? '…'
                    : issue.handled && confirmKeys.has(`reprocess:${issue.id}`) ? t('confirmReprocess')
                    : issue.handled ? t('reprocess') : t('process')),
                ),
              ))),
          visibleOrphans.length > 0 && h('div', { className: 'gta-section-title gta-subsection-title' },
            h('h2', null, t('issuesOrphans')),
            h('span', { className: 'gta-muted' }, `${visibleOrphans.length}`)),
          visibleOrphans.length > 0 && h('div', { className: 'gta-list', role: 'list', 'aria-label': t('issuesOrphans') },
            visibleOrphans.map((issue) =>
              h('article', { role: 'listitem', className: 'gta-todo', key: `orphan:${issue.id}` },
                h('div', { className: 'gta-todo-main' },
                  h('div', { className: 'gta-todo-title' },
                    issue.url
                      ? h('a', { href: issue.url, target: '_blank', rel: 'noreferrer' }, issue.title)
                      : h('span', null, issue.title),
                    h('span', { className: `gta-tag ${recordStatusClass(issue)}` }, handledStatusLabel(issue, t)),
                    leaderItemForSession(leaderProjection, issue.id, issue.sessionId) && h('span', { className: 'gta-tag gta-tag-mention' }, t('leaderEnrolled')),
                  ),
                  h('div', { className: 'gta-muted gta-meta' }, [
                    `#${issue.iid ?? ''}`, issue.project,
                    issue.sessionTitle,
                    ...closureMeta(issue, t),
                  ].filter(Boolean).join(' · ')),
                ),
                h('div', { className: 'gta-todo-actions' },
                  issue.sessionId && h(Button, { onClick: (event) => openSession({ sessionId: issue.sessionId, taskId: issue.id, title: issue.title, url: issue.url, manualHandoffs: issue.manualHandoffs }, event.currentTarget) }, t('openSession')),
                  issueLeaderControl(issue),
                ),
              ))),
        ),
        activeTab === 'handled' && snapshot && h('section', { className: 'gta-section', role: 'tabpanel', id: `${PANEL_ID}-panel-handled`, 'aria-labelledby': `${PANEL_ID}-tab-handled`, tabIndex: 0 },
          h('div', { className: 'gta-section-title' }, h('span', { className: 'gta-muted' },
            handledData ? `${handledData.items.length}/${handledData.total}` : `${snapshot.handledCount}`)),
          handledError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, `${t('handledTitle')}${colon()}${handledError}`),
          !handledData && !handledError && h('div', { className: 'gta-empty' }, t('loading')),
          handledData && handledData.total === 0 && h('div', { className: 'gta-empty' }, t('handledEmpty')),
          handledData && handledData.items.length > 0 && visibleHandled.length === 0 && h('div', { className: 'gta-empty', role: 'status' }, t('searchNoMatches')),
          visibleHandled.length > 0 && h('div', { className: 'gta-list gta-scroll-list', role: 'list', 'aria-label': t('handledTitle') }, visibleHandled.map((item) =>
                h('article', { role: 'listitem', className: 'gta-todo', key: `${item.todoId}-${item.round}` },
                  h('div', { className: 'gta-todo-main' },
                    h('div', { className: 'gta-todo-title' },
                      item.url
                        ? h('a', { href: item.url, target: '_blank', rel: 'noreferrer' }, item.title)
                        : h('span', null, item.title),
                      h('span', { className: `gta-tag ${recordStatusClass(item)}` }, handledStatusLabel(item, t)),
                      routedLabel(item, t) && h('span', { className: 'gta-tag gta-tag-routed' }, routedLabel(item, t)),
                      item.closure && handledStatusLabel(item, t) !== closureLabel(item.closure, t)
                        && h('span', { className: `gta-tag ${recordStatusClass({ closure: item.closure })}` }, closureLabel(item.closure, t)),
                      item.source === 'issue' && h('span', { className: 'gta-tag gta-tag-mention' }, t('issueTag')),
                      h('span', { className: 'gta-tag gta-tag-mention' }, item.automatic ? t('autoDispatch') : t('manualDispatch')),
                      item.archived && h('span', { className: 'gta-tag gta-tag-success' }, t('sessionArchived')),
                    ),
                    h('div', { className: 'gta-muted gta-meta' },
                      [`#${item.todoId}`, item.project,
                        item.round > 1 && `${t('roundLabel')} ${item.round}`,
                        item.mergedInto ? `${t('mergedIntoLabel')} #${item.mergedInto}` : '',
                        item.skipReason, item.reportSummary, item.closureNote,
                        item.sessionTitle && item.sessionId ? item.sessionTitle : '',
                        item.executionError,
                        item.archiveError,
                        item.waitProbes > 0 ? `${t('waitProbesLabel')}${item.waitProbes}` : '',
                        item.closure === 'follow-up' && item.nextAttemptAt ? `${t('nextAttempt')} ${formatTime(item.nextAttemptAt, '')}` : '',
                        `${item.completedAt ? formatTime(item.completedAt, '') : `${t('acceptedLabel')} ${formatTime(item.acceptedAt, '')}`}`,
                      ].filter(Boolean).join(' · ')),
                    item.excerpt && h('div', { className: 'gta-muted gta-meta' },
                      `${item.author ? `@${item.author}${colon()}` : ''}${item.excerpt}`),
                    h(ReplyPreview, { reply: item.lastReply, t }),
                  ),
                  h('div', { className: 'gta-todo-actions' },
                    // 有会话的记录：会话入口 + 归档切换（原「最近会话」Tab 的动作并入这里）；
                    // 无会话的记录（规则/预检跳过）：判定原因已在上面的 skipReason 行展示。
                    item.sessionId && h(Button, { onClick: (event) => openSession({ sessionId: item.sessionId, taskId: item.todoId, title: item.title, url: item.url, manualHandoffs: item.manualHandoffs }, event.currentTarget) }, t('openSession')),
                    item.sessionId && item.executionStatus !== 'starting' && item.routed !== true && h(Button, {
                      disabled: busySet.has(`archive:${item.sessionId}`) || (item.archived !== true && item.executionStatus === 'running'),
                      onClick: () => toggleSessionArchive(item),
                    }, busySet.has(`archive:${item.sessionId}`) ? '…' : (item.archived ? t('unarchiveSession') : t('archiveSession'))),
                  ),
                ),
              )),
          handledData && handledData.items.length < handledData.total && h('div', { className: 'gta-load-more' },
            h(Button, { disabled: Boolean(handledBusy), onClick: () => fetchHandled(true) }, handledBusy ? '…' : t('loadMore'))),
        ),
        activeTab === 'workspaces' && h('section', { className: 'gta-section', role: 'tabpanel', id: `${PANEL_ID}-panel-workspaces`, 'aria-labelledby': `${PANEL_ID}-tab-workspaces`, tabIndex: 0 },
          workspaceError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, `${t('workspacesError')}${colon()}${workspaceError}`),
          workspaceOptions.length === 0 && !workspaceError && h('div', { className: 'gta-empty' }, t('noWorkspaces')),
          h('div', { className: 'gta-list gta-scroll-list', role: 'list', 'aria-label': t('workspacesTitle') },
            workspaceOptions.map((workspace) =>
              h('article', { role: 'listitem', className: 'gta-todo gta-workspace', key: workspace.workspaceId || 'unassigned' },
                h('div', { className: 'gta-todo-main' },
                  h('div', { className: 'gta-todo-title' },
                    h('span', { className: 'gta-workspace-name', title: workspace.path },
                      workspace.unassigned ? t('unassignedWorkspace') : workspace.title || workspace.path || workspace.workspaceId),
                    workspace.configured && h('span', { className: 'gta-tag gta-tag-mention' }, t('configuredWorkspace')),
                    h('span', { className: 'gta-muted' }, `${t('sessionsTitle')}${colon()}${workspace.sessionCount}`),
                  ),
                  h('div', { className: 'gta-muted gta-meta' },
                    [workspace.path, workspace.updatedAt ? `${t('lastActive')}${colon()}${formatTime(workspace.updatedAt, '')}` : ''].filter(Boolean).join(' · ')),
                  h('div', { className: 'gta-workspace-sessions' },
                    workspace.sessions.length === 0
                      ? h('div', { className: 'gta-muted' }, t('noSessions'))
                      : workspace.sessions.map((session) =>
                          h('div', { className: 'gta-workspace-session', key: session.sessionId },
                            h('button', {
                              type: 'button', className: 'gta-session-link', title: session.sessionId,
                              onClick: (event) => openSession({ sessionId: session.sessionId, title: sessionDisplayName(session, t('sessionUnknown'), workspace.path) }, event.currentTarget),
                            }, sessionDisplayName(session, t('sessionUnknown'), workspace.path)),
                            h('span', { className: `gta-tag ${session.running ? '' : 'gta-tag-success'}` },
                              session.running ? t('executionRunning') : t('idle')),
                            session.plugin && h('span', { className: 'gta-tag gta-tag-mention' }, t('pluginSessionTag')),
                            session.archived && h('span', { className: 'gta-tag gta-tag-success' }, t('sessionArchived')),
                            h('span', { className: 'gta-muted gta-session-meta' },
                              [session.known ? '' : '·', session.updatedAt ? formatTime(session.updatedAt, '') : ''].filter(Boolean).join(' ')),
                          )),
                  ),
                ),
              )),
          ),
        ),
        activeTab === 'logs' && h('section', { className: 'gta-section', role: 'tabpanel', id: `${PANEL_ID}-panel-logs`, 'aria-labelledby': `${PANEL_ID}-tab-logs`, tabIndex: 0 },
          h('div', { className: 'gta-section-title' },
            h('div', { className: 'gta-todo-actions' },
              logData?.dropped > 0 && h('span', { className: 'gta-muted', title: `${logData.dropped} ${t('logsDropped')}` }, `-${logData.dropped}`),
              h(Button, {
                className: logFilter === 'all' ? 'gta-button-active' : '', pressed: logFilter === 'all',
                onClick: () => setLogFilter('all'),
              }, t('logsFilterAll')),
              h(Button, {
                className: logFilter === 'warn' ? 'gta-button-active' : '', pressed: logFilter === 'warn',
                onClick: () => setLogFilter('warn'),
              }, t('logsFilterWarn')),
              h(Button, {
                disabled: busySet.has('logs:clear') || !logData || logData.items.length === 0,
                onClick: guardedRun('logs:clear', () => { setLogFilter('all'); void perform('logs:clear', async () => { await post('logs', { clear: true }); await fetchLogs(); return { ok: true }; }); }),
              }, busySet.has('logs:clear') ? '…' : (confirmKeys.has('logs:clear') ? t('confirmClearLogs') : t('logsClear'))),
            )),
          logError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, `${t('logsError')}${colon()}${logError}`),
          !logData && !logError && h('div', { className: 'gta-empty' }, t('loading')),
          logData && logData.items.length === 0 && h('div', { className: 'gta-empty' }, t('logsEmpty')),
          logData && logData.items.length > 0 && h('div', { className: 'gta-list gta-scroll-list', role: 'list', 'aria-label': t('logsTitle') },
            (logFilter === 'warn' ? logData.items.filter((entry) => entry.level === 'warn' || entry.level === 'error') : logData.items).map((entry, index) =>
              h('article', { role: 'listitem', className: 'gta-todo', key: `${entry.ts}-${index}` },
                h('div', { className: 'gta-todo-main' },
                  h('div', { className: 'gta-todo-title', style: { fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
                    h('span', { className: 'gta-muted', style: { marginRight: '8px', flexShrink: 0 } }, formatTime(entry.ts, '')),
                    h('span', {
                      className: `gta-tag ${entry.level === 'warn' ? 'gta-tag-attention' : entry.level === 'error' ? 'gta-tag-error' : 'gta-tag-neutral'}`,
                      style: { marginRight: '8px', minWidth: '44px', textAlign: 'center', flexShrink: 0 },
                    }, (entry.level ?? 'info').toUpperCase()),
                    h('span', { style: { flex: 1 } }, entry.message),
                  ),
                ),
              ))),
        ),
        sessionEntry && h('div', {
          className: 'gta-route-backdrop',
          onClick: (event) => { if (event.target === event.currentTarget) closeSessionEntry(); },
        }, h('div', {
          className: 'gta-route-dialog gta-session-dialog', role: 'dialog', 'aria-modal': true,
          'aria-labelledby': `${PANEL_ID}-session-heading`, ref: sessionDialogRef, tabIndex: -1,
        },
          h('div', { className: 'gta-route-header' },
            h('h2', { id: `${PANEL_ID}-session-heading`, className: 'gta-route-heading' }, t('sessionEntryTitle')),
            h(Button, { onClick: closeSessionEntry }, t('close'))),
          h('div', { className: 'gta-muted gta-meta' }, sessionEntry.title, ' · ', sessionEntry.sessionId),
          sessionEntry.url && h('a', { href: sessionEntry.url, target: '_blank', rel: 'noreferrer', className: 'gta-reply-link' }, sessionEntry.url),
          h('div', { className: 'gta-banner gta-warn', role: 'status', 'aria-live': 'polite' },
            sessionEntry.busy ? t('sessionChecking')
              : t(sessionEntry.result?.status === 'missing' ? 'sessionMissingNotice'
                : sessionEntry.result?.status === 'archived' ? 'sessionArchivedNotice' : 'sessionUnknownNotice'),
            sessionEntry.result?.reasonKey && ` ${t(sessionEntry.result.reasonKey)}`,
            sessionEntry.result?.reason && ` ${sessionEntry.result.reason}`),
          sessionEntry.error && h('div', { className: 'gta-banner gta-warn', role: 'alert' }, sessionEntry.error),
          Array.isArray(sessionEntry.manualHandoffs) && sessionEntry.manualHandoffs.length > 1 && h('div', { className: 'gta-todo-actions' },
            sessionEntry.manualHandoffs.map((handoff) => h(Button, { key: handoff.requestId || handoff.sessionId, disabled: sessionEntry.busy,
              onClick: () => updateSessionEntry({ ...sessionEntryRef.current, handoff, copied: false }),
            }, handoff.sessionId || t('sessionHandoffUncertain')))),
          sessionEntry.handoff && h('div', { className: 'gta-handoff-context' },
            h('p', { className: 'gta-muted' }, t(!sessionEntry.handoff.sessionId || ['creating', 'creation-unknown'].includes(sessionEntry.handoff.status) ? 'sessionHandoffUncertain'
              : sessionEntry.error || sessionEntry.handoff.error || sessionEntry.handoff.status === 'created' ? 'sessionHandoffPartial' : 'sessionHandoffReady')),
            sessionEntry.handoff.error && h('div', { className: 'gta-banner gta-warn', role: 'status' }, sessionEntry.handoff.error),
            h('div', { className: 'gta-muted gta-meta' }, sessionEntry.handoff.sessionId),
            h('textarea', { readOnly: true, rows: 7, value: sessionEntry.handoff.handoffText || '', 'aria-label': t('sessionHandoffContext') }),
            h('div', { className: 'gta-todo-actions' },
              h(Button, { disabled: !sessionEntry.handoff.handoffText, onClick: () => { void copyHandoff(); } }, sessionEntry.copied ? t('sessionCopied') : t('sessionCopyContext')),
              sessionEntry.handoff.sessionId && h(Button, { disabled: sessionEntry.busy, onClick: () => runSessionAccess(false, sessionEntry.handoff.sessionId) }, t('openSession')))),
          !sessionEntry.handoff && sessionEntry.taskId != null && sessionEntry.result?.status === 'missing'
            && h('p', { className: 'gta-muted' }, t('sessionHandoffHint')),
          h('div', { className: 'gta-route-footer' },
            h(Button, { disabled: sessionEntry.busy, onClick: () => runSessionAccess(false, sessionEntry.result?.sessionId || sessionEntry.sessionId) }, t('sessionRetry')),
            sessionEntry.result?.status === 'archived' && h(Button, { primary: true, disabled: sessionEntry.busy,
              onClick: () => runSessionAccess(true, sessionEntry.result.sessionId) }, t('sessionRestoreOpen')),
            canCreateSessionHandoff(sessionEntry) && h(Button, { disabled: sessionEntry.busy, onClick: createHandoff },
              sessionEntry.handoff?.sessionId
                ? t(sessionEntry.confirmCreate ? 'sessionConfirmHandoffSetup' : 'sessionRetryHandoff')
                : t(sessionEntry.confirmCreate ? 'sessionConfirmHandoff' : 'sessionHandoff'))),
          h('p', { className: 'gta-muted' }, t('sessionCloseHint')),
        )),
        routeTodo && h('div', {
          className: 'gta-route-backdrop',
          onMouseDown: (event) => { if (event.target === event.currentTarget) closeRouteTargets(); },
        },
          h('section', {
            className: 'gta-route-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'gta-route-title',
            ref: routeDialogRef, tabIndex: -1,
          },
            h('div', { className: 'gta-route-header' },
              h('div', { className: 'gta-route-heading' },
                h('h2', { id: 'gta-route-title' }, t('routeToSession')),
                h('p', { className: 'gta-muted gta-route-todo', title: routeTodo.title }, routeTodo.title),
              ),
              h(Button, { onClick: closeRouteTargets }, t('close')),
            ),
            routeData && h('div', { className: 'gta-route-summary gta-muted' },
              h('span', null, `${t('routeScope')}${colon()}${routeData.scope === 'any' ? t('routeScopeAny') : t('routeScopePlugin')}`),
              h('span', null, `${t('busyRouteMode')}${colon()}${routeData.busyRouteMode === 'steer' ? t('busyRouteSteer') : t('busyRouteQueue')}`),
              h('span', null, `${t('maxQueuePerSession')}${colon()}${routeMaxQueue}`),
            ),
            routeError && h('div', { className: 'gta-banner gta-error gta-route-error', role: 'alert' }, `${t('localError')}${colon()}${routeError}`),
            h('div', { className: 'gta-route-tools' },
              h('input', {
                type: 'text', value: routeSearch, placeholder: t('routeSearch'), 'aria-label': t('routeSearch'),
                disabled: !routeData || routeLoading,
                onChange: (event) => setRouteSearch(event.target.value),
              }),
              h(Button, {
                disabled: routeLoading || busySet.has(`route:${routeTodo.id}`),
                onClick: () => loadRouteTargets(routeTodo.id),
              }, routeLoading ? '…' : t('refresh')),
            ),
            routeLoading && !routeData && h('div', { className: 'gta-empty' }, t('routeLoading')),
            routeData && !routeLoading && allRouteItems.length === 0 && h('div', { className: 'gta-empty' }, t('routeEmpty')),
            routeData && !routeLoading && allRouteItems.length > 0 && routeItems.length === 0 && h('div', { className: 'gta-empty' }, t('routeNoMatches')),
            routeData && routeItems.length > 0 && h('div', { className: 'gta-route-targets', role: 'group', 'aria-label': t('routeToSession') },
              routeItems.map((item) => h('label', {
                key: item.sessionId,
                className: `gta-route-target${routeSelection === item.sessionId ? ' gta-route-target-selected' : ''}`,
                'aria-disabled': item.accepting === false || busySet.has(`route:${routeTodo.id}`),
              },
                h('input', {
                  type: 'radio', name: `${PANEL_ID}-route-target`, value: item.sessionId,
                  checked: routeSelection === item.sessionId,
                  disabled: item.accepting === false || busySet.has(`route:${routeTodo.id}`),
                  onChange: () => setRouteSelection(item.sessionId),
                }),
                h('span', { className: 'gta-route-target-main' },
                  h('span', { className: 'gta-route-target-title' },
                    h('span', { className: 'gta-route-target-name', title: item.title }, item.title || t('sessionUnknown')),
                    item.sameTarget === true && h('span', { className: 'gta-tag gta-tag-mention' }, t('routeSameTarget')),
                    item.plugin === true && h('span', { className: 'gta-tag gta-tag-mention' }, t('pluginSessionTag')),
                    item.running === true && h('span', { className: 'gta-tag' }, t('executionRunning')),
                    item.running === true && h('span', { className: 'gta-tag gta-tag-routed' },
                      routeData.busyRouteMode === 'steer' ? t('routeModeSteer') : t('routeModeQueue')),
                    item.accepting === false && h('span', { className: 'gta-tag' }, t('routeNotAccepting')),
                  ),
                  h('span', {
                    className: 'gta-muted gta-route-target-meta', title: [item.sessionId, item.cwd].filter(Boolean).join(' · '),
                  }, [item.sessionId, item.cwd, item.updatedAt ? `${t('lastActive')}${colon()}${formatTime(item.updatedAt, '')}` : ''].filter(Boolean).join(' · ')),
                ),
                h('span', { className: 'gta-route-load', title: t('maxQueuePerSession') }, `${t('routeLoad')} ${item.load ?? 0}/${routeMaxQueue}`),
              ))),
            h('div', { className: 'gta-route-footer' },
              h(Button, {
                primary: true,
                disabled: !selectedRouteTarget || selectedRouteTarget.accepting === false || routeLoading || busySet.has(`route:${routeTodo.id}`),
                onClick: () => routeToSession(selectedRouteTarget),
              }, busySet.has(`route:${routeTodo.id}`) ? '…' : t('routeConfirm')),
            ),
          ),
        ),
      );
    }

    const CSS = `
      .gta-root{box-sizing:border-box;width:100%;min-width:0;height:100%;min-height:320px;overflow:auto;padding:12px 16px 20px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45}
      .gta-root *{box-sizing:border-box}
      .gta-root h1{font-size:17px;line-height:1.25;margin:0;font-weight:650}
      .gta-root h2{font-size:15px;margin:0 0 10px;font-weight:600}
      .gta-root p{margin:4px 0 0}
      .gta-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;max-width:1180px;margin:0 auto}
      .gta-title-row{display:flex;align-items:center;gap:8px}
      .gta-title-icon{color:var(--dsw-alias-brand-primary);display:flex}
      .gta-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      .gta-model-quick{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .gta-root .gta-model-quick select{width:auto;min-width:140px;max-width:240px}
      .gta-button{appearance:none;min-height:28px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 9px;font-family:inherit;font-size:12px;line-height:1.4;cursor:pointer;white-space:nowrap}
      .gta-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary)}
      .gta-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .gta-button:disabled{opacity:.45;cursor:default}
      .gta-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
      .gta-button-active:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
      .gta-muted{color:var(--dsw-alias-label-secondary);font-size:12px}
      .gta-success{color:var(--dsw-alias-state-success-primary)}
      .gta-attention{color:var(--dsw-alias-state-warn-primary)}
      .gta-banner{max-width:1180px;min-width:0;overflow-wrap:anywhere;margin:8px auto;padding:8px 10px;border-radius:6px;border:1px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1)}
      .gta-warn{border-color:var(--dsw-alias-state-warn-primary)}
      .gta-card,.gta-stats,.gta-section{max-width:1180px;margin:10px auto}
      .gta-card{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);padding:10px}
      .gta-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:10px 14px}
      .gta-form-grid label{display:flex;flex-direction:column;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px}
      .gta-wide{grid-column:1/-1}
      .gta-root input[type=text],.gta-root input[type=password],.gta-root input[type=number],.gta-root select,.gta-root textarea{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;padding:5px 8px}
      .gta-root textarea{resize:vertical;line-height:1.45}
      .gta-check{display:flex;align-items:center;gap:7px;margin:0;font-size:12px}
      .gta-checks-main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:8px 14px;margin-top:12px}
      .gta-form-actions{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap}
      .gta-stats{display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;padding:0 0 6px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .gta-stat{display:flex;align-items:baseline;gap:5px;padding:2px 0;white-space:nowrap}
      .gta-stat>span{color:var(--dsw-alias-label-secondary);font-size:11.5px}
      .gta-stat>strong{font-size:13px;font-weight:600}
      .gta-stat-time{margin-left:auto;border-right:0}
      .gta-stat-time>strong{font-size:12px}
      .gta-section-title{display:flex;align-items:center;justify-content:flex-end;gap:12px;min-height:28px;margin-bottom:8px}
      .gta-section-title h2{margin:0}
      .gta-leader{margin:0 0 10px;min-width:0}
      .gta-leader-head{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;min-width:0}
      .gta-leader-head>.gta-button:first-child{white-space:normal;text-align:left}
      .gta-leader-head>.gta-check{min-height:28px;flex-wrap:wrap}
      .gta-leader-body{margin-top:8px;min-width:0;overflow-wrap:anywhere}
      .gta-leader-body>.gta-banner{max-width:none;margin:8px 0}
      .gta-leader-settings{margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))}
      .gta-leader-settings select{min-height:28px}
      .gta-leader-list{margin-top:6px;max-height:300px;overflow:auto;overscroll-behavior:contain}
      .gta-leader-list .gta-todo-title{overflow-wrap:anywhere}
      .gta-leader-summary{white-space:pre-wrap;max-height:84px;overflow:auto}
      .gta-issue-toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      .gta-issue-settings-error{flex-basis:100%;min-width:0;overflow-wrap:anywhere}
      .gta-issue-settings{flex:1 1 300px;min-width:0}
      .gta-issue-settings[open]{flex:1 1 720px}
      .gta-issue-settings>.gta-form-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))}
      .gta-subsection-title{justify-content:space-between;margin-top:14px}
      .gta-feedback{max-width:1180px;margin:4px auto}
      .gta-poll-state{font-size:12px}
      .gta-needs-human{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);font-weight:650}
      .gta-tab-group{padding:6px 4px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
      .gta-tab-group-environment{margin-left:auto;border-left:1px solid var(--dsw-alias-border-l1);padding-left:12px}
      .gta-tab-count{margin-left:6px;font-size:11px;font-weight:600}
      .gta-list-tools{max-width:1180px;margin:8px auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .gta-list-search{display:flex;align-items:center;gap:8px;flex:1 1 250px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px}
      .gta-list-search>span{flex:none}
      .gta-root input[type=search]{min-width:0;width:100%;min-height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:4px 8px}
      .gta-todo-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}
      .gta-new-count{margin-left:auto}
      .gta-issue-summary{margin-left:10px;overflow-wrap:anywhere}
      .gta-tag.gta-tag-attention{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
      .gta-tag.gta-tag-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
      .gta-root :is(input,select,textarea,summary,.gta-session-link,.gta-reply-toggle):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .gta-section:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .gta-root .gta-route-target input[type=radio]{width:auto;flex:none;accent-color:var(--dsw-alias-brand-primary)}
      .gta-tabs{max-width:1180px;margin:8px auto 0;display:flex;flex-wrap:wrap;align-items:center;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;scrollbar-width:thin}
      .gta-tab{appearance:none;flex:none;margin-bottom:-1px;padding:6px 10px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
      .gta-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
      .gta-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .gta-tab-active{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600}
      .gta-list{display:flex;flex-direction:column;gap:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;overflow:hidden}
      .gta-load-more{display:flex;justify-content:center;padding:8px 0 2px}
      .gta-scroll-list{padding:0}
      .gta-todo{display:flex;align-items:center;gap:10px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
      .gta-todo:last-child{border-bottom:0}
      .gta-todo-main{min-width:0;flex:1}
      .gta-todo-title{display:flex;align-items:center;gap:4px 8px;flex-wrap:wrap;font-weight:550;line-height:1.35}
      .gta-todo-title>a{color:var(--dsw-alias-label-primary);text-decoration:none;min-width:0;max-width:100%;flex:1 1 220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gta-todo-title>a:hover{color:var(--dsw-alias-brand-primary);text-decoration:underline}
      .gta-tag{flex:none;font-size:10.5px;line-height:1.5;padding:0 6px;border-radius:9px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}
      .gta-tag-success{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
      .gta-tag-mention{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
      .gta-tag-neutral{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}
      .gta-meta{margin-top:3px;overflow-wrap:anywhere}
      .gta-todo-actions{display:flex;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end;max-width:100%}
      .gta-session-list{max-height:min(40vh,360px)}
      .gta-workspace{flex-direction:column;align-items:stretch;gap:8px}
      .gta-workspace-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gta-workspace-sessions{display:flex;flex-direction:column;gap:4px;margin-top:2px}
      .gta-workspace-session{display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);min-width:0}
      .gta-session-link{appearance:none;min-height:28px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-weight:550;padding:2px 0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0}
      .gta-session-link:hover{color:var(--dsw-alias-brand-primary);text-decoration:underline}
      .gta-session-name{font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0}
      .gta-session-meta{margin-left:auto;flex:none}
      .gta-advanced{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base)}
      .gta-advanced>summary{padding:7px 10px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);list-style:none;user-select:none}
      .gta-advanced>summary::-webkit-details-marker{display:none}
      .gta-advanced>summary::before{content:'>';display:inline-block;margin-right:7px;transition:transform .12s;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-border-l2))}
      .gta-advanced[open]>summary::before{transform:rotate(90deg)}
      .gta-advanced>.gta-form-grid{padding:4px 10px 10px}
      .gta-classifier{padding:4px 10px 10px}
      .gta-security-hint{margin:8px 0 0}
      .gta-advanced .gta-checks{grid-column:1/-1;display:flex;flex-direction:column;gap:6px}
      .gta-advanced .gta-check{margin-top:2px}
      .gta-empty{padding:14px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;text-align:center;color:var(--dsw-alias-label-secondary)}
      .gta-fatal{max-width:720px;margin:48px auto;padding:24px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
      .gta-fatal p{white-space:pre-wrap;word-break:break-word;margin:12px 0 20px;color:var(--dsw-alias-state-error-primary)}
      .gta-root .gta-tag-routed{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
      .gta-root .gta-route-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 38%,transparent)}
      .gta-root .gta-route-dialog{display:flex;flex-direction:column;width:min(680px,100%);max-height:min(80dvh,680px);overflow:hidden;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 60px color-mix(in srgb,var(--dsw-alias-label-primary) 25%,transparent)}
      .gta-root .gta-route-header{display:flex;align-items:center;gap:12px;flex:none}
      .gta-root .gta-route-heading{min-width:0;flex:1}
      .gta-root .gta-route-heading h2{margin:0}
      .gta-root .gta-route-todo{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gta-root .gta-route-summary{display:flex;gap:4px 12px;flex-wrap:wrap;flex:none;margin-top:8px}
      .gta-root .gta-route-error{max-width:none;margin:8px 0;flex:none}
      .gta-root .gta-route-tools{display:flex;align-items:center;gap:6px;flex:none;margin:10px 0 8px}
      .gta-root .gta-route-tools input{flex:1;min-width:0}
      .gta-root .gta-route-dialog>.gta-empty{flex:none}
      .gta-root .gta-route-targets{display:flex;flex:1 1 auto;flex-direction:column;gap:6px;min-height:80px;overflow-y:auto;overscroll-behavior:contain;padding:2px;scrollbar-width:thin}
      .gta-root .gta-route-target{appearance:none;width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
      .gta-root .gta-route-target:hover:not([aria-disabled=true]){border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
      .gta-root .gta-route-target:focus-within{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .gta-root .gta-route-target[aria-disabled=true]{opacity:.5;cursor:default}
      .gta-root .gta-route-target-selected:not([aria-disabled=true]){border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
      .gta-root .gta-route-target-main{display:block;min-width:0;flex:1}
      .gta-root .gta-route-target-title{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-weight:550}
      .gta-root .gta-route-target-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gta-root .gta-route-target-meta{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gta-root .gta-route-load{flex:none;margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:11.5px;white-space:nowrap}
      .gta-root .gta-route-footer{display:flex;justify-content:flex-end;gap:6px;flex:none;padding-top:10px}
      .gta-root .gta-session-dialog{overflow-y:auto;overscroll-behavior:contain;overflow-wrap:anywhere}
      .gta-session-dialog .gta-route-footer{flex-wrap:wrap}
      .gta-handoff-context{min-width:0}
      .gta-handoff-context textarea{box-sizing:border-box;display:block;width:100%;resize:vertical;min-height:100px;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;white-space:pre-wrap}
      .gta-reply{margin-top:2px}
      .gta-reply-toggle{appearance:none;min-height:28px;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;padding:0;cursor:pointer}
      .gta-reply-toggle:hover{text-decoration:underline}
      .gta-reply-body{margin-top:5px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px}
      .gta-reply-link{color:var(--dsw-alias-brand-primary);text-decoration:none;margin-right:6px}
      .gta-digest-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .gta-digest-head h2{margin:0}
      .gta-digest-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
      .gta-digest-list li{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px}
      .gta-digest-list a{color:var(--dsw-alias-label-primary);text-decoration:none}
      .gta-digest-list a:hover{color:var(--dsw-alias-brand-primary)}
      .gta-digest-note,.gta-digest-reply{flex-basis:100%}
      @media(max-width:720px){.gta-root{padding:12px 12px 20px}
      .gta-header{align-items:flex-start;flex-direction:column}
      .gta-tab-group-environment{margin-left:0}
      .gta-issue-summary{display:block;margin:4px 0 0}
      .gta-list-search{flex-wrap:wrap;flex-basis:100%}
      .gta-new-count{margin-left:0}
      .gta-actions{justify-content:flex-start;width:100%}
      .gta-model-quick{flex:1 1 100%}
      .gta-root .gta-model-quick select{flex:1;max-width:none}
      .gta-todo{align-items:flex-start;flex-direction:column}
      .gta-todo-actions{width:100%;justify-content:flex-end}
      .gta-stat-time{margin-left:0}}
      @media(max-width:640px){.gta-root{padding:12px 12px 20px}
      .gta-stats{display:flex;flex-wrap:wrap;padding:0 0 6px}
      .gta-stat{padding:2px 0;white-space:normal}
      .gta-stat-time{flex-basis:100%}
      .gta-root .gta-route-backdrop{padding:8px}
      .gta-root .gta-route-dialog{padding:12px;max-height:calc(100dvh - 16px)}}
    `;

    return {
      inject: ['slots', 'locale', 'uiWorkspace', 'sessions', 'workspaces', 'connection'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'gitlab-todo-agent: locale');
        const t = ctx.locale.bind(NS);
        // bridge 抛错早于任何组件渲染，注入 bind 后的 t 让超时/网络错误文案跟随当前 locale。
        bridgeText = t;
        function MainPanel() {
          return h(PanelBoundary, { t }, h(TodoPanel, { ctx, t }));
        }
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, MainPanel));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS,
          label: () => t('panel'),
        }, PanelIcon));
      },
    };
  },
});
