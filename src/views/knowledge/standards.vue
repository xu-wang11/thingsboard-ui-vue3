<template>
  <div class="knowledge-page">
    <a-card class="search-card">
      <div class="page-heading">
        <div><h2>标准知识库</h2><p>检索和阅读化工行业标准，或让本地模型基于证据回答问题。</p></div>
        <Segmented v-model:value="mode" :options="modeOptions" />
      </div>
      <a-input-search v-model:value="query" size="large" enter-button="搜索" placeholder="输入标准、条款或工程问题" :loading="loading" @search="runQuery" />
    </a-card>
    <a-alert v-if="errorMessage" type="error" show-icon :message="errorMessage" closable @close="errorMessage = ''" />
    <a-alert v-if="warningMessage" type="warning" show-icon :message="warningMessage" />
    <div v-if="loading" class="loading-state"><a-spin /><span>正在检索 {{ mode === 'search' ? '标准证据' : '并生成证据回答' }}…</span></div>
    <a-card v-if="mode === 'answer' && answerText" class="answer-card" title="证据回答">
      <div class="answer-text">{{ answerText }}</div>
      <a-alert v-if="abstained" type="warning" show-icon message="证据不足或本地模型不可用，未生成无依据结论。" />
    </a-card>
    <a-card class="evidence-card" :title="mode === 'search' ? 'Top 5 证据片段' : '回答依据'">
      <template #extra><span v-if="results.length" class="result-count">{{ results.length }} 条</span></template>
      <a-empty v-if="!loading && status === 'idle'" description="输入问题后开始检索" />
      <a-empty v-else-if="!loading && status === 'empty'" description="没有找到相关证据，可尝试更具体的标准号或条款。" />
      <div v-else class="result-list">
        <a-card v-for="item in results" :key="item.evidenceId" size="small" class="result-item" hoverable @click="openEvidence(item)">
          <div class="result-topline"><a-tag color="blue">{{ item.evidenceId }}</a-tag><span class="standard-code">{{ item.standardCode || item.title }}</span><span class="page-label">第 {{ item.pageStart || '?' }} 页</span></div>
          <h3>{{ item.titlePath || item.title }}</h3><p class="quote">{{ item.quote }}</p>
          <div class="result-meta"><span>{{ item.evidenceType || '文字证据' }}</span><span v-if="item.scores?.final !== undefined">相关度 {{ item.scores.final.toFixed(4) }}</span><span>打开 PDF</span></div>
        </a-card>
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Segmented } from 'ant-design-vue';
import { useRouter } from 'vue-router';
import { answerKnowledge, type RagAnswerResponse, type RagEvidence, type RagSearchResponse, searchKnowledge } from '/@/api/knowledge';

type Mode = 'search' | 'answer';
type Status = 'idle' | 'loading' | 'success' | 'empty' | 'error';
type ModeState = { query: string; status: Status; results: RagEvidence[]; warningMessage: string; errorMessage: string; answerText: string; abstained: boolean; buildId?: string };
const emptyState = (): ModeState => ({ query: '', status: 'idle', results: [], warningMessage: '', errorMessage: '', answerText: '', abstained: false });
const storageKey = 'knowledge-standards-state-v2';
const router = useRouter();
const mode = ref<Mode>('search');
const states = reactive<Record<Mode, ModeState>>({ search: emptyState(), answer: emptyState() });
const modeOptions = [{ label: '原文检索', value: 'search' }, { label: '证据回答', value: 'answer' }];
const active = computed(() => states[mode.value]);
const query = computed({ get: () => active.value.query, set: (value: string) => { active.value.query = value; } });
const results = computed(() => active.value.results);
const status = computed(() => active.value.status);
const warningMessage = computed({ get: () => active.value.warningMessage, set: (value: string) => { active.value.warningMessage = value; } });
const errorMessage = computed({ get: () => active.value.errorMessage, set: (value: string) => { active.value.errorMessage = value; } });
const answerText = computed(() => active.value.answerText.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim());
const abstained = computed(() => active.value.abstained);
const loading = computed(() => status.value === 'loading');

function saveState() { sessionStorage.setItem(storageKey, JSON.stringify({ mode: mode.value, states })); }
function restoreState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    if (saved.mode === 'search' || saved.mode === 'answer') mode.value = saved.mode;
    for (const key of ['search', 'answer'] as Mode[]) if (saved.states?.[key]) Object.assign(states[key], saved.states[key]);
  } catch { sessionStorage.removeItem(storageKey); }
}
function setResponse(response: RagSearchResponse | RagAnswerResponse) {
  const target = active.value;
  target.buildId = response.buildId;
  target.results = (response.results || []).map((item) => ({ ...item, buildId: item.buildId || response.buildId }));
  target.warningMessage = (response.warnings || []).map((item) => item.message).filter(Boolean).join('；');
  target.status = target.results.length ? 'success' : 'empty';
  if ('answer' in response) { target.answerText = response.answer || ''; target.abstained = Boolean(response.abstained); }
  saveState();
}
async function runQuery() {
  const target = active.value;
  if (!target.query.trim() || target.status === 'loading') return;
  target.status = 'loading'; target.errorMessage = ''; target.warningMessage = '';
  try { setResponse(mode.value === 'search' ? await searchKnowledge(target.query) : await answerKnowledge(target.query)); }
  catch (error) { target.status = 'error'; const code = (error as { status?: number })?.status; target.errorMessage = code === 401 || code === 403 ? '当前登录身份无权访问知识库，请重新登录后重试。' : error instanceof Error ? error.message : '知识库服务暂不可用。'; saveState(); }
}
function openEvidence(item: RagEvidence) {
  saveState();
  router.push({ name: 'KnowledgeSource', params: { docId: item.docId }, query: { page: String(item.pageStart || 1), buildId: item.buildId || active.value.buildId, bbox: item.normalizedBbox?.join(','), evidence: item.evidenceId } });
}
watch(mode, () => saveState());
restoreState();
</script>

<style scoped lang="less">
.knowledge-page { min-height: calc(100vh - 96px); padding: 24px; background: #f4f7f6; }.search-card, .evidence-card, .answer-card { margin-bottom: 16px; }.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }.page-heading h2 { margin: 0 0 6px; }.page-heading p { margin: 0; color: #66756e; }.loading-state { display: flex; align-items: center; gap: 10px; padding: 16px 0; color: #52635b; }.result-count { color: #87948f; }.result-item { margin-bottom: 12px; cursor: pointer; }.result-topline, .result-meta { display: flex; align-items: center; gap: 10px; }.standard-code { flex: 1; font-weight: 600; }.page-label { color: #65736d; }.result-item h3 { margin: 10px 0 6px; font-size: 15px; }.quote { margin: 0; color: #394640; line-height: 1.65; white-space: pre-wrap; }.result-meta { margin-top: 10px; color: #87948f; font-size: 12px; }.answer-text { margin-bottom: 16px; white-space: pre-wrap; line-height: 1.8; color: #26352f; }

.evidence-card { border: 1px solid #d6e4ff; }
.evidence-card :deep(.ant-card-head) { background: #f5f9ff; border-bottom-color: #d6e4ff; }
.result-item { margin-bottom: 14px; cursor: pointer; border: 1px solid #c5d8f7; border-radius: 8px; box-shadow: 0 1px 2px rgb(22 119 255 / 6%); transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
.result-item:hover { border-color: #1677ff; box-shadow: 0 6px 18px rgb(22 119 255 / 14%); transform: translateY(-1px); }
.result-item :deep(.ant-card-body) { padding: 16px 18px; }
.standard-code { font-size: 17px; font-weight: 700; line-height: 1.45; color: #174b8f; letter-spacing: .1px; }
.result-topline :deep(.ant-tag) { min-width: 34px; padding-inline: 8px; font-size: 14px; font-weight: 700; line-height: 24px; text-align: center; }
.page-label { font-size: 13px; font-weight: 600; padding: 3px 9px; background: #edf5ff; border-radius: 12px; }
.result-item h3 { margin: 12px 0 8px; font-size: 16px; line-height: 1.5; color: #183b68; }
.quote { padding: 12px 14px; font-size: 14px; line-height: 1.8; background: #f6faff; border-left: 3px solid #4c9aff; border-radius: 4px; }
.result-meta { margin-top: 12px; }
.answer-card { border: 1px solid #bcd9c9; box-shadow: 0 4px 14px rgb(29 83 53 / 8%); }
.answer-card :deep(.ant-card-head) { background: #f2faf5; border-bottom-color: #cce1d4; font-size: 16px; font-weight: 650; }
.answer-text { margin-bottom: 4px; padding: 18px 20px; font-size: 17px; line-height: 2; color: #173526; background: #fbfefc; border-left: 4px solid #1677ff; border-radius: 4px; }
</style>
