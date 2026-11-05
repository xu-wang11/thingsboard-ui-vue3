import axios from 'axios';
import { getToken } from '#/utils/auth';

const OPENCLAW_API_BASE = import.meta.env.VITE_OPENCLAW_API_BASE || '/openclaw-api';
const RAGFLOW_BASE = `${OPENCLAW_API_BASE}/ragflow`;

const http = axios.create({ baseURL: RAGFLOW_BASE, timeout: 120 * 1000 });

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers['X-Authorization'] = 'Bearer ' + token;
  return config;
});

// RAGFlow returns {code, data, message}. Non-zero code is a logical error.
http.interceptors.response.use(
  (response) => {
    const payload = response.data;
    if (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 0) {
      return Promise.reject(new Error(payload.message || 'RAGFlow 请求失败'));
    }
    return response;
  },
  (error) => {
    const data = error?.response?.data;
    return Promise.reject(new Error(data?.error || data?.message || error?.message || '请求失败'));
  },
);

export interface Dataset {
  id: string;
  name: string;
  description?: string;
  chunk_count: number;
  document_count: number;
  embedding_model?: string;
  chunk_method?: string;
  create_date?: string;
}

export interface RagDocument {
  id: string;
  name: string;
  size: number;
  chunk_count: number;
  chunk_method?: string;
  run: string; // UNSTART | RUNNING | DONE | FAIL | CANCEL
  progress: number;
  progress_msg?: string;
}

export interface Chunk {
  id: string;
  content: string;
  important_keywords?: string[];
  available: boolean;
}

export interface RetrievalChunk {
  id: string;
  content: string;
  document_id: string;
  document_keyword?: string;
  similarity: number;
  vector_similarity?: number;
  term_similarity?: number;
  highlight?: string;
}

const unwrap = <T>(p: Promise<{ data: { data: T } }>): Promise<T> => p.then((r) => r.data.data);

// --- Datasets ---
export function listDatasets(params: { page?: number; page_size?: number; name?: string } = {}) {
  return unwrap<Dataset[]>(http.get('/datasets', { params: { page_size: 100, ...params } }));
}
export function createDataset(body: { name: string; description?: string; embedding_model?: string; chunk_method?: string }) {
  return unwrap<Dataset>(http.post('/datasets', body));
}
export function updateDataset(id: string, body: { name?: string; description?: string }) {
  return http.put(`/datasets/${id}`, body);
}
export function deleteDatasets(ids: string[]) {
  return http.delete('/datasets', { data: { ids } });
}

// --- Documents ---
export function listDocuments(datasetId: string, params: { page?: number; page_size?: number; keywords?: string } = {}) {
  return unwrap<{ docs: RagDocument[]; total: number }>(
    http.get(`/datasets/${datasetId}/documents`, { params: { page_size: 100, ...params } }),
  );
}
export function uploadDocuments(datasetId: string, files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append('file', f));
  return http.post(`/datasets/${datasetId}/documents`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}
export function deleteDocuments(datasetId: string, ids: string[]) {
  return http.delete(`/datasets/${datasetId}/documents`, { data: { ids } });
}
export function parseDocuments(datasetId: string, documentIds: string[]) {
  return http.post(`/datasets/${datasetId}/chunks`, { document_ids: documentIds });
}
export function stopParse(datasetId: string, documentIds: string[]) {
  return http.delete(`/datasets/${datasetId}/chunks`, { data: { document_ids: documentIds } });
}
export async function downloadDocument(datasetId: string, doc: RagDocument) {
  const res = await http.get(`/datasets/${datasetId}/documents/${doc.id}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.name;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Chunks ---
export function listChunks(datasetId: string, docId: string, params: { page?: number; page_size?: number; keywords?: string } = {}) {
  return unwrap<{ chunks: Chunk[]; total: number }>(
    http.get(`/datasets/${datasetId}/documents/${docId}/chunks`, { params: { page_size: 100, ...params } }),
  );
}
export function addChunk(datasetId: string, docId: string, body: { content: string; important_keywords?: string[] }) {
  return http.post(`/datasets/${datasetId}/documents/${docId}/chunks`, body);
}
export function updateChunk(datasetId: string, docId: string, chunkId: string, body: { content?: string; important_keywords?: string[]; available?: boolean }) {
  return http.put(`/datasets/${datasetId}/documents/${docId}/chunks/${chunkId}`, body);
}
export function deleteChunks(datasetId: string, docId: string, chunkIds: string[]) {
  return http.delete(`/datasets/${datasetId}/documents/${docId}/chunks`, { data: { chunk_ids: chunkIds } });
}

// --- Retrieval ---
export function retrieval(body: {
  question: string;
  dataset_ids: string[];
  document_ids?: string[];
  top_k?: number;
  similarity_threshold?: number;
  vector_similarity_weight?: number;
  page_size?: number;
}) {
  return unwrap<{ chunks: RetrievalChunk[]; total: number }>(http.post('/retrieval', body));
}

// --- Knowledge graph ---
export interface GraphNode {
  id: string;
  entity_name?: string;
  entity_type?: string;
  description?: string;
  pagerank?: number;
  source_id?: string[];
}
export interface GraphEdge {
  source: string;
  target: string;
  src_id?: string;
  tgt_id?: string;
  description?: string;
  keywords?: string[];
  weight?: number;
  source_id?: string[];
}
export interface KnowledgeGraph {
  directed?: boolean;
  multigraph?: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// RAGFlow returns { graph: <networkx node-link>, mind_map }. When the dataset has
// no graph built, `graph` is null/empty — callers handle the empty state.
export function getKnowledgeGraph(datasetId: string) {
  return unwrap<{ graph: KnowledgeGraph | null; mind_map?: unknown }>(http.get(`/datasets/${datasetId}/graph`));
}
