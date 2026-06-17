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
