<template>
  <section class="rag-page">
    <header class="rag-header">
      <div>
        <a class="link" @click="goBack">← 返回知识库列表</a>
        <h2>{{ datasetName }}</h2>
      </div>
      <Space>
        <Upload :multiple="true" :before-upload="beforeUpload" :show-upload-list="false">
          <Button type="primary" :loading="uploading">上传文档</Button>
        </Upload>
        <Button @click="loadDocs">刷新</Button>
      </Space>
    </header>

    <Tabs v-model:activeKey="tab">
      <Tabs.TabPane key="docs" tab="文档">
        <Space class="toolbar">
          <Button :disabled="!selectedKeys.length" @click="() => parseSelected()">
            <Icon icon="i-ant-design:thunderbolt-outlined" /> 解析选中
          </Button>
          <Button :disabled="!selectedKeys.length" @click="() => stopSelected()">
            <Icon icon="i-ant-design:pause-outlined" /> 停止解析
          </Button>
          <Button danger :disabled="!selectedKeys.length" @click="() => deleteSelected()">
            <Icon icon="i-ant-design:delete-outlined" /> 删除选中
          </Button>
        </Space>
        <Table
          :columns="docColumns"
          :data-source="docs"
          :loading="loadingDocs"
          row-key="id"
          size="middle"
          :row-selection="{ selectedRowKeys: selectedKeys, onChange: (k: any) => { selectedKeys = k; } }"
          :pagination="{ pageSize: 20, hideOnSinglePage: true }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <div class="doc-cell">
                <Icon icon="i-ant-design:file-text-outlined" :size="18" class="doc-icon" />
                <div class="doc-meta">
                  <div class="doc-name" :title="record.name">{{ record.name }}</div>
                  <div class="doc-size">{{ formatSize(record.size) }}</div>
                </div>
              </div>
            </template>
            <template v-else-if="column.key === 'run'">
              <Tag :color="runColor(record.run)">{{ runLabel(record.run) }}</Tag>
              <Progress
                v-if="record.run === 'RUNNING'"
                :percent="Math.round((record.progress || 0) * 100)"
                size="small"
                style="width: 120px"
              />
            </template>
            <template v-else-if="column.key === 'action'">
              <Space :size="4">
                <Tooltip title="解析"><Button type="text" size="small" @click="parseSelected([record.id])"><Icon icon="i-ant-design:thunderbolt-outlined" /></Button></Tooltip>
                <Tooltip title="查看内容"><Button type="text" size="small" @click="viewChunks(record as RagDocument)"><Icon icon="i-ant-design:profile-outlined" /></Button></Tooltip>
                <Tooltip title="下载"><Button type="text" size="small" @click="download(record as RagDocument)"><Icon icon="i-ant-design:download-outlined" /></Button></Tooltip>
                <Tooltip title="删除"><Button type="text" size="small" danger @click="deleteSelected([record.id])"><Icon icon="i-ant-design:delete-outlined" /></Button></Tooltip>
              </Space>
            </template>
          </template>
        </Table>
      </Tabs.TabPane>

      <Tabs.TabPane key="retrieval" tab="检索测试">
        <div class="retrieval">
          <Textarea v-model:value="query" :rows="3" placeholder="输入检索问题" />
          <div class="retrieval-bar">
            <Button type="primary" :loading="searching" @click="runRetrieval">
              <Icon icon="i-ant-design:search-outlined" /> 检索
            </Button>
            <a class="link" @click="showParams = !showParams">{{ showParams ? '收起参数' : '高级参数' }}</a>
          </div>
          <Space v-show="showParams" class="retrieval-params">
            <span>返回条数 <InputNumber v-model:value="topK" :min="1" :max="50" /></span>
            <span>相似度阈值 <InputNumber v-model:value="threshold" :min="0" :max="1" :step="0.05" /></span>
          </Space>
          <div v-if="results.length" class="results">
            <div v-for="(c, i) in results" :key="c.id" class="result">
              <div class="result-head">
                <span class="idx">#{{ i + 1 }}</span>
                <span class="doc">{{ c.document_keyword }}</span>
                <Tag color="blue">相似度 {{ c.similarity?.toFixed(3) }}</Tag>
              </div>
              <div class="result-body" v-html="c.highlight || escapeHtml(c.content)"></div>
            </div>
          </div>
          <Empty v-else-if="searched" description="无检索结果" />
        </div>
      </Tabs.TabPane>

      <Tabs.TabPane key="graph" tab="知识图谱">
        <KnowledgeGraph v-if="tab === 'graph'" :dataset-id="datasetId" />
      </Tabs.TabPane>
    </Tabs>
  </section>
</template>

<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { Table, Button, Space, Upload, Tabs, Tag, Progress, InputNumber, Input, Empty, Tooltip } from 'ant-design-vue';
  import { Icon } from '#/components/Icon';
  import { useMessage } from '#/hooks/web/useMessage';
  import {
    listDocuments,
    uploadDocuments,
    parseDocuments,
    stopParse,
    deleteDocuments,
    downloadDocument,
    retrieval,
    type RagDocument,
    type RetrievalChunk,
  } from '#/api/openclaw/ragflow';
  import KnowledgeGraph from './KnowledgeGraph.vue';

  const Textarea = Input.TextArea;
  const route = useRoute();
  const router = useRouter();
  const { showMessage, createConfirm } = useMessage();

  const datasetId = route.params.id as string;
  const datasetName = computed(() => (route.query.name as string) || '知识库');

  const tab = ref('docs');
  const docs = ref<RagDocument[]>([]);
  const loadingDocs = ref(false);
  const uploading = ref(false);
  const selectedKeys = ref<string[]>([]);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const docColumns = [
    { title: '文档', key: 'name', dataIndex: 'name', ellipsis: true },
    { title: '状态', key: 'run', dataIndex: 'run', width: 200 },
    { title: '操作', key: 'action', width: 180 },
  ];

  function runLabel(run: string) {
    return { UNSTART: '未解析', RUNNING: '解析中', DONE: '已完成', FAIL: '失败', CANCEL: '已取消' }[run] || run;
  }
  function runColor(run: string) {
    return { UNSTART: 'default', RUNNING: 'processing', DONE: 'success', FAIL: 'error', CANCEL: 'warning' }[run] || 'default';
  }
  function formatSize(n: number) {
    if (!n) return '-';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  function escapeHtml(s: string) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function loadDocs() {
    loadingDocs.value = true;
    try {
      const res = await listDocuments(datasetId);
      docs.value = res.docs || [];
      syncPolling();
    } catch (e: any) {
      showMessage(e.message || '加载失败', 'error');
    } finally {
      loadingDocs.value = false;
    }
  }

  function syncPolling() {
    const running = docs.value.some((d) => d.run === 'RUNNING');
    if (running && !pollTimer) {
      pollTimer = setInterval(refreshDocsQuiet, 3000);
    } else if (!running && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  async function refreshDocsQuiet() {
    try {
      const res = await listDocuments(datasetId);
      docs.value = res.docs || [];
      syncPolling();
    } catch {
      // keep polling silently
    }
  }

  function beforeUpload(file: File) {
    doUpload(file);
    return false; // prevent antd auto-upload
  }
  async function doUpload(file: File) {
    uploading.value = true;
    try {
      await uploadDocuments(datasetId, [file]);
      showMessage(`已上传 ${file.name}`);
      await loadDocs();
    } catch (e: any) {
      showMessage(e.message || '上传失败', 'error');
    } finally {
      uploading.value = false;
    }
  }

  async function parseSelected(ids?: string[]) {
    const target = Array.isArray(ids) ? ids : selectedKeys.value;
    if (!target.length) return;
    try {
      await parseDocuments(datasetId, target);
      showMessage('已触发解析');
      await loadDocs();
    } catch (e: any) {
      showMessage(e.message || '解析失败', 'error');
    }
  }
  async function stopSelected() {
    if (!selectedKeys.value.length) return;
    try {
      await stopParse(datasetId, selectedKeys.value);
      showMessage('已停止解析');
      await loadDocs();
    } catch (e: any) {
      showMessage(e.message || '操作失败', 'error');
    }
  }
  function deleteSelected(ids?: string[]) {
    const target = Array.isArray(ids) ? ids : selectedKeys.value;
    if (!target.length) return;
    createConfirm({
      iconType: 'warning',
      title: '删除文档',
      content: `确定删除选中的 ${target.length} 个文档？`,
      onOk: async () => {
        try {
          await deleteDocuments(datasetId, target);
          selectedKeys.value = [];
          showMessage('已删除');
          await loadDocs();
        } catch (e: any) {
          showMessage(e.message || '删除失败', 'error');
        }
      },
    });
  }
  async function download(record: RagDocument) {
    try {
      await downloadDocument(datasetId, record);
    } catch (e: any) {
      showMessage(e.message || '下载失败', 'error');
    }
  }
  function viewChunks(record: RagDocument) {
    router.push(`/ragflow/dataset/${datasetId}/doc/${record.id}/chunks?name=${encodeURIComponent(record.name)}&ds=${encodeURIComponent(datasetName.value)}`);
  }

  // --- retrieval ---
  const query = ref('');
  const topK = ref(6);
  const threshold = ref(0.2);
  const showParams = ref(false);
  const searching = ref(false);
  const searched = ref(false);
  const results = ref<RetrievalChunk[]>([]);
  async function runRetrieval() {
    if (!query.value.trim()) {
      showMessage('请输入检索问题', 'warn');
      return;
    }
    searching.value = true;
    try {
      const res = await retrieval({
        question: query.value,
        dataset_ids: [datasetId],
        top_k: topK.value,
        similarity_threshold: threshold.value,
        page_size: topK.value,
      });
      results.value = res.chunks || [];
      searched.value = true;
    } catch (e: any) {
      showMessage(e.message || '检索失败', 'error');
    } finally {
      searching.value = false;
    }
  }

  function goBack() {
    router.push('/ragflow');
  }

  onMounted(loadDocs);
  onBeforeUnmount(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<style scoped>
  .rag-page {
    padding: 16px 20px;
  }
  .rag-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }
  .rag-header h2 {
    margin: 6px 0 0;
    font-size: 18px;
    font-weight: 600;
  }
  .toolbar {
    margin-bottom: 12px;
  }
  .doc-cell {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .doc-icon {
    color: #1677ff;
    flex: none;
  }
  .doc-meta {
    min-width: 0;
  }
  .doc-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .doc-size {
    font-size: 12px;
    color: #999;
  }
  .link {
    color: #1677ff;
    cursor: pointer;
  }
  .link.danger {
    color: #ff4d4f;
  }
  .retrieval-bar {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 12px 0;
  }
  .retrieval-params {
    margin: 0 0 12px;
  }
  .results {
    margin-top: 12px;
  }
  .result {
    border: 1px solid #eee;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .result-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 13px;
  }
  .result-head .idx {
    color: #999;
  }
  .result-head .doc {
    font-weight: 600;
  }
  .result-body {
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .result-body :deep(em) {
    background: #fff1a8;
    font-style: normal;
  }
</style>
