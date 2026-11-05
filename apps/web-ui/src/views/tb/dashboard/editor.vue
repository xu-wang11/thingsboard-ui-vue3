<script setup lang="ts">
import type { Dashboard } from '#/api/tb/dashboard';

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import {
  FullscreenExitOutlined,
  FullscreenOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import { useFullscreen } from '@vueuse/core';
import { Spin, Tooltip } from 'ant-design-vue';

import { getDashboardById } from '#/api/tb/dashboard';

defineOptions({ name: 'HebangDashboardViewer' });

const route = useRoute();
const dashboardId = computed(() => String(route.params.dashboardId || ''));
const record = ref<Dashboard | null>(null);
const frameRef = ref<HTMLFrameElement | null>(null);
const shellRef = ref<HTMLElement | null>(null);
const loading = ref(true);
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
let readyTimer: ReturnType<typeof setTimeout> | undefined;

const frameSrc = computed(() => {
  const base = (import.meta.env.VITE_TB_DASHBOARD_BASE || '').replace(/\/$/u, '');
  return `${base}/dashboard/${dashboardId.value}`;
});

const allowedFrameOrigin = computed(() => {
  try {
    return new URL(frameSrc.value, window.location.href).origin;
  } catch {
    return window.location.origin;
  }
});

watch(
  dashboardId,
  async (id) => {
    if (!id) return;
    startLoading();
    record.value = await getDashboardById(id);
  },
  { immediate: true },
);

onMounted(() => window.addEventListener('message', handleDashboardMessage));
onBeforeUnmount(() => {
  window.removeEventListener('message', handleDashboardMessage);
  clearReadyTimer();
});

function clearReadyTimer() {
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = undefined;
}

function startLoading() {
  loading.value = true;
  clearReadyTimer();
  readyTimer = setTimeout(hideLoading, 12_000);
}

function hideLoading() {
  clearReadyTimer();
  loading.value = false;
  applyEmbeddedTheme();
  fixScadaBackground();
}

function reloadDashboard() {
  startLoading();
  frameRef.value?.contentWindow?.location.reload();
}

function handleFrameLoad() {
  applyEmbeddedTheme();
  fixScadaBackground();
}

function handleDashboardMessage(event: MessageEvent) {
  if (
    event.origin === allowedFrameOrigin.value &&
    event.source === frameRef.value?.contentWindow &&
    event.data?.type === 'HB_TWIN_READY'
  ) {
    hideLoading();
  }
}

function applyEmbeddedTheme() {
  const doc = frameRef.value?.contentDocument;
  if (!doc || doc.getElementById('vue-dashboard-embed-theme')) return;
  const style = doc.createElement('style');
  style.id = 'vue-dashboard-embed-theme';
  style.textContent = `
    section.tb-dashboard-toolbar { right: 0 !important; }
    tb-dashboard-toolbar mat-fab-trigger { display: none !important; }
    tb-dashboard-toolbar .mat-fab-toolbar-wrapper,
    tb-dashboard-toolbar .mat-toolbar,
    tb-dashboard-toolbar .mat-toolbar-tools,
    tb-dashboard-toolbar mat-fab-actions,
    tb-dashboard-toolbar .tb-dashboard-action-panels,
    tb-dashboard-toolbar .tb-dashboard-action-panel {
      height: 56px !important; min-height: 56px !important; background: #fff !important;
    }
    tb-dashboard-toolbar .tb-dashboard-action-panel:first-child { display: none !important; }
    tb-dashboard-toolbar .tb-dashboard-action-panel:last-child > *:not(tb-timewindow) { display: none !important; }
    tb-dashboard-toolbar .tb-dashboard-action-panels { justify-content: flex-end !important; }
    tb-dashboard-toolbar mat-fab-actions { padding: 0 16px !important; }
  `;
  doc.head.appendChild(style);
}

function fixScadaBackground(attempt = 0) {
  const doc = frameRef.value?.contentDocument;
  const layout = doc?.querySelector('tb-dashboard-layout');
  const gridster = layout?.querySelector('gridster') as HTMLElement | null;
  const background = layout
    ? (Array.from(layout.querySelectorAll('div.mat-content')).find((element) =>
        /url\(/u.test(getComputedStyle(element).backgroundImage),
      ) as HTMLElement | undefined)
    : undefined;
  if (!gridster || !background) {
    if (attempt < 40) setTimeout(() => fixScadaBackground(attempt + 1), 300);
    return;
  }
  const image = getComputedStyle(background).backgroundImage;
  if (!image || image === 'none' || gridster.dataset.scadaBgFixed === '1') return;
  Object.assign(gridster.style, {
    backgroundAttachment: 'local',
    backgroundImage: image,
    backgroundPosition: '0 0',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% auto',
  });
  gridster.dataset.scadaBgFixed = '1';
  background.style.backgroundImage = 'none';
}
</script>

<template>
  <div ref="shellRef" class="dashboard-shell">
    <Spin :spinning="loading" size="large" wrapper-class-name="dashboard-spin">
      <div class="dashboard-toolbar">
        <div class="dashboard-title">{{ record?.title || '仪表盘' }}</div>
        <div class="dashboard-actions">
          <Tooltip title="刷新仪表盘">
            <button type="button" class="toolbar-button" @click="reloadDashboard">
              <ReloadOutlined />
            </button>
          </Tooltip>
          <Tooltip :title="isFullscreen ? '退出全屏' : '全屏显示'">
            <button type="button" class="toolbar-button" @click="toggleFullscreen">
              <FullscreenExitOutlined v-if="isFullscreen" />
              <FullscreenOutlined v-else />
            </button>
          </Tooltip>
        </div>
      </div>
      <iframe
        ref="frameRef"
        class="dashboard-frame"
        :src="frameSrc"
        allow="fullscreen"
        @load="handleFrameLoad"
      />
    </Spin>
  </div>
</template>

<style scoped>
.dashboard-shell,
.dashboard-spin,
.dashboard-spin :deep(.ant-spin-container) {
  height: calc(100vh - 96px);
  min-height: 560px;
  background: #fff;
}
.dashboard-toolbar {
  position: absolute;
  z-index: 2;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% - 360px);
  height: 56px;
  padding: 0 12px 0 20px;
  border-bottom: 1px solid rgb(0 0 0 / 12%);
  background: #fff;
}
.dashboard-title {
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dashboard-actions { display: flex; gap: 4px; }
.toolbar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.toolbar-button:hover { color: #1677ff; background: rgb(0 0 0 / 4%); }
.dashboard-frame { display: block; width: 100%; height: 100%; border: 0; }
</style>
