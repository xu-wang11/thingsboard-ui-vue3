<template>
  <div class="kg-wrap">
    <div class="kg-toolbar">
      <Space>
        <Input
          v-model:value="keyword"
          allow-clear
          placeholder="搜索实体并定位"
          style="width: 220px"
          @press-enter="locateEntity"
        />
        <Button @click="locateEntity">定位</Button>
        <Button @click="resetView">重置视图</Button>
        <Button :loading="loading" @click="load">刷新</Button>
      </Space>
      <div v-if="graph" class="kg-stats">
        <Tag color="blue">实体 {{ graph.nodes.length }}</Tag>
        <Tag color="green">关系 {{ graph.edges.length }}</Tag>
      </div>
    </div>

    <div class="kg-body">
      <Spin :spinning="loading" wrapper-class-name="kg-spin">
        <div v-show="hasGraph" ref="chartRef" class="kg-chart"></div>
        <Empty
          v-if="!loading && !hasGraph"
          class="kg-empty"
          :description="emptyText"
        />
      </Spin>

      <div v-if="detail" class="kg-detail">
        <div class="kg-detail-head">
          <Tag :color="colorOf(detail.entity_type)">{{ detail.entity_type || '未分类' }}</Tag>
          <span class="kg-detail-name">{{ detail.entity_name || detail.id }}</span>
          <a class="kg-detail-close" @click="detail = null">×</a>
        </div>
        <p class="kg-detail-desc">{{ detail.description || '（无描述）' }}</p>
        <div class="kg-detail-meta">
          <div v-if="detail.pagerank != null">重要度 (PageRank)：{{ detail.pagerank.toFixed(4) }}</div>
          <div>关联关系：{{ neighborCount(detail.id) }} 条</div>
        </div>
        <div v-if="neighborsOf(detail.id).length" class="kg-detail-rels">
          <div class="kg-detail-subtitle">关联实体</div>
          <div v-for="(rel, i) in neighborsOf(detail.id)" :key="i" class="kg-rel">
            <a class="kg-rel-node" @click="selectNode(rel.other)">{{ rel.other }}</a>
            <span v-if="rel.description" class="kg-rel-desc">{{ rel.description }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, ref, type Ref } from 'vue';
  import { Space, Input, Button, Tag, Empty, Spin } from 'ant-design-vue';
  import { useMessage } from '#/hooks/web/useMessage';
  import { useECharts } from '#/hooks/web/useECharts';
  import { getKnowledgeGraph, type GraphEdge, type GraphNode, type KnowledgeGraph } from '#/api/openclaw/ragflow';

  const props = defineProps<{ datasetId: string }>();
  const { showMessage } = useMessage();

  const chartRef = ref<HTMLDivElement | null>(null);
  const { setOptions, getInstance } = useECharts(chartRef as Ref<HTMLDivElement>);

  const loading = ref(false);
  const loaded = ref(false);
  const graph = ref<KnowledgeGraph | null>(null);
  const detail = ref<GraphNode | null>(null);
  const keyword = ref('');

  const hasGraph = computed(() => !!graph.value && graph.value.nodes.length > 0);
  const emptyText = computed(() => (loaded.value ? '该知识库尚未构建知识图谱' : '加载中…'));

  // A colour-blind-friendly categorical palette; extended by hashing for extra types.
  const PALETTE = ['#5B8FF9', '#61DDAA', '#F6BD16', '#F08BB4', '#65789B', '#7262FD', '#78D3F8', '#FF9845', '#9661BC', '#6DC8EC'];
  const categories = ref<string[]>([]);
  function colorOf(type?: string): string {
    const t = type || '未分类';
    let idx = categories.value.indexOf(t);
    if (idx < 0) idx = Math.abs(hash(t)) % PALETTE.length;
    return PALETTE[idx % PALETTE.length] ?? '#5B8FF9';
  }
  function hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
    return h;
  }

  function neighborsOf(id: string): { other: string; description?: string }[] {
    if (!graph.value) return [];
    const out: { other: string; description?: string }[] = [];
    for (const e of graph.value.edges) {
      if (e.source === id) out.push({ other: e.target, description: e.description });
      else if (e.target === id) out.push({ other: e.source, description: e.description });
    }
    return out;
  }
  function neighborCount(id: string): number {
    return neighborsOf(id).length;
  }

  function buildOptions(g: KnowledgeGraph) {
    const types = Array.from(new Set(g.nodes.map((n) => n.entity_type || '未分类')));
    categories.value = types;
    const ranks = g.nodes.map((n) => n.pagerank || 0);
    const maxRank = Math.max(...ranks, 0.0001);
    const weights = g.edges.map((e) => e.weight || 1);
    const maxWeight = Math.max(...weights, 1);

    const nodes = g.nodes.map((n) => {
      const r = (n.pagerank || 0) / maxRank;
      return {
        id: n.id,
        name: n.entity_name || n.id,
        category: types.indexOf(n.entity_type || '未分类'),
        symbolSize: 14 + r * 46,
        value: Number(((n.pagerank || 0) * 1000).toFixed(2)),
        label: { show: r > 0.25 },
      };
    });
    const links = g.edges.map((e) => ({
      source: e.source,
      target: e.target,
      value: e.description || '',
      lineStyle: { width: 1 + ((e.weight || 1) / maxWeight) * 5 },
    }));

    return {
      tooltip: {
        confine: true,
        formatter: (p: any) => {
          if (p.dataType === 'edge') {
            const e = findEdge(p.data.source, p.data.target);
            const kw = e?.keywords?.length ? `<div style="color:#888">${escapeHtml(e.keywords.join('、'))}</div>` : '';
            return `<b>${escapeHtml(p.data.source)} → ${escapeHtml(p.data.target)}</b>${kw}<div style="max-width:320px;white-space:normal">${escapeHtml(e?.description || '')}</div>`;
          }
          const node = findNode(p.data.id);
          return `<b>${escapeHtml(node?.entity_name || p.data.name)}</b> <span style="color:#888">${escapeHtml(node?.entity_type || '')}</span><div style="max-width:320px;white-space:normal">${escapeHtml(node?.description || '')}</div>`;
        },
      },
      legend: [{ data: types, top: 0, type: 'scroll' }],
      animationDuration: 800,
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          categories: types.map((t) => ({ name: t, itemStyle: { color: colorOf(t) } })),
          nodes,
          links,
          label: { position: 'right', formatter: '{b}', fontSize: 11 },
          labelLayout: { hideOverlap: true },
          emphasis: { focus: 'adjacency', lineStyle: { width: 4 } },
          lineStyle: { color: 'source', curveness: 0.1, opacity: 0.6 },
          force: { repulsion: 180, edgeLength: [60, 160], gravity: 0.08 },
          scaleLimit: { min: 0.3, max: 6 },
        },
      ],
    };
  }

  function findNode(id: string): GraphNode | undefined {
    return graph.value?.nodes.find((n) => n.id === id);
  }
  function findEdge(source: string, target: string): GraphEdge | undefined {
    return graph.value?.edges.find(
      (e) => (e.source === source && e.target === target) || (e.source === target && e.target === source),
    );
  }
  function escapeHtml(s: string) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function selectNode(id: string) {
    const node = findNode(id);
    if (node) detail.value = node;
    highlight(id);
  }
  function highlight(id: string) {
    const inst = getInstance();
    if (!inst || !graph.value) return;
    const idx = graph.value.nodes.findIndex((n) => n.id === id);
    if (idx < 0) return;
    inst.dispatchAction({ type: 'downplay', seriesIndex: 0 });
    inst.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: idx });
  }
  function locateEntity() {
    const kw = keyword.value.trim();
    if (!kw || !graph.value) return;
    const node = graph.value.nodes.find(
      (n) => (n.entity_name || n.id).toLowerCase().includes(kw.toLowerCase()),
    );
    if (!node) {
      showMessage('未找到匹配实体', 'warn');
      return;
    }
    selectNode(node.id);
  }
  function resetView() {
    detail.value = null;
    const inst = getInstance();
    inst?.dispatchAction({ type: 'downplay', seriesIndex: 0 });
    if (graph.value) render();
  }

  function render() {
    if (!graph.value) return;
    setOptions(buildOptions(graph.value) as any);
    nextTick(() => {
      const inst = getInstance();
      inst?.off('click');
      inst?.on('click', (p: any) => {
        if (p.dataType === 'node') selectNode(p.data.id);
      });
    });
  }

  async function load() {
    loading.value = true;
    try {
      const res = await getKnowledgeGraph(props.datasetId);
      const g = res?.graph;
      graph.value = g && Array.isArray(g.nodes) && g.nodes.length ? g : null;
      loaded.value = true;
      if (graph.value) await nextTick().then(render);
    } catch (e: any) {
      graph.value = null;
      loaded.value = true;
      showMessage(e.message || '加载知识图谱失败', 'error');
    } finally {
      loading.value = false;
    }
  }

  onMounted(load);
  defineExpose({ load });
</script>

<style scoped>
  .kg-wrap {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 240px);
    min-height: 480px;
  }
  .kg-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .kg-stats {
    display: flex;
    gap: 4px;
  }
  .kg-body {
    position: relative;
    flex: 1;
    border: 1px solid #eee;
    border-radius: 8px;
    overflow: hidden;
  }
  .kg-spin,
  .kg-spin :deep(.ant-spin-container) {
    height: 100%;
  }
  .kg-chart {
    width: 100%;
    height: 100%;
  }
  .kg-empty {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
  .kg-detail {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 300px;
    max-height: calc(100% - 24px);
    overflow: auto;
    background: var(--component-background, #fff);
    border: 1px solid #e8e8e8;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    padding: 12px 14px;
  }
  .kg-detail-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  .kg-detail-name {
    font-weight: 600;
    font-size: 15px;
    flex: 1;
    word-break: break-all;
  }
  .kg-detail-close {
    color: #999;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .kg-detail-desc {
    font-size: 13px;
    line-height: 1.6;
    color: #555;
    margin: 0 0 8px;
    white-space: pre-wrap;
  }
  .kg-detail-meta {
    font-size: 12px;
    color: #888;
    margin-bottom: 8px;
  }
  .kg-detail-subtitle {
    font-size: 12px;
    font-weight: 600;
    color: #666;
    margin: 6px 0 4px;
  }
  .kg-rel {
    font-size: 12px;
    padding: 4px 0;
    border-top: 1px dashed #eee;
  }
  .kg-rel-node {
    color: #1677ff;
    cursor: pointer;
    font-weight: 600;
  }
  .kg-rel-desc {
    display: block;
    color: #888;
    line-height: 1.5;
  }
</style>
