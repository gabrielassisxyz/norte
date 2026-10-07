import { createApp } from 'vue'

import router from './router'
import AppRoot from './shell/AppRoot.vue'
import { bootApplication } from './shell/boot'
import { installSources } from './sources'
import { createMockSources } from './sources/mock'
import { applyStoredTheme } from './theme'

import './styles/tokens.css'
import './styles/base.css'

applyStoredTheme()

const app = createApp(AppRoot)
app.use(router)
app.mount('#app')

// Mounting first is what lets the retry screen render at all; the app's own
// screens wait behind `bootState` until the server has said which modules exist.
// The sources are installed from inside that boot, once the config has named the
// time zone, because the mock dates its records against the day it is built on.
void bootApplication(router, () => {
  installSources(app, createMockSources())
})
