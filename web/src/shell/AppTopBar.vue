<script setup lang="ts">
import { RouterLink } from 'vue-router'

/**
 * The bar a phone gets instead of a sidebar: the brand, and the button that
 * opens the navigation drawer.
 *
 * It is hidden above the phone breakpoint by its own stylesheet rather than by
 * a `v-if`, so the wide layout keeps exactly the grid it had before the drawer
 * existed and nothing about it depends on a media query being read in script.
 */
defineProps<{ open: boolean }>()

defineEmits<{ menu: [] }>()
</script>

<template>
  <header class="app-topbar">
    <button
      type="button"
      class="app-menu"
      data-action="abrir-navegacao"
      aria-label="Abrir navegação"
      aria-controls="app-drawer"
      :aria-expanded="open"
      @click="$emit('menu')"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M3 5.5h14M3 10h14M3 14.5h14" />
      </svg>
    </button>
    <RouterLink :to="{ name: 'home' }" class="app-topbar-brand">Norte</RouterLink>
  </header>
</template>

<style scoped>
.app-topbar {
  display: none;
}

.app-menu {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.app-menu:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.app-topbar-brand {
  font-family: var(--font-display);
  font-size: 20px;
  line-height: 26px;
  font-weight: 750;
  letter-spacing: -0.035em;
  color: var(--ink);
  text-decoration: none;
}

@media (max-width: 900px) {
  .app-topbar {
    position: sticky;
    top: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 52px;
    padding: 0 8px;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }
}
</style>
