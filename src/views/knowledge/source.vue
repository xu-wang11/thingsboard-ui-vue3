<template>
  <div class="source-page">
    <a-card class="source-toolbar">
      <div class="toolbar-row">
        <a-button @click="goBack">Back</a-button>
        <div class="source-title"><strong>{{ documentTitle || 'Standard PDF' }}</strong><span>{{ standardCode }}</span></div>
        <div class="toolbar-actions">
          <a-button :disabled="currentPage <= 1" @click="jumpTo(currentPage - 1)">Prev</a-button>
          <a-input-number v-model:value="pageInput" :min="1" :max="totalPages || 1" @press-enter="jumpTo(pageInput || 1)" />
          <span>/ {{ totalPages || '?' }}</span>
          <a-button :disabled="!totalPages || currentPage >= totalPages" @click="jumpTo(currentPage + 1)">Next</a-button>
          <a-button @click="zoom = Math.max(0.75, zoom - 0.1)">-</a-button><span>{{ Math.round(zoom * 100) }}%</span><a-button @click="zoom = Math.min(2, zoom + 0.1)">+</a-button>
        </div>
      </div>
      <a-alert v-if="loadError" type="error" show-icon :message="loadError" />
      <a-alert v-if="highlightPage" type="info" show-icon message="Evidence is located on this page" />
    </a-card>
    <div ref="viewerRef" class="pdf-scroll" @scroll="onScroll">
      <div v-if="pdfLoading" class="pdf-loading"><a-spin tip="Loading PDF" /></div>
      <template v-for="page in pageNumbers" :key="page">
        <div class="page-shell" :data-page-shell="page">
          <VuePdfEmbed v-if="renderedPages.has(page)" :source="pdfSource" :page="page" :scale="zoom" text-layer annotation-layer class="pdf-page" @loaded="onDocumentLoaded" @rendered="onPageRendered(page)" @loading-failed="onPdfError" @rendering-failed="onPdfError" />
          <div v-else class="page-placeholder">Page {{ page }}</div>
          <div v-if="page === highlightPage" class="page-highlight" :style="highlightStyle" />
          <span class="page-number">{{ page }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import VuePdfEmbed from 'vue-pdf-embed';
import 'vue-pdf-embed/dist/styles/textLayer.css';
import 'vue-pdf-embed/dist/styles/annotationLayer.css';
import { getKnowledgeDocument, knowledgePdfUrl } from '/@/api/knowledge';
import { getToken } from '/@/utils/auth';

const route = useRoute();
const router = useRouter();
const viewerRef = ref<HTMLElement | null>(null);
const documentTitle = ref('');
const standardCode = ref('');
const totalPages = ref(0);
const currentPage = ref(Number(route.query.page || 1));
const pageInput = ref(currentPage.value);
const zoom = ref(1);
const pdfLoading = ref(true);
const loadError = ref('');
const renderedPages = ref(new Set<number>([currentPage.value]));
const documentInitialized = ref(false);
const scrollSyncTimer = ref<number | undefined>();
const docId = String(route.params.docId);
const buildId = route.query.buildId ? String(route.query.buildId) : undefined;
const highlightPage = Number(route.query.page || 1);
const bbox = computed(() => String(route.query.bbox || '').split(',').map(Number).filter(Number.isFinite));
const highlightStyle = computed(() => { const b = bbox.value.length === 4 ? bbox.value : [0, 0, 1, 1]; return { left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${(b[2] - b[0]) * 100}%`, height: `${(b[3] - b[1]) * 100}%` }; });
const pageNumbers = computed(() => totalPages.value ? Array.from({ length: totalPages.value }, (_, i) => i + 1) : [Math.max(1, currentPage.value)]);
const authToken = computed(() => String(getToken() || '').replace(/^Bearer\s+/i, ''));
const pdfSource = computed(() => ({ url: knowledgePdfUrl(docId, buildId), httpHeaders: { 'X-Authorization': authToken.value ? `Bearer ${authToken.value}` : '' } }));

function seedRenderedPages(page: number) { const next = new Set(renderedPages.value); for (let i = Math.max(1, page - 2); i <= Math.min(totalPages.value || page + 2, page + 2); i += 1) next.add(i); renderedPages.value = next; }
function onDocumentLoaded(document: { numPages?: number }) {
  if (documentInitialized.value) return;
  documentInitialized.value = true;
  totalPages.value = Number(document?.numPages || 1);
  pdfLoading.value = false;
  seedRenderedPages(currentPage.value);
  nextTick(() => jumpTo(currentPage.value, false));
}
function onPdfError() { pdfLoading.value = false; loadError.value = 'PDF is unavailable or authorization expired'; }
function onPageRendered(_page: number) { pdfLoading.value = false; }
function syncPageUrl(page: number) {
  const url = new URL(window.location.href);
  url.searchParams.set('page', String(page));
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
function jumpTo(page: number, syncUrl = true) {
  const target = Math.max(1, Math.min(page, totalPages.value || page));
  currentPage.value = target;
  pageInput.value = target;
  seedRenderedPages(target);
  if (syncUrl) syncPageUrl(target);
  nextTick(() => viewerRef.value?.querySelector<HTMLElement>(`[data-page-shell="${target}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function onScroll() {
  const top = viewerRef.value?.getBoundingClientRect().top || 0;
  const visible = Array.from(viewerRef.value?.querySelectorAll<HTMLElement>('[data-page-shell]') || []).find((el) => el.getBoundingClientRect().bottom > top + 20);
  if (!visible) return;
  const page = Number(visible.dataset.pageShell);
  if (!page) return;
  currentPage.value = page;
  pageInput.value = page;
  seedRenderedPages(page);
  if (scrollSyncTimer.value) window.clearTimeout(scrollSyncTimer.value);
  scrollSyncTimer.value = window.setTimeout(() => syncPageUrl(page), 250);
}
function goBack() { router.push({ name: 'KnowledgeStandards' }); }
onMounted(async () => { try { const document = await getKnowledgeDocument(docId, buildId); documentTitle.value = document.title || ''; standardCode.value = document.standard_code || ''; } catch (error) { loadError.value = error instanceof Error ? error.message : 'Document metadata unavailable'; } });
onBeforeUnmount(() => { if (scrollSyncTimer.value) window.clearTimeout(scrollSyncTimer.value); });
</script>

<style scoped lang="less">
.source-page { height: calc(100vh - 96px); padding: 16px 24px 24px; background: #f4f7f6; display: flex; flex-direction: column; gap: 12px; }
.source-toolbar { flex: none; }.toolbar-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }.source-title { flex: 1; min-width: 180px; display: flex; gap: 10px; align-items: baseline; }.source-title span { color: #74837c; }.toolbar-actions { display: flex; align-items: center; gap: 8px; }.pdf-scroll { position: relative; flex: 1; overflow: auto; padding: 18px; background: #89948f; border-radius: 8px; }.pdf-page, .page-placeholder { width: min(100%, 920px); margin: 0 auto; background: #fff; box-shadow: 0 2px 10px rgb(0 0 0 / 14%); }.page-shell { position: relative; width: min(100%, 920px); margin: 0 auto 18px; min-height: 1080px; }.page-placeholder { min-height: 1080px; display: flex; justify-content: center; align-items: center; color: #94a19b; }.page-number { position: absolute; right: 10px; bottom: 8px; padding: 2px 6px; border-radius: 4px; background: rgb(0 0 0 / 55%); color: #fff; font-size: 12px; }.page-highlight { position: absolute; z-index: 2; border: 3px solid #f59e0b; background: rgb(245 158 11 / 12%); pointer-events: none; }.pdf-loading { display: flex; justify-content: center; padding: 60px; }
</style>
