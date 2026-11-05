import type { EChartsOption } from 'echarts';
import type { Ref } from 'vue';

import { nextTick, onBeforeUnmount, onMounted } from 'vue';

import * as echarts from 'echarts';

export function useECharts(elementRef: Ref<HTMLElement | null>) {
  let instance: echarts.ECharts | null = null;

  function ensureInstance() {
    const element = elementRef.value;
    if (!element) return null;
    if (!instance || instance.getDom() !== element) {
      instance?.dispose();
      instance = echarts.init(element);
    }
    return instance;
  }

  async function setOptions(options: EChartsOption) {
    await nextTick();
    const chart = ensureInstance();
    chart?.setOption(options, true);
    chart?.resize();
    return chart;
  }

  const resize = () => instance?.resize();
  onMounted(() => window.addEventListener('resize', resize));
  onBeforeUnmount(() => {
    window.removeEventListener('resize', resize);
    instance?.dispose();
    instance = null;
  });

  return { getInstance: () => instance, setOptions };
}
