<script setup lang="ts">
  import type { ToolbarType } from '../types';

  // import { Copyright } from '/@/components/Copyright';
  import AuthenticationFormView from './form.vue';
  import { AppLocalePicker, AppDarkModeToggle } from '/@/components/Application';
  import chemistryBg from '/@/assets/images/chemistry-bg.jpg';

  import { useAppStore } from '/@/store/modules/app';
  import { computed } from 'vue';

  interface Props {
    appName?: string;
    logo?: string;
    pageTitle?: string;
    pageDescription?: string;
    sloganImage?: string;
    toolbar?: boolean;
    copyright?: boolean;
    toolbarList?: ToolbarType[];
    clickLogo?: () => void;
  }

  withDefaults(defineProps<Props>(), {
    appName: '',
    copyright: true,
    logo: '',
    pageDescription: '',
    pageTitle: '',
    sloganImage: '',
    toolbar: true,
    toolbarList: () => ['color', 'language', 'layout', 'theme'],
    clickLogo: () => {},
  });

  const { getDarkMode } = useAppStore();

  const isDark = computed(() => getDarkMode === 'dark');
</script>

<template>
  <div :class="[isDark ? 'dark' : '']" class="auth-layout flex min-h-full flex-1 select-none overflow-x-hidden">
    <!-- 全屏化学背景图 -->
    <div class="auth-bg-image absolute inset-0 z-0" :style="{ backgroundImage: `url(${chemistryBg})` }"></div>
    <div class="auth-bg-overlay absolute inset-0 z-0"></div>

    <template v-if="toolbar">
      <slot name="toolbar">
        <div class="flex-center absolute right-8 top-4 z-20 space-x-2">
          <AppDarkModeToggle />
          <AppLocalePicker :showText="false" />
        </div>
      </slot>
    </template>

    <!-- 头部 Logo 和应用名称 -->
    <div v-if="logo || appName" class="absolute left-0 top-0 z-20 flex flex-1" @click="clickLogo">
      <div class="ml-6 mt-5 flex flex-1 items-center text-white sm:left-6 sm:top-6">
        <img v-if="logo" :alt="appName" :src="logo" class="mr-2" width="42" />
        <p v-if="appName" class="m-0 text-xl font-medium drop-shadow">
          {{ appName }}
        </p>
      </div>
    </div>

    <!-- 左侧系统介绍 -->
    <div class="relative z-10 hidden flex-1 lg:flex lg:flex-col lg:justify-center lg:pl-20">
      <div class="-enter-x max-w-xl text-white">
        <template v-if="sloganImage">
          <img :alt="appName" :src="sloganImage" class="mb-8 h-48" />
        </template>
        <h1 class="m-0 text-4xl font-bold leading-tight drop-shadow-lg xl:text-5xl">
          {{ pageTitle }}
        </h1>
        <p class="mt-6 max-w-md text-base leading-relaxed text-white/80">
          {{ pageDescription }}
        </p>
      </div>
    </div>

    <!-- 右侧认证面板 -->
    <div class="relative z-10 flex w-full items-center justify-center p-6 lg:w-[42%] lg:justify-end lg:pr-24">
      <AuthenticationFormView class="auth-card">
        <template v-if="copyright" #copyright>
          <slot name="copyright">
            <!-- <Copyright v-if="preferences.copyright.enable" v-bind="preferences.copyright" /> -->
          </slot>
        </template>
      </AuthenticationFormView>
    </div>
  </div>
</template>

<style lang="less">
  .auth-bg-image {
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
  }

  .auth-bg-overlay {
    background: linear-gradient(115deg, rgba(8, 12, 24, 0.78) 0%, rgba(8, 12, 24, 0.45) 45%, rgba(8, 12, 24, 0.25) 100%);
    backdrop-filter: saturate(120%);
  }

  .dark .auth-bg-overlay {
    background: linear-gradient(115deg, rgba(4, 6, 12, 0.9) 0%, rgba(4, 6, 12, 0.7) 45%, rgba(4, 6, 12, 0.5) 100%);
  }
</style>
