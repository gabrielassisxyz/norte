<script setup lang="ts">
import PageTitle from '@/components/ds/PageTitle.vue'
</script>

<!--
  An address no route claims.

  Without this the router matched nothing and `RouterView` rendered nothing, so
  a mistyped address and a broken screen looked identical: the sidebar was
  there, the main area was blank, and nothing said which of the two had
  happened.
-->
<template>
  <main class="not-found">
    <PageTitle title="Página não encontrada" objective="Este endereço não corresponde a nenhuma tela do Norte." />
    <p class="not-found-copy">
      Confira o endereço na barra do navegador. Se você chegou aqui por um link dentro do aplicativo, a tela pode ter
      sido renomeada.
    </p>
    <RouterLink :to="{ name: 'inicio' }" class="not-found-link">Voltar ao início</RouterLink>
  </main>
</template>

<style scoped>
.not-found { max-width: 640px; margin: 0 auto; padding-top: var(--space-16); }
.not-found-copy { margin: var(--space-6) 0 0; color: var(--ink-2); font-size: 15px; line-height: 24px; }
.not-found-link { display: inline-block; margin-top: var(--space-6); font-family: var(--font-display); font-size: 14px; font-weight: 550; }
</style>
