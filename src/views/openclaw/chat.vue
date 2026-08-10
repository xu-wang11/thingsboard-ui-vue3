<template>
  <div class="openclaw-chat">
    <section class="chat-layout">
      <header class="chat-header">
        <div>
          <h2>智能体对话</h2>
          <p>查询工艺规程、传感器数据、产量趋势和运行建议</p>
        </div>
        <div class="header-actions">
          <a-tag color="success">
            <template #icon><CheckCircleOutlined /></template>
            已连接
          </a-tag>
        </div>
      </header>

      <main ref="threadRef" class="thread" @click="onThreadClick">
        <BubbleList :items="bubbleItems" :roles="roles" :auto-scroll="true" class="bubble-list" />
      </main>

      <a-alert v-if="chatError" :message="chatError" type="error" show-icon closable @close="chatError = ''" />

      <Sender
        v-model:value="input"
        :loading="loading"
        placeholder="输入问题，例如：查看当前反应釜温度趋势"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, h, nextTick, ref } from 'vue';
import { CheckCircleOutlined, UserOutlined } from '@ant-design/icons-vue';
import { Bubble, Sender } from 'ant-design-x-vue';
import type { BubbleListProps } from 'ant-design-x-vue';
import { ChatMessage, sendZhihuaChat } from '/@/api/openclaw/chat';
import { renderMarkdown } from './renderMarkdown';
import { publicPath } from '/@/utils/env';

const BubbleList = Bubble.List;

const hebangLogo = `${publicPath}/resource/img/hebang_user.png`;

const loading = ref(false);
const chatError = ref('');
const input = ref('');
const threadRef = ref<HTMLElement | null>(null);
let abortController: AbortController | null = null;

const messages = ref<ChatMessage[]>([
  {
    role: 'assistant',
    content: '您好，我是和邦知化智能体。可以查询工艺规程、传感器数据、产量趋势和运行建议。',
  },
]);

// assistant 消息渲染 markdown（返回带 innerHTML 的 VNode）；user 保持纯文本
function assistantRender(content: string) {
  return h('div', { class: 'md-body', innerHTML: renderMarkdown(content) });
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
    avatar: {
      icon: h(UserOutlined),
      style: { background: '#fff3d8', color: '#8a5c11' },
    },
  },
};

const bubbleItems = computed(() =>
  messages.value.map((m, index) => ({
    key: index,
    role: m.role,
    content: m.content,
    // assistant 首 token 前显示 loading 点
    loading: m.role === 'assistant' && loading.value && index === messages.value.length - 1 && m.content === '',
  })),
);

async function scrollToBottom() {
  await nextTick();
  if (threadRef.value) threadRef.value.scrollTop = threadRef.value.scrollHeight;
}

// 图片点击放大：委托到 thread 容器
function onThreadClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.tagName === 'IMG') {
    const src = target.getAttribute('src');
    if (src) window.open(src, '_blank', 'noopener,noreferrer');
  }
}

async function onSubmit(text: string) {
  const content = (text ?? '').trim();
  if (!content || loading.value) return;

  messages.value = [...messages.value, { role: 'user', content }, { role: 'assistant', content: '' }];
  const assistantIndex = messages.value.length - 1;
  input.value = '';
  loading.value = true;
  chatError.value = '';
  await scrollToBottom();

  abortController = new AbortController();
  try {
    const result = await sendZhihuaChat(messages.value.slice(0, assistantIndex), abortController.signal);
    messages.value[assistantIndex].content = result.message;
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || (error as { code?: string })?.code === 'ERR_CANCELED') {
      messages.value[assistantIndex].content ||= '（已停止）';
    } else {
      const message = error instanceof Error ? error.message : '智能体暂时不可用';
      chatError.value = message;
      if (!messages.value[assistantIndex].content) messages.value[assistantIndex].content = message;
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
</script>

<style scoped lang="less">
.openclaw-chat {
  min-height: calc(100vh - 96px);
  padding: 24px;
  background: #f4f7f6;
}

.chat-layout {
  display: grid;
  height: calc(100vh - 144px);
  min-height: 560px;
  grid-template-rows: auto 1fr auto auto;
  gap: 16px;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  h2 {
    margin: 0 0 6px;
    color: #17211c;
    font-size: 24px;
    font-weight: 700;
  }

  p {
    margin: 0;
    color: #6c7b72;
  }
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.thread {
  min-height: 0;
  padding: 20px;
  overflow: auto;
  border: 1px solid #dce6e1;
  border-radius: 12px;
  background: linear-gradient(#ffffff, #fbfdfc);
}

.bubble-list {
  height: 100%;
}

// markdown 排版（messageRender 注入的 .md-body）
:deep(.md-body) {
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;

  p {
    margin: 0 0 10px;
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
    font-size: 20px;
  }
  h2 {
    font-size: 18px;
  }
  h3 {
    font-size: 16px;
  }
  h4 {
    font-size: 14px;
  }
  ul,
  ol {
    margin: 0 0 10px;
    padding-left: 22px;
  }
  li {
    margin: 3px 0;
  }
  a {
    color: #1f7a4d;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
  blockquote {
    margin: 0 0 10px;
    padding: 4px 12px;
    color: #52615a;
    border-left: 3px solid #cdd8d1;
    background: rgba(0, 0, 0, 0.02);
  }
  code {
    padding: 1px 5px;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 0.88em;
    background: rgba(0, 0, 0, 0.06);
    border-radius: 4px;
  }
  pre.hljs,
  pre {
    margin: 0 0 10px;
    padding: 12px 14px;
    overflow: auto;
    background: #1f2a24;
    border-radius: 6px;
    code {
      padding: 0;
      color: #e6edea;
      background: transparent;
      font-size: 13px;
      line-height: 1.6;
    }
  }
  table {
    margin: 0 0 10px;
    border-collapse: collapse;
    max-width: 100%;
    th,
    td {
      padding: 6px 12px;
      border: 1px solid #dce6e1;
      text-align: left;
    }
    th {
      background: #f0f4f2;
      font-weight: 600;
    }
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 520px;
    margin: 8px 0;
    border: 1px solid #dfe5e1;
    border-radius: 6px;
    object-fit: contain;
    cursor: zoom-in;
  }
  hr {
    margin: 14px 0;
    border: none;
    border-top: 1px solid #dce6e1;
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
</style>
