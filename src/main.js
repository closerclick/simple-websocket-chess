import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/theme.css'
import './style.css'
import App from './App.vue'
import '@closerclick/closer-click-support'
import '@closerclick/closer-click-profile'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
