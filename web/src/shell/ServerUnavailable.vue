<script setup lang="ts">
defineProps<{ attempts: number }>()
</script>

<template>
  <main class="server-unavailable" role="alert">
    <h1>Servidor indisponível</h1>
    <p>
      O aplicativo precisa do servidor para saber quais módulos estão ligados. Nenhuma ação é necessária: a conexão é
      tentada de novo sozinha.
    </p>
    <p class="server-unavailable-attempts">
      <span class="server-unavailable-dot" aria-hidden="true" />
      <span>{{ attempts }} tentativa{{ attempts === 1 ? '' : 's' }}</span>
    </p>
  </main>
</template>

<style scoped>
.server-unavailable { display: grid; gap: var(--space-4); align-content: center; justify-items: start; min-height: 100vh; max-width: 520px; margin: 0 auto; padding: 0 var(--space-6); }
.server-unavailable h1 { margin: 0; font-family: var(--font-display); font-size: 28px; line-height: 34px; font-weight: 650; letter-spacing: -0.02em; }
.server-unavailable p { margin: 0; color: var(--ink-2); font-size: 15px; line-height: 24px; }
.server-unavailable-attempts { display: flex; align-items: center; gap: var(--space-2); color: var(--muted) !important; font-family: var(--font-mono); font-size: 12px; }
.server-unavailable-dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--danger); }
</style>
