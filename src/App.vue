<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import LobbyView from './components/lobby/LobbyView.vue'
import PhaserChessGame from './components/chess/PhaserChessGame.vue'
import UserSettingsModal from './components/identity/UserSettingsModal.vue'
import PeerRatingModal from './components/identity/PeerRatingModal.vue'
import { computeDerivedRating } from './utils/rating'
import { useGameStore } from './stores/gameStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useHostGameStore } from '@/stores/hostGameStore'
import { usePlayerGameStore } from '@/stores/playerGameStore'

// Stores
const gameStore = useGameStore()
const connectionStore = useConnectionStore()
const hostGameStore = useHostGameStore()
const playerGameStore = usePlayerGameStore()

// Estado local
const showGameControls = ref(true)
const boardSize = ref(computeBoardSize())
const currentView = ref('lobby') // 'lobby', 'game'
const isConnecting = ref(false)

function computeBoardSize () {
  if (typeof window === 'undefined') return 600
  // En móvil: ancho de pantalla menos 24px de padding total. En desktop: tope 600px.
  return Math.min(window.innerWidth - 24, 600)
}

const onResize = () => { boardSize.value = computeBoardSize() }

// Identity / rating UI
const settingsOpen = ref(false)
const ratingTarget = ref(null)

const opponentToken = computed(() => {
  if (connectionStore.isGuest) return connectionStore.subscribedHost
  if (connectionStore.isHost && connectionStore.subscribers.length > 0) return connectionStore.subscribers[0]
  return null
})
const opponentInfo = computed(() => {
  const t = opponentToken.value
  if (!t) return null
  const id = connectionStore.peerIdentities.get(t)
  return {
    token: t,
    pubkey: id?.pubkey || null,
    peer: id?.peer || null,
    announcedNickname: id?.announcedNickname || null
  }
})
const opponentRating = computed(() => {
  return computeDerivedRating(opponentInfo.value?.peer, connectionStore.trustMap)
})

const openOpponentRating = () => {
  if (!opponentInfo.value) return
  ratingTarget.value = opponentInfo.value
}

onMounted(() => {
  connectionStore.refreshIdentity?.()
  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', onResize)

  // API global para tests automatizados (Playwright). Permite interactuar con
  // el juego sin depender de coordenadas del canvas Phaser.
  window.__chess = {
    stores: {
      connection: connectionStore,
      game: gameStore,
      host: hostGameStore,
      player: playerGameStore
    },
    createServer(isPrivate = false) {
      connectionStore.setMode('host', isPrivate ? 'private' : 'public')
      return connectionStore.token
    },
    async joinServer(hostToken) {
      connectionStore.setMode('guest')
      return connectionStore.subscribeToHost(hostToken)
    },
    occupy(color) {
      if (connectionStore.isHost) return hostGameStore.occupySeatAsHost(color)
      return playerGameStore.requestSeat(color)
    },
    leaveSeat() {
      if (connectionStore.isHost) return hostGameStore.leaveSeatAsHost()
      return playerGameStore.requestLeaveSeat()
    },
    move(fromRow, fromCol, toRow, toCol) {
      if (connectionStore.isHost) {
        hostGameStore.selectPieceAsHost({ row: fromRow, col: fromCol })
        return hostGameStore.makeMoveAsHost({ row: toRow, col: toCol })
      } else {
        playerGameStore.selectPiece({ row: fromRow, col: fromCol })
        return playerGameStore.makeMove({ row: toRow, col: toCol })
      }
    },
    getBoard() {
      const store = connectionStore.isHost ? hostGameStore : playerGameStore
      return store.board.map(r => r.map(c => c || '.').join(''))
    },
    getSeats() {
      const store = connectionStore.isHost ? hostGameStore : playerGameStore
      return JSON.parse(JSON.stringify(store.seats))
    },
    getTurn() { return gameStore.currentTurn },
    getStatus() { return gameStore.gameStatus },
    getMyToken() { return connectionStore.token },
    getOpponentToken() { return opponentToken.value },
    surrender() {
      return playerGameStore.surrender ? playerGameStore.surrender() : null
    }
  }
})

// Computed
const gameTitle = computed(() => {
  if (gameStore.gameStatus === 'playing') {
    return `Ajedrez - Turno: ${gameStore.currentTurn === 'white' ? 'Blancas' : 'Negras'}`
  }
  
  switch (currentView.value) {
    case 'lobby':
      if (!connectionStore.isConnected) {
        return 'Lobby de Ajedrez - Conectando...'
      }
      return 'Lobby de Ajedrez'
    case 'game':
      if (gameStore.gameStatus === 'paused') {
        return 'Ajedrez - Juego en pausa'
      }
      return 'Ajedrez - Configurando asientos'
    default:
      return 'Ajedrez con WebSocket'
  }
})

const playerInfo = computed(() => {
  if (gameStore.gameStatus === 'playing') {
    return `Eres las ${gameStore.playerColor === 'white' ? 'blancas' : 'negras'} ${gameStore.isHost ? '(Host)' : '(Guest)'}`
  }
  
  switch (currentView.value) {
    case 'lobby':
      if (!connectionStore.isConnected) {
        return 'Conectando al servidor...'
      }
      return 'Selecciona o crea un juego para comenzar'
    case 'game':
      if (gameStore.isSeated) {
        return `Jugador (${gameStore.mySeatColor === 'white' ? 'Blancas' : 'Negras'})`
      } else if (gameStore.isSpectator) {
        return `Espectador (${gameStore.spectatorsCount} total)`
      } else {
        return 'Selecciona un asiento para jugar'
      }
    default:
      return 'Conectando al servidor...'
  }
})

const canShowGame = computed(() => {
  // Siempre mostrar el juego cuando estamos en la vista de juego
  // El overlay de selección de asientos manejará la interacción
  return currentView.value === 'game'
})

// Determinar vista actual basada en estado
const determineCurrentView = () => {
  if (!connectionStore.isConnected) {
    currentView.value = 'lobby'
    return
  }

  // Si está conectado pero no tiene modo (no es host ni guest), mostrar lobby
  if (!connectionStore.mode) {
    currentView.value = 'lobby'
    return
  }

  // Si es host o guest, ir al juego (tablero con selección de asientos)
  // El sistema de asientos manejará si el usuario es jugador o espectador
  currentView.value = 'game'
}

// Conectar automáticamente al WebSocket proxy
const autoConnect = async () => {
  if (connectionStore.isConnected || isConnecting.value) {
    return
  }
  
  isConnecting.value = true
  try {
    console.log('Conectando automáticamente al servidor WebSocket proxy...')
    await connectionStore.connect()
    console.log('Conexión WebSocket proxy establecida automáticamente')
  } catch (error) {
    console.error('Error al conectar automáticamente:', error)
    // El connectionStore manejará la reconexión automática
  } finally {
    isConnecting.value = false
  }
}

// Watchers para cambios de estado
watch(() => connectionStore.isConnected, determineCurrentView)
watch(() => connectionStore.mode, determineCurrentView)
watch(() => gameStore.gameStatus, determineCurrentView)

// Inicializar vista
determineCurrentView()

// Configurar listeners para eventos del proxy (a través del connectionStore)
// Los eventos se manejan internamente en el connectionStore
// Para cambios de vista, usamos watchers en el estado del store

// Método para volver al lobby
const returnToLobby = async () => {
  try {
    // Si somos host, destruir la instancia del host primero
    if (connectionStore.isHost) {
      hostGameStore.destroyHostInstance()
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    // Si estamos suscritos como guest, desuscribirse y resetear estado local
    if (connectionStore.isGuest && connectionStore.subscribedHost) {
      await connectionStore.unsubscribe()
    }
    
    // Resetear estado del juego del guest (seats, playerColor, board, etc.)
    if (connectionStore.isGuest) {
      playerGameStore.resetLocalGame()
    }
    
    // Actualizar estado de conexión
    connectionStore.setMode(null)
    connectionStore.setSubscribedHost(null)
    currentView.value = 'lobby'
  } catch (error) {
    console.error('Error al volver al lobby:', error)
    playerGameStore.resetLocalGame()
    connectionStore.setMode(null)
    connectionStore.setSubscribedHost(null)
    currentView.value = 'lobby'
  }
}

const joinPublicGame = async (hostToken) => {
  try {
    connectionStore.setMode('guest')
    const success = await connectionStore.subscribeToHost(hostToken)
    if (success) {
      // Solicitar el estado completo directamente — sin watch, sin delay de tick
      playerGameStore.requestFullState(hostToken)
    } else {
      connectionStore.setMode(null)
    }
  } catch (error) {
    console.error('Error al unirse al juego:', error)
    connectionStore.setMode(null)
  }
}

// Conectar automáticamente al montar el componente
onMounted(() => {
  autoConnect()
})
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <div class="hdr-coin">
        <closer-click-support href="https://ko-fi.com/closerclick" repo="closerclick/simple-websocket-chess" discord="https://discord.gg/D648uq7cth"></closer-click-support>
      </div>
      <h1>{{ gameTitle }}</h1>
      <p class="subtitle">{{ playerInfo }}</p>
      
      <div v-if="connectionStore.isConnected" class="connection-status-bar">
        <div class="status-item">
          <span class="status-label">Token:</span>
          <code class="status-value">{{ connectionStore.shortToken }}</code>
        </div>

        <div class="status-item">
          <button class="identity-button" @click="settingsOpen = true" title="Editar identidad">
            @{{ connectionStore.myNickname || 'sin nombre' }}
          </button>
        </div>

        <div v-if="opponentInfo" class="status-item">
          <button class="opponent-button" @click="openOpponentRating">
            Oponente: {{ opponentInfo.peer?.nickname || opponentInfo.announcedNickname || opponentInfo.token }}
            <span
              v-if="opponentRating.value != null"
              class="rating-badge"
              :class="{ derived: opponentRating.source === 'derived' }"
            >
              ★ {{ opponentRating.value.toFixed(opponentRating.source === 'derived' ? 1 : 0) }}
            </span>
          </button>
        </div>

        <div v-if="currentView !== 'lobby'" class="status-item">
          <button
            @click="returnToLobby"
            class="back-to-lobby-button"
          >
            Volver al Lobby
          </button>
        </div>
      </div>
      
      <div v-else class="connection-status-bar">
        <div class="status-item">
          <span class="status-label">Estado:</span>
          <span class="status-value">{{ isConnecting ? 'Conectando...' : 'Desconectado' }}</span>
        </div>
      </div>
    </header>

    <UserSettingsModal :open="settingsOpen" @close="settingsOpen = false" />
    <PeerRatingModal :info="ratingTarget" @close="ratingTarget = null" />

    <main class="app-main">
      <!-- Vista de Lobby -->
      <div v-if="currentView === 'lobby'" class="lobby-container">
        <div class="lobby-wrapper">
          <LobbyView />
        </div>
        
        <div class="connection-status-panel">
          <div class="connection-status-info">
            <h4>Estado de Conexión</h4>
            <div class="status-item">
              <span class="status-label">Servidor:</span>
              <span class="status-value">{{ connectionStore.isConnected ? 'Conectado' : 'Desconectado' }}</span>
            </div>
            <div class="status-item" v-if="connectionStore.isConnected">
              <span class="status-label">Token:</span>
              <code class="status-value">{{ connectionStore.shortToken }}</code>
            </div>
            <div class="status-item" v-if="!connectionStore.isConnected && !isConnecting">
              <button @click="autoConnect" class="reconnect-button">
                Reconectar
              </button>
            </div>
          </div>

          <!-- Lista de juegos públicos -->
          <div class="public-hosts-info" v-if="connectionStore.isConnected">
            <h4>Juegos Públicos</h4>
            <div v-if="connectionStore.publicHosts && connectionStore.publicHosts.length === 0" class="no-hosts">
              <p>No hay juegos disponibles.</p>
            </div>
            <div v-else class="hosts-mini-list">
              <div
                v-for="hostToken in connectionStore.publicHosts"
                :key="hostToken"
                class="host-mini-card"
              >
                <code class="host-mini-token">{{ hostToken }}</code>
                <button
                  @click="joinPublicGame(hostToken)"
                  class="host-mini-join"
                >
                  Unirse
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Vista de Juego -->
      <div v-else-if="currentView === 'game'" class="game-container">
        <div class="game-area">
          <div class="phaser-container" :class="{ 'game-active': canShowGame }">
            <PhaserChessGame
              v-if="canShowGame"
              :board-size="boardSize"
              class="chess-game"
            />
            <div v-else class="game-placeholder">
              <div class="placeholder-content">
                <h3>Esperando para comenzar</h3>
                <p>El juego comenzará pronto...</p>
                <div class="placeholder-board">
                  <div class="board-grid">
                    <div v-for="row in 8" :key="row" class="board-row">
                      <div
                        v-for="col in 8"
                        :key="col"
                        class="board-square"
                        :class="{ 'light': (row + col) % 2 === 0, 'dark': (row + col) % 2 !== 0 }"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="control-panel">
            <div class="connection-status-info">
              <h4>Estado de Conexión</h4>
              <div class="status-item">
                <span class="status-label">Servidor:</span>
                <span class="status-value">{{ connectionStore.isConnected ? 'Conectado' : 'Desconectado' }}</span>
              </div>
              <div class="status-item" v-if="connectionStore.isConnected">
                <span class="status-label">Token:</span>
                <code class="status-value">{{ connectionStore.shortToken }}</code>
              </div>
              <div class="status-item" v-if="!connectionStore.isConnected && !isConnecting">
                <button @click="autoConnect" class="reconnect-button">
                  Reconectar
                </button>
              </div>
            </div>
            
            <div v-if="gameStore.gameStatus === 'playing'" class="game-info-panel">
              <div class="game-status">
                <h4>Estado del Juego</h4>
                <div class="status-item">
                  <span class="status-label">Turno:</span>
                  <span class="status-value" :class="{ 'current-turn': gameStore.isMyTurn }">
                    {{ gameStore.currentTurn === 'white' ? 'Blancas' : 'Negras' }}
                    <span v-if="gameStore.isMyTurn" class="your-turn">(TÚ)</span>
                  </span>
                </div>
                <div class="status-item">
                  <span class="status-label">Estado:</span>
                  <span class="status-value">{{ gameStore.gameStatus }}</span>
                </div>
                <div class="status-item" v-if="gameStore.winner">
                  <span class="status-label">Ganador:</span>
                  <span class="status-value winner">{{ gameStore.winner === 'white' ? 'Blancas' : 'Negras' }}</span>
                </div>
              </div>

              <div class="move-history">
                <h4>Historial de Movimientos</h4>
                <div class="history-list">
                  <div
                    v-for="(move, index) in gameStore.moveHistory.slice().reverse()"
                    :key="index"
                    class="history-item"
                  >
                    <span class="move-number">{{ gameStore.moveHistory.length - index }}.</span>
                    <span class="move-description">{{ move.notation }}</span>
                  </div>
                  <div v-if="gameStore.moveHistory.length === 0" class="no-moves">
                    No hay movimientos aún
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  background: var(--color-header-bg);
  padding: 20px;
}

.app-header {
  text-align: center;
  margin-bottom: 30px;
  color: var(--color-text-on-primary);
  position: relative;
}
.hdr-coin {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
}

.app-header h1 {
  margin: 0 0 10px 0;
  font-size: 2.5rem;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
}

.subtitle {
  margin: 0 0 20px 0;
  font-size: 1.2rem;
  opacity: 0.9;
  color: var(--color-text-on-primary);
}

.connection-status-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  background: rgba(255, 255, 255, 0.1);
  padding: 10px 20px;
  border-radius: 10px;
  backdrop-filter: blur(10px);
}

.status-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-label {
  font-weight: bold;
  font-size: 0.9rem;
  color: var(--color-text-on-primary);
}

.status-value {
  font-family: monospace;
  background: rgba(0, 0, 0, 0.2);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.9rem;
  color: var(--color-text-on-primary);
}

.back-to-lobby-button {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.2);
  color: var(--color-text-on-primary);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.back-to-lobby-button:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-2px);
}

.identity-button, .opponent-button {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.15);
  color: var(--color-text-on-primary);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.identity-button:hover, .opponent-button:hover {
  background: rgba(255, 255, 255, 0.28);
}
.rating-badge {
  background: rgba(245, 179, 1, 0.3);
  color: #fff;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.85em;
}
.rating-badge.derived { background: rgba(52, 152, 219, 0.4); }

.app-main {
  max-width: 1400px;
  margin: 0 auto;
}

.lobby-container {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 30px;
}

.lobby-wrapper {
  background: var(--color-card-bg);
  border-radius: 15px;
  padding: 0;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.connection-status-panel {
  background: var(--color-card-bg);
  border-radius: 15px;
  padding: 20px;
  box-shadow: var(--shadow-lg);
}

.connection-status-info {
  background: var(--color-surface);
  border-radius: 10px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
}

.connection-status-info h4 {
  margin: 0 0 15px 0;
  color: var(--color-text);
  font-size: 1.1rem;
}

.reconnect-button {
  padding: 8px 16px;
  background: var(--color-button-primary);
  color: var(--color-button-primary-text);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
  width: 100%;
}

.reconnect-button:hover {
  background: var(--color-button-primary-hover);
  transform: translateY(-2px);
}

.reconnect-button:disabled {
  background: var(--color-button-secondary);
  cursor: not-allowed;
  transform: none;
}

.public-hosts-info {
  margin-top: 16px;
  background: var(--color-surface);
  border-radius: 10px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
}

.public-hosts-info h4 {
  margin: 0 0 12px 0;
  color: var(--color-text);
  font-size: 1rem;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 8px;
}

.no-hosts {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.no-hosts p {
  margin: 4px 0;
}

.hosts-mini-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.host-mini-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--color-card-bg);
  border-radius: 6px;
  border: 1px solid var(--color-border);
}

.host-mini-token {
  font-family: monospace;
  font-size: 0.9rem;
  color: var(--color-text);
}

.host-mini-join {
  padding: 4px 12px;
  background: var(--color-button-success);
  color: var(--color-text-on-primary);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: bold;
  transition: background 0.2s;
}

.host-mini-join:hover {
  background: var(--color-button-success-hover);
}

.host-waiting-container,
.guest-waiting-container {
  background: var(--color-card-bg);
  border-radius: 15px;
  padding: 0;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.game-container {
  background: var(--color-card-bg);
  border-radius: 15px;
  padding: 30px;
  box-shadow: var(--shadow-lg);
}

.game-area {
  display: grid;
  grid-template-columns: 1fr 350px;
  gap: 30px;
}

.phaser-container {
  background: var(--color-surface-variant);
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  min-height: 600px;
}

.phaser-container.game-active {
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
}

.chess-game {
  width: 100%;
  height: 100%;
}

.game-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-overlay-dark);
}

.placeholder-content {
  text-align: center;
  color: var(--color-text-on-primary);
  padding: 30px;
}

.placeholder-content h3 {
  margin: 0 0 15px 0;
  font-size: 1.5rem;
}

.placeholder-content p {
  margin: 0 0 30px 0;
  opacity: 0.8;
}

.placeholder-board {
  display: inline-block;
  border: 3px solid var(--color-border-dark);
  border-radius: 5px;
  overflow: hidden;
}

.board-grid {
  display: grid;
  grid-template-rows: repeat(8, 40px);
  gap: 0;
}

.board-row {
  display: grid;
  grid-template-columns: repeat(8, 40px);
  gap: 0;
}

.board-square {
  width: 40px;
  height: 40px;
}

.board-square.light {
  background: var(--color-game-white);
}

.board-square.dark {
  background: var(--color-game-black);
}

.control-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}


.game-info-panel {
  background: var(--color-surface);
  border-radius: 10px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
}

.game-status h4,
.move-history h4 {
  margin: 0 0 15px 0;
  color: var(--color-text);
  font-size: 1.1rem;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border);
}

.status-item:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.status-label {
  font-weight: bold;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.status-value {
  font-weight: bold;
  color: var(--color-text);
}

.status-value.current-turn {
  color: var(--color-success);
}

.your-turn {
  font-size: 0.8rem;
  color: var(--color-success);
  margin-left: 5px;
}

.status-value.winner {
  color: var(--color-error);
}

.move-history {
  margin-top: 20px;
}

.history-list {
  max-height: 300px;
  overflow-y: auto;
  background: var(--color-card-bg);
  border-radius: 5px;
  padding: 10px;
  border: 1px solid var(--color-border);
}

.history-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-light);
}

.history-item:last-child {
  border-bottom: none;
}

.move-number {
  font-weight: bold;
  color: var(--color-text-secondary);
  min-width: 30px;
}

.move-description {
  flex: 1;
  font-family: monospace;
  font-size: 0.9rem;
  color: var(--color-text);
}

.no-moves {
  text-align: center;
  color: var(--color-text-secondary);
  font-style: italic;
  padding: 20px;
}

@media (max-width: 1200px) {
  .game-area {
    grid-template-columns: 1fr;
  }
  
  .phaser-container {
    min-height: 500px;
  }
}

@media (max-width: 768px) {
  .app-container { padding: 0; }
  .app-header {
    padding: 6px 8px;
    margin-bottom: 0;
    text-align: left;
  }
  .app-header h1 { font-size: 1rem; margin: 0; text-shadow: none; }
  .subtitle { display: none; }
  .app-main { padding: 0; max-width: 100%; }

  .lobby-container {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 0;
  }
  .connection-status-panel { padding: 8px; }

  .connection-status-bar {
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-start;
    margin-top: 4px;
  }
  .status-item { font-size: 0.78rem; gap: 4px; }
  .status-label { font-size: 0.75rem; }
  .identity-button, .opponent-button {
    font-size: 0.78rem;
    padding: 3px 7px;
  }
  .opponent-button {
    max-width: 60vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .back-to-lobby-button { padding: 4px 8px; font-size: 0.75rem; }

  /* En vista de juego: sin paddings, tablero al top, panel debajo */
  .game-container {
    padding: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .game-area {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .phaser-container {
    min-height: 0;
    width: 100%;
    overflow: hidden;
    border-radius: 0;
    background: transparent;
  }

  .board-row {
    grid-template-columns: repeat(8, 30px);
  }
  .board-square {
    width: 30px;
    height: 30px;
  }
}
</style>
