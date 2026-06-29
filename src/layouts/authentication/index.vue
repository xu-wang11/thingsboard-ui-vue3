<script lang="ts" setup>
  import { default as AuthPageLayout } from './src/authentication.vue';
  import { useGlobSetting } from '/@/hooks/setting';

  import { useI18n } from '/@/hooks/web/useI18n';
  import { publicPath } from '/@/utils/env';
  const { t } = useI18n('tb');
  const { title } = useGlobSetting();

  const appName = title;
  const logo = `${publicPath}/resource/img/logo.png`;
</script>

<template>
  <AuthPageLayout
    :app-name="appName"
    :logo="logo"
    :page-title="t('四川和邦生物工业智能体')"
    :page-description="t('从互联到智能')"
  >
    <!-- 自定义工具栏 -->
    <!-- <template #toolbar></template> -->
  </AuthPageLayout>
</template>
