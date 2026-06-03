<template>
  <div class="lobby-view">
    <div class="lobby-header">
      <h2>Lobby de Ajedrez</h2>
    </div>

    <div class="lobby-content">
      <!-- Acciones: Crear / Unirse -->
      <div class="lobby-actions-column">
        <!-- Sección de creación de juego -->
        <div class="game-creation-section">
          <h3>Crear Nuevo Juego</h3>
          
          <div class="creation-options">
            <div class="private-game-toggle">
              <label class="toggle-switch">
                <input type="checkbox" v-model="isPrivateGame">
                <span class="slider round"></span>
              </label>
              <div class="toggle-label-text">
                <strong>Hacer juego privado</strong>
                <small v-if="isPrivateGame">Solo podrán unirse con tu token</small>
                <small v-else>El juego será visible en la lista pública</small>
              </div>
            </div>

            <button
              @click="createGame"
              class="create-button primary-action"
              :disabled="isCreating"
              data-testid="create-server"
            >
              <span class="button-icon">{{ isPrivateGame ? '🔐' : '🌐' }}</span>
              <span class="button-text">
                <strong>Crear Servidor</strong>
              </span>
            </button>
          </div>
        </div>

        <!-- Sección de unirse con token manual -->
        <div class="manual-join-section">
          <h3>Unirse con Token</h3>
          <div class="manual-join-form">
            <input
              v-model="manualToken"
              type="text"
              placeholder="Ingresa el token del host (ej: ABC123)"
              class="token-input"
              :disabled="isJoining"
              data-testid="join-token-input"
            />
            <button
              @click="joinWithManualToken"
              class="join-button"
              :disabled="!isValidToken(manualToken) || isJoining"
              data-testid="join-server"
            >
              {{ isJoining ? 'Uniéndose...' : 'Unirse' }}
            </button>
          </div>
          <p class="help-text">
            Pídele al host que te comparta su token para unirte a su juego privado.
          </p>
        </div>
      </div>
    </div>

    <!-- Estado de carga -->
    <div v-if="isCreating || isJoining" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>{{ loadingMessage }}</p>
    </div>

    <!-- Mensajes de error -->
    <div v-if="errorMessage" class="error-message">
      {{ errorMessage }}
      <button @click="clearError" class="dismiss-button">×</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useConnectionStore } from '@/stores/connectionStore'

const connectionStore = useConnectionStore()

// Estado local
const isCreating = ref(false)
const isJoining = ref(false)
const isRefreshing = ref(false)
const manualToken = ref('')
const errorMessage = ref('')
const refreshInterval = ref(null)

// Computed
const publicHosts = computed(() => connectionStore.publicHosts)
const lastUpdateText = computed(() => {
  if (!connectionStore.lastPublicHostsUpdate) return 'Nunca actualizado'
  
  const now = Date.now()
  const diff = now - connectionStore.lastPublicHostsUpdate
  const seconds = Math.floor(diff / 1000)
  
  if (seconds < 60) return `Hace ${seconds} segundos`
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} minutos`
  return `Hace ${Math.floor(seconds / 3600)} horas`
})

const loadingMessage = computed(() => {
  if (isCreating.value) return 'Creando juego...'
  if (isJoining.value) return 'Uniéndose al juego...'
  return ''
})

// Métodos
const isValidToken = (token) => {
  return token && token.trim().length >= 4 && /^[A-Za-z0-9]+$/.test(token.trim())
}

const isPrivateGame = ref(false)

const createGame = async () => {
  if (isCreating.value) return
  
  isCreating.value = true
  errorMessage.value = ''
  
  try {
    const visibilityMode = isPrivateGame.value ? 'private' : 'public'
    connectionStore.setMode('host', visibilityMode)
  } catch (error) {
    errorMessage.value = `Error al crear juego: ${error.message}`
    console.error('Error creating game:', error)
  } finally {
    isCreating.value = false
  }
}

const joinGame = async (hostToken) => {
  if (isJoining.value) return
  
  isJoining.value = true
  errorMessage.value = ''
  
  try {
    // En el proxy, establecer modo guest
    connectionStore.setMode('guest')
    
    // Luego suscribirse al host (handshake)
    const success = await connectionStore.subscribeToHost(hostToken)
    
    if (!success) {
      throw new Error('No se pudo conectar con el host')
    }
    
    // La transición a la vista de guest-waiting se manejará en App.vue
  } catch (error) {
    errorMessage.value = `Error al unirse al juego: ${error.message}`
    console.error('Error joining game:', error)
    // Revertir modo si falla
    connectionStore.setMode(null)
  } finally {
    isJoining.value = false
  }
}

const joinWithManualToken = async () => {
  const token = manualToken.value.trim()
  if (!isValidToken(token)) {
    errorMessage.value = 'Token inválido. Debe tener al menos 4 caracteres alfanuméricos.'
    return
  }
  
  await joinGame(token)
}

const refreshPublicHosts = async () => {
  if (isRefreshing.value) return
  
  isRefreshing.value = true
  errorMessage.value = ''
  
  try {
    await connectionStore.listPublicHosts()
  } catch (error) {
    errorMessage.value = `Error al actualizar lista: ${error.message}`
    console.error('Error refreshing public hosts:', error)
  } finally {
    isRefreshing.value = false
  }
}

const clearError = () => {
  errorMessage.value = ''
}

const startAutoRefresh = () => {
  // Quien sólo mira el lobby NO es miembro del canal de descubrimiento, así que no
  // recibe eventos joined/left en vivo: el poll es el mecanismo principal. Como cada
  // refresh es un único list() (~ms), podemos pollear seguido.
  const refreshIntervalMs = parseInt(import.meta.env.VITE_WS_LOBBY_REFRESH_INTERVAL) || 3000
  refreshInterval.value = setInterval(() => {
    if (!isRefreshing.value && connectionStore.isConnected) {
      refreshPublicHosts()
    }
  }, refreshIntervalMs)
}

const stopAutoRefresh = () => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
    refreshInterval.value = null
  }
}

// Lifecycle hooks
onMounted(() => {
  // Cargar lista inicial de hosts públicos
  if (connectionStore.isConnected) {
    refreshPublicHosts()
    startAutoRefresh()
  }
})

// Arrancar/parar el auto-refresh cuando cambia la conexión
watch(() => connectionStore.isConnected, (connected) => {
  if (connected && !refreshInterval.value) {
    refreshPublicHosts()
    startAutoRefresh()
  } else if (!connected) {
    stopAutoRefresh()
  }
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<style scoped>
.lobby-view {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
}

.lobby-header {
  text-align: center;
  margin-bottom: 30px;
}

.lobby-header h2 {
  margin: 0 0 10px 0;
  color: var(--color-text);
}

.subtitle {
  color: var(--color-text-secondary);
  margin: 0;
}
.lobby-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.lobby-actions-column {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.public-hosts-column {
  display: flex;
  flex-direction: column;
}

.game-creation-section,
.public-hosts-section,
.manual-join-section {
  background: var(--color-card-bg);
  border-radius: 10px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
  height: 100%;
}

.game-creation-section h3,
.public-hosts-section h3,
.manual-join-section h3 {
  margin-top: 0;
  margin-bottom: 20px;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 10px;
}

.creation-options {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Toggle Switch Styles */
.private-game-toggle {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 10px;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.toggle-label-text {
  display: flex;
  flex-direction: column;
}

.toggle-label-text strong {
  font-size: 15px;
  color: var(--color-text);
}

.toggle-label-text small {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: .4s;
}

.slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 4px;
  bottom: 4px;
  background-color: white;
  transition: .4s;
}

input:checked + .slider {
  background-color: var(--color-info);
}

input:focus + .slider {
  box-shadow: 0 0 1px var(--color-info);
}

input:checked + .slider:before {
  transform: translateX(26px);
}

.slider.round {
  border-radius: 24px;
}

.slider.round:before {
  border-radius: 50%;
}

/* Action Button */
.create-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding: 15px;
  border: none;
  border-radius: 8px;
  background: var(--color-button-success);
  color: var(--color-text-on-primary);
  cursor: pointer;
  transition: all 0.2s;
}

.create-button:hover:not(:disabled) {
  transform: translateY(-2px);
  background: var(--color-button-success-hover);
  box-shadow: var(--shadow-md);
}

.button-icon {
  font-size: 24px;
}

.button-text {
  display: flex;
  flex-direction: column;
}

.button-text strong {
  font-size: 16px;
  color: var(--color-text);
  margin-bottom: 5px;
}

.button-text small {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.refresh-controls {
  display: flex;
  align-items: center;
}

.last-update {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-style: italic;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary);
}

.empty-state p {
  margin: 5px 0;
}

.hosts-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.host-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.host-info {
  flex: 1;
}

.host-token {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.token-label {
  font-weight: bold;
  color: var(--color-text);
}

.token-value {
  font-family: monospace;
  background: var(--color-surface-variant);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 14px;
}

.host-stats {
  display: flex;
  gap: 15px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  color: var(--color-text-secondary);
}

.stat-icon {
  font-size: 16px;
}

.join-button {
  padding: 8px 20px;
  background: var(--color-button-success);
  color: var(--color-text-on-primary);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

.join-button:hover:not(:disabled) {
  background: var(--color-button-success-hover);
}

.join-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.manual-join-form {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.token-input {
  flex: 1;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 16px;
}

.token-input:focus {
  outline: none;
  border-color: var(--color-primary-light);
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}

.help-text {
  font-size: 14px;
  color: var(--color-text-secondary);
  margin: 0;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-overlay-light);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 5px solid var(--color-surface);
  border-top: 5px solid var(--color-info);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error-message {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: var(--color-button-danger);
  color: var(--color-text-on-primary);
  padding: 15px 20px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  max-width: 400px;
  box-shadow: var(--shadow-md);
  z-index: 1000;
}

.dismiss-button {
  background: none;
  border: none;
  color: var(--color-text-on-primary);
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
  background: rgba(255, 255, 255, 0.2);
}

@media (max-width: 768px) {
  .lobby-view { padding: 8px; }
  .lobby-header { margin-bottom: 16px; }
  .lobby-header h2 { font-size: 1.3rem; }

  .lobby-content {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .game-creation-section,
  .public-hosts-section,
  .manual-join-section { padding: 14px; }

  .game-creation-section h3,
  .public-hosts-section h3,
  .manual-join-section h3 { font-size: 1.05rem; margin-bottom: 12px; }

  .private-game-toggle { gap: 10px; }

  .manual-join-form { flex-direction: column; gap: 8px; }
  .token-input { width: 100%; box-sizing: border-box; font-size: 16px; }
  .join-button { width: 100%; padding: 12px; }

  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .host-card {
    flex-direction: column;
    gap: 15px;
    align-items: stretch;
  }
  .join-button {
    align-self: flex-end;
  }
}
</style>
