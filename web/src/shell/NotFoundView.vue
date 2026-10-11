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
    <PageTitle title="Page not found" objective="This address matches no screen in Norte." />
    <p class="not-found-copy">
      Check the address in the browser's bar. If you got here from a link inside the app, the screen may have been
      renamed.
    </p>
    <RouterLink :to="{ name: 'home' }" class="not-found-link">Back to home</RouterLink>
  </main>
</template>

<style scoped>
.not-found { max-width: 640px; margin: 0 auto; padding-top: var(--space-16); }
.not-found-copy { margin: var(--space-6) 0 0; color: var(--ink-2); font-size: 15px; line-height: 24px; }
.not-found-link { display: inline-block; margin-top: var(--space-6); font-family: var(--font-display); font-size: 14px; font-weight: 550; }
</style>
