<script setup lang="ts">
import PageTitle from '@/components/ds/PageTitle.vue'
</script>

<template>
  <main class="module-disabled">
    <PageTitle title="Module switched off" objective="This address belongs to a module the server is not serving." />
    <p class="module-disabled-copy">
      Switch the module on in the server's configuration and reload the page. Until then the rest of the app keeps
      working normally.
    </p>
    <RouterLink :to="{ name: 'home' }" class="module-disabled-link">Back to home</RouterLink>
  </main>
</template>

<style scoped>
.module-disabled { max-width: 640px; margin: 0 auto; padding-top: var(--space-16); }
.module-disabled-copy { margin: var(--space-6) 0 0; color: var(--ink-2); font-size: 15px; line-height: 24px; }
.module-disabled-link { display: inline-block; margin-top: var(--space-6); font-family: var(--font-display); font-size: 14px; font-weight: 550; }
</style>
