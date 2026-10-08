<script setup lang="ts">
import App from '@/App.vue'

import { bootState } from './boot'
import BootFailed from './BootFailed.vue'
import NavigationFailed from './NavigationFailed.vue'
import { shellNavigationFailure } from './navigationFailure'
import ServerUnavailable from './ServerUnavailable.vue'
</script>

<!--
  What is on screen before `/api/config` answers. The sidebar, the home screen
  and the route table are all built from that answer, so there is no honest
  partial application to show: either the server has answered and the app is
  there, or it has not and this says so while the retry runs.

  A failed navigation is reported on top of whichever of those is showing,
  because it happens after the boot is over and leaves the previous screen in
  place: the message is the only thing that distinguishes it from a click the
  app ignored.
-->
<template>
  <!--
    One root element, laid out as if it were not there: the boot phase and the
    navigation message are two independent branches, and a component whose root
    is a fragment of two `v-if`s is patched against a parent Vue does not always
    have. `display: contents` keeps the shell's own full-height layout the
    child of whatever contains the application.
  -->
  <div class="app-root">
    <ServerUnavailable v-if="bootState.phase === 'unavailable'" :attempts="bootState.attempts" />
    <BootFailed v-else-if="bootState.phase === 'error'" :message="bootState.message" />
    <App v-else-if="bootState.phase === 'ready'" />
    <NavigationFailed v-if="shellNavigationFailure.path" :path="shellNavigationFailure.path" />
  </div>
</template>

<style scoped>
.app-root { display: contents; }
</style>
