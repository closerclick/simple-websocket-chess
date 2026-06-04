<template>
  <div class="host-game-view">
    <div class="header">
      <h2>Esperando Jugadores</h2>
      <p class="subtitle">Eres el host del juego</p>
    </div>

    <div class="content">
      <!-- Información del host -->
      <div class="host-info-card">
        <div class="info-section">
          <h3>Tu Información</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Token:</span>
              <div class="token-display">
                <code class="token-value">{{ connectionStore.shortToken }}</code>
                <button 
                  @click="copyToken" 
                  class="copy-button"
                  :title="copyButtonText"
                >
                  {{ copyButtonText }}
                </button>
              </div>
            </div>
            
            <div class="info-item">
              <span class="info-label">Visibilidad:</span>
              <span class="info-value visibility-badge" :class="visibilityClass">
                {{ connectionStore.visibility === 'public' ? 'Público' : 'Privado' }}
              </span>
            </div>
            
            <div class="info-item">
              <span class="info-label">Jugadores conectados:</span>
              <span class="info-value players-count">
                {{ connectionStore.subscribersCount }}
              </span>
            </div>
          </div>
          
          <p class="help-text" v-if="connectionStore.visibility === 'public'">
            Tu juego aparece en la lista pública del lobby. Los jugadores pueden unirse directamente.
          </p>
          <p class="help-text" v-else>
            Tu juego es privado. Comparte tu token con los jugadores para que se unan.
          </p>
        </div>
      </div>

      <!-- Lista de jugadores conectados -->
      <div class="players-section">
        <div class="section-header">
          <h3>Jugadores Conectados</h3>
          <span class="players-count-badge">
            {{ connectionStore.subscribersCount }}
          </span>
        </div>

        <div v-if="connectionStore.subscribersCount === 0" class="empty-state">
          <p>Esperando que los jugadores se unan...</p>
          <p v-if="connectionStore.visibility === 'public'">
            Los jugadores pueden encontrarte en la lista pública del lobby.
          </p>
          <p v-else>
            Comparte tu token <strong>{{ connectionStore.shortToken }}</strong> con los jugadores.
          </p>
        </div>

        <div v-else class="players-list">
          <div 
            v-for="player in connectionStore.subscribers" 
            :key="player"
            class="player-card"
          >
            <div class="player-info">
              <span class="player-icon">👤</span>
              <span class="player-token">{{ player }}</span>
            </div>
            <span class="player-status">Conectado</span>
          </div>
        </div>
      </div>

      <!-- Controles del juego -->
      <div class="game-controls">
        <div class="controls-section">
          <h3>Controles del Juego</h3>
          
          <div class="controls-grid">
            <button 
              @click="startGame"
              class="start-game-button"
              :disabled="!canStartGame || isStarting"
            >
              <span v-if="isStarting">Iniciando...</span>
              <span v-else>Iniciar Juego</span>
            </button>
            
            <button 
              @click="changeVisibility"
              class="visibility-button"
              :disabled="isChangingVisibility"
            >
              <span v-if="isChangingVisibility">Cambiando...</span>
              <span v-else>
                {{ connectionStore.visibility === 'public' ? 'Hacer Privado' : 'Hacer Público' }}
              </span>
            </button>
            
            <button
              @click="cancelGame"
              class="cancel-button"
              :disabled="isCanceling"
            >
              <span v-if="isCanceling">Cerrando juego...</span>
              <span v-else>Cerrar Juego y Volver al Lobby</span>
            </button>
          </div>
          
          <div class="start-requirements" v-if="!canStartGame">
            <p>Necesitas al menos 1 jugador conectado para iniciar el juego.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Notificaciones -->
    <div v-if="notification" class="notification" :class="notification.type">
      <span>{{ notification.message }}</span>
      <button @click="clearNotification" class="dismiss-button">×</button>
    </div>

    <!-- Estado de carga -->
    <div v-if="isStarting || isChangingVisibility || isCanceling" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>{{ loadingMessage }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useConnectionStore } from '@/stores/connectionStore'
import { useGameStore } from '@/stores/gameStore'
import { useHostGameStore } from '@/stores/hostGameStore'

const connectionStore = useConnectionStore()
const gameStore = useGameStore()
const hostGameStore = useHostGameStore()

// Estado local
const isStarting = ref(false)
const isChangingVisibility = ref(false)
const isCanceling = ref(false)
const copyButtonText = ref('Copiar')
const notification = ref(null)

// Computed
const canStartGame = computed(() => {
  return connectionStore.subscribersCount > 0
})

const visibilityClass = computed(() => {
  return connectionStore.visibility === 'public' ? 'public' : 'private'
})

const loadingMessage = computed(() => {
  if (isStarting.value) return 'Iniciando juego...'
  if (isChangingVisibility.value) return 'Cambiando visibilidad...'
  if (isCanceling.value) return 'Cancelando juego...'
  return ''
})

// Métodos
const copyToken = async () => {
  try {
    await navigator.clipboard.writeText(connectionStore.shortToken)
    copyButtonText.value = '¡Copiado!'
    setTimeout(() => {
      copyButtonText.value = 'Copiar'
    }, 2000)
    
    showNotification('success', 'Token copiado al portapapeles')
  } catch (error) {
    console.error('Error copying token:', error)
    showNotification('error', 'Error al copiar el token')
  }
}

const startGame = async () => {
  if (!canStartGame.value || isStarting.value) return
  
  isStarting.value = true
  
  try {
    // Iniciar juego en el GameStore
    await gameStore.startGame()
    
    // El cambio a la vista de juego se manejará en App.vue
    // basado en el cambio de estado en gameStore
  } catch (error) {
    console.error('Error starting game:', error)
    showNotification('error', `Error al iniciar el juego: ${error.message}`)
  } finally {
    isStarting.value = false
  }
}

const changeVisibility = async () => {
  if (isChangingVisibility.value) return
  
  isChangingVisibility.value = true
  
  try {
    const newVisibility = connectionStore.visibility === 'public' ? 'private' : 'public'
    // En el proxy, actualizar el modo local
    connectionStore.setMode('host', newVisibility)
    
    // Si cambia a público, publicar en canal
    if (newVisibility === 'public') {
      await connectionStore.publishToChessHosts()
    }
    
    showNotification('success', `Juego ahora es ${newVisibility === 'public' ? 'público' : 'privado'}`)
  } catch (error) {
    console.error('Error changing visibility:', error)
    showNotification('error', `Error al cambiar visibilidad: ${error.message}`)
  } finally {
    isChangingVisibility.value = false
  }
}

const cancelGame = async () => {
  if (isCanceling.value) return
  
  isCanceling.value = true
  
  try {
    // Notificar a todos los guests que el host está cerrando el juego
    hostGameStore.destroyHostInstance()
    
    // Esperar un momento para que los guests reciban la notificación
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Cambiar a modo null para volver al lobby
    connectionStore.setMode(null)
    
    // El cambio a la vista de lobby se manejará en App.vue
  } catch (error) {
    console.error('Error canceling game:', error)
    showNotification('error', `Error al cancelar el juego: ${error.message}`)
  } finally {
    isCanceling.value = false
  }
}

const showNotification = (type, message) => {
  notification.value = { type, message }
  
  // Auto-ocultar después de 5 segundos
  setTimeout(() => {
    if (notification.value && notification.value.message === message) {
      clearNotification()
    }
  }, 5000)
}

const clearNotification = () => {
  notification.value = null
}

// Observar cambios en los subscribers para mostrar notificaciones
watch(() => connectionStore.subscribers, (newSubscribers, oldSubscribers) => {
  // Detectar nuevos subscribers
  if (oldSubscribers && newSubscribers.length > oldSubscribers.length) {
    const newSubscriber = newSubscribers.find(sub => !oldSubscribers.includes(sub))
    if (newSubscriber) {
      showNotification('info', `Nuevo jugador conectado: ${newSubscriber}`)
    }
  }
  
  // Detectar subscribers desconectados
  if (oldSubscribers && newSubscribers.length < oldSubscribers.length) {
    const removedSubscriber = oldSubscribers.find(sub => !newSubscribers.includes(sub))
    if (removedSubscriber) {
      showNotification('warning', `Jugador desconectado: ${removedSubscriber}`)
    }
  }
}, { immediate: false })
</script>

<style scoped>
.host-game-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  text-align: center;
  margin-bottom: 30px;
}

.header h2 {
  margin: 0 0 10px 0;
  color: var(--color-text);
}

.subtitle {
  color: var(--color-text-secondary);
  margin: 0;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.host-info-card,
.players-section,
.game-controls {
  background: var(--color-card-bg);
  border-radius: 10px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
}

.info-section h3,
.players-section h3,
.controls-section h3 {
  margin-top: 0;
  margin-bottom: 15px;
  color: var(--color-text);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 15px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
</style>

.info-label {
  font-weight: bold;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.info-value {
  font-size: 16px;
  color: var(--color-text);
}

.token-display {
  display: flex;
  align-items: center;
  gap: 10px;
}

.token-value {
  font-family: monospace;
  background: var(--color-surface-variant);
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 16px;
  flex: 1;
}

.copy-button {
  padding: 8px 15px;
  background: var(--color-button-secondary);
  color: var(--color-text-on-primary);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.copy-button:hover {
  background: var(--color-button-secondary-hover);
}

.visibility-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: bold;
}

.visibility-badge.public {
  background: rgba(52, 206, 87, 0.15);
  color: var(--color-success-dark);
  border: 1px solid #c3e6cb;
}

.visibility-badge.private {
  background: rgba(57, 192, 237, 0.15);
  color: var(--color-info-dark);
  border: 1px solid #bee5eb;
}

.players-count {
  font-size: 24px;
  font-weight: bold;
  color: var(--color-success);
}

.help-text {
  font-size: 14px;
  color: var(--color-text-secondary);
  margin: 10px 0 0 0;
  line-height: 1.5;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.players-count-badge {
  background: var(--color-button-success);
  color: var(--color-text-on-primary);
  padding: 5px 15px;
  border-radius: 20px;
  font-weight: bold;
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary);
}

.empty-state p {
  margin: 5px 0;
}

.players-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.player-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid #dee2e6;
}

.player-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.player-icon {
  font-size: 20px;
}

.player-token {
  font-family: monospace;
  font-weight: bold;
  color: var(--color-text);
}

.player-status {
  color: var(--color-success);
  font-weight: bold;
  font-size: 14px;
}

.controls-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 15px;
  margin-bottom: 15px;
}

.start-game-button,
.visibility-button,
.cancel-button {
  padding: 15px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  transition: all 0.2s;
}

.start-game-button {
  background: var(--color-button-success);
  color: var(--color-text-on-primary);
}

.start-game-button:hover:not(:disabled) {
  background: var(--color-button-success-hover);
  transform: translateY(-2px);
}

.visibility-button {
  background: var(--color-button-info);
  color: var(--color-text-on-primary);
}

.visibility-button:hover:not(:disabled) {
  background: var(--color-button-info-hover);
  transform: translateY(-2px);
}

.cancel-button {
  background: var(--color-button-danger);
  color: var(--color-text-on-primary);
}

.cancel-button:hover:not(:disabled) {
  background: #c82333;
  transform: translateY(-2px);
}

.start-game-button:disabled,
.visibility-button:disabled,
.cancel-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.start-requirements {
  padding: 10px;
  background: #fff3cd;
  border: 1px solid #ffeaa7;
  border-radius: 4px;
  color: #856404;
}

.start-requirements p {
  margin: 0;
  font-size: 14px;
}

.notification {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 15px 20px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  max-width: 400px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  animation: slideIn 0.3s ease-out;
}

.notification.success {
  background: rgba(52, 206, 87, 0.15);
  color: var(--color-success-dark);
  border: 1px solid #c3e6cb;
}

.notification.error {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.notification.info {
  background: rgba(57, 192, 237, 0.15);
  color: var(--color-info-dark);
  border: 1px solid #bee5eb;
}

.notification.warning {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffeaa7;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.dismiss-button {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.dismiss-button:hover {
  background: rgba(0, 0, 0, 0.1);
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 5px solid #f3f3f3;
  border-top: 5px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .info-grid {
    grid-template-columns: 1fr;
  }
  
  .controls-grid {
    grid-template-columns: 1fr;
  }
  
  .token-display {
    flex-direction: column;
    align-items: stretch;
  }
  
  .copy-button {
    width: 100%;
  }
}

