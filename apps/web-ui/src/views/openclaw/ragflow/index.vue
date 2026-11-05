<template>
  <section class="rag-page">
    <header class="rag-header">
      <div>
        <h2>知识库管理</h2>
        <p>点击卡片进入知识库，管理其中的文档与检索</p>
      </div>
      <Space>
        <Button @click="load">刷新</Button>
        <Button type="primary" @click="openCreate">
          <Icon icon="i-ant-design:plus-outlined" />
          新建知识库
        </Button>
      </Space>
    </header>

    <Spin :spinning="loading">
      <div v-if="datasets.length" class="kb-grid">
        <Card v-for="ds in datasets" :key="ds.id" hoverable class="kb-card">
          <div class="kb-main" @click="openDataset(ds)">
            <div class="kb-icon">
              <Icon icon="i-ant-design:read-outlined" :size="34" />
            </div>
            <div class="kb-info">
              <div class="kb-name" :title="ds.name">{{ ds.name }}</div>
              <div class="kb-desc">{{ ds.description || '暂无描述' }}</div>
            </div>
          </div>
          <template #actions>
            <Tooltip title="进入">
              <span class="kb-act" @click="openDataset(ds)"><Icon icon="i-ant-design:login-outlined" /> 进入</span>
            </Tooltip>
            <Tooltip title="编辑">
              <span class="kb-act" @click="openEdit(ds)"><Icon icon="i-ant-design:edit-outlined" /> 编辑</span>
            </Tooltip>
            <Tooltip title="删除">
              <span class="kb-act danger" @click="removeDataset(ds)"><Icon icon="i-ant-design:delete-outlined" /> 删除</span>
            </Tooltip>
          </template>
        </Card>

        <div class="kb-card kb-card-add" @click="openCreate">
          <Icon icon="i-ant-design:plus-outlined" :size="26" />
          <span>新建知识库</span>
        </div>
      </div>

      <Empty v-else-if="!loading" description="暂无知识库，点击右上角新建" />
    </Spin>

    <Modal v-model:open="formOpen" :title="editing ? '编辑知识库' : '新建知识库'" :confirm-loading="saving" @ok="submit">
      <Form layout="vertical">
        <Form.Item label="名称" required>
          <Input v-model:value="form.name" placeholder="知识库名称" />
        </Form.Item>
        <Form.Item label="描述">
          <Textarea v-model:value="form.description" :rows="3" placeholder="可选" />
        </Form.Item>
        <Collapse v-if="!editing" ghost>
          <Collapse.Panel key="adv" header="高级设置">
            <Form.Item label="切块方式">
              <Select v-model:value="form.chunk_method" :options="chunkMethodOptions" />
            </Form.Item>
            <Form.Item label="嵌入模型">
              <Input v-model:value="form.embedding_model" placeholder="留空则用默认模型" />
            </Form.Item>
          </Collapse.Panel>
        </Collapse>
      </Form>
    </Modal>
  </section>
</template>

<script setup lang="ts">
  import { onMounted, reactive, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import { Button, Space, Modal, Form, Input, Select, Card, Tooltip, Spin, Empty, Collapse } from 'ant-design-vue';
  import { Icon } from '#/components/Icon';
  import { useMessage } from '#/hooks/web/useMessage';
  import { listDatasets, createDataset, updateDataset, deleteDatasets, type Dataset } from '#/api/openclaw/ragflow';

  const Textarea = Input.TextArea;
  const router = useRouter();
  const { showMessage, createConfirm } = useMessage();

  const datasets = ref<Dataset[]>([]);
  const loading = ref(false);
  const formOpen = ref(false);
  const saving = ref(false);
  const editing = ref<Dataset | null>(null);
  const form = reactive({ name: '', description: '', chunk_method: 'naive', embedding_model: '' });

  const chunkMethodOptions = ['naive', 'qa', 'paper', 'book', 'laws', 'manual', 'presentation', 'one', 'table'].map((v) => ({
    label: v,
    value: v,
  }));

  async function load() {
    loading.value = true;
    try {
      datasets.value = await listDatasets();
    } catch (e: any) {
      showMessage(e.message || '加载失败', 'error');
    } finally {
      loading.value = false;
    }
  }

  function openCreate() {
    editing.value = null;
    form.name = '';
    form.description = '';
    form.chunk_method = 'naive';
    form.embedding_model = datasets.value[0]?.embedding_model || '';
    formOpen.value = true;
  }

  function openEdit(record: Dataset) {
    editing.value = record;
    form.name = record.name;
    form.description = record.description || '';
    formOpen.value = true;
  }

  async function submit() {
    if (!form.name.trim()) {
      showMessage('请填写名称', 'warn');
      return;
    }
    saving.value = true;
    try {
      if (editing.value) {
        await updateDataset(editing.value.id, { name: form.name, description: form.description });
      } else {
        const body: any = { name: form.name, description: form.description, chunk_method: form.chunk_method };
        if (form.embedding_model.trim()) body.embedding_model = form.embedding_model.trim();
        await createDataset(body);
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

  function removeDataset(record: Dataset) {
    createConfirm({
      iconType: 'warning',
      title: '删除知识库',
      content: `确定删除「${record.name}」？该库下所有文档与分块将一并删除，且不可恢复。`,
      onOk: async () => {
        try {
          await deleteDatasets([record.id]);
          showMessage('已删除');
          await load();
        } catch (e: any) {
          showMessage(e.message || '删除失败', 'error');
        }
      },
    });
  }

  function openDataset(record: Dataset) {
    router.push(`/ragflow/dataset/${record.id}?name=${encodeURIComponent(record.name)}`);
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
    margin-bottom: 16px;
  }
  .rag-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .rag-header p {
    margin: 4px 0 0;
    color: #888;
    font-size: 13px;
  }

  .kb-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }
  .kb-card {
    border-radius: 12px;
    overflow: hidden;
    transition: box-shadow 0.2s ease, transform 0.2s ease;
  }
  .kb-card:hover {
    transform: translateY(-2px);
  }
  .kb-main {
    display: flex;
    align-items: center;
    gap: 14px;
    cursor: pointer;
    min-height: 56px;
  }
  .kb-icon {
    flex: none;
    width: 56px;
    height: 56px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1677ff;
    background: linear-gradient(135deg, #e6f0ff 0%, #f0f5ff 100%);
  }
  .kb-info {
    min-width: 0;
  }
  .kb-name {
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kb-desc {
    margin-top: 4px;
    font-size: 12px;
    color: #999;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .kb-act {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: #595959;
  }
  .kb-act:hover {
    color: #1677ff;
  }
  .kb-act.danger:hover {
    color: #ff4d4f;
  }
  .kb-card-add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 148px;
    border: 1px dashed #d0d5dd;
    border-radius: 12px;
    color: #8c8c8c;
    cursor: pointer;
    transition: color 0.2s ease, border-color 0.2s ease;
  }
  .kb-card-add:hover {
    color: #1677ff;
    border-color: #1677ff;
  }
</style>
