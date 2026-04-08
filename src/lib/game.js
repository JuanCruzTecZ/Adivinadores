export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;
export const WORDS_PER_PLAYER = 5;

export const TEAM_COLORS = ["#ff6b2c", "#17b6b0", "#ffd166", "#a78bfa"];

export const STAGES = [
  {
    title: "1ra etapa",
    shortTitle: "Etapa 1",
    durationMs: 60_000,
    cue: "Describir",
    description: "Se puede hablar y describir, pero sin decir la palabra, sin señas, sin onomatopeyas y sin colgarse con “ehhh”.",
  },
  {
    title: "2da etapa",
    shortTitle: "Etapa 2",
    durationMs: 90_000,
    cue: "Mimica",
    description: "Solo vale actuar con mímicas. No se puede hablar ni hacer sonidos.",
  },
  {
    title: "3ra etapa",
    shortTitle: "Etapa 3",
    durationMs: 60_000,
    cue: "Una palabra",
    description: "Solo se puede decir una sola palabra para ayudar al equipo a adivinar.",
  },
];

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

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function ensureTurnCollections(turn) {
  if (!turn) return;
  turn.correctWordIds = normalizeList(turn.correctWordIds);
  turn.passedWordIds = normalizeList(turn.passedWordIds);
}

function ensureGameCollections(game) {
  if (!game) return;
  game.wordsMaster = normalizeList(game.wordsMaster);
  game.currentDeck = normalizeList(game.currentDeck);
  game.completedTurns = normalizeList(game.completedTurns);
  if (game.turn) ensureTurnCollections(game.turn);
}

function createTeam(teamId, index) {
  return {
    id: teamId,
    name: `Equipo ${index + 1}`,
    color: TEAM_COLORS[index],
    playerIds: [],
    readerCursor: 0,
    deviceClientId: "",
  };
}

function createScores(teamOrder) {
  return Object.fromEntries(
    teamOrder.map((teamId) => [
      teamId,
      {
        stagePoints: [0, 0, 0],
        total: 0,
      },
    ]),
  );
}

function updateScore(room, teamId, stageIndex, delta = 1) {
  room.game.scores[teamId] ||= { stagePoints: [0, 0, 0], total: 0 };
  room.game.scores[teamId].stagePoints[stageIndex] += delta;
  room.game.scores[teamId].total += delta;
}

export function createRoom(code, hostClientId) {
  const teamOrder = ["team-1", "team-2"];
  const teams = Object.fromEntries(teamOrder.map((teamId, index) => [teamId, createTeam(teamId, index)]));

  return {
    code,
    createdAt: Date.now(),
    hostClientId,
    status: "lobby",
    teamOrder,
    teams,
    players: {},
    words: {},
    clients: {},
    activity: {
      title: "Sala creada",
      body: "Configurá equipos, jugadores y después pasamos a la carga privada de palabras.",
    },
    game: null,
  };
}

export function getTeams(room) {
  return (room?.teamOrder || []).map((teamId) => room.teams?.[teamId]).filter(Boolean);
}

export function getPlayers(room) {
  return Object.values(room?.players || {});
}

export function getTeamPlayers(room, teamId) {
  const playerIds = room?.teams?.[teamId]?.playerIds || [];
  return playerIds.map((playerId) => room.players?.[playerId]).filter(Boolean);
}

export function getPendingPlayerForTeam(room, teamId) {
  return getTeamPlayers(room, teamId).find((player) => !Array.isArray(player.words) || player.words.length !== WORDS_PER_PLAYER) || null;
}

export function isSetupReady(room) {
  const teams = getTeams(room);
  if (teams.length < MIN_TEAMS || teams.length > MAX_TEAMS) return false;
  return teams.every((team) => sanitizeText(team.name, 24) && getTeamPlayers(room, team.id).length > 0);
}

export function isCollectionComplete(room) {
  const players = getPlayers(room);
  if (!players.length) return false;
  return players.every((player) => Array.isArray(player.words) && player.words.length === WORDS_PER_PLAYER);
}

export function setTeamCount(room, nextCount) {
  const count = Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, Number(nextCount) || MIN_TEAMS));
  const currentCount = room.teamOrder.length;

  if (count < currentCount) {
    const removedIds = room.teamOrder.slice(count);
    const blocked = removedIds.some((teamId) => (room.teams?.[teamId]?.playerIds || []).length > 0);
    if (blocked) {
      return {
        ok: false,
        message: "Primero vaciá los equipos que querés eliminar.",
      };
    }

    removedIds.forEach((teamId) => {
      delete room.teams[teamId];
    });
    room.teamOrder = room.teamOrder.slice(0, count);
  }

  if (count > currentCount) {
    for (let index = currentCount; index < count; index += 1) {
      const teamId = `team-${index + 1}`;
      room.teamOrder.push(teamId);
      room.teams[teamId] = createTeam(teamId, index);
    }
  }

  room.activity = {
    title: "Equipos actualizados",
    body: `La sala quedó configurada para ${count} equipos.`,
  };

  return { ok: true };
}

export function renameTeam(room, teamId, value) {
  if (!room.teams?.[teamId]) return false;
  const name = sanitizeText(value, 24);
  if (!name) return false;
  room.teams[teamId].name = name;
  return true;
}

export function addPlayer(room, teamId, value) {
  room.teams ||= {};
  room.players ||= {};

  const team = room.teams?.[teamId];
  if (!team) return null;
  team.playerIds ||= [];

  const name = sanitizeText(value, 24);
  if (!name) return null;

  const playerId = uid("player");
  room.players[playerId] = {
    id: playerId,
    teamId,
    name,
    words: [],
    createdAt: Date.now(),
    submittedAt: null,
  };
  team.playerIds.push(playerId);
  return playerId;
}

export function renamePlayer(room, playerId, value) {
  const player = room.players?.[playerId];
  if (!player) return false;
  const name = sanitizeText(value, 24);
  if (!name) return false;
  player.name = name;
  return true;
}

export function removePlayer(room, playerId) {
  const player = room.players?.[playerId];
  if (!player) return false;

  room.teams?.[player.teamId] && (room.teams[player.teamId].playerIds = room.teams[player.teamId].playerIds.filter((id) => id !== playerId));
  delete room.players[playerId];
  return true;
}

export function savePlayerWords(room, playerId, values) {
  const player = room.players?.[playerId];
  if (!player) return { ok: false, message: "Jugador inexistente." };

  const words = values.map((value) => sanitizeText(value, 28)).filter(Boolean);
  if (words.length !== WORDS_PER_PLAYER) {
    return { ok: false, message: `Cada jugador debe guardar exactamente ${WORDS_PER_PLAYER} palabras.` };
  }

  player.words = words;
  player.submittedAt = Date.now();
  return { ok: true };
}

function buildMasterWords(room) {
  const words = {};
  const masterOrder = [];

  room.teamOrder.forEach((teamId) => {
    getTeamPlayers(room, teamId).forEach((player) => {
      player.words.forEach((text, index) => {
        const wordId = uid("word");
        words[wordId] = {
          id: wordId,
          text,
          order: index,
          teamId,
          playerId: player.id,
          teamName: room.teams?.[teamId]?.name || "",
          playerName: player.name,
        };
        masterOrder.push(wordId);
      });
    });
  });

  room.words = words;
  return masterOrder;
}

function createTurn(room, turnIndex, stageIndex) {
  const teamId = room.teamOrder[turnIndex % room.teamOrder.length];
  const playerIds = room.teams?.[teamId]?.playerIds?.filter((playerId) => room.players?.[playerId]) || [];
  const readerPlayerId = playerIds[(room.teams?.[teamId]?.readerCursor || 0) % playerIds.length];

  return {
    id: uid("turn"),
    teamId,
    readerPlayerId,
    status: "waiting",
    durationMs: STAGES[stageIndex].durationMs,
    stageIndex,
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    correctWordIds: [],
    passedWordIds: [],
    foulRequest: null,
    endedReason: "",
  };
}

function advanceCurrentWordForNextTurn(room) {
  ensureGameCollections(room.game);
  if (!Array.isArray(room.game?.currentDeck) || room.game.currentDeck.length <= 1) return;

  const [currentWordId, ...rest] = room.game.currentDeck;
  room.game.currentDeck = [...rest, currentWordId];
  room.game.currentWordId = room.game.currentDeck[0] || null;
}

function completeTurn(room, reason) {
  const turn = room.game?.turn;
  if (!turn) return false;
  ensureGameCollections(room.game);
  ensureTurnCollections(turn);

  room.game.completedTurns ||= [];
  room.game.completedTurns.push({
    id: turn.id,
    teamId: turn.teamId,
    readerPlayerId: turn.readerPlayerId,
    stageIndex: turn.stageIndex,
    correctCount: turn.correctWordIds.length,
    endedReason: reason,
    endedAt: Date.now(),
  });

  if (room.teams?.[turn.teamId]) {
    room.teams[turn.teamId].readerCursor += 1;
  }

  const nextTurnIndex = room.game.turnIndex + 1;

  if (room.game.currentDeck.length === 0) {
    const nextStageIndex = room.game.stageIndex + 1;

    if (nextStageIndex >= STAGES.length) {
      room.status = "finished";
      room.game.turn = null;
      room.game.turnIndex = nextTurnIndex;
      room.game.stageTransition = null;
      room.activity = {
        title: "Partida terminada",
        body: "Las tres etapas se completaron. Ya pueden ver el podio final.",
      };
      return true;
    }

    room.game.stageIndex = nextStageIndex;
    room.game.currentDeck = shuffle(room.game.wordsMaster);
    room.game.currentWordId = room.game.currentDeck[0] || null;
    room.game.turnIndex = nextTurnIndex;
    room.game.turn = createTurn(room, nextTurnIndex, nextStageIndex);
    room.game.stageTransition = {
      id: uid("stage"),
      stageIndex: nextStageIndex,
      teamId: room.game.turn.teamId,
      readerPlayerId: room.game.turn.readerPlayerId,
      title: STAGES[nextStageIndex].title,
      cue: STAGES[nextStageIndex].cue,
      durationMs: STAGES[nextStageIndex].durationMs,
      description: STAGES[nextStageIndex].description,
    };
    room.activity = {
      title: `${STAGES[nextStageIndex].title} lista`,
      body: `${room.teams?.[room.game.turn.teamId]?.name || "Siguiente equipo"} abre la nueva etapa.`,
    };
    return true;
  }

  advanceCurrentWordForNextTurn(room);
  room.game.turnIndex = nextTurnIndex;
  room.game.turn = createTurn(room, nextTurnIndex, room.game.stageIndex);
  room.game.stageTransition = null;
  room.activity = {
    title: "Turno resuelto",
    body: `${room.teams?.[room.game.turn.teamId]?.name || "Siguiente equipo"} queda listo para jugar.`,
  };
  return true;
}

function removeCurrentWordFromDeck(room) {
  const currentWordId = room.game?.currentWordId;
  if (!currentWordId) return null;
  ensureGameCollections(room.game);

  const nextDeck = [...room.game.currentDeck];
  const index = nextDeck.indexOf(currentWordId);
  if (index >= 0) {
    nextDeck.splice(index, 1);
  }
  room.game.currentDeck = nextDeck;
  room.game.currentWordId = nextDeck[0] || null;
  return currentWordId;
}

export function beginGame(room) {
  if (!isCollectionComplete(room)) {
    return { ok: false, message: "Todavía faltan palabras por cargar." };
  }

  const masterWords = buildMasterWords(room);
  if (!masterWords.length) {
    return { ok: false, message: "No hay palabras cargadas para empezar." };
  }

  room.status = "playing";
  room.game = {
    stageIndex: 0,
    turnIndex: 0,
    wordsMaster: masterWords,
    currentDeck: shuffle(masterWords),
    currentWordId: null,
    turn: null,
    completedTurns: [],
    scores: createScores(room.teamOrder),
    stageTransition: null,
  };
  room.game.currentWordId = room.game.currentDeck[0] || null;
  room.game.turn = createTurn(room, 0, 0);
  room.activity = {
    title: "Juego iniciado",
    body: `${room.teams?.[room.game.turn.teamId]?.name || "Equipo inicial"} abre la ${STAGES[0].title.toLowerCase()}.`,
  };
  return { ok: true };
}

export function startTurn(room) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "waiting" || room.game?.stageTransition) return false;
  ensureGameCollections(room.game);
  ensureTurnCollections(turn);

  turn.status = "running";
  turn.startedAt = Date.now();
  turn.pausedAt = null;
  turn.pausedTotalMs = 0;
  room.activity = {
    title: "Cronómetro en marcha",
    body: `${room.teams?.[turn.teamId]?.name || "Equipo"} ya está jugando.`,
  };
  return true;
}

export function getTurnRemainingMs(turn, now = Date.now()) {
  if (!turn?.startedAt) return turn?.durationMs || 0;
  const elapsedUntil = turn.status === "paused" && turn.pausedAt ? turn.pausedAt : now;
  const elapsed = elapsedUntil - turn.startedAt - (turn.pausedTotalMs || 0);
  return Math.max(0, turn.durationMs - elapsed);
}

export function markCurrentWordCorrect(room) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "running" || !room.game.currentWordId) return false;
  ensureGameCollections(room.game);
  ensureTurnCollections(turn);

  const resolvedWordId = removeCurrentWordFromDeck(room);
  if (!resolvedWordId) return false;

  turn.correctWordIds.push(resolvedWordId);
  updateScore(room, turn.teamId, room.game.stageIndex, 1);

  if (room.game.currentDeck.length === 0) {
    room.activity = {
      title: "Etapa vaciada",
      body: `${room.teams?.[turn.teamId]?.name || "El equipo"} limpió la última palabra disponible.`,
    };
    return completeTurn(room, "deck-cleared");
  }

  return true;
}

export function passCurrentWord(room) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "running" || !room.game.currentWordId) return false;
  ensureGameCollections(room.game);
  ensureTurnCollections(turn);

  const [currentWordId, ...rest] = room.game.currentDeck;
  room.game.currentDeck = [...rest, currentWordId];
  room.game.currentWordId = room.game.currentDeck[0] || null;
  turn.passedWordIds.push(currentWordId);
  return true;
}

export function requestFoul(room, clientId) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "running" || turn.foulRequest) return false;
  ensureGameCollections(room.game);
  ensureTurnCollections(turn);

  turn.status = "paused";
  turn.pausedAt = Date.now();
  turn.foulRequest = {
    id: uid("foul"),
    requestedByClientId: clientId,
    createdAt: Date.now(),
  };
  room.activity = {
    title: "Falta solicitada",
    body: "El cronómetro quedó pausado hasta que el equipo lector confirme o rechace la falta.",
  };
  return true;
}

export function rejectFoul(room) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "paused" || !turn.foulRequest || !turn.pausedAt) return false;
  ensureGameCollections(room.game);
  ensureTurnCollections(turn);

  turn.pausedTotalMs += Date.now() - turn.pausedAt;
  turn.pausedAt = null;
  turn.foulRequest = null;
  turn.status = "running";
  room.activity = {
    title: "Falta rechazada",
    body: "El turno sigue corriendo y la palabra vuelve a estar activa.",
  };
  return true;
}

export function confirmFoul(room) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "paused" || !turn.foulRequest) return false;
  ensureGameCollections(room.game);
  ensureTurnCollections(turn);
  return completeTurn(room, "confirmed-foul");
}

export function finishTurnByTimeout(room) {
  const turn = room.game?.turn;
  if (!turn || turn.status !== "running") return false;
  ensureGameCollections(room.game);
  ensureTurnCollections(turn);
  room.activity = {
    title: "Tiempo cumplido",
    body: "Se terminó el cronómetro y el turno pasa al siguiente equipo.",
  };
  return completeTurn(room, "timeout");
}

export function dismissStageTransition(room) {
  if (!room.game?.stageTransition) return false;
  room.game.stageTransition = null;
  room.activity = {
    title: "Nueva etapa confirmada",
    body: `${room.teams?.[room.game.turn?.teamId]?.name || "El siguiente equipo"} ya puede iniciar su turno.`,
  };
  return true;
}

export function resetRoomForReplay(room) {
  getPlayers(room).forEach((player) => {
    player.words = [];
    player.submittedAt = null;
  });

  getTeams(room).forEach((team) => {
    team.readerCursor = 0;
  });

  room.words = {};
  room.game = null;
  room.status = "lobby";
  room.activity = {
    title: "Listo para volver a jugar",
    body: "Se conservaron equipos y jugadores. Ahora pueden revisar la configuracion y volver a cargar palabras.",
  };
  return true;
}

export function buildWordsExport(room) {
  const teams = getTeams(room).map((team) => ({
    id: team.id,
    name: team.name,
    players: getTeamPlayers(room, team.id).map((player) => ({
      id: player.id,
      name: player.name,
      words: Array.isArray(player.words) ? [...player.words] : [],
    })),
  }));

  return {
    exportedAt: new Date().toISOString(),
    roomCode: room?.code || "",
    teams,
    allWords: teams.flatMap((team) =>
      team.players.flatMap((player) =>
        player.words.map((word) => ({
          word,
          teamId: team.id,
          teamName: team.name,
          playerId: player.id,
          playerName: player.name,
        })),
      ),
    ),
  };
}

export function getLeaderboard(room) {
  return getTeams(room)
    .map((team) => ({
      ...team,
      score: room?.game?.scores?.[team.id] || { stagePoints: [0, 0, 0], total: 0 },
    }))
    .sort((left, right) => right.score.total - left.score.total);
}

export function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
