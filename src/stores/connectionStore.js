import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWebSocketProxyClient } from '@closerclick/closer-click-proxy-client'
import { Identity } from '@closerclick/closer-click-identity'

let _identity = null
async function getIdentity () {
  if (_identity) return _identity
  try {
    _identity = await Identity.connect()
  } catch (e) {
    console.warn('Identity vault unreachable, identity features disabled:', e)
    _identity = null
  }
  return _identity
}

function formatProxyMessage (type, payload) {
  return `${type}|${JSON.stringify(payload || {})}`
}
function parseProxyMessage (raw) {
  if (typeof raw !== 'string') return { type: null, payload: null }
  const i = raw.indexOf('|')
  if (i === -1) return { type: null, payload: null }
  const type = raw.slice(0, i)
  try { return { type, payload: JSON.parse(raw.slice(i + 1)) } }
  catch { return { type: null, payload: null } }
}

export const useConnectionStore = defineStore('connection', () => {
  // Estado de conexión WebSocketProxyClient
  const wsProxyClient = getWebSocketProxyClient()
  const token = ref(null) // Token asignado por el proxy (4 caracteres)
  const isConnected = ref(false)
  const connectionError = ref(null)
  const wsUrl = ref(import.meta.env.VITE_WS_URL || 'wss://proxy.closer.click')
  
  // Estado para protocolo de lobby con proxy
  const mode = ref(null) // null, 'host', 'guest'
  const visibility = ref(null) // null, 'public', 'private' (solo para hosts)
  const publicHosts = ref([]) // Lista de tokens de hosts públicos
  const subscribedHost = ref(null) // token del host suscrito (para guests)
  const subscribers = ref([]) // lista de tokens de guests (para hosts)
  const lastPublicHostsUpdate = ref(null)

  // Identity / web-of-trust
  const peerIdentities = ref(new Map()) // Map<token, { pubkey, peer }>
  const trustMap = ref(new Map())       // Map<pubkey, my rating 0-5>
  const myPubkey = ref(null)
  const myNickname = ref(localStorage.getItem('chess_nickname') || '')
  
  // Mapeo de localId a token para comunicación transparente
  const localIdToTokenMap = ref(new Map())
  
  // Guard: evitar registrar listeners duplicados al reconectar
  let handlersSetup = false
  
  // Getters
  const connectionStatus = computed(() => {
    if (connectionError.value) return 'error'
    if (isConnected.value) return 'connected'
    return 'disconnected'
  })

  const hasToken = computed(() => !!token.value)
  const canPlay = computed(() => isConnected.value && subscribedHost.value)
  const shortToken = computed(() => token.value) // alias usado por componentes
  
  // Nuevos getters para protocolo de lobby
  const isHost = computed(() => mode.value === 'host')
  const isGuest = computed(() => mode.value === 'guest')
  const isPublicHost = computed(() => isHost.value && visibility.value === 'public')
  const hasSubscribers = computed(() => subscribers.value.length > 0)
  const subscribersCount = computed(() => subscribers.value.length)
  const isSubscribed = computed(() => !!subscribedHost.value)

  // Acciones básicas
  const setToken = (newToken) => {
    token.value = newToken
  }

  const setConnected = (connected) => {
    isConnected.value = connected
    if (!connected) {
      connectionError.value = null
      token.value = null
    }
  }

  const setError = (error) => {
    connectionError.value = error
    isConnected.value = false
  }

  const clearError = () => {
    connectionError.value = null
  }

  const reset = () => {
    token.value = null
    isConnected.value = false
    connectionError.value = null
    
    // Resetear estado de lobby
    mode.value = null
    visibility.value = null
    publicHosts.value = []
    subscribedHost.value = null
    subscribers.value = []
    lastPublicHostsUpdate.value = null
    localIdToTokenMap.value.clear()
    
    // Limpiar localStorage de datos antiguos (no compatibilidad)
    localStorage.removeItem('chess_uuid')
    localStorage.removeItem('chess_short_token')
    localStorage.removeItem('chess_opponent_token')
    localStorage.removeItem('chess_mode')
    localStorage.removeItem('chess_visibility')
    localStorage.removeItem('chess_subscribed_host')
  }

  // Nuevas acciones para protocolo de lobby con proxy
  const setMode = (newMode, newVisibility = null) => {
    const oldMode = mode.value
    const oldVisibility = visibility.value
    
    // Despublicar si estábamos como host público
    if (oldMode === 'host' && oldVisibility === 'public' && newMode !== 'host') {
      unpublishFromChessHosts()
    }
    
    mode.value = newMode
    visibility.value = newVisibility
    
    // Resetear estado relacionado al cambiar modo
    if (newMode === 'host') {
      subscribedHost.value = null
      subscribers.value = []
      // Host se publica en canal 'chess_hosts' si es público
      if (newVisibility === 'public' && token.value) {
        publishToChessHosts()
      }
    } else if (newMode === 'guest') {
      subscribers.value = []
    }
  }

  const setPublicHosts = (hosts) => {
    publicHosts.value = hosts || []
  }

  const setSubscribedHost = (hostToken) => {
    subscribedHost.value = hostToken
    if (hostToken) {
      peerIdentities.value.set(hostToken, peerIdentities.value.get(hostToken) || { pubkey: null, peer: null })
      challengePeer(hostToken)
    }
  }

  const addSubscriber = (guestToken) => {
    if (!subscribers.value.includes(guestToken)) {
      subscribers.value.push(guestToken)
    }
    peerIdentities.value.set(guestToken, peerIdentities.value.get(guestToken) || { pubkey: null, peer: null })
    challengePeer(guestToken)
  }

  const removeSubscriber = (guestToken) => {
    const index = subscribers.value.indexOf(guestToken)
    if (index > -1) {
      subscribers.value.splice(index, 1)
    }
  }

  const clearSubscribers = () => {
    subscribers.value = []
  }

  const updateLastPublicHostsUpdate = () => {
    lastPublicHostsUpdate.value = Date.now()
  }

  // Acciones específicas del proxy WebSocket
  const connect = async () => {
    try {
      // Aplicar URL actual de la configuración (desde .env)
      wsProxyClient.updateConfig({ url: wsUrl.value })
      
      // Configurar handlers de eventos del proxy
      setupProxyEventHandlers()
      
      // Conectar al proxy
      await wsProxyClient.connect()
      
      return true
    } catch (error) {
      console.error('Error conectando al proxy WebSocket:', error)
      setError('Error de conexión: ' + (error.message || 'Desconocido'))
      return false
    }
  }

  const disconnect = () => {
    wsProxyClient.disconnect()
    setConnected(false)
    token.value = null
  }

  const publishToChessHosts = async () => {
    if (!isConnected.value || !token.value) {
      console.error('No conectado o sin token para publicar en canal')
      return false
    }
    
    try {
      // Include additional data about the chess host
      const extraData = {
        gameType: 'chess',
        version: '1.0',
        timestamp: new Date().toISOString(),
        hostToken: token.value
      };
      
      await wsProxyClient.publish('chess_hosts', extraData)
      console.log('Host publicado en canal chess_hosts con datos adicionales')
      return true
    } catch (error) {
      console.error('Error publicando en canal chess_hosts:', error)
      return false
    }
  }

  const unpublishFromChessHosts = async () => {
    if (!isConnected.value || !token.value) {
      return false
    }
    
    try {
      if (wsProxyClient.unpublish) {
        await wsProxyClient.unpublish('chess_hosts')
        console.log('Host retirado del canal chess_hosts')
      }
      return true
    } catch (error) {
      console.error('Error retirando del canal chess_hosts:', error)
      return false
    }
  }

  const listPublicHosts = async () => {
    if (!isConnected.value) {
      console.error('No conectado para listar hosts públicos')
      return []
    }
    
    try {
      const hosts = await wsProxyClient.listChannel('chess_hosts')
      // Los hosts son tokens (4 caracteres) en el canal
      setPublicHosts(hosts)
      updateLastPublicHostsUpdate()
      return hosts
    } catch (error) {
      console.error('Error listando hosts públicos:', error)
      return []
    }
  }

  const subscribeToHost = async (hostToken) => {
    if (!isConnected.value || !token.value) {
      console.error('No conectado o sin token para suscribirse a host')
      return false
    }
    
    if (hostToken === token.value) {
      console.error('No puedes suscribirte a ti mismo')
      return false
    }
    
    // Setear el host directamente — el playerGameStore se encarga de
    // enviar REQUEST_FULL_STATE como primer mensaje
    setSubscribedHost(hostToken)
    
    console.log(`[Guest] Suscrito al host ${hostToken}. Solicitando estado completo...`)
    return true
  }

  const unsubscribe = async () => {
    if (!isConnected.value || !subscribedHost.value) {
      return false
    }
    
    try {
      await wsProxyClient.disconnectFrom(subscribedHost.value)
      subscribedHost.value = null
      return true
    } catch (error) {
      console.error('Error desuscribiéndose:', error)
      return false
    }
  }

  const sendMessage = async (toToken, message) => {
    if (!isConnected.value || !token.value) {
      console.error('No conectado o sin token para enviar mensaje')
      return false
    }
    
    try {
      await wsProxyClient.send(toToken, message)
      return true
    } catch (error) {
      console.error('Error enviando mensaje:', error)
      return false
    }
  }

  const broadcastToSubscribers = (message) => {
    if (!isConnected.value || !token.value || subscribers.value.length === 0) {
      return
    }
    // wsProxyClient.send es síncrono (lib v0.1.1+); sin .catch
    for (const subscriberToken of subscribers.value) {
      try {
        wsProxyClient.send(subscriberToken, message)
      } catch (error) {
        console.error(`Error enviando a subscriber ${subscriberToken}:`, error)
      }
    }
  }

  // Configurar handlers de eventos del proxy (solo se ejecuta una vez)
  const setupProxyEventHandlers = () => {
    if (handlersSetup) return
    handlersSetup = true
    
    // Token asignado al conectar
    wsProxyClient.on('token', (assignedToken) => {
      console.log('Token asignado por proxy:', assignedToken)
      token.value = assignedToken
    })
    
    // Conexión establecida
    wsProxyClient.on('connect', () => {
      console.log('Conectado al proxy WebSocket')
      setConnected(true)
      clearError()
    })
    
    // Desconexión
    wsProxyClient.on('disconnect', (data) => {
      console.log('Desconectado del proxy:', data)
      setConnected(false)
      token.value = null
      
      if (data.code !== 1000) {
        setError(`Desconexión inesperada: ${data.reason || 'Código ' + data.code}`)
      }
    })
    
    // Error de conexión
    wsProxyClient.on('error', (errorData) => {
      console.error('Error del proxy:', errorData)
      setError(`Error WebSocket: ${errorData.error || 'Desconocido'}`)
    })
    
    // Mensaje recibido — interceptar protocolo de identidad/reputación
    wsProxyClient.on('message', async (fromToken, message, timestamp, parsedMessage) => {
      // Mensajes JSON puros (no del protocolo TYPE|payload) los ignoramos aquí
      if (typeof message !== 'string') return
      const { type, payload } = parseProxyMessage(message)
      if (!type) return
      switch (type) {
        case 'IDENTIFY_CHALLENGE': await handleIdentifyChallenge(fromToken, payload); break
        case 'IDENTIFY_RESPONSE': await handleIdentifyResponse(fromToken, payload); break
        case 'RATING_QUERY': await handleRatingQuery(fromToken, payload); break
        case 'RATING_REPLY': await handleRatingReply(fromToken, payload); break
        // Otros tipos los manejan game stores
      }
    })
    
    // (channel_updated ya no se emite: list() devuelve los tokens directamente.
    //  El estado de publicHosts se mantiene vía joined/left/peer_disconnected.)

    // Notificación en tiempo real: alguien publicó en el canal
    wsProxyClient.on('channel_joined', (channel, joinedToken) => {
      if (channel !== 'chess_hosts') return
      if (joinedToken === token.value) return
      if (!publicHosts.value.includes(joinedToken)) {
        publicHosts.value = [...publicHosts.value, joinedToken]
        updateLastPublicHostsUpdate()
      }
    })

    // Notificación en tiempo real: alguien se despublicó del canal
    wsProxyClient.on('channel_left', (channel, leftToken) => {
      if (channel !== 'chess_hosts') return
      if (publicHosts.value.includes(leftToken)) {
        publicHosts.value = publicHosts.value.filter(t => t !== leftToken)
        updateLastPublicHostsUpdate()
      }
    })

    // Peer desconectado: si era host público, quitarlo del lobby
    wsProxyClient.on('peer_disconnected', (peerToken) => {
      if (publicHosts.value.includes(peerToken)) {
        publicHosts.value = publicHosts.value.filter(t => t !== peerToken)
        updateLastPublicHostsUpdate()
      }
      peerIdentities.value.delete(peerToken)
    })
  }

  // ---- Identity handshake ------------------------------------------------

  const challengePeer = async (peerToken) => {
    const id = await getIdentity()
    if (!id || !peerToken || peerToken === token.value) return
    try {
      const { nonce } = await id.makeChallenge()
      await wsProxyClient.send([peerToken], formatProxyMessage('IDENTIFY_CHALLENGE', { nonce }))
    } catch (e) { console.warn('challengePeer failed:', e) }
  }

  const handleIdentifyChallenge = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.nonce) return
    try {
      const response = await id.signChallenge(payload.nonce)
      // Anunciar también el nickname propio (no firmado: es el reclamo del peer
      // sobre cómo le gustaría ser visto, sirve como fallback de UI).
      const enriched = { ...response, nickname: myNickname.value || null }
      await wsProxyClient.send([fromToken], formatProxyMessage('IDENTIFY_RESPONSE', enriched))
    } catch (e) { console.warn('signChallenge failed:', e) }
  }

  const handleIdentifyResponse = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.publickey) return
    try {
      const result = await id.verifyResponse(payload)
      if (!result.ok) return
      const announcedNickname = typeof payload.nickname === 'string' && payload.nickname.trim()
        ? payload.nickname.trim().slice(0, 40)
        : null
      peerIdentities.value.set(fromToken, {
        pubkey: result.publickey,
        peer: result.peer || null,
        announcedNickname
      })
      peerIdentities.value = new Map(peerIdentities.value)
      requestRatingsForSubject(result.publickey, fromToken)
    } catch (e) { console.warn('verifyResponse failed:', e) }
  }

  const requestRatingsForSubject = (subjectPubkey, excludeToken) => {
    if (!subjectPubkey) return
    const targets = []
    for (const [t, info] of peerIdentities.value) {
      if (t === excludeToken) continue
      if (!info.pubkey) continue
      targets.push(t)
    }
    if (targets.length === 0) return
    const queryId = crypto.randomUUID()
    try { wsProxyClient.send(targets, formatProxyMessage('RATING_QUERY', { queryId, subject: subjectPubkey })) } catch (_) {}
  }

  const handleRatingQuery = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.subject) return
    const askerPubkey = peerIdentities.value.get(fromToken)?.pubkey || null
    try {
      if (askerPubkey) await id.recordQuery(askerPubkey, payload.subject)
      const { mine, endorsements } = await id.getRatingsForSubject(payload.subject)
      await wsProxyClient.send([fromToken], formatProxyMessage('RATING_REPLY', {
        queryId: payload.queryId, subject: payload.subject, mine, endorsements
      }))
    } catch (e) { console.warn('handleRatingQuery failed:', e) }
  }

  const handleRatingReply = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.subject || !Array.isArray(payload?.endorsements)) return
    const askerPubkey = peerIdentities.value.get(fromToken)?.pubkey || null
    try {
      const all = []
      if (payload.mine && payload.mine.subject === payload.subject) all.push(payload.mine)
      for (const e of payload.endorsements) if (e && e.subject === payload.subject) all.push(e)
      if (all.length === 0) return
      await id.mergeEndorsements(payload.subject, all, askerPubkey)
      // Refrescar el peer afectado en la cache, conservando announcedNickname
      const peer = await id.getPeer(payload.subject)
      for (const [t, info] of peerIdentities.value) {
        if (info.pubkey === payload.subject) {
          peerIdentities.value.set(t, {
            pubkey: info.pubkey,
            peer,
            announcedNickname: info.announcedNickname || null
          })
        }
      }
      peerIdentities.value = new Map(peerIdentities.value)
    } catch (e) { console.warn('handleRatingReply failed:', e) }
  }

  /** Refrescar mi pubkey y el trustMap. Llamar al iniciar y tras cambiar ratings. */
  const refreshIdentity = async () => {
    const id = await getIdentity()
    if (!id) return
    myPubkey.value = id.me?.publickey || null
    if (id.me?.nickname) myNickname.value = id.me.nickname
    try {
      const all = await id.listPeers()
      const next = new Map()
      for (const p of all) {
        const r = p?.myRating?.rating
        if (typeof r === 'number' && r > 0) next.set(p.publickey, r)
      }
      trustMap.value = next
    } catch (_) {}
  }

  /** Calificar a un peer por pubkey y refrescar trust map. */
  const ratePeer = async (pubkey, rating, notes) => {
    const id = await getIdentity()
    if (!id) throw new Error('Identity vault not available')
    const updated = await id.setRating(pubkey, rating, notes)
    // Promote rated peer to the shared contact book (id.closer.click ≥ 0.6.0)
    // so they show up in the messenger / other apps as a known contact.
    try {
      const info = [...peerIdentities.value.values()].find(p => p.pubkey === pubkey)
      const nick = info?.peer?.nickname || info?.announcedNickname || undefined
      const enc  = info?.peer?.encryptionPubkey || undefined
      const tk   = [...peerIdentities.value.entries()].find(([_, p]) => p.pubkey === pubkey)?.[0]
      await id.addContact({ publickey: pubkey, nickname: nick, encryptionPubkey: enc, lastToken: tk })
    } catch (_) {}
    for (const [t, info] of peerIdentities.value) {
      if (info.pubkey === pubkey) {
        peerIdentities.value.set(t, {
          pubkey,
          peer: updated,
          announcedNickname: info.announcedNickname || null
        })
      }
    }
    peerIdentities.value = new Map(peerIdentities.value)
    await refreshIdentity()
    return updated
  }

  const setPeerNickname = async (pubkey, nickname) => {
    const id = await getIdentity()
    if (!id) throw new Error('Identity vault not available')
    const updated = await id.setNickname(pubkey, nickname)
    for (const [t, info] of peerIdentities.value) {
      if (info.pubkey === pubkey) {
        peerIdentities.value.set(t, {
          pubkey,
          peer: updated,
          announcedNickname: info.announcedNickname || null
        })
      }
    }
    peerIdentities.value = new Map(peerIdentities.value)
    return updated
  }

  const setMyNickname = async (nickname) => {
    const v = (nickname || '').trim().slice(0, 20)
    myNickname.value = v
    localStorage.setItem('chess_nickname', v)
    const id = await getIdentity()
    if (id) {
      try { await id.setMyNickname(v) } catch (_) {}
    }
  }

  // Inicializar cargando estado mínimo (solo modo/visibilidad si existen)
  const loadSavedState = () => {
    const savedMode = localStorage.getItem('chess_mode')
    const savedVisibility = localStorage.getItem('chess_visibility')
    
    if (savedMode) mode.value = savedMode
    if (savedVisibility) visibility.value = savedVisibility
  }

  // Inicializar
  loadSavedState()

  return {
    // Estado
    token,
    shortToken,
    isConnected,
    connectionError,
    wsUrl,
    
    // Nuevo estado para protocolo de lobby
    mode,
    visibility,
    publicHosts,
    subscribedHost,
    subscribers,
    lastPublicHostsUpdate,

    // Identidad / web of trust
    peerIdentities,
    trustMap,
    myPubkey,
    myNickname,
    refreshIdentity,
    ratePeer,
    setPeerNickname,
    setMyNickname,
    
    // Getters
    connectionStatus,
    hasToken,
    canPlay,
    
    // Nuevos getters para protocolo de lobby
    isHost,
    isGuest,
    isPublicHost,
    hasSubscribers,
    subscribersCount,
    isSubscribed,
    
    // Acciones básicas
    setToken,
    setConnected,
    setError,
    clearError,
    reset,
    loadSavedState,
    
    // Acciones de conexión proxy
    connect,
    disconnect,
    
    // Acciones de lobby con proxy
    setMode,
    setPublicHosts,
    setSubscribedHost,
    addSubscriber,
    removeSubscriber,
    clearSubscribers,
    updateLastPublicHostsUpdate,
    publishToChessHosts,
    unpublishFromChessHosts,
    listPublicHosts,
    subscribeToHost,
    unsubscribe,
    
    // Acciones de mensajería
    sendMessage,
    broadcastToSubscribers,
    
    // Referencia al cliente proxy (para uso avanzado)
    wsProxyClient: () => wsProxyClient
  }
})