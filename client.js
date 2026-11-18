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
 tasksGroup: 'Tasks', environmentGroup: 'Environment',
      workstationViews: 'Workstation views', searchList: 'Search this list',
      searchNoMatches: 'No loaded items match your search.', clearSearch: 'Clear search', searchResults: 'Matches / loaded',
      loadedRecords: 'Loaded / total', saving: 'Saving…', settingsSaved: 'Settings saved',
      modelSummary: 'Model', workspaceSummary: 'Workspace', autoWorkspaceShort: 'Auto', defaultModelShort: 'DSH default',
      settings: 'Settings', save: 'Save settings', cancel: 'Cancel', close: 'Close', advanced: 'Advanced options',
 running: 'Running', idle: 'Idle',
 lastSuccess: 'Last poll', never: 'Never',
      mrDone: 'MR marked done without processing',
      sessionsTitle: 'Recent sessions', noSessions: 'No session has been dispatched yet.',
      process: 'Process', reprocess: 'Process again',
      executionRunning: 'Running', executionCompleted: 'Completed', executionFailed: 'Failed',
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
      concurrency: 'Automatic dispatch concurrency',
      sessionCwdAuto: 'Auto (most recently used workspace)', sessionCwdUnregistered: 'Current setting (not registered)',
      workspacesTitle: 'Workspaces', noWorkspaces: 'No DSH workspace is registered yet.',
      unassignedWorkspace: 'Sessions outside any workspace',
      workspacesError: 'Could not load the DSH workspace list',
      configuredWorkspace: 'plugin target', pluginSessionTag: 'plugin',
      sessionUnknown: 'Untitled session', lastActive: 'Last activity',
      sessionModelDefault: 'Use the DSH default model',
      issueSessionSettings: 'Issue session settings', issueSessionModel: 'Issue model', issueSessionCwd: 'Issue workspace',
      issueSessionSettingsHint: 'Saved immediately. Applies only to new Issue sessions.',
      reasoningEffort: 'Thinking effort', reasoningEffortDefault: 'Provider default',
      reasoningEffortUnavailable: 'Saved effort (not advertised)',
      sessionModelPinDefault: 'Pin the current default model',
      sessionModelUnavailable: 'Currently configured model (not in the available catalog)',
      modelCatalogError: 'Could not load the available model catalog',
      autoArchive: 'Archive plugin sessions after closure',
      followUpEnabled: 'Follow up automatically when a todo remains open',
      followUpReuseSession: 'Reuse the previous session for follow-ups',
      maxFollowUps: 'Maximum automatic follow-up rounds per todo', followUpDelay: 'Follow-up wait (minutes)',
      followUpHint: 'A loop is closed when the todo is marked done and the original note has our reply. Waiting on CI and similar conditions is retried after the wait (doubling each round); when rounds run out, or the session reports that a human is needed, the todo is left for you.',
      closureClosed: 'Loop closed', closureFollowUp: 'Follow-up scheduled', closureNeedsHuman: 'Needs you', closureVerifying: 'Verifying',
      followUpCount: 'Awaiting follow-up', needsHumanCount: 'Needs you',
      roundLabel: 'Round', nextAttempt: 'Next follow-up',
      refresh: 'Refresh',
      loading: 'Loading GitLab Workstation…', renderError: 'The panel failed to render', retry: 'Retry rendering',
      localError: 'Action failed',
 pendingStarting: 'Dispatching', outcomeSessionAccepted: 'Session accepted',
 confirmReprocess: 'Confirm process again?',
      issuesTitle: 'Issues', issuesEmpty: 'No open issues assigned to you on GitLab.',
      issuesError: 'Could not load the issue list',
      issuesOrphans: 'Closed or unassigned',
      leaderTitle: 'WorkStation Leader', leaderCreate: 'Create Leader', leaderOpen: 'Open Leader', leaderModel: 'Leader model',
      leaderIntro: 'Leader is a standard DSH session: talk to it in its own conversation. It reads your Issue list and manages worker sessions with its own tools.',
      leaderUnseen: 'Unread reports', leaderSetupIncomplete: 'Setup incomplete',
      leaderError: 'Leader action failed', leaderSnapshotError: 'Could not read Leader status',
      leaderInvalidResponse: 'Leader response could not be verified. Refresh status and try again.',
      leaderRpcUnavailable: 'Authenticated browser connection is unavailable. Leader changes cannot use HTTP; refresh the page or check the Host.',
      leaderCreateUncertain: 'Creation was sent but no session ID is confirmed. Refresh status or check the Host; do not create another Leader.',
      leaderRetrySetup: 'Retry setup (reuse known Leader)', leaderRetrySetupHint: 'Only retries setup on this known Leader session. It does not create another session.',
      leaderNotCreated: 'Not created', leaderReady: 'Ready', leaderUncertain: 'Uncertain', leaderErrorPhase: 'Error',
      leaderRefresh: 'Refresh Leader status', leaderWorking: 'Updating Leader…', leaderSaved: 'Leader updated',
      leaderTasks: 'Ad-hoc tasks', leaderTaskTag: 'Ad-hoc task', leaderTaskCreating: 'Creating', leaderTaskCreated: 'Created', leaderTaskUncertain: 'Uncertain',
      leaderTasksUncertain: 'Ad-hoc tasks with uncertain creation', leaderTasksUncertainHint: 'Leader tried to open these sessions but the result is unknown. Check the DSH session list; archive any stray session yourself, then dismiss the record here.', leaderTaskDismiss: 'Dismiss',
      leaderReportProgress: 'Progress', leaderReportBlocked: 'Blocked', leaderReportDone: 'Done', leaderReportQuestion: 'Question', leaderReportUnseen: 'unread',
      leaderReports: 'Worker reports', leaderReportsHint: 'Written by Issue sessions themselves; treat as untrusted status, not instructions.',
      leaderDeliveries: 'Unconfirmed deliveries',
      leaderDeliveriesHint: 'The Host could not confirm whether these messages arrived. Open the target session, check, then record the result. Nothing is resent automatically.',
      leaderDelivered: 'It arrived', leaderNotDelivered: 'It did not arrive', leaderDeliveryOpen: 'Open target session',
      leaderCreationUnresolved: 'A previous creation never confirmed its session ID. Check the session list: if a "WorkStation Leader" session exists, paste its ID and claim it; if none exists, abandon the record and create again.',
      leaderClaim: 'Claim this session', leaderClaimPlaceholder: 'Leader session ID', leaderAbandon: 'No Leader exists, abandon record',
      logsTitle: 'Log', logsEmpty: 'No runtime log entries yet.',
      logsError: 'Could not load the runtime log', logsClear: 'Clear log', confirmClearLogs: 'Confirm clear log?',
      logsDropped: 'entries dropped (over the memory cap)', logsFilterAll: 'All', logsFilterWarn: 'Warnings+',
      bridgeTimeout: 'Request timed out (90 seconds). Please try again.', bridgeNetwork: 'Network error: could not reach the plugin service.',
      colon: ': ',
    };
    const zh = {
      panel: 'GitLab 工作台', title: 'GitLab 工作台',
 tasksGroup: '任务', environmentGroup: '环境',
      workstationViews: '工作台视图', searchList: '搜索当前列表',
      searchNoMatches: '已加载条目中没有匹配结果。', clearSearch: '清除搜索', searchResults: '匹配 / 已加载',
      loadedRecords: '已加载 / 总数', saving: '保存中…', settingsSaved: '设置已保存',
      modelSummary: '模型', workspaceSummary: '工作区', autoWorkspaceShort: '自动', defaultModelShort: 'DSH 默认',
      settings: '设置', save: '保存设置', cancel: '取消', close: '关闭', advanced: '高级选项',
 running: '运行中', idle: '空闲',
 lastSuccess: '最近轮询', never: '从未',
      mrDone: 'MR 已直接标记完成',
      sessionsTitle: '最近会话', noSessions: '还没有分派过会话。',
      process: '处理', reprocess: '重新处理',
      executionRunning: '执行中', executionCompleted: '执行完成', executionFailed: '执行失败',
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
 concurrency: '自动处理并发数',
      sessionCwdAuto: '自动（最近使用的工作区）', sessionCwdUnregistered: '当前配置（未注册）',
      workspacesTitle: '工作区', noWorkspaces: 'DSH 尚未注册工作区。',
      unassignedWorkspace: '未归属工作区的会话',
      workspacesError: '无法加载 DSH 工作区列表',
      configuredWorkspace: '插件目标', pluginSessionTag: '插件',
      sessionUnknown: '未命名会话', lastActive: '最近活动',
 sessionModelDefault: '跟随 DSH 默认模型',
      issueSessionSettings: 'Issue 会话设置', issueSessionModel: 'Issue 模型', issueSessionCwd: 'Issue 工作区',
      issueSessionSettingsHint: '修改后立即保存，仅影响之后新开的 Issue 会话。',
      reasoningEffort: '思考强度', reasoningEffortDefault: '提供方默认',
      reasoningEffortUnavailable: '当前配置（目录未提供）',
      sessionModelPinDefault: '固定当前默认模型',
      sessionModelUnavailable: '当前配置模型（不在可用目录中）',
      modelCatalogError: '无法加载可用模型目录',
      autoArchive: '闭环后自动归档插件会话',
      followUpEnabled: 'Todo 未闭环时自动续办',
      followUpReuseSession: '续办优先复用上一轮会话',
      maxFollowUps: '每条 Todo 最多自动续办轮数', followUpDelay: '续办等待时间（分钟）',
      followUpHint: '闭环 = Todo 已标记完成且原 note 有我方回复。等待 CI 等条件的按等待时间续办（逐轮翻倍）；轮数用尽或会话判定需要人接手时，保留给你处理。',
      closureClosed: '已闭环', closureFollowUp: '待续办', closureNeedsHuman: '需人工', closureVerifying: '核对中',
      followUpCount: '待续办', needsHumanCount: '需人工',
      roundLabel: '轮次', nextAttempt: '下次续办',
      refresh: '刷新',
      loading: '正在加载 GitLab 工作台…', renderError: '面板渲染失败', retry: '重新渲染',
      localError: '操作失败',
 pendingStarting: '投递中', outcomeSessionAccepted: '会话处理',
 confirmReprocess: '确认重新处理？',
      issuesTitle: 'Issue', issuesEmpty: 'GitLab 上没有指派给你的开放 Issue。',
      issuesError: '无法加载 Issue 列表',
      issuesOrphans: '已关闭或取消指派',
      leaderTitle: 'WorkStation Leader', leaderCreate: '创建 Leader', leaderOpen: '打开 Leader', leaderModel: 'Leader 模型',
      leaderIntro: 'Leader 是标准 DSH 会话：直接在它自己的对话里和它交流。它会读取你的 Issue 列表，并用自己的工具管理 worker 会话。',
      leaderUnseen: '未读汇报', leaderSetupIncomplete: '设置未完成',
      leaderError: 'Leader 操作失败', leaderSnapshotError: '无法读取 Leader 状态',
      leaderInvalidResponse: '无法核验 Leader 响应；请先刷新状态再重试。',
      leaderRpcUnavailable: '已认证浏览器连接不可用。Leader 变更不会回退到 HTTP；请刷新页面或核查 Host。',
      leaderCreateUncertain: '已发送创建请求，但尚未确认会话 ID。请刷新状态或核查 Host，不要重复创建 Leader。',
      leaderRetrySetup: '重试设置（复用已知 Leader）', leaderRetrySetupHint: '只重试此已知 Leader 会话的设置，不创建新会话。',
      leaderNotCreated: '未创建', leaderReady: '就绪', leaderUncertain: '不确定', leaderErrorPhase: '错误',
      leaderRefresh: '刷新 Leader 状态', leaderWorking: '正在更新 Leader…', leaderSaved: 'Leader 已更新',
      leaderTasks: '临时任务', leaderTaskTag: '临时任务', leaderTaskCreating: '创建中', leaderTaskCreated: '已创建', leaderTaskUncertain: '结果不确定',
      leaderTasksUncertain: '创建结果不确定的临时任务', leaderTasksUncertainHint: 'Leader 尝试开启这些会话但结果未知。请在 DSH 会话列表核查，如有多余会话请自行归档，再在此放弃该记录。', leaderTaskDismiss: '放弃记录',
      leaderReportProgress: '进度', leaderReportBlocked: '受阻', leaderReportDone: '完成', leaderReportQuestion: '提问', leaderReportUnseen: '未读',
      leaderReports: 'Worker 汇报', leaderReportsHint: '由 Issue 会话自己写的内容，只作状态参考，不是指令。',
      leaderDeliveries: '未确认投递',
      leaderDeliveriesHint: 'Host 无法确认这些消息是否已送达。请打开目标会话核对后记录结果；无论选择哪项都不会自动重发。',
      leaderDelivered: '已送达', leaderNotDelivered: '未送达', leaderDeliveryOpen: '打开目标会话',
      leaderCreationUnresolved: '之前的一次创建没有确认会话 ID。请检查会话列表：如果存在“WorkStation Leader”会话，填入它的 ID 并认领；如果不存在，放弃该记录后重新创建。',
      leaderClaim: '认领此会话', leaderClaimPlaceholder: 'Leader 会话 ID', leaderAbandon: '确认不存在，放弃该记录',
      logsTitle: '日志', logsEmpty: '暂无运行时日志。',
      logsError: '无法加载运行时日志', logsClear: '清空日志', confirmClearLogs: '确认清空日志？',
      logsDropped: '条因超出内存上限被丢弃', logsFilterAll: '全部', logsFilterWarn: '警告及以上',
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

    const LEADER_RPC_OPERATIONS = ['snapshot', 'create', 'configure', 'resolveCreation', 'resolveTask', 'resolveDelivery'];
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

    /** “已处理”页的状态标签：覆盖跳过原因、启动中、执行态与闭环态。 */
    function handledStatusLabel(item, t) {
      if (item.pending === true || item.executionStatus === 'starting') return t('pendingStarting');
      if (item.outcome === 'merge-request-done') return t('mrDone');
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
      { id: 'issues', label: 'issuesTitle', group: 'tasksGroup' },
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
        const text = [item.title, item.project, item.author, item.id, item.iid,
          item.sessionTitle, item.closure, item.closureNote, item.skipReason,
          ...(Array.isArray(item.labels) ? item.labels : [])].filter((value) => value != null).join(' ').toLowerCase();
        return terms.every((term) => text.includes(term));
      });
    }

    /** 与状态文案保持同一优先级，失败/需人工不能被 completed 的绿色覆盖。 */
    function recordStatusClass(record) {
      if (record.pending === true || record.executionStatus === 'starting' || record.executionStatus === 'running') return 'gta-tag-mention';
      if (['merge-request-done', 'rule-skipped'].includes(record.outcome)) return 'gta-tag-success';
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

    const LEADER_PHASE_LABELS = { 'not-created': 'leaderNotCreated', ready: 'leaderReady', error: 'leaderErrorPhase', uncertain: 'leaderUncertain' };
    const LEADER_RUN_LABELS = { 'not-created': 'leaderNotCreated', 'creation-uncertain': 'leaderUncertain', 'setup-incomplete': 'leaderSetupIncomplete',
      error: 'leaderErrorPhase', ready: 'leaderReady' };
    const LEADER_RUN_STATES = Object.keys(LEADER_RUN_LABELS);
    const LEADER_TASK_STATUS_LABELS = { creating: 'leaderTaskCreating', created: 'leaderTaskCreated', uncertain: 'leaderTaskUncertain' };
    const LEADER_REPORT_LABELS = { progress: 'leaderReportProgress', blocked: 'leaderReportBlocked', done: 'leaderReportDone', question: 'leaderReportQuestion' };

    function validLeaderSessionId(value) {
      return typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
    }

    /** Read-only projection decoding of the v3 Leader journal (session, model, ad-hoc tasks, child reports, open deliveries). */
    function normalizeLeaderProjection(value) {
      if (!value || !Object.hasOwn(LEADER_PHASE_LABELS, value.phase)
        || (value.sessionId !== null && !validLeaderSessionId(value.sessionId))
        || !value.settings || typeof value.settings !== 'object') return null;
      const text = (item) => typeof item === 'string' ? item : '';
      const count = (item) => Number.isSafeInteger(item) && item >= 0 ? item : null;
      const list = (item) => Array.isArray(item) ? item : [];
      const model = value.settings.model ?? null;
      if (model !== null && (typeof model !== 'object' || !text(model.provider) || !text(model.model)
        || (model.reasoningEffort !== undefined && !text(model.reasoningEffort)))) return null;
      return {
        sessionId: validLeaderSessionId(value.sessionId) ? value.sessionId : null, phase: value.phase,
        runState: LEADER_RUN_STATES.includes(value.runState) ? value.runState : '',
        creation: value.creation && typeof value.creation === 'object'
          ? { status: text(value.creation.status), createdAt: count(value.creation.createdAt), agentPreset: text(value.creation.agentPreset) } : null,
        deliveries: list(value.deliveries)
          .filter((entry) => entry && text(entry.requestId) && ['send', 'steer'].includes(entry.kind))
          .map((entry) => ({ requestId: entry.requestId, kind: entry.kind, taskId: text(entry.taskId),
            sessionId: validLeaderSessionId(entry.sessionId) ? entry.sessionId : null, status: text(entry.status),
            error: text(entry.error), at: count(entry.at) })),
        settings: { model: model ? withReasoningEffort({ provider: model.provider, model: model.model }, text(model.reasoningEffort)) : null },
        // Leader-dispatched ad-hoc task sessions (no GitLab Issue); only uncertain ones need the human.
        tasks: list(value.tasks).filter((entry) => entry && text(entry.taskId)).map((entry) => ({
          taskId: entry.taskId, sessionId: validLeaderSessionId(entry.sessionId) ? entry.sessionId : null, title: text(entry.title),
          status: Object.hasOwn(LEADER_TASK_STATUS_LABELS, entry.status) ? entry.status : 'created', createdAt: count(entry.createdAt), error: text(entry.error),
        })),
        // Worker self-reports (untrusted worker text, shown as plain text), oldest first.
        reports: list(value.reports).filter((entry) => entry && Object.hasOwn(LEADER_REPORT_LABELS, entry.kind)).map((entry) => ({
          id: text(entry.id), taskId: text(entry.taskId), sessionId: validLeaderSessionId(entry.sessionId) ? entry.sessionId : null,
          kind: entry.kind, text: text(entry.text), at: count(entry.at), seen: entry.seen === true,
        })),
        unseenReports: count(value.unseenReports) ?? 0, error: text(value.error),
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
        && projection.phase === 'not-created' && !sessionId;
      return { projection, sessionId, state: data?.state, creationAbsent,
        error: !success ? data?.result?.error || projection?.error || t('leaderInvalidResponse') : projection.error || '' };
    }

    function canCreateLeader(projection, knownSessionId, creationAttempted) {
      return projection?.phase === 'not-created' && !projection.sessionId && !knownSessionId && !creationAttempted;
    }

    function canRetryLeaderSetup(projection, knownSessionId) {
      return Boolean(projection && validLeaderSessionId(knownSessionId) && projection.sessionId === knownSessionId
        && (['error', 'uncertain'].includes(projection.phase) || projection.runState === 'setup-incomplete'));
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

    function WorkstationPanel({ ctx, t }) {
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
        setLeaderBusy(''); setLeaderFresh(false);
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
        // Recovery operations are human assertions about the latest Host state; never act on a stale view.
        if (['resolveDelivery', 'resolveCreation', 'resolveTask'].includes(operation) && !leaderFresh) return Promise.resolve(false);
        if (operation === 'configure') {
          if (!leaderFresh || !leaderViewRef.current.projection || ['error', 'uncertain'].includes(leaderViewRef.current.projection.phase)) return Promise.resolve(false);
          payload = { settings: { model: payload.settings?.model ?? null } };
        }
        leaderGuard.current.reset(); leaderActionRef.current = operation;
        setLeaderBusy(operation); setLeaderFresh(false); setLeaderFeedback(''); setLeaderOpen(true);
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
        confirmTimers.current.forEach((timer) => clearTimeout(timer));
        confirmTimers.current.clear();
      }, []);

      // 模板拼接用冒号：zh 全角“：”，en 半角“: ”，随当前 locale 取词典。
      const colon = () => t('colon');


      const updateSettings = (settings) => {
        setSettingsFeedback('');
        return perform('settings', () => post('updateSettings', { settings }))
          .then((saved) => { if (saved) setSettingsFeedback(t('settingsSaved')); return saved; });
      };
      // 对比打开时 baseline，仅提交用户在草稿中改动且当前值尚未生效的字段。
      // Issue 即时设置不会被未编辑的旧草稿回盖（Host 仍浅合并 patch）。
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
        if (validLeaderSessionId(sessionId)) safeSessionOpener({ sessionId, title: 'WorkStation Leader' }, trigger);
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
      // Issue 面板「处理」：同一 dispatch 通道（Host 端按合成 id 找到缓存条目）；
      // 成功后立刻刷新投影，把行状态换成“执行中”。
      const dispatchIssue = (issue) => {
        if (busyKeysRef.current.has('settings')) return Promise.resolve(false);
        return perform(`dispatch:${issue.id}`, () => post('dispatch', { id: issue.id }))
          .then((done) => { if (done) void fetchIssues(false); });
      };
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
      const leaderModel = leaderProjection?.settings?.model ?? null;
      const leaderReasoning = reasoningForSelection(modelCatalog, leaderModel);
      const leaderEffort = leaderModel?.reasoningEffort ?? '';
      const leaderEffortAdvertised = !leaderEffort || leaderReasoning?.efforts.some((effort) => effort.id === leaderEffort);
      const leaderCanConfigure = leaderFresh && !leaderBusy && leaderProjection && !['error', 'uncertain'].includes(leaderProjection.phase);
      const leaderRunState = leaderProjection?.runState || '';
      const leaderPhaseLabel = t(!leaderFresh ? 'leaderUncertain' : LEADER_RUN_LABELS[leaderRunState] || LEADER_PHASE_LABELS[leaderProjection?.phase] || 'leaderUncertain');
      const leaderDeliveries = (leaderProjection?.deliveries ?? []).filter((entry) => entry.status === 'uncertain');
      const leaderUncertainTasks = (leaderProjection?.tasks ?? []).filter((task) => task.status === 'uncertain');
      const leaderTasks = leaderProjection?.tasks ?? [];
      const leaderReports = [...(leaderProjection?.reports ?? [])].reverse().slice(0, 30);
      const leaderUnseen = leaderProjection?.unseenReports ?? 0;
      const leaderCreationUnresolved = leaderFresh && leaderRunState === 'creation-uncertain';
      // 工作区下拉：值仍是工作区路径（sessionCwd 语义不变）；比较忽略大小写/斜杠差异。
      const workspaceOptions = Array.isArray(workspaceData) ? workspaceData : [];
      const normalizePathKey = (value) => String(value ?? '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
      const registeredWorkspacePaths = new Set(workspaceOptions.map((workspace) => normalizePathKey(workspace.path)));
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
      const listQuery = listSearches[activeTab] ?? '';
      const visibleIssues = filterWorkstationItems(issuesData?.items, listQuery);
      const visibleOrphans = filterWorkstationItems(issuesData?.orphans, listQuery);
      const searchableList = {
        issues: { loaded: (issuesData?.items.length ?? 0) + (issuesData?.orphans.length ?? 0), matches: visibleIssues.length + visibleOrphans.length, ready: issuesData !== null },
      }[activeTab];
      const tabCounts = {
        issues: issuesData?.items.length ?? snapshot?.issueCount ?? 0,
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
            h(Button, {
              disabled: !snapshot,
              expanded: Boolean(draft), controls: `${PANEL_ID}-settings`,
              onClick: () => {
                if (draft) closeGeneralSettings();
                else { draftGeneration.current += 1; draftBaseline.current = settings; setDraft({ ...settings }); }
              },
            }, draft ? t('close') : t('settings')),
          ),
        ),
        (busySet.has('settings') || settingsFeedback) && h('div', { className: 'gta-feedback gta-muted', role: 'status' }, busySet.has('settings') ? t('saving') : settingsFeedback),
        !snapshot && !error && h('div', { className: 'gta-empty' }, t('loading')),
        (error || pollError) && h('div', { className: 'gta-banner gta-error', role: 'alert' }, `${t('localError')}${colon()}${error || pollError}`),
        snapshot?.lastPollError && h('div', { className: 'gta-banner gta-error', role: 'alert' }, snapshot.lastPollError),
        snapshot?.lastDispatchError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, snapshot.lastDispatchError),
        modelCatalogError && h('div', { className: 'gta-banner gta-warn', role: 'status' }, `${t('modelCatalogError')}${colon()}${modelCatalogError}`),
        draft && h('section', { className: 'gta-card gta-settings', id: `${PANEL_ID}-settings` },
          h('h2', null, t('settings')),
          h('div', { className: 'gta-form-grid' },
            h('label', null, t('concurrency'), h('input', {
              type: 'number', min: 1, max: 10, value: draft.maxConcurrentSessions,
              onChange: (event) => setDraft({ ...draft, maxConcurrentSessions: Number(event.target.value) }),
            })),
            h('label', null, t('maxFollowUps'), h('input', {
              type: 'number', min: 0, max: 10, value: draft.maxFollowUps ?? 3, disabled: draft.followUpEnabled === false,
              onChange: (event) => setDraft({ ...draft, maxFollowUps: Number(event.target.value) }),
            })),
            h('details', { className: 'gta-advanced gta-wide' },
              h('summary', null, t('advanced')),
              h('div', { className: 'gta-form-grid' },
                h('label', null, t('followUpDelay'), h('input', {
                  type: 'number', min: 1, max: 1440, value: draft.followUpDelayMinutes ?? 15, disabled: draft.followUpEnabled === false,
                  onChange: (event) => setDraft({ ...draft, followUpDelayMinutes: Number(event.target.value) }),
                })),
                h('div', { className: 'gta-checks' },
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
              type: 'checkbox', checked: draft.autoArchive,
              onChange: (event) => setDraft({ ...draft, autoArchive: event.target.checked }),
            }), t('autoArchive')),
            h('label', { className: 'gta-check', title: t('followUpHint') }, h('input', {
              type: 'checkbox', checked: draft.followUpEnabled !== false,
              onChange: (event) => setDraft({ ...draft, followUpEnabled: event.target.checked }),
            }), t('followUpEnabled')),
          ),
          h('div', { className: 'gta-form-actions' },
            h(Button, { primary: true, disabled: busySet.has('settings'), onClick: saveAndCloseGeneralSettings }, t('save')),
            h(Button, { onClick: closeGeneralSettings }, t('cancel')),
          ),
        ),
        snapshot && h('section', { className: 'gta-stats', 'aria-label': t('title') },
          h('div', { className: 'gta-stat' }, h('strong', { className: snapshot.running ? 'gta-success' : 'gta-muted' }, snapshot.running ? t('running') : t('idle'))),
          h('div', { className: 'gta-stat' }, h('span', null, t('followUpCount')), h('strong', null, snapshot.closure?.followUp ?? 0)),
          h('div', { className: 'gta-stat' }, h('span', null, t('needsHumanCount')), h('strong', null, snapshot.closure?.needsHuman ?? 0)),
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
              className: 'gta-tab-count',
            }, tabCounts[tab.id])),
          )),
        ),
        snapshot && searchableList && h('div', { className: 'gta-list-tools' },
          h('label', { className: 'gta-list-search' },
            h('span', null, t('searchList')),
            h('input', {
              type: 'search', value: listQuery, disabled: !searchableList.ready,
              placeholder: t('searchList'),
              onChange: (event) => setListSearches({ ...listSearches, [activeTab]: event.target.value }),
            }),
          ),
          listQuery && h(Button, { onClick: () => setListSearches({ ...listSearches, [activeTab]: '' }) }, t('clearSearch')),
          searchableList.ready && h('span', { className: 'gta-muted', role: 'status' },
            `${listQuery ? t('searchResults') : t('loadedRecords')}${colon()}${listQuery ? `${searchableList.matches}/${searchableList.loaded}` : searchableList.loaded}`),
        ),
        activeTab === 'issues' && snapshot && h('section', { className: 'gta-section', role: 'tabpanel', id: `${PANEL_ID}-panel-issues`, 'aria-labelledby': `${PANEL_ID}-tab-issues`, tabIndex: 0 },
          h('section', { className: 'gta-card gta-leader', 'aria-label': t('leaderTitle') },
            h('div', { className: 'gta-leader-head' },
              h(Button, { expanded: leaderOpen, controls: `${PANEL_ID}-leader-body`, onClick: () => setLeaderOpen(!leaderOpen) },
              `${leaderOpen ? '▾' : '▸'} ${t('leaderTitle')} · ${leaderPhaseLabel}${leaderUnseen > 0 ? ` · ${t('leaderUnseen')} ${leaderUnseen}` : ''}`),
              h('span', { className: 'gta-muted' }, t('leaderIntro')),
            ),
            leaderOpen && h('div', { id: `${PANEL_ID}-leader-body`, className: 'gta-leader-body' },
              h('div', { className: 'gta-form-actions' },
                !leaderView.sessionId && h(Button, { disabled: !leaderFresh || Boolean(leaderBusy)
                  || !canCreateLeader(leaderProjection, leaderView.sessionId, leaderView.creationAttempted),
                  onClick: () => { void runLeader('create'); } }, t('leaderCreate')),
                leaderView.sessionId && h(Button, { onClick: (event) => openLeader(event.currentTarget) }, t('leaderOpen')),
                canRetryLeaderSetup(leaderProjection, leaderView.sessionId) && h(Button, {
                  disabled: !leaderFresh || Boolean(leaderBusy), title: t('leaderRetrySetupHint'),
                  onClick: () => { void runLeader('create', { sessionId: leaderView.sessionId }); },
                }, t('leaderRetrySetup')),
                h(Button, { disabled: Boolean(leaderBusy), onClick: () => { void fetchLeaderSnapshot(); } }, t('leaderRefresh')),
              ),
              leaderView.creationAttempted && !leaderView.sessionId && h('div', { className: 'gta-banner gta-warn', role: 'status' }, t('leaderCreateUncertain')),
              (leaderView.error || leaderView.pollError || leaderProjection?.error) && h('div', { className: 'gta-banner gta-warn', role: 'status' },
                `${t(leaderView.pollError && !leaderView.error ? 'leaderSnapshotError' : 'leaderError')}${colon()}${leaderView.error || leaderView.pollError || leaderProjection.error}`),
              (leaderBusy || leaderFeedback) && h('div', { className: 'gta-feedback gta-muted', role: 'status' }, leaderBusy ? t('leaderWorking') : leaderFeedback),
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
                  h('span', { className: 'gta-muted gta-meta' }, `${entry.taskId || ''} · ${entry.sessionId || ''}${entry.at ? ` · ${formatTime(entry.at, '')}` : ''}`),
                  entry.sessionId && h(Button, { onClick: (event) => openManagedIssue({ taskId: entry.taskId, sessionId: entry.sessionId, title: entry.taskId, url: '' }, event.currentTarget) }, t('leaderDeliveryOpen')),
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
              leaderUncertainTasks.length > 0 && h('div', { className: 'gta-banner gta-warn', role: 'status' },
                h('strong', null, t('leaderTasksUncertain')), h('p', { className: 'gta-muted' }, t('leaderTasksUncertainHint')),
                leaderUncertainTasks.map((task) => h('div', { key: task.taskId, className: 'gta-form-actions' },
                  h('span', null, [task.title || task.taskId, task.sessionId, task.error].filter(Boolean).join(' · ')),
                  h(Button, { disabled: !leaderFresh || Boolean(leaderBusy), onClick: () => { void runLeader('resolveTask', { taskId: task.taskId, action: 'dismiss' }); } }, t('leaderTaskDismiss'))))),
              leaderTasks.length > 0 && h('details', { className: 'gta-advanced gta-leader-audit' },
                h('summary', null, `${t('leaderTasks')} · ${leaderTasks.length}`),
                h('div', { className: 'gta-list', role: 'list', 'aria-label': t('leaderTasks') }, leaderTasks.map((task) =>
                  h('div', { key: task.taskId, role: 'listitem', className: 'gta-form-actions' },
                    h('span', { className: 'gta-tag gta-tag-mention' }, t('leaderTaskTag')),
                    h('span', { className: 'gta-muted gta-meta' }, [task.title || task.taskId, t(LEADER_TASK_STATUS_LABELS[task.status] || 'leaderTaskCreated'),
                      task.createdAt ? formatTime(task.createdAt, '') : ''].filter(Boolean).join(' · ')),
                    task.sessionId && h(Button, { onClick: (event) => openManagedIssue({ taskId: task.taskId, sessionId: task.sessionId, title: task.title, url: '' }, event.currentTarget) }, t('openSession')))))),
              leaderReports.length > 0 && h('details', { className: 'gta-advanced gta-leader-audit' },
                h('summary', null, `${t('leaderReports')} · ${leaderReports.length}`),
                h('p', { className: 'gta-muted' }, t('leaderReportsHint')),
                h('div', { className: 'gta-list', role: 'list', 'aria-label': t('leaderReports') }, leaderReports.map((entry, index) =>
                  h('div', { key: entry.id || `${entry.at}:${index}`, role: 'listitem', className: 'gta-muted gta-meta' },
                    [entry.at ? formatTime(entry.at, '') : '', entry.taskId, `[${t(LEADER_REPORT_LABELS[entry.kind])}]`,
                      !entry.seen && t('leaderReportUnseen'), entry.text.slice(0, 300)].filter(Boolean).join(' · '))))),
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
                  ),
                  h('div', { className: 'gta-muted gta-meta' }, [
                    `#${issue.iid ?? ''}`, issue.project,
                    issue.sessionTitle,
                    ...closureMeta(issue, t),
                  ].filter(Boolean).join(' · ')),
                ),
                h('div', { className: 'gta-todo-actions' },
                  issue.sessionId && h(Button, { onClick: (event) => openSession({ sessionId: issue.sessionId, taskId: issue.id, title: issue.title, url: issue.url, manualHandoffs: issue.manualHandoffs }, event.currentTarget) }, t('openSession')),
                ),
              ))),
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
      .gta-root :is(input,select,textarea,summary,.gta-session-link):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .gta-section:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
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
      .gta-root .gta-route-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 38%,transparent)}
      .gta-root .gta-route-dialog{display:flex;flex-direction:column;width:min(680px,100%);max-height:min(80dvh,680px);overflow:hidden;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 60px color-mix(in srgb,var(--dsw-alias-label-primary) 25%,transparent)}
      .gta-root .gta-route-header{display:flex;align-items:center;gap:12px;flex:none}
      .gta-root .gta-route-heading{min-width:0;flex:1}
      .gta-root .gta-route-heading h2{margin:0}
      .gta-root .gta-route-footer{display:flex;justify-content:flex-end;gap:6px;flex:none;padding-top:10px}
      .gta-root .gta-session-dialog{overflow-y:auto;overscroll-behavior:contain;overflow-wrap:anywhere}
      .gta-session-dialog .gta-route-footer{flex-wrap:wrap}
      .gta-handoff-context{min-width:0}
      .gta-handoff-context textarea{box-sizing:border-box;display:block;width:100%;resize:vertical;min-height:100px;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;white-space:pre-wrap}
      .gta-reply-link{color:var(--dsw-alias-brand-primary);text-decoration:none;margin-right:6px}
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
          return h(PanelBoundary, { t }, h(WorkstationPanel, { ctx, t }));
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
