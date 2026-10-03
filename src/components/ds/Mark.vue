<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ note?: number; href?: string }>()

const target = computed(() => props.href ?? `#nota-${props.note}`)
</script>

<template>
  <mark class="nt-mark"><slot /></mark><a
    v-if="note != null"
    class="nt-mark-ref"
    :href="target"
    :aria-label="`Anotação ${note}`"
    >{{ note }}</a
  >
</template>

<style scoped>
.nt-mark {
  background: var(--lime);
  color: var(--on-lime);
  padding: 1px 2px;
  border-radius: var(--radius-xs);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.nt-mark-ref {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--norte);
  vertical-align: super;
  line-height: 0;
  margin-left: 2px;
  text-decoration: none;
  border-radius: 2px;
}
.nt-mark-ref:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
</style>
