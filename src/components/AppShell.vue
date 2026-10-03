<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import AppSidebar from './AppSidebar.vue'

defineEmits<{
  search: []
  preferences: []
}>()

const route = useRoute()
const bare = computed(() => route.meta.layout === 'bare')
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      v-if="!bare"
      @search="$emit('search')"
      @preferences="$emit('preferences')"
    />
    <div class="app-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  min-height: 100vh;
  background: var(--ground);
  color: var(--ink);
}

.app-content {
  min-width: 0;
  padding: 20px 48px 112px;
}

@media (max-width: 900px) {
  .app-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .app-content {
    padding: 24px 16px 72px;
  }
}
</style>
