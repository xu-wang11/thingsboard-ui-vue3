import axios from 'axios';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

const OPENCLAW_API_BASE = import.meta.env.VITE_OPENCLAW_API_BASE || '/openclaw-api';

const openclawHttp = axios.create({
  baseURL: OPENCLAW_API_BASE,
  timeout: 120 * 1000,
  headers: {
    'Content-Type': 'application/json',
  },
});

openclawHttp.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error?.response?.data as ApiErrorPayload | undefined;
    return Promise.reject(new Error(data?.error || data?.message || error?.message || '请求失败'));
  },
);

export function sendZhihuaChat(messages: ChatMessage[]) {
  return openclawHttp.post<{ message: string }>('/chat', { messages }).then((res) => res.data);
}

export interface StreamHandlers {
  // 每帧回调，snapshot 为到当前为止的完整文本（全量快照，直接替换）
  onDelta: (snapshot: string) => void;
  signal?: AbortSignal;
}

/**
 * 流式对话：SSE（text/event-stream）。后端逐帧返回 { delta } / { done } / { error }。
 * delta 为全量快照，调用方应替换而非拼接。返回最终完整文本。
 */
export async function streamZhihuaChat(messages: ChatMessage[], handlers: StreamHandlers): Promise<string> {
  const response = await fetch(`${OPENCLAW_API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ messages }),
    signal: handlers.signal,
  });

  if (!response.ok || !response.body) {
    let message = '智能体暂时不可用';
    try {
      const data = (await response.json()) as ApiErrorPayload;
      message = data?.error || data?.message || message;
    } catch {
      // 非 JSON 错误体，保留默认提示
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let latest = '';

  const handleEvent = (chunk: string) => {
    const dataLines = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (!dataLines.length) return;
    const payload = dataLines.join('\n');
    let parsed: { delta?: string; done?: boolean; error?: string };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    if (parsed.error) throw new Error(parsed.error);
    if (typeof parsed.delta === 'string') {
      latest = parsed.delta;
      handlers.onDelta(latest);
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIndex: number;
    // SSE 事件以空行（\n\n）分隔
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      handleEvent(rawEvent);
    }
  }
  if (buffer.trim()) handleEvent(buffer);

  return latest;
}
