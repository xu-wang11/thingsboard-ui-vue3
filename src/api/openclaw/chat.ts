import axios from 'axios';
import { getToken } from '/@/utils/auth';

export type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  artifacts?: ChatArtifact[];
  knowledgeRoute?: 'none' | 'standard' | 'sop' | 'mixed';
  warnings?: ChatWarning[];
  abstained?: boolean;
  activities?: ChatActivity[];
  thinking?: string;
};

export type ChatSource = {
  id: string;
  corpus: 'standard' | 'sop';
  linkType: 'pdf' | 'section';
  docId?: string;
  sourceKey?: string;
  title: string;
  standardCode?: string;
  titlePath?: string;
  section?: string;
  quote: string;
  sectionContent?: string;
  pageStart?: number;
  pageEnd?: number;
  normalizedBbox?: number[];
  buildId?: string;
};

export type ChatWarning = { type: string; message: string };

export type ChatActivity = {
  id: string;
  kind: 'tool';
  toolName: string;
  title?: string;
  status: 'running' | 'completed' | 'error';
  ragKind?: 'standard' | 'sop';
  inputSummary?: string;
  outputSummary?: string;
  resultCount?: number;
};

export type ChatArtifact = {
  id: string;
  kind: 'image';
  mimeType: 'image/png';
  alt: string;
  title: string;
  url: string;
};

export type ChatResponse = {
  messageId: string;
  message: string;
  knowledgeRoute: 'none' | 'standard' | 'sop' | 'mixed';
  sources: ChatSource[];
  artifacts: ChatArtifact[];
  warnings: ChatWarning[];
  abstained: boolean;
  activities: ChatActivity[];
};

export type ChatStreamEvent =
  | { event: 'activity'; data: ChatActivity | { kind: 'thinking'; delta: string } }
  | { event: 'final'; data: ChatResponse }
  | { event: 'error'; data: { error: string } };

type ApiErrorPayload = { error?: string; message?: string };
const OPENCLAW_API_BASE = import.meta.env.VITE_OPENCLAW_API_BASE || '/openclaw-api';

const openclawHttp = axios.create({
  baseURL: OPENCLAW_API_BASE,
  timeout: 120 * 1000,
  headers: { 'Content-Type': 'application/json' },
});

openclawHttp.interceptors.request.use((config) => {
  const token = String(getToken() || '').replace(/^Bearer\s+/i, '');
  config.headers.set('X-Authorization', token ? 'Bearer ' + token : '');
  return config;
});

openclawHttp.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error?.response?.data as ApiErrorPayload | undefined;
    const normalized = new Error(data?.error || data?.message || error?.message || '请求失败');
    Object.assign(normalized, { status: error?.response?.status });
    return Promise.reject(normalized);
  },
);

export function sendZhihuaChat(messages: ChatMessage[], signal?: AbortSignal) {
  return openclawHttp.post<ChatResponse>('/chat', { messages }, { signal }).then((res) => res.data);
}

export async function streamZhihuaChat(
  messages: ChatMessage[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
) {
  const token = String(getToken() || '').replace(/^Bearer\s+/i, '');
  const response = await fetch(`${OPENCLAW_API_BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Authorization': token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = `请求失败 (${response.status})`;
    try {
      const payload = await response.json() as ApiErrorPayload;
      message = payload.error || payload.message || message;
    } catch {
      // 非 JSON 错误响应保留状态码。
    }
    const error = new Error(message);
    Object.assign(error, { status: response.status });
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const event = frame.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim();
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (event && data) onEvent({ event, data: JSON.parse(data) } as ChatStreamEvent);
    }
    if (done) break;
  }
}

export function fetchChatArtifact(artifact: ChatArtifact, signal?: AbortSignal) {
  return openclawHttp.get<Blob>(artifact.url, { responseType: 'blob', signal }).then((res) => res.data);
}
