<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { usePhoneViewport } from '@/lib/phoneViewport'

import AppSidebar from './AppSidebar.vue'
import AppTopBar from './AppTopBar.vue'
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
const phone = usePhoneViewport()
/**
 * Whether the sidebar is the narrow rail.
 *
 * Only above the breakpoint. Below it the sidebar is the drawer's panel, where
 * a rail is a 52px strip with no navigation in it -- so the flag is ignored
 * there rather than reset, and a window narrowed and widened again comes back
 * to the rail the reader left it in.
 */
const railed = computed(() => collapsed.value && !phone.value)
/**
 * Whether the navigation drawer is showing.
 *
 * Below the phone breakpoint the sidebar is off-canvas and this is what slides
 * it in. Above it the sidebar is simply the first grid column and the flag is
 * never set, because the only control that sets it is in the top bar, which
 * that width hides.
 */
const drawerOpen = ref(false)

function toggleCollapse(): void {
  collapsed.value = !collapsed.value
}

function toggleDrawer(): void {
  drawerOpen.value = !drawerOpen.value
}

function closeDrawer(): void {
  drawerOpen.value = false
}

function open(mode: Exclude<ShellOverlayMode, null>): void {
  overlay.value = mode
  // The palette and the preferences are opened from inside the drawer, and on a
  // phone the drawer is a panel over the content rather than a column beside it:
  // left standing it covers the left 300px of whatever it just opened, so its
  // rows answer the taps the overlay's own rows should be getting.
  closeDrawer()
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
  open('busca')
})

function handleWindowKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    open('busca')
    return
  }
  // The overlay has its own Escape, and it is on top of the drawer, so the
  // drawer only takes the key when nothing is over it.
  if (event.key === 'Escape' && overlay.value === null) closeDrawer()
}

// Navigating is what the drawer is for, so arriving somewhere closes it.
watch(() => route.fullPath, closeDrawer)
// A window widened past the breakpoint puts the sidebar back in the layout,
// and an open drawer would then be a second copy of it over the content.
watch(phone, (isPhone) => {
  if (!isPhone) closeDrawer()
})

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown)
})
</script>

<template>
  <div class="app-shell" :class="{ 'is-collapsed': railed, 'is-bare': bare }">
    <div v-if="!bare" id="app-drawer" class="app-drawer" :class="{ 'is-open': drawerOpen }">
      <AppSidebar
        :collapsed="railed"
        :drawer="phone"
        @search="open('busca')"
        @preferences="open('prefs')"
        @toggle-collapse="toggleCollapse"
      />
    </div>
    <button
      v-if="!bare && drawerOpen"
      type="button"
      class="app-scrim"
      aria-label="Fechar navegação"
      @click="closeDrawer"
    />
    <div class="app-main">
      <AppTopBar v-if="!bare" :open="drawerOpen" @menu="toggleDrawer" />
      <div class="app-content">
        <slot />
      </div>
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

/*
  A bare route renders no sidebar, so the one column left is the content's. The
  rule is explicit because a two-track template with a single item places that
  item in the first track, which made the reader 232px wide.
*/
.app-shell.is-bare {
  grid-template-columns: minmax(0, 1fr);
}

.app-main {
  min-width: 0;
}

.app-content {
  min-width: 0;
  padding: 20px 48px 112px;
}

/*
  A bare route is a full-height screen of its own (the reader, a material), so it
  brings its own spacing. The padding above made it 100vh tall inside a box that
  started 20px down, which pushed its bottom edge, and anything pinned to it,
  out of the window.
*/
.app-shell.is-bare .app-content {
  padding: 0;
}

@media (max-width: 900px) {
  .app-shell,
  .app-shell.is-collapsed,
  .app-shell.is-bare {
    grid-template-columns: minmax(0, 1fr);
  }

  .app-content {
    padding: 24px 16px 72px;
  }

  /*
    Off-canvas, and `visibility` as well as the transform: a panel that is only
    moved out of sight is still in the tab order and still reachable by a
    pointer at the edge of the screen.
  */
  .app-drawer {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 60;
    visibility: hidden;
    transform: translateX(-100%);
    transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
  }

  .app-drawer.is-open {
    visibility: visible;
    transform: none;
    box-shadow: var(--shadow-pop);
  }

  .app-scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    padding: 0;
    border: 0;
    background: rgb(0 0 0 / 40%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-drawer {
    transition: none;
  }
}
</style>
