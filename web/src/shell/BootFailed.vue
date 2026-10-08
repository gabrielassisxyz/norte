<script setup lang="ts">
defineProps<{ message: string }>()
</script>

<!--
  The boot reached the server and then broke anyway.

  This is deliberately not the server-unavailable screen: that one promises a
  retry, and nothing here gets better by waiting. The message is shown rather
  than summarised because it is the only thing that distinguishes one of these
  from another, and the person reading it is the one who can change the
  configuration that caused it.
-->
<template>
  <main class="boot-failed" role="alert">
    <h1>Não foi possível iniciar o aplicativo</h1>
    <p>
      O servidor respondeu, mas o aplicativo falhou ao preparar a tela. Recarregar a página não deve resolver sozinho:
      a mensagem abaixo diz o que falhou.
    </p>
    <p class="boot-failed-message">{{ message }}</p>
  </main>
</template>

<style scoped>
.boot-failed { display: grid; gap: var(--space-4); align-content: center; justify-items: start; min-height: 100vh; max-width: 520px; margin: 0 auto; padding: 0 var(--space-6); }
.boot-failed h1 { margin: 0; font-family: var(--font-display); font-size: 28px; line-height: 34px; font-weight: 650; letter-spacing: -0.02em; }
.boot-failed p { margin: 0; color: var(--ink-2); font-size: 15px; line-height: 24px; }
.boot-failed-message { padding: var(--space-3) var(--space-4); border-left: 2px solid var(--danger); background: var(--sunken); color: var(--ink) !important; font-family: var(--font-mono); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
</style>
