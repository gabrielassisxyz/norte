<script setup lang="ts">
import Icon from './Icon.vue'

withDefaults(
  defineProps<{
    quote: string
    source: string
    timestamp?: string
    href?: string
    note?: string
  }>(),
  { href: '#' }
)
</script>

<template>
  <figure class="nt-hl">
    <blockquote class="nt-hl-quote"><mark>{{ quote }}</mark></blockquote>
    <figcaption class="nt-hl-source">
      <a v-if="timestamp" class="nt-hl-time" :href="href">
        <Icon name="play" :size="12" />
        {{ timestamp }}
      </a>
      <span>{{ source }}</span>
    </figcaption>
    <p v-if="note" class="nt-hl-note">{{ note }}</p>
  </figure>
</template>

<style scoped>
.nt-hl {
  margin: 0;
  max-width: 65ch;
}
.nt-hl-quote {
  margin: 0;
  font-size: 18px;
  line-height: 30px;
  color: var(--ink);
}
.nt-hl-quote mark {
  background: var(--lime);
  color: var(--on-lime);
  padding: 2px 3px;
  border-radius: var(--radius-xs);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.nt-hl-source {
  margin-top: var(--space-3);
  display: flex;
  gap: var(--space-3);
  align-items: center;
  font-size: 14px;
  line-height: 22px;
  color: var(--muted);
}
.nt-hl-time {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--link);
  text-decoration: none;
  border-radius: var(--radius-xs);
}
.nt-hl-time:hover {
  text-decoration: underline;
}
.nt-hl-time:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.nt-hl-note {
  margin: var(--space-3) 0 0;
  font-size: 16px;
  line-height: 26px;
  color: var(--ink-2);
}
</style>
