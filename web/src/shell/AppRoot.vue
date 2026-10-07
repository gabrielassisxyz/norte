<script setup lang="ts">
import App from '@/App.vue'

import { bootState } from './boot'
import ServerUnavailable from './ServerUnavailable.vue'
</script>

<!--
  What is on screen before `/api/config` answers. The sidebar, the home screen
  and the route table are all built from that answer, so there is no honest
  partial application to show: either the server has answered and the app is
  there, or it has not and this says so while the retry runs.
-->
<template>
  <ServerUnavailable v-if="bootState.phase === 'unavailable'" :attempts="bootState.attempts" />
  <App v-else-if="bootState.phase === 'ready'" />
</template>
