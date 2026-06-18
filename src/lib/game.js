import peliculasData from "../peliculas.json";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 20;
export const DEFAULT_ROUNDS = 3;
export const TURN_DURATION_MS = 60_000;

const WORDS_DATABASE = Array.isArray(peliculasData?.peliculas) ? peliculasData.peliculas : [];

export function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function randomRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function sanitizeText(value, maxLength = 28) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

export function shuffle(list) {
  const clone = [...list];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function normalizeWord(word) {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getLevenshteinDistance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

export function createRoom(code, hostClientId) {
  return {
    code,
    createdAt: Date.now(),
    hostClientId,
    status: "lobby",
    maxRounds: DEFAULT_ROUNDS,
    players: {},
    clients: {},
    playerOrder: [],
    activity: {
      title: "Sala creada",
      body: "Esperando a que los jugadores se unan con el código.",
    },
    game: null,
  };
}

export function getPlayers(room) {
  return Object.values(room?.players || {});
}

export function isSetupReady(room) {
  const players = getPlayers(room);
  return players.length >= MIN_PLAYERS && players.length <= MAX_PLAYERS;
}

export function addPlayer(room, value, clientId) {
  room.players ||= {};
  room.clients ||= {};
  const name = sanitizeText(value, 24);
  if (!name) return null;

  const playerId = uid("player");
  room.players[playerId] = {
    id: playerId,
    name,
    clientId,
    score: 0,
    lastTurnScore: 0,
    createdAt: Date.now(),
  };
  if (clientId) {
    room.clients[clientId] = playerId;
  }
  return playerId;
}

export function resetRoomForReplay(room) {
  // Preserve players, reset scores and start from lobby
  room.status = "lobby";
  room.game = null;
  Object.values(room.players || {}).forEach((p) => {
    p.score = 0;
    p.lastTurnScore = 0;
  });
  room.activity = { title: "Sala reiniciada", body: "La sala está lista para jugar de nuevo." };
  room.createdAt = Date.now();
  return true;
}

export function removePlayer(room, playerId) {
  if (!room.players?.[playerId]) return false;
  delete room.players[playerId];
  return true;
}

function getRandomWords(count) {
  return shuffle([...WORDS_DATABASE]).slice(0, count);
}

function setupNextTurn(room) {
  const game = room.game;
  const activeMimeId = game.playerOrder[game.turnIndex % game.playerOrder.length];
  const roundNumber = Math.floor(game.turnIndex / game.playerOrder.length) + 1;

  game.turn = {
    id: uid("turn"),
    activeMimeId,
    roundNumber,
    status: "selecting",
    wordOptions: getRandomWords(3),
    targetWord: null,
    revealedIndices: [],
    startedAt: null,
    solvers: [],
    reports: [],
    chatLog: [],
  };

  getPlayers(room).forEach((p) => (p.lastTurnScore = 0));

  room.activity = {
    title: `Ronda ${roundNumber}`,
    body: `${room.players[activeMimeId]?.name} está eligiendo una palabra.`,
  };
}

export function beginGame(room) {
  if (!isSetupReady(room)) return { ok: false, message: "Jugadores insuficientes." };

  room.status = "playing";
  const playerIds = shuffle(Object.keys(room.players));
  
  room.game = {
    turnIndex: 0,
    playerOrder: playerIds,
    completedTurns: [],
    turn: null,
  };

  setupNextTurn(room);
  return { ok: true };
}

export function selectWordAndStart(room, word) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "selecting") return false;

  turn.targetWord = word.toUpperCase();
  turn.status = "running";
  turn.startedAt = Date.now();

  room.activity = {
    title: "Mímica en progreso",
    body: "¡Adivinen la palabra antes de que se acabe el tiempo!",
  };
  return true;
}

export function getTurnRemainingMs(turn, now = Date.now()) {
  if (!turn?.startedAt || turn.status !== "running") return TURN_DURATION_MS;
  const elapsed = now - turn.startedAt;
  return Math.max(0, TURN_DURATION_MS - elapsed);
}

export function processGuess(room, playerId, text) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "running" || playerId === turn.activeMimeId) return false;
  
  turn.solvers = turn.solvers || [];
  if (turn.solvers.includes(playerId)) return false;

  const guess = sanitizeText(text, 30);
  if (!guess) return false;

  const normalizedGuess = normalizeWord(guess);
  const normalizedTarget = normalizeWord(turn.targetWord);
  const player = room.players[playerId];

  turn.chatLog = turn.chatLog || [];

  if (normalizedGuess === normalizedTarget) {
    const position = turn.solvers.length;
    const remainingMs = getTurnRemainingMs(turn);
    const basePoints = Math.max(10, 60 - (position * 3));
    const timeModifier = Math.floor(remainingMs / 1000);
    const totalPoints = basePoints + timeModifier;

    player.score += totalPoints;
    player.lastTurnScore = totalPoints;
    turn.solvers.push(playerId);

    turn.chatLog.push({ id: uid("msg"), type: "correct", playerName: player.name });

    const totalAdivinadores = room.game.playerOrder.length - 1;
    if (turn.solvers.length >= totalAdivinadores) {
      completeTurn(room, "all-solved");
    }
    return true;
  }

  const distance = getLevenshteinDistance(normalizedGuess, normalizedTarget);
  const isClose = distance <= 2 && normalizedTarget.length > 4;

  turn.chatLog.push({
    id: uid("msg"),
    type: isClose ? "close" : "guess",
    playerName: player.name,
    text: isClose ? "¡Está muy cerca!" : guess,
  });

  if (turn.chatLog.length > 50) turn.chatLog.shift();
  return true;
}

export function reportMimo(room, playerId) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "running" || playerId === turn.activeMimeId) return false;
  
  turn.reports = turn.reports || [];
  if (turn.reports.includes(playerId)) return false;

  turn.reports.push(playerId);
  
  const totalAdivinadores = room.game.playerOrder.length - 1;
  const threshold = Math.ceil(totalAdivinadores / 2);

  if (turn.reports.length >= threshold) {
    completeTurn(room, "reported");
  }
  return true;
}

export function finishTurnByTimeout(room) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "running") return false;
  return completeTurn(room, "timeout");
}

function completeTurn(room, reason) {
  const game = room.game;
  const turn = game.turn;
  
  turn.solvers = turn.solvers || [];
  const mimoPlayer = room.players[turn.activeMimeId];

  if (reason !== "reported") {
    let mimoPoints = turn.solvers.length * 5;
    const totalAdivinadores = game.playerOrder.length - 1;
    if (turn.solvers.length === totalAdivinadores && totalAdivinadores > 0) {
      mimoPoints += 20;
    }
    mimoPlayer.score += mimoPoints;
    mimoPlayer.lastTurnScore = mimoPoints;
  }

  turn.status = "finished";
  turn.endedReason = reason;
  
  game.completedTurns = game.completedTurns || [];
  game.completedTurns.push({ ...turn });
  game.turnIndex += 1;

  const totalTurnsNeeded = game.playerOrder.length * room.maxRounds;
  if (game.turnIndex >= totalTurnsNeeded) {
    room.status = "finished";
    room.activity = { title: "Partida terminada", body: "Revisa el podio final." };
  } else {
    setupNextTurn(room);
  }
  return true;
}

export function getLeaderboard(room) {
  return getPlayers(room).sort((a, b) => b.score - a.score);
}