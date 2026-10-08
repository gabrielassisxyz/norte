<script setup lang="ts">
import { computed } from 'vue'

/**
 * A planted violation: a screen that decides what day it is, and when something
 * is due, from literals. See `README.md` in this folder.
 */
const plantedToday = '2026-10-03'
const plantedSeed = 20261003
const plantedDue = computed(() => '2026-10-10')
const plantedTitle = 'Sábado, 3 de outubro'
</script>

<template>
  <p>{{ plantedToday }} · {{ plantedSeed }} · {{ plantedDue }} · {{ plantedTitle }}</p>
</template>
