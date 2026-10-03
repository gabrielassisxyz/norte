<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import PageTitle from '@/components/ds/PageTitle.vue'

const route = useRoute()

const title = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : 'Norte'))
</script>

<template>
  <main class="placeholder">
    <PageTitle :title="title" objective="Esta tela ainda está em construção." />
  </main>
</template>

<style scoped>
.placeholder {
  max-width: 1120px;
  margin: 0 auto;
  padding: var(--space-9) var(--space-6) var(--space-24);
}
</style>
