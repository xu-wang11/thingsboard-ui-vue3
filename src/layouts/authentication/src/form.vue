<script setup lang="ts">
  defineOptions({
    name: 'AuthenticationFormView',
  });
</script>

<template>
  <div class="auth-bg flex-col-center relative w-full rounded-2xl px-8 py-12 lg:flex-initial">
    <slot></slot>
    <!-- Router View with Transition and KeepAlive -->
    <RouterView v-slot="{ Component, route }">
      <Transition appear mode="out-in" name="slide-right">
        <KeepAlive :include="['Login']">
          <component :is="Component" :key="route.fullPath" class="enter-x w-full sm:mx-auto md:max-w-md" />
        </KeepAlive>
      </Transition>
    </RouterView>

    <!-- Footer Copyright -->

    <div class="text-muted-foreground absolute bottom-3 flex text-center text-xs">
      <slot name="copyright"> </slot>
    </div>
  </div>
</template>

<style lang="less">
  .auth-card {
    width: 100%;
    max-width: 440px;
  }

  .auth-bg {
    background-color: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(18px) saturate(160%);
    box-shadow:
      0 20px 60px -10px rgba(8, 12, 24, 0.45),
      0 4px 16px -4px rgba(8, 12, 24, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.4);
  }

  html[data-theme='dark'] {
    .auth-bg {
      background-color: rgba(17, 22, 35, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow:
        0 20px 60px -10px rgba(0, 0, 0, 0.6),
        0 4px 16px -4px rgba(0, 0, 0, 0.4);
    }
  }
</style>
