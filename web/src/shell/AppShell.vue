<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import AppSidebar from './AppSidebar.vue'
import ShellOverlay, { type ShellOverlayMode } from './ShellOverlay.vue'

const route = useRoute()
const bare = computed(() => route.meta.layout === 'bare')
const overlay = ref<ShellOverlayMode>(null)
// Session-only: collapsing hides the sidebar rail-wide and survives route
// changes because the shell outlives every route view.
const collapsed = ref(false)

function toggleCollapse(): void {
  collapsed.value = !collapsed.value
}

function open(mode: Exclude<ShellOverlayMode, null>): void {
  overlay.value = mode
}

function close(): void {
  overlay.value = null
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    open('busca')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown)
})
</script>

<template>
  <div class="app-shell" :class="{ 'is-collapsed': collapsed }">
    <AppSidebar
      v-if="!bare"
      :collapsed="collapsed"
      @search="open('busca')"
      @preferences="open('prefs')"
      @toggle-collapse="toggleCollapse"
    />
    <div class="app-content">
      <slot />
    </div>
    <ShellOverlay :open="overlay" @close="close" @open-preferences="open('prefs')" />
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

.app-shell.is-collapsed {
  grid-template-columns: auto minmax(0, 1fr);
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
