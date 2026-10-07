<script setup lang="ts">
import PageTitle from '@/components/ds/PageTitle.vue'
</script>

<template>
  <main class="module-disabled">
    <PageTitle title="Módulo desligado" objective="Este endereço pertence a um módulo que o servidor não está servindo." />
    <p class="module-disabled-copy">
      Ligue o módulo na configuração do servidor e recarregue a página. Até lá, as outras partes do aplicativo continuam
      funcionando normalmente.
    </p>
    <RouterLink :to="{ name: 'inicio' }" class="module-disabled-link">Voltar ao início</RouterLink>
  </main>
</template>

<style scoped>
.module-disabled { max-width: 640px; margin: 0 auto; padding-top: var(--space-16); }
.module-disabled-copy { margin: var(--space-6) 0 0; color: var(--ink-2); font-size: 15px; line-height: 24px; }
.module-disabled-link { display: inline-block; margin-top: var(--space-6); font-family: var(--font-display); font-size: 14px; font-weight: 550; }
</style>
