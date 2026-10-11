<script setup lang="ts">
import Icon from './Icon.vue'

withDefaults(
  defineProps<{
    title: string
    description?: string
    meta?: string
    href?: string
    cover?: string
    coverHeight?: number
  }>(),
  { href: '#', coverHeight: 168 }
)
</script>

<template>
  <a :href="href" class="nt-cover-card">
    <div class="nt-cover" :style="{ height: `${coverHeight}px` }">
      <img v-if="cover" :src="cover" alt="" class="nt-cover-img" />
      <template v-else>
        <Icon name="image" :size="20" />
        <span>Cover photo</span>
      </template>
    </div>
    <div>
      <div class="nt-cover-title">{{ title }}</div>
      <p v-if="description" class="nt-cover-desc">{{ description }}</p>
      <p v-if="meta" class="nt-cover-meta">{{ meta }}</p>
    </div>
  </a>
</template>

<style scoped>
.nt-cover-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  color: var(--ink);
  text-decoration: none;
  border-radius: var(--radius-md);
}
.nt-cover {
  box-sizing: border-box;
  border-radius: var(--radius-md);
  background: var(--sunken);
  border: 1px solid var(--line);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
  line-height: 16px;
  transition: border-color 120ms cubic-bezier(0.2, 0, 0, 1);
}
.nt-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.nt-cover-card:hover .nt-cover {
  border-color: var(--line-strong);
}
.nt-cover-card:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.nt-cover-title {
  font-family: var(--font-display);
  font-size: 18px;
  line-height: 24px;
  font-weight: 650;
  letter-spacing: -0.01em;
  transition: color 120ms cubic-bezier(0.2, 0, 0, 1);
}
.nt-cover-card:hover .nt-cover-title {
  color: var(--norte);
}
.nt-cover-desc {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--ink-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nt-cover-meta {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}
</style>
