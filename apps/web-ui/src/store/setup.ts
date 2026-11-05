import { ref } from 'vue';

import { defineStore } from 'pinia';

import { getSetupState } from '#/api/tb/noauth';

export const useSetupStore = defineStore('setup', () => {
  const status = ref<string>();
  let pending: Promise<void> | undefined;

  async function load(force = false) {
    if (!force && status.value) return status.value;
    pending ??= getSetupState()
      .then((info) => {
        status.value = info.status || 'UNKNOWN';
      })
      .catch((error: any) => {
        // The setup API was added in ThingsBoard 4.4. Existing 4.3 servers are
        // already initialized and answer 404; retain strict failure handling
        // for every other response and for connectivity errors.
        status.value = error?.response?.status === 404 ? 'READY' : undefined;
      })
      .finally(() => {
        pending = undefined;
      });
    await pending;
    return status.value;
  }

  function $reset() {
    status.value = undefined;
  }

  return { $reset, load, status };
});
