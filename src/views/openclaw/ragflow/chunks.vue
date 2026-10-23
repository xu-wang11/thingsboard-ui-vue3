<template>
  <section class="rag-page">
    <header class="rag-header">
      <div>
        <a class="link" @click="goBack">← 返回文档列表</a>
        <h2>分块管理 · {{ docName }}</h2>
      </div>
      <Space>
        <Input v-model:value="keywords" placeholder="搜索分块内容" style="width: 220px" @press-enter="load" />
        <Button @click="load">搜索</Button>
        <Button type="primary" @click="openAdd">新增分块</Button>
      </Space>
    </header>

    <Spin :spinning="loading">
      <div v-if="chunks.length" class="chunk-list">
        <Card v-for="(c, i) in chunks" :key="c.id" size="small" class="chunk-card">
          <div class="chunk-head">
            <span class="chunk-idx">#{{ i + 1 }}</span>
            <div class="chunk-ops">
              <Switch size="small" :checked="c.available" @change="(v: any) => toggle(c as Chunk, !!v)" />
              <Tooltip title="编辑"><span class="op" @click="openEdit(c as Chunk)"><Icon icon="i-ant-design:edit-outlined" /></span></Tooltip>
              <Tooltip title="删除"><span class="op danger" @click="remove(c as Chunk)"><Icon icon="i-ant-design:delete-outlined" /></span></Tooltip>
            </div>
          </div>
          <div class="content">{{ c.content }}</div>
          <div v-if="c.important_keywords?.length" class="kw">
            <Tag v-for="k in c.important_keywords" :key="k">{{ k }}</Tag>
          </div>
        </Card>
      </div>
      <Empty v-else-if="!loading" description="暂无分块" />
    </Spin>

    <Modal v-model:open="formOpen" :title="editing ? '编辑分块' : '新增分块'" :confirm-loading="saving" width="640px" @ok="submit">
      <Form layout="vertical">
        <Form.Item label="内容" required>
          <Textarea v-model:value="form.content" :rows="8" />
        </Form.Item>
        <Form.Item label="关键词（逗号分隔）">
          <Input v-model:value="form.keywords" placeholder="可选，用于提升召回" />
        </Form.Item>
      </Form>
    </Modal>
  </section>
</template>

<script setup lang="ts">
  import { onMounted, reactive, ref } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { Button, Space, Modal, Form, Input, Tag, Switch, Card, Tooltip, Spin, Empty } from 'ant-design-vue';
  import { Icon } from '/@/components/Icon';
  import { useMessage } from '/@/hooks/web/useMessage';
  import { listChunks, addChunk, updateChunk, deleteChunks, type Chunk } from '/@/api/openclaw/ragflow';

  const Textarea = Input.TextArea;
  const route = useRoute();
  const router = useRouter();
  const { showMessage, createConfirm } = useMessage();

  const datasetId = route.params.id as string;
  const docId = route.params.docId as string;
  const docName = (route.query.name as string) || '文档';

  const chunks = ref<Chunk[]>([]);
  const loading = ref(false);
  const keywords = ref('');
  const formOpen = ref(false);
  const saving = ref(false);
  const editing = ref<Chunk | null>(null);
  const form = reactive({ content: '', keywords: '' });

  async function load() {
    loading.value = true;
    try {
      const res = await listChunks(datasetId, docId, { keywords: keywords.value || undefined });
      chunks.value = res.chunks || [];
    } catch (e: any) {
      showMessage(e.message || '加载失败', 'error');
    } finally {
      loading.value = false;
    }
  }

  function openAdd() {
    editing.value = null;
    form.content = '';
    form.keywords = '';
    formOpen.value = true;
  }
  function openEdit(record: Chunk) {
    editing.value = record;
    form.content = record.content;
    form.keywords = (record.important_keywords || []).join(', ');
    formOpen.value = true;
  }
  async function submit() {
    if (!form.content.trim()) {
      showMessage('请填写内容', 'warn');
      return;
    }
    const kws = form.keywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    saving.value = true;
    try {
      if (editing.value) {
        await updateChunk(datasetId, docId, editing.value.id, { content: form.content, important_keywords: kws });
      } else {
        await addChunk(datasetId, docId, { content: form.content, important_keywords: kws });
      }
      formOpen.value = false;
      showMessage('保存成功');
      await load();
    } catch (e: any) {
      showMessage(e.message || '保存失败', 'error');
    } finally {
      saving.value = false;
    }
  }
  async function toggle(record: Chunk, value: boolean) {
    try {
      await updateChunk(datasetId, docId, record.id, { available: value });
      record.available = value;
    } catch (e: any) {
      showMessage(e.message || '操作失败', 'error');
    }
  }
  function remove(record: Chunk) {
    createConfirm({
      iconType: 'warning',
      title: '删除分块',
      content: '确定删除该分块？',
      onOk: async () => {
        try {
          await deleteChunks(datasetId, docId, [record.id]);
          showMessage('已删除');
          await load();
        } catch (e: any) {
          showMessage(e.message || '删除失败', 'error');
        }
      },
    });
  }
  function goBack() {
    const ds = (route.query.ds as string) || '';
    router.push(`/ragflow/dataset/${datasetId}?name=${encodeURIComponent(ds)}`);
  }

  onMounted(load);
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
  .link {
    color: #1677ff;
    cursor: pointer;
  }
  .link.danger {
    color: #ff4d4f;
  }
  .chunk-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }
  .chunk-card {
    border-radius: 10px;
  }
  .chunk-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .chunk-idx {
    font-size: 12px;
    color: #999;
  }
  .chunk-ops {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .chunk-ops .op {
    cursor: pointer;
    color: #595959;
  }
  .chunk-ops .op:hover {
    color: #1677ff;
  }
  .chunk-ops .op.danger:hover {
    color: #ff4d4f;
  }
  .content {
    white-space: pre-wrap;
    font-size: 13px;
    line-height: 1.6;
    max-height: 160px;
    overflow: auto;
  }
  .kw {
    margin-top: 6px;
  }
</style>
