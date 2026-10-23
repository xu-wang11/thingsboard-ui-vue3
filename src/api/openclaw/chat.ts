import axios from 'axios';
import { getToken } from '/@/utils/auth';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatSource = {
  id: string;
  corpus: 'standard' | 'sop';
  linkType: 'pdf';
  docId: string;
  fileName?: string;
  sourceKey?: string;
  title: string;
  standardCode?: string;
  titlePath?: string;
  quote: string;
  pageStart?: number;
  pageEnd?: number;
  normalizedBbox?: number[];
  /** RAGFlow 命中区域框（PDF 点坐标，[left, top, right, bottom]），用于阅读页高亮。 */
  bboxes?: number[][];
  buildId?: string;
};

export type ChatArtifact = {
  /** Backend-relative, authenticated source URL. */
  sourceUrl?: string;
  /** Browser-display URL; may be a short-lived Blob URL. */
  url: string;
  title?: string;
  /** True when url is an external/inline image shown as-is (not a workspace artifact). */
  external?: boolean;
};

export type ChatActivity = {
  id?: string;
  kind?: string;
  toolName?: string;
  ragKind?: string;
  status?: string;
  resultCount?: number;
  title?: string;
  inputSummary?: string;
  outputSummary?: string;
  delta?: string;
};

export type ChatFinal = {
  messageId: string;
  message: string;
  knowledgeRoute?: 'none' | 'standard' | 'sop' | 'mixed';
  sources: ChatSource[];
  artifacts: ChatArtifact[];
  activities: ChatActivity[];
  warnings: Array<{ type: string; message: string }>;
  abstained?: boolean;
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

const OPENCLAW_API_BASE = import.meta.env.VITE_OPENCLAW_API_BASE || '/openclaw-api';

const openclawHttp = axios.create({
  baseURL: OPENCLAW_API_BASE,
  timeout: 120 * 1000,
  headers: { 'Content-Type': 'application/json' },
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
  onDelta: (snapshot: string) => void;
  onFinal?: (response: ChatFinal) => void;
  onActivity?: (activity: ChatActivity) => void;
  onThinking?: (delta: string) => void;
  signal?: AbortSignal;
}

/** SSE adapter. Tool evidence is accepted only from the backend final event. */
export async function streamZhihuaChat(messages: ChatMessage[], handlers: StreamHandlers): Promise<string> {
  const response = await fetch(`${OPENCLAW_API_BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(getToken() ? { 'X-Authorization': 'Bearer ' + getToken() } : {}),
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
      // Keep the meaningful default for non-JSON failures.
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let latest = '';

  const handleEvent = (chunk: string) => {
    const eventName = chunk
      .split('\n')
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    const payload = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!payload) return;

    let parsed: ChatFinal & { delta?: string; error?: string };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    if (parsed.error) throw new Error(parsed.error);
    if (eventName === 'final') {
      latest = typeof parsed.message === 'string' ? parsed.message : latest;
      handlers.onDelta(latest);
      handlers.onFinal?.(parsed);
      return;
    }
    if (eventName === 'activity') {
      const activity = parsed as ChatActivity;
      // Reasoning streams as its own collapsible panel; tool lifecycle events go to the trace.
      if (activity.kind === 'thinking') handlers.onThinking?.(parsed.delta ?? '');
      else handlers.onActivity?.(activity);
      return;
    }
    if (typeof parsed.delta === 'string') {
      latest = parsed.delta;
      handlers.onDelta(latest);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      handleEvent(rawEvent);
      separator = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) handleEvent(buffer);
  return latest;
}
