// i18n del ajedrez: bilingüe es/en. El español es neutro / de Ecuador (TUTEO,
// nunca voseo). Detección automática + selector persistido.
import { ref, computed } from 'vue'

const messages = {
  es: {
    brand: 'Ajedrez',
    lobby: 'Lobby',
    identity: 'Tu identidad',
    noName: 'sin nombre',
    // nickname gate
    nickTitle: 'Elige tu nombre',
    nickSub: 'Así te ven los demás en la mesa. Puedes cambiarlo cuando quieras — tu identidad real es tu clave criptográfica.',
    nickPlaceholder: 'ej. magnus_2026',
    nickEnter: 'Entrar →',
    // lobby create
    playTitle: 'Juega una partida',
    playSub: 'Crea una mesa y compártela, o únete a una pública.',
    public: 'Pública',
    private: 'Privada',
    createGame: 'Crear partida →',
    codePlaceholder: '¿Tienes un código de mesa? Pégalo aquí',
    join: 'Unirse',
    watch: 'Mirar',
    // lobby list
    publicTables: 'Mesas públicas',
    openOnly: 'Solo con lugar',
    online: 'En línea',
    connecting: 'Conectando…',
    emptyOpen: 'No hay mesas con lugar ahora.',
    emptyAll: 'No hay mesas públicas todavía.',
    emptySub: 'Crea una y espera rival — aparecerá aquí para todos.',
    host: 'Anfitrión',
    yourContact: 'Tu contacto',
    friend: 'amigo',
    newPlayer: 'jugador nuevo',
    reputation: 'reputación',
    seatsFree: (n) => `${n} lugar${n > 1 ? 'es' : ''} libre${n > 1 ? 's' : ''}`,
    full: 'Completa',
    errJoin: 'No se pudo unir a la mesa.',
    errCode: 'Código de mesa inválido.',
    // game
    white: 'Blancas',
    black: 'Negras',
    toMove: (c) => `Mueven ${c}`,
    yourTurn: '· tu turno',
    win: (c) => `Ganan las ${c} 🏆`,
    moves: 'Movimientos',
    noMoves: 'Sin movimientos aún',
    status: {
      waiting: 'Esperando jugadores', playing: 'En juego', check: '¡Jaque!',
      checkmate: 'Jaque mate', stalemate: 'Tablas (ahogado)', paused: 'En pausa', finished: 'Partida terminada'
    }
  },
  en: {
    brand: 'Chess',
    lobby: 'Lobby',
    identity: 'Your identity',
    noName: 'no name',
    nickTitle: 'Choose your name',
    nickSub: "This is how others see you at the table. You can change it anytime — your real identity is your cryptographic key.",
    nickPlaceholder: 'e.g. magnus_2026',
    nickEnter: 'Enter →',
    playTitle: 'Play a game',
    playSub: 'Create a table and share it, or join a public one.',
    public: 'Public',
    private: 'Private',
    createGame: 'Create game →',
    codePlaceholder: 'Have a table code? Paste it here',
    join: 'Join',
    watch: 'Watch',
    publicTables: 'Public tables',
    openOnly: 'Open seats only',
    online: 'Online',
    connecting: 'Connecting…',
    emptyOpen: 'No open tables right now.',
    emptyAll: 'No public tables yet.',
    emptySub: "Create one and wait for an opponent — it'll show here for everyone.",
    host: 'Host',
    yourContact: 'Your contact',
    friend: 'friend',
    newPlayer: 'new player',
    reputation: 'reputation',
    seatsFree: (n) => `${n} open seat${n > 1 ? 's' : ''}`,
    full: 'Full',
    errJoin: "Couldn't join the table.",
    errCode: 'Invalid table code.',
    white: 'White',
    black: 'Black',
    toMove: (c) => `${c} to move`,
    yourTurn: '· your turn',
    win: (c) => `${c} win 🏆`,
    moves: 'Moves',
    noMoves: 'No moves yet',
    status: {
      waiting: 'Waiting for players', playing: 'Playing', check: 'Check!',
      checkmate: 'Checkmate', stalemate: 'Stalemate', paused: 'Paused', finished: 'Game over'
    }
  }
}

function detect () {
  const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('chess_lang')) || ''
  if (saved === 'es' || saved === 'en') return saved
  const nav = (typeof navigator !== 'undefined' && (navigator.language || '')).toLowerCase()
  return nav.startsWith('es') ? 'es' : 'en'
}

export const lang = ref(detect())
export const t = computed(() => messages[lang.value] || messages.es)
export function setLang (l) {
  lang.value = (l === 'en') ? 'en' : 'es'
  try { localStorage.setItem('chess_lang', lang.value) } catch (_) {}
}
export function toggleLang () { setLang(lang.value === 'es' ? 'en' : 'es') }
