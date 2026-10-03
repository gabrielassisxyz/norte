import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { applyStoredTheme } from './theme'

import './styles/tokens.css'
import './styles/base.css'

applyStoredTheme()

const app = createApp(App)
app.use(router)
app.mount('#app')
