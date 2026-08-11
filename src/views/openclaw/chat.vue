<template>
  <div class="openclaw-chat">
    <section class="chat-layout">
      <header class="chat-header">
        <div>
          <h2>智能体对话</h2>
          <p>查询标准、作业指导书、传感器数据、产量趋势和运行建议</p>
        </div>
        <div class="header-actions">
          <a-tag color="success"><template #icon><CheckCircleOutlined /></template>已连接</a-tag>
        </div>
      </header>

      <main ref="threadRef" class="thread" @click="onThreadClick" @scroll="saveScroll">
        <BubbleList :items="bubbleItems" :roles="roles" :auto-scroll="true" class="bubble-list" />
      </main>

      <a-alert v-if="chatError" :message="chatError" type="error" show-icon closable @close="chatError = ''" />
      <a-alert v-if="chatWarning" :message="chatWarning" type="warning" show-icon closable @close="chatWarning = ''" />

      <Sender
        v-model:value="input"
        :loading="loading"
        placeholder="输入问题，例如：ASME B16.34 对阀门压力等级有什么要求？"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CheckCircleOutlined, FileTextOutlined, UserOutlined } from '@ant-design/icons-vue';
import { Bubble, Sender } from 'ant-design-x-vue';
import type { BubbleListProps } from 'ant-design-x-vue';
import { fetchChatArtifact, type ChatActivity, type ChatArtifact, type ChatMessage, type ChatSource, streamZhihuaChat } from '/@/api/openclaw/chat';
import { renderMarkdown } from './renderMarkdown';
import { publicPath } from '/@/utils/env';

const BubbleList = Bubble.List;
// SOP 原文 PDF 已改为独立的全文构建；旧会话页码不能再复用。
const storageKey = 'openclaw-chat-rag-v2';
const hebangLogo = publicPath + '/resource/img/hebang_user.png';
const router = useRouter();
const loading = ref(false);
const chatError = ref('');
const chatWarning = ref('');
const input = ref('');
const threadRef = ref<HTMLElement | null>(null);
let abortController: AbortController | null = null;
type ArtifactState = { loading?: boolean; url?: string; error?: string };
const artifactStates = ref<Record<string, ArtifactState>>({});

const newId = () => 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const messages = ref<ChatMessage[]>([{
  id: newId(),
  role: 'assistant',
  content: '您好，我是和邦知化智能体。可以查询化工标准、作业指导书、传感器数据、产量趋势和运行建议。',
}]);

function renderAssistant(content: string, messageId: string, sources: ChatSource[] = []) {
  const available = new Set(sources.map((source) => source.id));
  // 只有后端实际返回了来源元数据的引用才可点击，避免模型自行输出 [E2]
  // 时造成“看起来能点、实际没有链接”的假引用。
  const html = renderMarkdown(content).replace(/\[(E(?:10|[1-9]))\]/g, (token, id: string) => {
    return available.has(id) ? `<button type="button" class="citation-token" data-citation="${id}">${token}</button>` : token;
  });
  return h('div', { class: 'md-body', 'data-message-id': messageId, innerHTML: html });
}

function clearArtifactUrls() {
  Object.values(artifactStates.value).forEach((state) => {
    if (state.url) URL.revokeObjectURL(state.url);
  });
  artifactStates.value = {};
}

async function loadArtifact(artifact: ChatArtifact, force = false) {
  const previous = artifactStates.value[artifact.id];
  if (previous?.loading || (previous?.url && !force)) return;
  if (previous?.url) URL.revokeObjectURL(previous.url);
  artifactStates.value = { ...artifactStates.value, [artifact.id]: { loading: true } };
  try {
    const blob = await fetchChatArtifact(artifact);
    artifactStates.value = { ...artifactStates.value, [artifact.id]: { url: URL.createObjectURL(blob) } };
  } catch {
    artifactStates.value = { ...artifactStates.value, [artifact.id]: { error: '图表加载失败，请重试。' } };
  }
}

function renderArtifact(artifact: ChatArtifact) {
  const state = artifactStates.value[artifact.id];
  if (!state) void loadArtifact(artifact);
  const current = state || { loading: true };
  const children = [h('div', { class: 'artifact-title' }, artifact.title || artifact.alt)];
  if (current.url) {
    children.push(h('img', { src: current.url, alt: artifact.alt, onClick: () => window.open(current.url, '_blank', 'noopener,noreferrer') }));
    children.push(h('div', { class: 'artifact-actions' }, [
      h('button', { type: 'button', onClick: () => window.open(current.url, '_blank', 'noopener,noreferrer') }, '查看大图'),
      h('a', { href: current.url, download: `${artifact.id}.png` }, '下载 PNG'),
    ]));
  } else if (current.error) {
    children.push(h('div', { class: 'artifact-error' }, [current.error, h('button', { type: 'button', onClick: () => void loadArtifact(artifact, true) }, '重试')]));
  } else {
    children.push(h('div', { class: 'artifact-loading' }, '正在加载图表…'));
  }
  return h('section', { class: 'chat-artifact', 'data-artifact-id': artifact.id }, children);
}

const roles: BubbleListProps['roles'] = {
  assistant: {
    placement: 'start',
    variant: 'filled',
    avatar: h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', overflow: 'hidden', borderRadius: '50%', background: '#ffffff' } },
      h('img', { src: hebangLogo, alt: '和邦知化', style: { display: 'block', width: '100%', height: '100%', objectFit: 'cover' } })) as never,
  },
  user: {
    placement: 'end',
    variant: 'filled',
    avatar: { icon: h(UserOutlined), style: { background: '#fff3d8', color: '#8a5c11' } },
  },
};

function sourceFooter(message: ChatMessage) {
  if (!message.sources?.length) return null;
  const groups: Array<{ corpus: ChatSource['corpus']; title: string }> = [
    { corpus: 'standard', title: '标准知识库' },
    { corpus: 'sop', title: '作业指导书' },
  ];
  return h('section', { class: 'source-footer', 'data-source-message-id': message.id }, [
    h('div', { class: 'source-heading' }, [h(FileTextOutlined), h('span', '参考来源')]),
    ...groups.flatMap(({ corpus, title }) => {
      const sources = message.sources!.filter((source) => source.corpus === corpus);
      return sources.length ? [h('div', { class: 'source-group' }, [
        h('div', { class: 'source-group-heading' }, title),
        ...sources.map((source) => renderSourceLink(source, message.id || '')),
      ])] : [];
    }),
  ]);
}

function renderActivity(activity: ChatActivity) {
  const statusText = activity.status === 'running' ? '进行中' : activity.status === 'error' ? '失败' : '完成';
  return h('div', { class: ['trace-tool', `trace-tool-${activity.status}`] }, [
    h('div', { class: 'trace-tool-title' }, [
      h('span', { class: 'trace-status' }),
      h('span', activity.title || `调用工具：${activity.toolName}`),
      h('span', { class: 'trace-status-text' }, statusText),
    ]),
    activity.inputSummary ? h('code', { class: 'trace-command' }, activity.inputSummary) : null,
    activity.outputSummary ? h('div', { class: 'trace-output' }, activity.outputSummary) : null,
  ]);
}

function renderAgentTrace(message: ChatMessage) {
  const activities = message.activities || [];
  if (!message.thinking && !activities.length) return null;
  const completed = activities.filter((activity) => activity.status === 'completed').length;
  const running = activities.some((activity) => activity.status === 'running');
  const summary = running ? `智能体执行中 · ${activities.length} 个工具步骤` : `思考与工具调用 · ${completed}/${activities.length} 已完成`;
  return h('details', { class: 'agent-trace' }, [
    h('summary', { class: 'agent-trace-summary' }, summary),
    h('div', { class: 'agent-trace-body' }, [
      message.thinking ? h('details', { class: 'trace-thinking' }, [
        h('summary', '思考过程'),
        h('pre', message.thinking),
      ]) : null,
      ...activities.map(renderActivity),
    ]),
  ]);
}

function renderSourceLink(source: ChatSource, messageId: string) {
  const isPdf = source.linkType === 'pdf' && Boolean(source.docId);
  if (isPdf) {
    return h('a', {
      href: standardSourceHref(source, messageId),
      onClick: saveState,
      class: 'source-link source-pdf-link',
      'aria-label': `查看 ${source.title} 第 ${source.pageStart || '?'} 页`,
    }, `${source.title}：第 ${source.pageStart || '?'} 页`);
  }
  return h('button', {
    type: 'button',
    'data-source-id': source.id,
    class: 'source-link',
    'aria-label': `阅读 SOP 原文：${source.titlePath || source.title}`,
  }, [
    h('span', { class: 'source-id' }, source.id),
    h('span', { class: 'source-main' }, [
      h('span', { class: 'source-name' }, source.title),
      h('span', { class: 'source-location' }, 'SOP · ' + (source.section || '章节')),
    ]),
    h('span', { class: 'source-path' }, source.titlePath || source.quote),
    h('span', { class: 'source-action' }, '阅读 SOP 原文'),
  ]);
}

function messageFooter(message: ChatMessage) {
  const parts: ReturnType<typeof h>[] = [];
  const trace = renderAgentTrace(message);
  if (trace) parts.push(trace);
  parts.push(...(message.artifacts || []).map(renderArtifact));
  const sources = sourceFooter(message);
  if (sources) parts.push(sources);
  return h('div', { class: 'assistant-footer' }, parts);
}

/** 标准来源使用真实路由链接，避免气泡组件吞掉页脚点击事件。 */
function standardSourceHref(source: ChatSource, messageId: string) {
  if (!source.docId) return '#';
  return router.resolve({
    name: 'KnowledgeSource',
    params: { docId: source.docId },
    query: {
      page: String(source.pageStart || 1),
      buildId: source.buildId,
      bbox: source.normalizedBbox?.join(','),
      from: 'openclaw',
      messageId,
    },
  }).href;
}

const bubbleItems = computed(() => messages.value.map((message) => ({
  key: message.id || newId(),
  role: message.role,
  content: message.role === 'assistant' ? renderAssistant(message.content, message.id || '', message.sources) : message.content,
  footer: message.role === 'assistant' ? () => messageFooter(message) : undefined,
  loading: message.role === 'assistant' && loading.value && message === messages.value[messages.value.length - 1] && message.content === '',
})));

function saveState() {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ messages: messages.value, input: input.value, scrollTop: threadRef.value?.scrollTop || 0 }));
  } catch {
    // 浏览器存储不可用时不影响对话。
  }
}

function restoreState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    if (Array.isArray(saved.messages) && saved.messages.length) {
      messages.value = (saved.messages as ChatMessage[]).map((message) => ({
        ...message,
        // 兼容旧会话：旧 SOP 章节来源统一迁移到新的 PDF 阅读链路。
        sources: message.sources?.map((source) => source.corpus === 'sop' && source.linkType === 'section' && source.sourceKey
          ? { ...source, linkType: 'pdf', docId: `sop:${source.sourceKey}` }
          : source),
      }));
    }
    if (typeof saved.input === 'string') input.value = saved.input;
    nextTick(() => {
      if (threadRef.value && Number.isFinite(saved.scrollTop)) threadRef.value.scrollTop = saved.scrollTop;
    });
  } catch {
    sessionStorage.removeItem(storageKey);
  }
}

function saveScroll() {
  saveState();
}

async function scrollToBottom() {
  await nextTick();
  if (threadRef.value) threadRef.value.scrollTop = threadRef.value.scrollHeight;
}

function openSource(source: ChatSource, messageId: string) {
  saveState();
  if (source.linkType === 'section') {
    if (!source.sourceKey) {
      chatWarning.value = '该 SOP 来源缺少章节定位信息。';
      return;
    }
    source = { ...source, linkType: 'pdf', docId: `sop:${source.sourceKey}` };
  }
  if (!source.docId) {
    chatWarning.value = '该标准来源缺少文档定位信息。';
    return;
  }
  router.push({
    name: 'KnowledgeSource',
    params: { docId: source.docId },
    query: {
      page: String(source.pageStart || 1),
      buildId: source.buildId,
      bbox: source.normalizedBbox?.join(','),
      from: 'openclaw',
      messageId,
    },
  });
}

function onThreadClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.tagName === 'IMG') {
    const src = target.getAttribute('src');
    if (src) window.open(src, '_blank', 'noopener,noreferrer');
    return;
  }
  const sourceButton = target.closest<HTMLElement>('[data-source-id]');
  if (sourceButton) {
    const footer = sourceButton.closest<HTMLElement>('[data-source-message-id]');
    const message = messages.value.find((item) => item.id === footer?.dataset.sourceMessageId);
    const source = message?.sources?.find((item) => item.id === sourceButton.dataset.sourceId);
    if (source) openSource(source, message?.id || '');
    return;
  }
  const citation = target.closest<HTMLElement>('[data-citation]');
  if (!citation) return;
  const messageElement = citation.closest<HTMLElement>('[data-message-id]');
  const message = messages.value.find((item) => item.id === messageElement?.dataset.messageId);
  const source = message?.sources?.find((item) => item.id === citation.dataset.citation);
  if (source) openSource(source, message?.id || '');
}

async function onSubmit(text: string) {
  const content = (text ?? '').trim();
  if (!content || loading.value) return;

  const userMessage: ChatMessage = { id: newId(), role: 'user', content };
  const pendingMessage: ChatMessage = { id: newId(), role: 'assistant', content: '' };
  messages.value = [...messages.value, userMessage, pendingMessage];
  input.value = '';
  loading.value = true;
  chatError.value = '';
  chatWarning.value = '';
  saveState();
  await scrollToBottom();

  abortController = new AbortController();
  try {
    await streamZhihuaChat(messages.value.slice(0, -1), (streamEvent) => {
      if (streamEvent.event === 'activity') {
        if ('delta' in streamEvent.data) {
          pendingMessage.thinking = (pendingMessage.thinking || '') + streamEvent.data.delta;
        } else {
          const activity = streamEvent.data;
          const activities = [...(pendingMessage.activities || [])];
          const index = activities.findIndex((item) => item.id === activity.id);
          if (index >= 0) activities[index] = activity;
          else activities.push(activity);
          pendingMessage.activities = activities;
        }
        messages.value = [...messages.value.slice(0, -1), { ...pendingMessage }];
        void scrollToBottom();
        return;
      }
      if (streamEvent.event === 'error') throw new Error(streamEvent.data.error);
      const result = streamEvent.data;
      pendingMessage.content = result.message;
      pendingMessage.id = result.messageId || pendingMessage.id;
      pendingMessage.sources = result.sources || [];
      pendingMessage.artifacts = result.artifacts || [];
      pendingMessage.activities = result.activities || pendingMessage.activities || [];
      pendingMessage.knowledgeRoute = result.knowledgeRoute;
      pendingMessage.warnings = result.warnings || [];
      pendingMessage.abstained = result.abstained;
      if (pendingMessage.warnings.length) chatWarning.value = pendingMessage.warnings.map((item) => item.message).filter(Boolean).join('；');
      messages.value = [...messages.value.slice(0, -1), { ...pendingMessage }];
      pendingMessage.artifacts.forEach((artifact) => void loadArtifact(artifact));
    }, abortController.signal);
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || (error as { code?: string })?.code === 'ERR_CANCELED') {
      pendingMessage.content = '（已停止）';
    } else {
      const status = (error as { status?: number })?.status;
      const message = status === 401 || status === 403 ? '登录已过期，请重新登录后重试。' : error instanceof Error ? error.message : '智能体暂时不可用';
      chatError.value = message;
      pendingMessage.content = message;
    }
    messages.value = [...messages.value.slice(0, -1), pendingMessage];
  } finally {
    loading.value = false;
    abortController = null;
    saveState();
    await scrollToBottom();
  }
}

function onCancel() {
  abortController?.abort();
}

onMounted(() => {
  restoreState();
  messages.value.flatMap((message) => message.artifacts || []).forEach((artifact) => void loadArtifact(artifact));
});
onBeforeUnmount(clearArtifactUrls);
</script>

<style scoped lang="less">
.openclaw-chat { min-height: calc(100vh - 96px); padding: 24px; background: #f4f7f6; }
.chat-layout { display: grid; height: calc(100vh - 144px); min-height: 560px; grid-template-rows: auto 1fr auto auto; gap: 16px; }
.chat-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.chat-header h2 { margin: 0 0 6px; color: #17211c; font-size: 24px; font-weight: 700; }
.chat-header p { margin: 0; color: #6c7b72; }
.header-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end; }
.thread { min-height: 0; padding: 20px; overflow: auto; border: 1px solid #dce6e1; border-radius: 12px; background: linear-gradient(#ffffff, #fbfdfc); }
.bubble-list { height: 100%; }

:deep(.md-body) { font-size: 15px; line-height: 1.8; word-break: break-word; }
:deep(.md-body p) { margin: 0 0 10px; }
:deep(.md-body p:last-child) { margin-bottom: 0; }
:deep(.md-body h1), :deep(.md-body h2), :deep(.md-body h3), :deep(.md-body h4) { margin: 16px 0 8px; font-weight: 650; line-height: 1.35; }
:deep(.md-body h1) { font-size: 21px; }
:deep(.md-body h2) { font-size: 19px; }
:deep(.md-body h3) { font-size: 17px; }
:deep(.md-body h4) { font-size: 15px; }
:deep(.md-body ul), :deep(.md-body ol) { margin: 0 0 10px; padding-left: 22px; }
:deep(.md-body li) { margin: 3px 0; }
:deep(.md-body a) { color: #1677ff; text-decoration: none; }
:deep(.md-body a:hover) { text-decoration: underline; }
:deep(.md-body blockquote) { margin: 0 0 10px; padding: 4px 12px; color: #52615a; border-left: 3px solid #cdd8d1; background: rgb(0 0 0 / 2%); }
:deep(.md-body code) { padding: 1px 5px; font-family: Consolas, monospace; font-size: .88em; background: rgb(0 0 0 / 6%); border-radius: 4px; }
:deep(.md-body pre) { margin: 0 0 10px; padding: 12px 14px; overflow: auto; color: #e6edea; background: #1f2a24; border-radius: 6px; }
:deep(.md-body table) { max-width: 100%; margin: 0 0 10px; border-collapse: collapse; }
:deep(.md-body th), :deep(.md-body td) { padding: 6px 12px; text-align: left; border: 1px solid #dce6e1; }
.assistant-footer { width: min(100%, 680px); }
.chat-artifact { margin-top: 10px; padding: 12px; background: #f7fbff; border: 1px solid #c8dcf7; border-radius: 10px; }
.artifact-title { margin-bottom: 8px; color: #174b8f; font-size: 14px; font-weight: 700; }
.chat-artifact img { display: block; width: 100%; max-width: 640px; max-height: 520px; margin: 0 auto; object-fit: contain; cursor: zoom-in; border: 1px solid #dfe5e1; border-radius: 6px; }
.artifact-actions { display: flex; gap: 12px; margin-top: 8px; font-size: 13px; }
.artifact-actions button, .artifact-error button { padding: 0; color: #1677ff; cursor: pointer; background: none; border: 0; }
.artifact-actions a { color: #1677ff; }
.artifact-loading, .artifact-error { color: #6681a1; font-size: 13px; }
.artifact-error { color: #b42318; }
:deep(.citation-token) { margin: 0 2px; padding: 1px 5px; color: #1359b5; font: inherit; font-size: .9em; font-weight: 700; line-height: 1.35; background: #edf5ff; border: 1px solid #b8d5ff; border-radius: 4px; cursor: pointer; }
:deep(.citation-token:hover) { color: #fff; background: #1677ff; }

:global(.source-footer) { width: min(100%, 680px); margin-top: 4px; padding: 12px; background: #f7fbff; border: 1px solid #c8dcf7; border-radius: 10px; }
:global(.source-heading) { display: flex; gap: 7px; align-items: center; margin: 0 0 9px; color: #174b8f; font-size: 14px; font-weight: 700; }
:global(.source-group + .source-group) { margin-top: 12px; padding-top: 10px; border-top: 1px solid #d9e7f8; }
:global(.source-group-heading) { margin: 0 0 4px; color: #5a7594; font-size: 12px; font-weight: 700; }
:global(.agent-trace) { width: min(100%, 680px); margin: 4px 0 8px; overflow: hidden; background: #f7f8fa; border: 1px solid #d9dee7; border-radius: 9px; }
:global(.agent-trace-summary) { padding: 9px 12px; color: #526174; font-size: 13px; font-weight: 650; cursor: pointer; user-select: none; }
:global(.agent-trace-body) { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px; }
:global(.trace-thinking) { color: #5b6573; font-size: 12px; }
:global(.trace-thinking summary) { cursor: pointer; }
:global(.trace-thinking pre) { max-height: 260px; padding: 9px; margin: 7px 0 0; overflow: auto; font: 12px/1.55 Consolas, monospace; white-space: pre-wrap; background: #fff; border: 1px solid #e3e7ed; border-radius: 6px; }
:global(.trace-tool) { padding: 8px 9px; background: #fff; border: 1px solid #e0e5ec; border-radius: 6px; }
:global(.trace-tool-title) { display: flex; gap: 7px; align-items: center; color: #3f4d5f; font-size: 13px; font-weight: 650; }
:global(.trace-status) { width: 8px; height: 8px; background: #52c41a; border-radius: 50%; }
:global(.trace-tool-running .trace-status) { background: #1677ff; box-shadow: 0 0 0 3px rgb(22 119 255 / 14%); }
:global(.trace-tool-error .trace-status) { background: #e5484d; }
:global(.trace-status-text) { margin-left: auto; color: #8993a1; font-size: 11px; font-weight: 500; }
:global(.trace-command) { display: block; max-height: 80px; padding: 6px 8px; margin-top: 6px; overflow: auto; color: #5c6674; font-size: 11px; white-space: pre-wrap; background: #f5f7f9; border-radius: 4px; }
:global(.trace-output) { margin-top: 5px; color: #6c7684; font-size: 12px; }
:global(.source-link) { display: grid; width: 100%; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 9px 10px; margin-top: 7px; color: inherit; text-align: left; text-decoration: none; cursor: pointer; background: #fff; border: 1px solid #b9d3f5; border-radius: 7px; transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease; }
:global(.source-link:hover) { border-color: #1677ff; box-shadow: 0 4px 12px rgb(22 119 255 / 13%); transform: translateY(-1px); }
:global(.source-pdf-link) { display: inline-block; width: auto; max-width: 100%; padding: 7px 11px; margin: 6px 8px 0 0; overflow: hidden; color: #1455a1; font-size: 14px; font-weight: 700; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; background: #fff; border: 1px solid #8ab9ef; border-radius: 6px; }
:global(.source-pdf-link:hover) { color: #0f4c99; background: #f0f7ff; border-color: #1677ff; }
:global(.source-id) { min-width: 30px; padding: 2px 5px; color: #1455a1; font-weight: 800; text-align: center; background: #e6f1ff; border-radius: 4px; }
:global(.source-main) { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
:global(.source-name) { overflow: hidden; color: #173f77; font-size: 15px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
:global(.source-location) { color: #6681a1; font-size: 12px; }
:global(.source-path) { display: -webkit-box; grid-column: 2 / 4; overflow: hidden; color: #53677e; font-size: 12px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
:global(.source-action) { color: #1677ff; font-size: 12px; font-weight: 650; white-space: nowrap; }
@media (max-width: 720px) {
  .openclaw-chat { padding: 16px; }
  .chat-layout { height: calc(100vh - 112px); }
  .chat-header { align-items: flex-start; flex-direction: column; }
  .chat-artifact img { max-height: 360px; }
}
</style>
