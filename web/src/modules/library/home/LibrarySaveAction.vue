<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import Button from '@/components/ds/Button.vue'

import SaveLinkDialog from '../components/SaveLinkDialog.vue'

const route = useRoute()
const saveOpen = ref(false)

watch(
  () => route.query.save,
  (save) => {
    if (save === '1') saveOpen.value = true
  },
  { immediate: true }
)
</script>

<template>
  <Button variant="secondary" icon="plus" @click="saveOpen = true">Save a link</Button>
  <SaveLinkDialog v-model:open="saveOpen" />
</template>
