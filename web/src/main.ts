import { createApp } from 'vue'

import { createApiLibrarySource } from './modules/library/data/apiSource'
import { createApiNotesSource } from './modules/notes/data/apiSource'
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
//
// The library and the notes are the modules reading the real server; the rest
// still read the mock. Naming them here, rather than hiding them inside the mock
// bundle, is what keeps the line between what is wired and what is not visible
// in one place.
void bootApplication(router, () => {
  installSources(app, {
    ...createMockSources(),
    library: createApiLibrarySource(),
    notes: createApiNotesSource()
  })
})
