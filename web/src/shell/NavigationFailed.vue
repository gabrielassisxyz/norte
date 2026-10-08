<script setup lang="ts">
import Button from '@/components/ds/Button.vue'

import { clearShellNavigationFailure } from './navigationFailure'

const props = defineProps<{ path: string }>()

/**
 * Retry by loading the address again, not by navigating to it.
 *
 * The chunk the router failed to import is cached as a failure for the lifetime
 * of the page, so a second `router.push` to the same route fails without even
 * reaching the network. A document load is the only retry that can succeed, and
 * it is also what recovers the other case this fires for: a deploy that replaced
 * the chunk this page was built against.
 */
function retry(): void {
  clearShellNavigationFailure()
  window.location.assign(props.path)
}
</script>

<template>
  <div class="navigation-failed" role="alert">
    <p class="navigation-failed-copy">Não foi possível abrir esta tela. Verifique a conexão com o servidor.</p>
    <Button variant="primary" size="sm" @click="retry">Tentar de novo</Button>
    <Button variant="ghost" size="sm" @click="clearShellNavigationFailure()">Fechar</Button>
  </div>
</template>

<style scoped>
.navigation-failed { position: fixed; inset: auto var(--space-4) var(--space-4) var(--space-4); z-index: 60; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); max-width: 560px; margin: 0 auto; padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 2px solid var(--danger); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-pop); }
.navigation-failed-copy { flex: 1 1 240px; margin: 0; color: var(--ink); font-size: 14px; line-height: 21px; }
</style>
