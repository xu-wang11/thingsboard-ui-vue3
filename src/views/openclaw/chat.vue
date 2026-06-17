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

      <main ref="threadRef" class="thread">
        <article v-for="(message, index) in messages" :key="index" :class="['message', message.role]">
          <div class="message-role">{{ message.role === 'assistant' ? '知化' : '我' }}</div>
          <div class="message-body">{{ message.content }}</div>
        </article>
        <article v-if="loading" class="message assistant">
          <div class="message-role">知化</div>
          <div class="message-body muted">正在分析...</div>
        </article>
      </main>

      <a-alert v-if="chatError" :message="chatError" type="error" show-icon />

      <form class="composer" @submit.prevent="sendCurrentMessage">
        <a-textarea
          v-model:value="input"
          :auto-size="{ minRows: 2, maxRows: 5 }"
          :disabled="loading"
          placeholder="输入问题，例如：查看当前反应釜温度趋势"
          @keydown.enter.exact.prevent="sendCurrentMessage"
        />
        <a-button type="primary" html-type="submit" :disabled="!input.trim()" :loading="loading">
          <template #icon><SendOutlined /></template>
          发送
        </a-button>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { CheckCircleOutlined, SendOutlined } from '@ant-design/icons-vue';
import { ChatMessage, sendZhihuaChat } from '/@/api/openclaw/chat';

const loading = ref(false);
const chatError = ref('');
const input = ref('');
const threadRef = ref<HTMLElement | null>(null);

const messages = ref<ChatMessage[]>([
  {
    role: 'assistant',
    content: '您好，我是和邦知化智能体。可以查询工艺规程、传感器数据、产量趋势和运行建议。',
  },
]);

async function scrollToBottom() {
  await nextTick();
  if (threadRef.value) {
    threadRef.value.scrollTop = threadRef.value.scrollHeight;
  }
}

async function sendCurrentMessage() {
  const content = input.value.trim();
  if (!content || loading.value) return;

  const nextMessages: ChatMessage[] = [...messages.value, { role: 'user', content }];
  messages.value = nextMessages;
  input.value = '';
  loading.value = true;
  chatError.value = '';
  await scrollToBottom();

  try {
    const response = await sendZhihuaChat(nextMessages);
    messages.value = [...nextMessages, { role: 'assistant', content: response.message }];
  } catch (error) {
    const message = error instanceof Error ? error.message : '智能体暂时不可用';
    chatError.value = message;
    messages.value = [...nextMessages, { role: 'assistant', content: message }];
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
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
  padding: 18px;
  overflow: auto;
  border: 1px solid #dce6e1;
  border-radius: 8px;
  background: #fff;
}

.message {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.message-role {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 50%;
  background: #e9eee9;
  color: #52615a;
  font-weight: 700;
}

.message.assistant .message-role {
  background: #dff3e7;
  color: #1f7a4d;
}

.message.user .message-role {
  background: #fff3d8;
  color: #8a5c11;
}

.message-body {
  max-width: 920px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #f5f7f6;
  color: #17211c;
  line-height: 1.7;
  white-space: pre-wrap;
}

.message.user .message-body {
  background: #edf5ff;
}

.muted {
  color: #7a877f;
}

.composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 104px;
  gap: 12px;
  align-items: end;
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

  .message {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .composer {
    grid-template-columns: 1fr;
  }
}
</style>
