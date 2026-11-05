<script lang="ts" setup>
import { computed } from 'vue';

import { AuthPageLayout } from '@vben/layouts';
import { preferences } from '@vben/preferences';

import { $t } from '#/locales';

const appName = computed(() => preferences.app.name);
const logo = computed(() => preferences.logo.source);
const logoDark = computed(() => preferences.logo.sourceDark);
</script>

<template>
  <AuthPageLayout
    class="hebang-auth"
    :app-name="appName"
    :logo="logo"
    :logo-dark="logoDark"
    :page-description="$t('authentication.messages.pageDesc')"
    :page-title="$t('authentication.menu')"
  >
    <template #copyright>
      <a
        v-if="preferences.copyright.enable && preferences.copyright.icp"
        :href="preferences.copyright.icpLink || 'https://beian.miit.gov.cn/'"
        class="text-primary hover:text-primary-hover"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ preferences.copyright.icp }}
      </a>
    </template>
  </AuthPageLayout>
</template>

<style scoped>
.hebang-auth :deep(.login-background) {
  background:
    linear-gradient(120deg, rgb(4 24 46 / 82%), rgb(12 83 107 / 58%)),
    url('../assets/images/chemistry-bg.jpg') center / cover no-repeat;
}
</style>
