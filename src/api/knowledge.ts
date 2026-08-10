import { getToken } from '/@/utils/auth';

export type RagScores = { final?: number; lexical?: number; dense?: number; lexicalCoverage?: number; synonymHits?: number };
export type RagEvidence = { evidenceId: string; docId: string; title: string; standardCode?: string; titlePath?: string; quote: string; evidenceType?: string; pageStart?: number; pageEnd?: number; normalizedBbox?: number[]; sourceUrl?: string; pageImageUrl?: string; scores?: RagScores; buildId?: string };
export type RagSearchResponse = { buildId: string; query: string; results: RagEvidence[]; warnings?: Array<{ type?: string; message?: string }>; externalApiCalls?: number };
export type RagAnswerResponse = RagSearchResponse & { answer: string; abstained: boolean; citations: RagEvidence[]; answerError?: string };
export type RagDocument = { doc_id?: string; title?: string; standard_code?: string; page_count?: number; pageCount?: number };

const RAG_API_BASE = (import.meta.env.VITE_RAG_API_BASE || '/rag-api').replace(/\/$/, '');

function authHeaders() {
  const token = String(getToken() || '').replace(/^Bearer\s+/i, '');
  return { 'Content-Type': 'application/json', 'X-Authorization': token ? `Bearer ${token}` : '' };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${RAG_API_BASE}${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || `Knowledge base request failed (${response.status})`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data as T;
}

export function searchKnowledge(query: string, signal?: AbortSignal) { return request<RagSearchResponse>('/search', { method: 'POST', body: JSON.stringify({ query, topK: 5, retrievalMode: 'hybrid', filters: {} }), signal }); }
export function answerKnowledge(query: string, signal?: AbortSignal) { return request<RagAnswerResponse>('/answer', { method: 'POST', body: JSON.stringify({ query, topK: 6, filters: {} }), signal }); }
export function getKnowledgeDocument(docId: string, buildId?: string, signal?: AbortSignal) { const query = buildId ? `?build_id=${encodeURIComponent(buildId)}` : ''; return request<RagDocument>(`/documents/${encodeURIComponent(docId)}${query}`, { signal }); }
export function knowledgePdfUrl(docId: string, buildId?: string) { const query = buildId ? `?build_id=${encodeURIComponent(buildId)}` : ''; return `${RAG_API_BASE}/documents/${encodeURIComponent(docId)}/file${query}`; }
export function knowledgePageImageUrl(docId: string, page: number, buildId?: string) { const query = buildId ? `?build_id=${encodeURIComponent(buildId)}` : ''; return `${RAG_API_BASE}/documents/${encodeURIComponent(docId)}/pages/${page}/image${query}`; }
