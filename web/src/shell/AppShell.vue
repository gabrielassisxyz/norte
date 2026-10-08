<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import AppSidebar from './AppSidebar.vue'
import { paletteRequest } from './paletteRequest'
import ShellOverlay, { type ShellOverlayMode } from './ShellOverlay.vue'

const route = useRoute()
const bare = computed(() => route.meta.layout === 'bare')
const overlay = ref<ShellOverlayMode>(null)
/** What a screen's own search box typed before handing the query over. */
const handedOverQuery = ref('')
/** The last hand-over this shell acted on, so it acts on each one once. */
const handledHandOver = ref(0)
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
  // Forgotten on the way out, so the next palette is the empty one the
  // shortcut promises rather than the last thing a search box handed over.
  handedOverQuery.value = ''
}

/**
 * A screen asking for the palette, with what it had typed.
 *
 * The counter is what makes one ask open the palette once. The shell does not
 * clear the request it read: clearing shared state from a watcher makes the
 * shell the owner of something it only consumes, and a second shell watching
 * the same state would then see the request already gone.
 */
watch(paletteRequest(), (request) => {
  if (!request || request.count === handledHandOver.value) return
  handledHandOver.value = request.count
  handedOverQuery.value = request.query
  overlay.value = 'busca'
})

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
    <ShellOverlay
      :open="overlay"
      :initial-query="handedOverQuery"
      @close="close"
      @open-preferences="open('prefs')"
    />
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
