<template>
  <div class="openclaw-chat" :class="isLanding ? 'is-landing' : 'is-chat'">
    <section class="chat-layout">
      <header class="chat-header">
        <div class="chat-title">
          <h2>智能体对话</h2>
          <p>查询工艺规程、工程标准、传感器数据和产量趋势</p>
        </div>
        <span class="status-pill">
          <span class="status-dot"></span>
          已连接
        </span>
      </header>

      <div class="body">
        <main ref="threadRef" class="thread" :class="{ 'is-streaming': loading }" @scroll="saveScrollPosition">
          <div class="thread-inner">
            <BubbleList :items="bubbleItems" :roles="roles" :auto-scroll="true" class="bubble-list" />
          </div>
        </main>

        <div class="composer">
          <div class="landing-hero">
            <div class="landing-avatar">
              <img :src="hebangLogo" alt="和邦知化" />
            </div>
            <h1 class="landing-title">今天想查什么？</h1>
            <p class="landing-subtitle">工艺规程 · 工程标准 · 传感器数据 · 产量趋势</p>
          </div>

          <a-alert v-if="chatError" :message="chatError" type="error" show-icon closable @close="chatError = ''" />

          <Sender
            v-model:value="input"
            :loading="loading"
            :placeholder="senderPlaceholder"
            @submit="onSubmit"
            @cancel="onCancel"
          />

          <div class="landing-chips">
            <button
              v-for="(chip, index) in landingChips"
              :key="index"
              type="button"
              class="landing-chip"
              @click="onSubmit(chip.text)"
            >
              <component :is="chip.icon" class="landing-chip-icon" />
              <span>{{ chip.text }}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
  import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import type { VNode } from 'vue';
  import { useRouter } from 'vue-router';
  import { BarChartOutlined, FileTextOutlined, LineChartOutlined, UserOutlined } from '@ant-design/icons-vue';
  import { Bubble, Sender } from 'ant-design-x-vue';
  import type { BubbleListProps } from 'ant-design-x-vue';
  import type {
    ChatActivity,
    ChatArtifact,
    ChatFinal,
    ChatMessage,
    ChatSource,
  } from '#/api/openclaw/chat';
  import { streamZhihuaChat } from '#/api/openclaw/chat';
  import { getAlarmEvents, type AlarmEvent } from '#/api/openclaw/alarm';
  import { renderMarkdown } from './renderMarkdown';
  import { publicPath } from '#/utils/env';
  import { getToken } from '#/utils/auth';

  const BubbleList = Bubble.List;
  const router = useRouter();
  const hebangLogo = `${publicPath}resource/img/hebang_user.png`;
  const STORAGE_KEY = 'hebang-openclaw-chat-v2';
  const SCROLL_STORAGE_KEY = 'hebang-openclaw-chat-scroll-v2';
  const ALARM_SINCE_KEY = 'hebang-openclaw-alarm-since-v1';
  const ALARM_POLL_MS = 30 * 1000;
  const OPENCLAW_API_BASE = import.meta.env.VITE_OPENCLAW_API_BASE || '/openclaw-api';

  type ThreadMessage = ChatMessage & {
    messageId?: string;
    thinking?: string;
    sources?: ChatSource[];
    artifacts?: ChatArtifact[];
    activities?: ChatActivity[];
    warnings?: Array<{ type: string; message: string }>;
  };

  const loading = ref(false);
  const chatError = ref('');
  const input = ref('');
  const threadRef = ref<HTMLElement | null>(null);
  let abortController: AbortController | null = null;

  const messages = ref<ThreadMessage[]>([]);

  // 传感器报警轮询(独立报警服务 /alarm-api)。新告警作为对话气泡注入。
  let alarmTimer: ReturnType<typeof setInterval> | null = null;
  let alarmSinceId = 0;
  let alarmPolling = false;

  const landingChips = [
    { icon: FileTextOutlined, text: '反应岗位开车准备需要检查哪些项目' },
    { icon: LineChartOutlined, text: '近 24 小时反应釜温度趋势' },
    { icon: BarChartOutlined, text: '本月产量环比变化' },
  ];
  const isLanding = computed(() => !messages.value.some((message) => message.role === 'user'));
  const senderPlaceholder = computed(() =>
    isLanding.value ? '输入问题，或从下面选一个' : '输入问题，例如：ASME B16.34 对阀门压力等级有什么要求？',
  );

  onMounted(() => {
    try {
      const restored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(restored) && restored.length) {
        messages.value = restored;
        messages.value.forEach((message) => {
          if (message.artifacts?.length) {
            const originalArtifacts = message.artifacts.map((artifact) => ({
              ...artifact,
              url: artifact.sourceUrl || artifact.url,
            }));
            void Promise.all(originalArtifacts.map(authenticatedArtifact))
              .then((artifacts) => {
                message.artifacts = artifacts;
              })
              .catch(() => {
                message.artifacts = [];
              });
          }
        });
      }
      void nextTick(() => {
        if (threadRef.value) threadRef.value.scrollTop = Number(sessionStorage.getItem(SCROLL_STORAGE_KEY) || 0);
      });
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(SCROLL_STORAGE_KEY);
    }
  });
  watch(messages, (value) => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)), { deep: true });

  function saveScrollPosition() {
    if (threadRef.value) sessionStorage.setItem(SCROLL_STORAGE_KEY, String(threadRef.value.scrollTop));
  }

  onBeforeUnmount(() => {
    messages.value
      .flatMap((message) => message.artifacts || [])
      .forEach((artifact) => {
        if (artifact.url.startsWith('blob:')) URL.revokeObjectURL(artifact.url);
      });
  });

  function assistantRender(content: string) {
    const visible = String(content || '')
      .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, '')
      .replace(/<\/?think\b[^>]*>/gi, '');
    return h('div', { class: 'md-body', innerHTML: renderMarkdown(visible) });
  }

  function sourceLabel(source: ChatSource) {
    const title = source.standardCode || source.title || '知识库原文';
    return `${title}：第 ${source.pageStart || '?'} 页`;
  }

  function openSource(source: ChatSource) {
    const boxes = source.bboxes?.length
      ? source.bboxes.map((b) => b.join(',')).join(';')
      : source.normalizedBbox?.join(',') || undefined;
    router.push({
      path: `/knowledge/source/${encodeURIComponent(source.docId)}`,
      query: {
        page: String(source.pageStart || 1),
        buildId: source.buildId || undefined,
        bbox: boxes,
        name: source.fileName || undefined,
      },
    });
  }

  function sourceFooter(message: ThreadMessage) {
    const children: VNode[] = [];
    if (message.thinking?.trim()) {
      children.push(
        h('details', { class: 'reasoning-trace' }, [
          h('summary', { class: 'reasoning-summary' }, [
            h('span', { class: 'reasoning-dot' }),
            h('span', {}, '思考过程'),
          ]),
          h('div', { class: 'reasoning-body' }, message.thinking),
        ]),
      );
    }
    if (message.sources?.length) {
      children.push(h('div', { class: 'source-heading' }, '参考来源'));
      children.push(
        h(
          'div',
          { class: 'source-list' },
          message.sources.slice(0, 5).map((source) =>
            h(
              'button',
              {
                type: 'button',
                class: 'source-card',
                title: '查看原文第 ' + (source.pageStart || '?') + ' 页',
                onClick: (event: MouseEvent) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openSource(source);
                },
              },
              [
                h('span', { class: 'source-id' }, source.id),
                h('span', { class: 'source-main' }, [
                  h('span', { class: 'source-label' }, sourceLabel(source)),
                  source.titlePath ? h('span', { class: 'source-path' }, source.titlePath) : null,
                ]),
                h('span', { class: 'source-action' }, '查看原文 ›'),
              ],
            ),
          ),
        ),
      );
    }
    if (message.artifacts?.length) {
      children.push(
        h(
          'div',
          { class: 'artifact-list' },
          message.artifacts.map((artifact) =>
            h('img', {
              class: 'chat-artifact',
              src: artifact.url,
              alt: artifact.title || '智能体生成图表',
              referrerpolicy: 'no-referrer',
              onClick: () => window.open(artifact.url, '_blank', 'noopener,noreferrer'),
            }),
          ),
        ),
      );
    }
    const visibleActivities = (message.activities || []).filter(
      (item) => item.kind !== 'thinking' && (item.title || item.toolName),
    );
    if (visibleActivities.length) {
      const running = visibleActivities.some((item) => item.status === 'running');
      children.push(
        h('details', { class: 'activity-trace', open: running }, [
          h('summary', { class: 'activity-summary' }, [
            h('span', { class: ['activity-dot', running ? 'activity-running' : 'activity-completed'] }),
            h('span', {}, running ? '正在调用工具' : '工具调用记录'),
            h('span', { class: 'activity-count' }, String(visibleActivities.length) + ' 项'),
          ]),
          h(
            'div',
            { class: 'activity-body' },
            visibleActivities
              .slice(-5)
              .map((item) =>
                h('div', { class: 'activity-item' }, [
                  h('div', { class: 'activity-row' }, [
                    h('span', { class: ['activity-dot', 'activity-' + (item.status || 'running')] }),
                    h('span', { class: 'activity-title' }, item.title || item.toolName || '系统工具'),
                    typeof item.resultCount === 'number'
                      ? h('span', { class: 'activity-badge' }, item.resultCount + ' 条')
                      : null,
                    h(
                      'span',
                      { class: 'activity-state' },
                      item.status === 'completed' ? '完成' : item.status === 'failed' ? '失败' : '执行中',
                    ),
                  ]),
                  item.inputSummary ? h('div', { class: 'activity-detail' }, '查询：' + item.inputSummary) : null,
                  item.outputSummary
                    ? h('div', { class: 'activity-detail activity-output' }, item.outputSummary)
                    : null,
                ]),
              ),
          ),
        ]),
      );
    }
    return h('section', { class: 'assistant-footer' }, children);
  }

  const roles: BubbleListProps['roles'] = {
    assistant: {
      placement: 'start',
      variant: 'filled',
      avatar: h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            overflow: 'hidden',
            borderRadius: '50%',
            background: '#ffffff',
          },
        },
        h('img', {
          src: hebangLogo,
          alt: '和邦知化',
          style: { display: 'block', width: '100%', height: '100%', objectFit: 'cover' },
        }),
      ) as never,
      messageRender: assistantRender as never,
    },
    user: {
      placement: 'end',
      variant: 'filled',
      avatar: { icon: h(UserOutlined), style: { background: '#fff3d8', color: '#8a5c11' } },
    },
  };

  const bubbleItems = computed(() =>
    messages.value.map((message, index) => ({
      key: message.messageId || index,
      role: message.role,
      content: message.content,
      loading:
        message.role === 'assistant' && loading.value && index === messages.value.length - 1 && message.content === '',
      footer:
        message.role === 'assistant' &&
        (message.thinking || message.sources?.length || message.artifacts?.length || message.activities?.length)
          ? (_content: unknown, _info: unknown) => sourceFooter(message)
          : undefined,
    })),
  );

  async function scrollToBottom() {
    await nextTick();
    if (threadRef.value) threadRef.value.scrollTop = threadRef.value.scrollHeight;
  }

  async function authenticatedArtifact(artifact: ChatArtifact): Promise<ChatArtifact> {
    // Gateway artifacts live behind /api/chat/artifacts and must not be requested as
    // unauthenticated static files from the Vite origin.
    const sourceUrl = artifact.sourceUrl || artifact.url;
    if (!sourceUrl?.startsWith('/chat/artifacts/')) return { ...artifact, sourceUrl };
    const response = await fetch(OPENCLAW_API_BASE + sourceUrl, {
      headers: getToken() ? { 'X-Authorization': 'Bearer ' + getToken() } : {},
    });
    if (!response.ok) throw new Error('图表加载失败（' + response.status + '）');
    return { ...artifact, sourceUrl, url: URL.createObjectURL(await response.blob()) };
  }

  async function applyFinal(index: number, response: ChatFinal) {
    const message = messages.value[index];
    if (!message) return;
    message.messageId = response.messageId;
    message.content = response.message || message.content;
    message.sources = response.sources || [];
    try {
      message.artifacts = await Promise.all((response.artifacts || []).map(authenticatedArtifact));
    } catch (error) {
      message.artifacts = [];
      chatError.value = error instanceof Error ? error.message : '图表加载失败';
    }
    message.activities = response.activities || message.activities || [];
    message.warnings = response.warnings || [];
    if (message.warnings.length)
      chatError.value = message.warnings
        .map((item) => item.message)
        .filter(Boolean)
        .join('；');
  }

  async function onSubmit(text: string) {
    const content = (text ?? '').trim();
    if (!content || loading.value) return;

    messages.value = [...messages.value, { role: 'user', content }, { role: 'assistant', content: '', activities: [] }];
    const assistantIndex = messages.value.length - 1;
    input.value = '';
    loading.value = true;
    chatError.value = '';
    await scrollToBottom();

    abortController = new AbortController();
    try {
      await streamZhihuaChat(messages.value.slice(0, assistantIndex), {
        signal: abortController.signal,
        onDelta: (snapshot) => {
          if (messages.value[assistantIndex]) messages.value[assistantIndex].content = snapshot;
          scrollToBottom();
        },
        onThinking: (delta) => {
          const message = messages.value[assistantIndex];
          if (!message || !delta) return;
          message.thinking = (message.thinking || '') + delta;
        },
        onActivity: (activity) => {
          const message = messages.value[assistantIndex];
          if (!message) return;
          const activities = message.activities || [];
          const position = activities.findIndex((item) => item.id && item.id === activity.id);
          if (position >= 0) activities.splice(position, 1, { ...activities[position], ...activity });
          else activities.push(activity);
          message.activities = [...activities];
        },
        onFinal: (response) => {
          void applyFinal(assistantIndex, response).finally(scrollToBottom);
        },
      });
    } catch (error) {
      const assistantMessage = messages.value[assistantIndex];
      if (!assistantMessage) return;
      if ((error as Error)?.name === 'AbortError') {
        assistantMessage.content ||= '（已停止）';
      } else {
        const message = error instanceof Error ? error.message : '智能体暂时不可用';
        chatError.value = message;
        if (!assistantMessage.content) assistantMessage.content = message;
      }
    } finally {
      loading.value = false;
      abortController = null;
      await scrollToBottom();
    }
  }

  function onCancel() {
    abortController?.abort();
  }

  function alarmBubble(event: AlarmEvent): ThreadMessage {
    const title = event.kind === 'recover' ? '传感器报警恢复' : '⚠️ 传感器报警';
    const when = event.ts ? new Date(event.ts).toLocaleString('zh-CN', { hour12: false }) : '';
    const meta = [event.sensor, when].filter(Boolean).join(' · ');
    return {
      role: 'assistant',
      messageId: `alarm-${event.id}`,
      content: `**${title}**\n\n${event.message}${meta ? `\n\n\`${meta}\`` : ''}`,
    };
  }

  async function pollAlarms() {
    if (alarmPolling) return;
    alarmPolling = true;
    try {
      const { events, maxId } = await getAlarmEvents(alarmSinceId);
      if (events.length) {
        messages.value = [...messages.value, ...events.map(alarmBubble)];
        void scrollToBottom();
      }
      alarmSinceId = Math.max(alarmSinceId, maxId);
      sessionStorage.setItem(ALARM_SINCE_KEY, String(alarmSinceId));
    } catch {
      // 报警服务不可用时静默,不打断对话
    } finally {
      alarmPolling = false;
    }
  }

  async function startAlarmPolling() {
    const stored = sessionStorage.getItem(ALARM_SINCE_KEY);
    if (stored !== null) {
      alarmSinceId = Number(stored) || 0;
    } else {
      // 首次进入:以当前最大 id 为基线,不回灌历史告警(防刷屏)
      try {
        alarmSinceId = (await getAlarmEvents(0)).maxId;
      } catch {
        alarmSinceId = 0;
      }
      sessionStorage.setItem(ALARM_SINCE_KEY, String(alarmSinceId));
    }
    void pollAlarms();
    alarmTimer = setInterval(pollAlarms, ALARM_POLL_MS);
  }

  onMounted(() => {
    void startAlarmPolling();
  });

  onBeforeUnmount(() => {
    if (alarmTimer) clearInterval(alarmTimer);
  });
</script>

<style scoped lang="less">
  // ── 设计变量：全文件只用这组值 ──────────────────────────────
  @brand: #1677ff;
  @bg-page: #f5f7fa;
  @bg-assistant: #ffffff;
  @bg-user: @brand;
  @text-primary: rgba(0, 0, 0, 0.88);
  @text-secondary: rgba(0, 0, 0, 0.45);
  @border-soft: rgba(0, 0, 0, 0.06);
  @border-hair: rgba(0, 0, 0, 0.09);
  @radius-lg: 16px;
  @radius-md: 12px;
  @radius-sm: 6px;
  @content-max: 820px;
  @landing-max: 600px;
  @code-font: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;

  .openclaw-chat {
    min-height: calc(100vh - 96px);
    padding: 24px;
    background: @bg-page;
  }
  .chat-layout {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 144px);
    min-height: 560px;
    gap: 16px;
  }
  .body {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }
  // 落地态：在实际可用高度内垂直居中偏上（padding-bottom 把内容整体上移）
  .is-landing .body {
    justify-content: center;
    padding-bottom: 6%;
  }
  .is-landing .thread {
    display: none;
  }

  // ── 顶部区域 ────────────────────────────────────────────────
  .chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: min(@content-max, 100%);
    margin: 0 auto;
  }
  .chat-title {
    h2 {
      margin: 0 0 2px;
      color: @text-primary;
      font-size: 20px;
      font-weight: 600;
      line-height: 1.3;
    }
    p {
      margin: 0;
      color: @text-secondary;
      font-size: 13px;
    }
  }
  // 落地态由 hero 承担标题，隐藏 header 标题避免重复；胶囊仍靠右
  .is-landing .chat-title {
    display: none;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px;
    color: #389e0d;
    font-size: 12px;
    font-weight: 500;
    background: #f6ffed;
    border: 1px solid #b7eb8f;
    border-radius: 999px;
    white-space: nowrap;
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #52c41a;
  }

  // ── 消息区：内容列居中限宽，气泡浮于页面底色 ──────────────────
  .thread {
    flex: 1 1 auto;
    min-height: 0;
    padding: 16px 12px 24px;
    overflow: auto;
  }
  .thread-inner {
    width: min(@content-max, 100%);
    margin: 0 auto;
  }
  .bubble-list {
    height: auto;
  }

  // 气泡间距
  :deep(.ant-bubble) {
    margin-bottom: 18px;
  }
  :deep(.ant-bubble-avatar) {
    width: 32px;
    height: 32px;
  }

  // 助手气泡
  :deep(.ant-bubble-start .ant-bubble-content) {
    max-width: 88%;
    padding: 10px 14px;
    color: @text-primary;
    background: @bg-assistant;
    border: 1px solid @border-soft;
    border-radius: @radius-lg;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  // 用户气泡
  :deep(.ant-bubble-end .ant-bubble-content) {
    max-width: 75%;
    padding: 10px 14px;
    color: #fff;
    background: @bg-user;
    border-radius: @radius-lg;
    border-top-right-radius: 4px;
    font-size: 14px;
  }
  :deep(.ant-bubble-end .ant-bubble-content *) {
    color: #fff;
  }

  // ── 回复正文排版（renderMarkdown 产出的 .md-body）────────────
  :deep(.md-body) {
    font-size: 14px;
    line-height: 1.65;
    word-break: break-word;
    p {
      margin: 0 0 8px;
    }
    p:last-child {
      margin-bottom: 0;
    }
    h1,
    h2,
    h3,
    h4 {
      margin: 16px 0 8px;
      font-weight: 600;
      line-height: 1.3;
    }
    h1 {
      font-size: 18px;
    }
    h2 {
      font-size: 16px;
    }
    h3 {
      font-size: 15px;
    }
    h4 {
      font-size: 14px;
    }
    ul,
    ol {
      margin: 0 0 8px;
      padding-left: 22px;
    }
    li {
      margin: 3px 0;
    }
    a {
      color: @brand;
      text-decoration: none;
      &:hover {
        text-decoration: underline;
      }
    }
    img {
      display: block;
      max-width: 100%;
      max-height: 520px;
      margin: 8px 0;
      border: 1px solid @border-hair;
      border-radius: @radius-sm;
      object-fit: contain;
      cursor: zoom-in;
    }
    code {
      padding: 1px 5px;
      font-family: @code-font;
      font-size: 0.88em;
      background: rgba(0, 0, 0, 0.05);
      border-radius: 3px;
    }
    pre {
      margin: 8px 0;
      padding: 12px;
      overflow-x: auto;
      font-size: 13px;
      background: #f6f8fa;
      border: 1px solid @border-hair;
      border-radius: @radius-md;
      code {
        padding: 0;
        font-size: 13px;
        background: none;
      }
    }
    table {
      width: 100%;
      margin: 8px 0;
      border-collapse: collapse;
      font-size: 13px;
      th,
      td {
        padding: 8px 12px;
        border: 1px solid @border-hair;
        text-align: left;
      }
      th {
        background: #fafafa;
        font-weight: 600;
      }
    }
  }

  // ── 落地态：品牌 hero + 输入横条 + 建议 chip ─────────────────
  .composer {
    width: 100%;
  }
  .landing-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    max-height: 220px;
    margin-bottom: 20px;
    text-align: center;
    transition:
      opacity 0.22s ease-out,
      max-height 0.22s ease-out,
      margin 0.22s ease-out;
  }
  .landing-avatar {
    width: 44px;
    height: 44px;
    overflow: hidden;
    background: #fff;
    border-radius: 50%;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
  .landing-title {
    margin: 4px 0 0;
    color: @text-primary;
    font-size: 22px;
    font-weight: 500;
    line-height: 1.3;
  }
  .landing-subtitle {
    margin: 0;
    color: @text-secondary;
    font-size: 13px;
  }
  .landing-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    max-height: 160px;
    margin-top: 12px;
    transition:
      opacity 0.22s ease-out,
      max-height 0.22s ease-out,
      margin 0.22s ease-out;
  }
  .landing-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    color: @text-primary;
    font-size: 13px;
    background: @bg-assistant;
    border: 1px solid @border-hair;
    border-radius: 999px;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      transform 0.15s ease;
    &:hover {
      border-color: @brand;
      transform: translateY(-1px);
    }
  }
  .landing-chip-icon {
    color: @text-secondary;
    font-size: 15px;
  }
  // 对话态：折叠品牌 hero（保留 DOM 以驱动透明度过渡）；建议 chip 保持开放
  .is-chat {
    .landing-hero {
      max-height: 0;
      margin: 0;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    }
    // 消息区底部留白，避免最后一条被悬浮输入条遮挡
    .thread {
      padding-bottom: 150px;
    }
    // 输入条悬浮固定在对话区底部，消息从其下方滚动穿过（类 ChatGPT/Claude）
    .composer {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      padding: 20px 0 8px;
      background: linear-gradient(180deg, rgba(245, 247, 250, 0) 0%, @bg-page 42%);
    }
    // 对话态下建议 chip 收窄贴合输入条、单行排布
    .landing-chips {
      max-height: 44px;
      margin-top: 10px;
    }
  }

  // ── 参考来源（紧凑胶囊条）──────────────────────────────────
  .assistant-footer {
    width: 100%;
    margin-top: 8px;
  }
  .source-heading {
    margin: 4px 0 6px;
    color: @text-secondary;
    font-size: 12px;
  }
  .source-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .source-card {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 3px 10px;
    color: @text-secondary;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    background: rgba(0, 0, 0, 0.04);
    border: 1px solid transparent;
    border-radius: 999px;
    transition:
      color 0.15s ease,
      background 0.15s ease;
    &:hover {
      color: @brand;
      background: rgba(22, 119, 255, 0.08);
    }
  }
  .source-id {
    flex: 0 0 auto;
    font-weight: 600;
  }
  .source-main {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
  }
  .source-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-path {
    display: none;
  }
  .source-action {
    flex: 0 0 auto;
  }

  // 图表
  .artifact-list {
    margin-top: 10px;
  }
  .chat-artifact {
    display: block;
    max-width: min(100%, 420px);
    max-height: 240px;
    cursor: zoom-in;
    border: 1px solid @border-hair;
    border-radius: @radius-md;
  }

  // ── 工具调用折叠面板（降噪）────────────────────────────────
  .activity-trace {
    width: min(500px, 100%);
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid @border-soft;
    border-radius: @radius-md;
    background: rgba(0, 0, 0, 0.02);
  }
  .activity-summary {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px;
    color: @text-secondary;
    font-size: 12px;
    cursor: pointer;
    list-style: none;
  }
  .activity-summary::-webkit-details-marker {
    display: none;
  }
  .activity-count {
    margin-left: auto;
    color: @text-secondary;
  }
  .activity-body {
    padding: 4px 12px 8px;
    font-family: @code-font;
    border-top: 1px solid @border-soft;
  }
  .activity-row {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 22px;
    color: @text-secondary;
    font-size: 12px;
  }
  .activity-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #bfbfbf;
  }
  .activity-dot.activity-running {
    background: @brand;
    animation: activity-pulse 1.2s infinite;
  }
  .activity-dot.activity-completed {
    background: #52c41a;
  }
  .activity-dot.activity-failed {
    background: #ff4d4f;
  }
  .activity-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .activity-badge {
    flex: 0 0 auto;
    padding: 0 6px;
    color: @text-secondary;
    font-size: 11px;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 999px;
  }
  .activity-item {
    padding: 3px 0;
    & + & {
      border-top: 1px dashed @border-soft;
    }
  }
  .activity-detail {
    margin-left: 14px;
    color: @text-secondary;
    font-size: 11px;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .activity-output {
    color: rgba(0, 0, 0, 0.35);
  }
  .activity-state {
    color: @text-secondary;
  }

  // ── 思考过程折叠面板（默认折叠）──────────────────────────────
  .reasoning-trace {
    width: min(500px, 100%);
    margin-top: 10px;
    overflow: hidden;
    background: rgba(22, 119, 255, 0.03);
    border: 1px solid rgba(22, 119, 255, 0.12);
    border-radius: @radius-md;
  }
  .reasoning-summary {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px;
    color: @text-secondary;
    font-size: 12px;
    cursor: pointer;
    list-style: none;
  }
  .reasoning-summary::-webkit-details-marker {
    display: none;
  }
  .reasoning-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    background: @brand;
    border-radius: 50%;
    opacity: 0.5;
  }
  .reasoning-body {
    max-height: 320px;
    padding: 8px 12px 10px;
    overflow: auto;
    color: @text-secondary;
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    border-top: 1px solid rgba(22, 119, 255, 0.1);
  }
  @keyframes activity-pulse {
    50% {
      opacity: 0.35;
    }
  }

  // ── 底部输入区 ──────────────────────────────────────────────
  :deep(.ant-sender) {
    width: min(@content-max, 100%);
    margin: 0 auto;
    background: #fff;
    border: 1px solid @border-hair;
    border-radius: @radius-lg;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    transition:
      width 0.22s ease-out,
      box-shadow 0.22s ease-out,
      border-color 0.15s ease;
  }
  :deep(.ant-sender textarea),
  :deep(.ant-sender .ant-input) {
    font-size: 14px;
  }
  :deep(.ant-sender:focus-within) {
    border-color: @brand;
  }
  // 落地态输入横条：更窄、更松、阴影更明显
  .is-landing {
    :deep(.ant-sender) {
      width: min(@landing-max, 100%);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
    }
    :deep(.ant-sender textarea),
    :deep(.ant-sender .ant-input) {
      padding-left: 18px;
      font-size: 14px;
    }
  }

  // ── 流式输出指示（纯 CSS，末尾三点跳动）────────────────────
  .thread.is-streaming :deep(.ant-bubble:last-child .md-body::after) {
    content: '';
    display: inline-block;
    width: 4px;
    height: 4px;
    margin-left: 4px;
    vertical-align: middle;
    border-radius: 50%;
    background: @text-secondary;
    box-shadow:
      8px 0 0 @text-secondary,
      16px 0 0 @text-secondary;
    animation: typing-dots 1s infinite;
  }
  @keyframes typing-dots {
    0%,
    60%,
    100% {
      opacity: 0.25;
    }
    30% {
      opacity: 0.9;
    }
  }

  @media (max-width: 720px) {
    .openclaw-chat {
      padding: 16px;
    }
    .chat-layout {
      height: calc(100vh - 112px);
    }
    .chat-header {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  // 降低动效偏好下直接切换，不做过渡
  @media (prefers-reduced-motion: reduce) {
    .landing-hero,
    .landing-chips,
    .landing-chip,
    :deep(.ant-sender) {
      transition: none;
    }
  }
</style>
