<script setup lang="ts">
import { computed } from 'vue'

import { useReviewSummary } from '../data/composables'

const { data: summary } = useReviewSummary()

const dueCount = computed(() => summary.value?.due ?? 0)
</script>

<template>
  <RouterLink :to="{ name: 'review' }" class="home-review">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5.5 3.5v9l7-4.5z" />
    </svg>
    Revisar {{ dueCount }} cartões
  </RouterLink>
</template>

<style scoped>
.home-review { display: inline-flex; align-items: center; gap: var(--space-2); height: 36px; padding: 0 var(--space-4); border-radius: var(--radius-sm); background: var(--norte); color: var(--on-norte); font-family: var(--font-display); font-size: 14px; font-weight: 550; text-decoration: none; }
</style>
