<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ n: number; id?: string }>()

const anchor = computed(() => props.id ?? `note-${props.n}`)
</script>

<template>
  <div class="nt-mnote" :id="anchor">
    <span class="nt-mnote-n">{{ n }}</span>
    <span><slot /></span>
  </div>
</template>

<style scoped>
.nt-mnote {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--ink-2);
}
.nt-mnote-n {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 20px;
  font-weight: 700;
  color: var(--norte);
}
</style>
