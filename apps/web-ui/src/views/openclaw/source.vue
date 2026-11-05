<template>
  <section class="source-reader">
    <header class="reader-header">
      <div>
        <button type="button" class="back" @click="goBack">返回对话</button>
        <h2>{{ isSop ? '作业指导书原文' : '标准原文' }}</h2>
        <p>{{ documentLabel }} · 已定位至第 {{ page }} 页{{ boxes.length ? '（已高亮命中区域）' : '' }}</p>
      </div>
      <span v-if="totalHint" class="page-hint">{{ totalHint }}</span>
    </header>

    <a-alert v-if="error" type="error" show-icon :message="error" />
    <div v-if="loading && !error" class="loading">正在加载原文 PDF…</div>
    <template v-if="!error">
      <nav v-show="!loading" class="toolbar" aria-label="PDF 阅读控制">
        <button type="button" :disabled="page <= 1" @click="changePage(page - 1)">上一页</button>
        <label>
          页码
          <input v-model.number="pageInput" type="number" min="1" :max="totalPages" @keyup.enter="jumpToPage" />
        </label>
        <span class="of-total">/ {{ totalPages }}</span>
        <button type="button" @click="jumpToPage">跳转</button>
        <button type="button" :disabled="page >= totalPages" @click="changePage(page + 1)">下一页</button>
        <button type="button" @click="zoom(-0.2)">缩小</button>
        <button type="button" @click="zoom(0.2)">放大</button>
        <span class="position-note">命中区域以黄色高亮</span>
      </nav>
      <!-- canvas 用 v-show 常驻 DOM，确保 renderPage 任何时机都能拿到 canvasRef。 -->
      <div v-show="!loading" ref="viewportRef" class="pdf-viewport">
        <div class="pdf-page" :style="{ width: pageWidthPx + 'px' }">
          <canvas ref="canvasRef" />
          <div
            v-for="(b, i) in pageBoxesPx"
            :key="i"
            class="hl"
            :style="{ left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' }"
          />
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import * as pdfjsLib from 'pdfjs-dist';
  import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
  import { getToken } from '#/utils/auth';

  pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

  const route = useRoute();
  const router = useRouter();
  const apiBase = import.meta.env.VITE_OPENCLAW_API_BASE || '/openclaw-api';
  const docId = computed(() => decodeURIComponent(String(route.params.docId || '')));
  const isSop = computed(() => docId.value === 'sop:full');
  const documentLabel = computed(() => (isSop.value ? 'SOP 全文' : docId.value));

  const page = ref(Math.max(1, Number(route.query.page || 1) || 1));
  const pageInput = ref(page.value);
  const totalPages = ref(1);
  const scale = ref(1.4);
  const loading = ref(true);
  const error = ref('');
  const pageWidthPx = ref(0);

  const canvasRef = ref<HTMLCanvasElement | null>(null);
  const viewportRef = ref<HTMLDivElement | null>(null);

  // boxes: [left, top, right, bottom] in PDF points on the target page.
  const boxes = computed<number[][]>(() => {
    const raw = String(route.query.bbox || '');
    if (!raw) return [];
    return raw
      .split(';')
      .map((seg) => seg.split(',').map(Number))
      .filter((nums) => nums.length === 4 && nums.every((n) => Number.isFinite(n)));
  });
  const targetPage = Math.max(1, Number(route.query.page || 1) || 1);
  // Only highlight when we are on the page the evidence came from.
  const pageBoxesPx = ref<Array<{ left: number; top: number; width: number; height: number }>>([]);

  const totalHint = computed(() => (boxes.value.length ? '证据区域已高亮' : '页级证据定位'));

  let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  let renderTask: pdfjsLib.RenderTask | null = null;

  async function loadPdf() {
    let endpoint: string;
    if (isSop.value) {
      endpoint = `${apiBase}/sop/documents/file`;
    } else {
      const params = new URLSearchParams();
      if (route.query.buildId) params.set('build_id', String(route.query.buildId));
      if (route.query.name) params.set('name', String(route.query.name));
      const qs = params.toString();
      endpoint = `${apiBase}/rag/documents/${encodeURIComponent(docId.value)}/file${qs ? `?${qs}` : ''}`;
    }
    const token = getToken();
    const response = await fetch(endpoint, { headers: token ? { 'X-Authorization': `Bearer ${token}` } : {} });
    if (!response.ok) {
      throw new Error(response.status === 404 ? '原文文件尚未迁入该服务器。' : `加载原文失败（${response.status}）`);
    }
    const data = await response.arrayBuffer();
    const head = new Uint8Array(data.slice(0, 5));
    // %PDF magic bytes — 后端异常时可能返回 JSON 错误体，避免喂给 pdf.js 崩溃。
    if (!(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) {
      throw new Error('原文文件不可用或格式错误。');
    }
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    totalPages.value = pdfDoc.numPages;
    if (page.value > totalPages.value) page.value = totalPages.value;
  }

  async function renderPage() {
    if (!pdfDoc || !canvasRef.value) return;
    if (renderTask) {
      try { renderTask.cancel(); } catch { /* ignore */ }
    }
    const pdfPage = await pdfDoc.getPage(page.value);
    const viewport = pdfPage.getViewport({ scale: scale.value });
    const canvas = canvasRef.value;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    pageWidthPx.value = viewport.width;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    renderTask = pdfPage.render({ canvasContext: ctx, viewport });
    await renderTask.promise;

    // Draw highlights only on the evidence page. positions are PDF points
    // (top-left origin); scale to rendered px.
    if (page.value === targetPage && boxes.value.length) {
      pageBoxesPx.value = boxes.value.map((box) => {
        const [left = 0, top = 0, right = left, bottom = top] = box;
        return {
          left: left * scale.value,
          top: top * scale.value,
          width: (right - left) * scale.value,
          height: (bottom - top) * scale.value,
        };
      });
      void scrollToFirstBox();
    } else {
      pageBoxesPx.value = [];
    }
  }

  async function scrollToFirstBox() {
    await Promise.resolve();
    if (!viewportRef.value || !pageBoxesPx.value.length) return;
    const first = pageBoxesPx.value[0];
    if (!first) return;
    viewportRef.value.scrollTop = Math.max(0, first.top - 120);
  }

  function changePage(next: number) {
    const normalized = Math.min(totalPages.value, Math.max(1, Math.floor(next || 1)));
    page.value = normalized;
    pageInput.value = normalized;
    router.replace({ query: { ...route.query, page: String(normalized) } });
  }

  function jumpToPage() {
    changePage(pageInput.value);
  }

  function zoom(delta: number) {
    scale.value = Math.min(4, Math.max(0.5, Number((scale.value + delta).toFixed(2))));
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push('/openclaw/chat');
  }

  watch(page, () => void renderPage());
  watch(scale, () => void renderPage());

  onMounted(async () => {
    try {
      await loadPdf();
      await nextTick();
      await renderPage();
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '加载原文失败';
    } finally {
      loading.value = false;
    }
  });

  onBeforeUnmount(() => {
    if (renderTask) {
      try { renderTask.cancel(); } catch { /* ignore */ }
    }
    if (pdfDoc) {
      try { void pdfDoc.destroy(); } catch { /* ignore */ }
    }
  });
</script>

<style scoped lang="less">
  .source-reader { min-height: calc(100vh - 96px); padding: 22px; background: #f4f7f6; }
  .reader-header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
  h2 { margin: 10px 0 4px; color: #17211c; }
  p { margin: 0; color: #687789; }
  .back, .toolbar button { padding: 6px 11px; color: #195cc7; cursor: pointer; border: 1px solid #82aeef; border-radius: 6px; background: #fff; }
  .back:hover, .toolbar button:not(:disabled):hover { color: #fff; border-color: #2868cf; background: #2868cf; }
  .toolbar button:disabled { color: #a5b1c2; cursor: not-allowed; border-color: #d8e0ea; background: #f8fafc; }
  .page-hint { align-self: center; padding: 5px 10px; color: #285a9c; border: 1px solid #c7dbf8; border-radius: 999px; background: #edf5ff; }
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; margin-bottom: 10px; border: 1px solid #d4e0f1; border-radius: 8px; background: #fff; }
  .toolbar label { display: inline-flex; align-items: center; gap: 6px; color: #526274; }
  .toolbar input { width: 76px; padding: 5px 7px; border: 1px solid #c7d2e0; border-radius: 6px; }
  .of-total { color: #758399; }
  .position-note { margin-left: 6px; color: #758399; font-size: 12px; }
  .loading { padding: 40px; color: #687789; text-align: center; }
  .pdf-viewport { height: calc(100vh - 270px); min-height: 600px; overflow: auto; border: 1px solid #cfd9e7; border-radius: 8px; background: #e9eef4; display: flex; justify-content: center; padding: 16px 0; }
  .pdf-page { position: relative; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15); background: #fff; }
  .pdf-page canvas { display: block; }
  .hl { position: absolute; background: rgba(255, 214, 0, 0.35); border: 1px solid rgba(240, 173, 0, 0.9); border-radius: 2px; pointer-events: none; mix-blend-mode: multiply; }
</style>
