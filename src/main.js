import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/theme.css'
import './style.css'
import App from './App.vue'
import '@closerclick/closer-click-support'
import '@closerclick/closer-click-profile'
import '@closerclick/closer-click-share'
import { createBackNav } from '@closerclick/closer-click-nav'

// Navegación "volver" unificada del ecosistema (botón físico de Android / gesto
// de iOS / atrás del navegador / chevron del header → cierra modal, vuelve del
// juego al lobby; si no hay nada → closer.click).
createBackNav()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
