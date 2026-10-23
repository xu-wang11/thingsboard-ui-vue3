<template>
  <div ref="shellRef" :class="[prefixCls, 'dashboard-shell']" :style="getWrapStyle">
    <Spin :spinning="loading" size="large" :style="getWrapStyle">
      <div class="dashboard-stage overflow-hidden h-full" :style="getWrapStyle">
        <div class="dashboard-toolbar">
          <div class="dashboard-title">{{ record.title || t('tb.dashboard.title') }}</div>
          <div class="dashboard-actions">
            <Tooltip title="刷新仪表盘">
              <button class="toolbar-button" type="button" @click="reloadDashboard">
                <ReloadOutlined />
              </button>
            </Tooltip>
            <Tooltip :title="isFullscreen ? '退出全屏' : '全屏显示'">
              <button class="toolbar-button" type="button" @click="toggleFullscreen">
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
        ></iframe>
      </div>
    </Spin>
  </div>
</template>
<script lang="ts">
  export default defineComponent({
    name: 'ViewsTbDashboardEditor',
  });
</script>
<script lang="ts" setup>
  import { computed, CSSProperties, defineComponent, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue';
  import { router } from '/@/router';
  import { Spin, Tooltip } from 'ant-design-vue';
  import { FullscreenExitOutlined, FullscreenOutlined, ReloadOutlined } from '@ant-design/icons-vue';
  import { useFullscreen } from '@vueuse/core';
  import { useTabs } from '/@/hooks/web/useTabs';
  import { useI18n } from '/@/hooks/web/useI18n';
  import { useDesign } from '/@/hooks/web/useDesign';
  import { useWindowSizeFn } from '/@/hooks/event/useWindowSizeFn';
  import { Dashboard, getDashboardById } from '/@/api/tb/dashboard';
  import { useLayoutHeight } from '/@/layouts/default/content/useContentViewHeight';
  import { useGlobSetting } from '/@/hooks/setting';

  const padding = 13;
  const readyTimeoutMs = 12_000;

  const loading = ref(true);
  const topRef = ref(50);
  const heightRef = ref(window.innerHeight);
  const frameRef = ref<HTMLFrameElement>();

  const dashboardId = ref<string>(router.currentRoute.value.params.dashboardId as string);
  const record = ref<Dashboard>({} as Dashboard);
  let readyTimeout: ReturnType<typeof setTimeout> | undefined;

  const { setTitle } = useTabs();
  const { t } = useI18n('tb');
  const shellRef = ref<HTMLElement>();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);
  const { headerHeightRef } = useLayoutHeight();
  const { prefixCls } = useDesign('iframe-page');

  // 使用环境变量配置ThingsBoard基础地址
  const frameSrc = computed(() => {
    const { tbBaseUrl } = useGlobSetting();
    return `${tbBaseUrl}/dashboard/${dashboardId.value}`;
  });

  const allowedFrameOrigin = computed(() => {
    try {
      return new URL(frameSrc.value, window.location.href).origin;
    } catch {
      return window.location.origin;
    }
  });

  useWindowSizeFn(calcHeight, 150, { immediate: true });

  watch(
    () => router.currentRoute.value.params.dashboardId,
    async (newVal) => {
      if (!newVal) {
        return;
      }
      dashboardId.value = newVal as string;
      startReadyTimeout();
      await getDashboard();
    },
    { immediate: true },
  );

  onMounted(() => {
    window.addEventListener('message', handleDashboardMessage);
    startReadyTimeout();
  });

  onBeforeUnmount(() => {
    window.removeEventListener('message', handleDashboardMessage);
    clearReadyTimeout();
  });

  const getWrapStyle = computed((): CSSProperties => {
    return {
      height: `${unref(heightRef) - padding}px`,
    };
  });

  function calcHeight() {
    const iframe = unref(frameRef);
    if (!iframe) {
      return;
    }

    const top = headerHeightRef.value + padding;
    topRef.value = top;
    heightRef.value = window.innerHeight - top;
    const clientHeight = document.documentElement.clientHeight - top;
    iframe.style.height = `${clientHeight - padding}px`;
  }

  async function getDashboard() {
    const res = await getDashboardById(dashboardId.value);
    record.value = (res || {}) as Dashboard;
    setTitle(record.value.title || t('tb.dashboard.title'));
  }

  function reloadDashboard() {
    const iframe = unref(frameRef);
    if (!iframe) {
      return;
    }
    startReadyTimeout();
    iframe.contentWindow?.location.reload();
  }

  function clearReadyTimeout() {
    if (readyTimeout !== undefined) {
      clearTimeout(readyTimeout);
      readyTimeout = undefined;
    }
  }

  function startReadyTimeout() {
    loading.value = true;
    clearReadyTimeout();
    readyTimeout = setTimeout(() => {
      hideLoading();
    }, readyTimeoutMs);
  }

  function handleDashboardMessage(event: MessageEvent) {
    if (event.origin !== allowedFrameOrigin.value) {
      return;
    }
    if (event.source !== unref(frameRef)?.contentWindow) {
      return;
    }
    if (event.data?.type !== 'HB_TWIN_READY') {
      return;
    }
    hideLoading();
  }

  function handleFrameLoad() {
    calcHeight();
    applyEmbeddedTheme();
    fixScadaBackground();
  }

  function applyEmbeddedTheme() {
    const iframeDocument = unref(frameRef)?.contentDocument;
    if (!iframeDocument || iframeDocument.getElementById('vue-dashboard-embed-theme')) {
      return;
    }
    const style = iframeDocument.createElement('style');
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
        height: 56px !important;
        min-height: 56px !important;
        background: #fff !important;
      }
      tb-dashboard-toolbar .tb-dashboard-action-panel:first-child { display: none !important; }
      tb-dashboard-toolbar .tb-dashboard-action-panel:last-child > *:not(tb-timewindow) { display: none !important; }
      tb-dashboard-toolbar .tb-dashboard-action-panels { justify-content: flex-end !important; }
      tb-dashboard-toolbar mat-fab-actions { padding: 0 16px !important; }
    `;
    iframeDocument.head.appendChild(style);
  }

  function fixScadaBackground(attempt = 0) {
    const doc = unref(frameRef)?.contentDocument;
    if (!doc) {
      return;
    }
    const layout = doc.querySelector('tb-dashboard-layout');
    const gridster = layout?.querySelector('gridster') as HTMLElement | null;
    const bgEl = layout
      ? (Array.from(layout.querySelectorAll('div.mat-content')).find((el) =>
          /url\(/.test(getComputedStyle(el as Element).backgroundImage),
        ) as HTMLElement | undefined)
      : undefined;
    // SCADA 看板渲染是异步的,元素尚未出现就重试
    if (!layout || !gridster || !bgEl) {
      if (attempt < 40) {
        setTimeout(() => fixScadaBackground(attempt + 1), 300);
      }
      return;
    }
    const bg = getComputedStyle(bgEl).backgroundImage;
    if (!bg || bg === 'none') {
      if (attempt < 40) {
        setTimeout(() => fixScadaBackground(attempt + 1), 300);
      }
      return;
    }
    if (gridster.dataset.scadaBgFixed === '1') {
      return;
    }
    // 背景图(产线连线)原挂在不滚动的 mat-content 上,而符号在会滚动的 gridster 里,
    // 上下滑动时二者错位。把背景移到 gridster 并用 local 让它随内容一起滚,消除漂移。
    gridster.style.backgroundImage = bg;
    gridster.style.backgroundRepeat = 'no-repeat';
    gridster.style.backgroundPosition = '0 0';
    gridster.style.backgroundSize = '100% auto';
    gridster.style.backgroundAttachment = 'local';
    gridster.dataset.scadaBgFixed = '1';
    bgEl.style.backgroundImage = 'none';
  }

  function hideLoading() {
    clearReadyTimeout();
    applyEmbeddedTheme();
    loading.value = false;
    calcHeight();
    fixScadaBackground();
  }
</script>
<style scoped>
  .dashboard-shell {
    background: #fff;
  }

  .dashboard-stage {
    position: relative;
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
    padding: 0 8px 0 20px;
    background: #fff;
    border-bottom: 1px solid rgb(0 0 0 / 12%);
    box-sizing: border-box;
  }

  .dashboard-title {
    overflow: hidden;
    color: rgb(0 0 0 / 88%);
    font-size: 16px;
    font-weight: 600;
    line-height: 56px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dashboard-actions {
    display: flex;
    flex: none;
    gap: 4px;
    margin-left: 12px;
  }

  .toolbar-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    color: rgb(0 0 0 / 65%);
    font-size: 17px;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .toolbar-button:hover {
    color: #1677ff;
    background: rgb(0 0 0 / 4%);
  }

  .dashboard-frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    box-sizing: border-box;
  }

  @media (max-width: 900px) {
    .dashboard-toolbar {
      width: calc(100% - 180px);
      padding-left: 12px;
    }

    .dashboard-title {
      font-size: 14px;
    }
  }
</style>
