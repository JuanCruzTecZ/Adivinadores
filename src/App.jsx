import { useEffect, useMemo, useRef, useState } from "react";
import { get, onDisconnect, onValue, ref, remove, set } from "firebase/database";
import { db, firebaseInitError } from "./lib/firebase.js";
import {
  STAGES,
  addPlayer,
  beginGame,
  buildWordsExport,
  confirmFoul,
  createRoom,
  dismissStageTransition,
  finishTurnByTimeout,
  formatDuration,
  getLeaderboard,
  getPlayers,
  getPendingPlayerForTeam,
  getTeamPlayers,
  getTeams,
  getTurnRemainingMs,
  isCollectionComplete,
  isSetupReady,
  markCurrentWordCorrect,
  passCurrentWord,
  randomRoomCode,
  rejectFoul,
  removePlayer,
  renamePlayer,
  renameTeam,
  requestFoul,
  resetRoomForReplay,
  savePlayerWords,
  sanitizeText,
  setTeamCount,
  startTurn,
  uid,
} from "./lib/game.js";

const SESSION_KEY = "juego_3_rondas_session_v1";

function explainFirebaseError(error) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (message.includes("permission_denied")) {
    return "Firebase rechazó la escritura.";
  }

  if (message.includes("404") || message.includes("not found")) {
    return "La Realtime Database no parece estar disponible.";
  }

  if (message.includes("offline") || message.includes("network")) {
    return "No se pudo conectar con Firebase.";
  }

  return `Firebase devolvió este error: ${message || "desconocido"}`;
}

function cloneRoomState(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function loadSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.clientId) {
        return {
          clientId: parsed.clientId,
          roomId: parsed.roomId || "",
          teamId: parsed.teamId || "",
          mode: parsed.mode || "spectator",
        };
      }
    }
  } catch (error) {
    console.error(error);
  }

  return {
    clientId: uid("client"),
    roomId: "",
    teamId: "",
    mode: "spectator",
  };
}

function hasActiveClient(room, clientId) {
  if (!clientId) return false;
  return Boolean(room?.clients?.[clientId]);
}

function getLinkedDeviceClientId(room, teamId) {
  const clientId = room?.teams?.[teamId]?.deviceClientId || "";
  return hasActiveClient(room, clientId) ? clientId : "";
}

function getTeamProgress(room, teamId) {
  const players = getTeamPlayers(room, teamId);
  const submitted = players.filter((player) => Array.isArray(player.words) && player.words.length === 5).length;
  return {
    total: players.length,
    submitted,
  };
}

function Banner({ banner, onClose }) {
  if (!banner) return null;

  return (
    <div className={`banner banner-${banner.tone || "info"}`}>
      <span>{banner.text}</span>
      <button className="ghost-icon" onClick={onClose} type="button" aria-label="Cerrar aviso">
        ×
      </button>
    </div>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <p>Diseñado y creado por Juan Cruz Zenarruza</p>
    </footer>
  );
}

function RolePanel({ room, session, onClaimTeam, onSpectator }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Celulares</p>
          <h2>Vinculá este dispositivo</h2>
        </div>
      </div>

      <div className="role-grid">
        {getTeams(room).map((team) => {
          const linkedDeviceClientId = getLinkedDeviceClientId(room, team.id);
          const claimedByMe = linkedDeviceClientId === session.clientId;
          const claimedByOther = Boolean(linkedDeviceClientId && linkedDeviceClientId !== session.clientId);

          return (
            <article className="role-card" key={team.id}>
              <div className="role-chip" style={{ background: `${team.color}22`, color: team.color }}>
                {team.name}
              </div>
              <p>{claimedByMe ? "Este celular está vinculado a este equipo." : claimedByOther ? "Este equipo ya tiene un celular asignado." : "Libre para conectar."}</p>
              <button
                className={claimedByMe ? "secondary-btn" : "primary-btn"}
                onClick={() => onClaimTeam(team.id)}
                type="button"
                disabled={claimedByOther}
              >
                {claimedByMe ? "Celular conectado" : claimedByOther ? "Celular ya vinculado" : "asignar este celular al equipo"}
              </button>
            </article>
          );
        })}

        <article className="role-card role-card-muted">
          <div className="role-chip neutral-chip">Espectador</div>
          <p>Mira la partida en vivo, el cronómetro, los puntos y pedir FALTA! si corresponde.</p>
          <button className={session.mode === "spectator" ? "secondary-btn" : "ghost-btn"} onClick={onSpectator} type="button">
            Usar este celular como Espectador
          </button>
        </article>
      </div>
    </section>
  );
}

function LobbyTeamCard({
  room,
  session,
  team,
  isHost,
  teamName,
  playerDraft,
  playerNameDrafts,
  onTeamNameChange,
  onSaveTeamName,
  onPlayerDraftChange,
  onAddPlayer,
  onPlayerNameChange,
  onSavePlayerName,
  onRemovePlayer,
}) {
  const players = getTeamPlayers(room, team.id);
  const linkedDeviceClientId = getLinkedDeviceClientId(room, team.id);
  const claimedByMe = linkedDeviceClientId === session.clientId;
  const claimedByOther = Boolean(linkedDeviceClientId && linkedDeviceClientId !== session.clientId);

  return (
    <article className="team-card" style={{ "--team-accent": team.color }}>
      <div className="team-card-head">
        <div>
          <div className="team-dot" style={{ background: team.color }} />
          <p className="eyebrow">Equipo</p>
        </div>
      </div>

      {isHost ? (
        <div className="inline-form">
          <input
            type="text"
            maxLength="24"
            value={teamName}
            onChange={(event) => onTeamNameChange(team.id, event.target.value)}
            placeholder={`Nombre de ${team.name}`}
          />
          <button className="ghost-btn" onClick={() => onSaveTeamName(team.id)} type="button">
            Guardar
          </button>
        </div>
      ) : (
        <h3>{team.name}</h3>
      )}

      <div className="player-stack">
        {players.length ? (
          players.map((player) => (
            <div className="player-row" key={player.id}>
              {isHost ? (
                <>
                  <input
                    type="text"
                    maxLength="24"
                    value={playerNameDrafts[player.id] ?? player.name}
                    onChange={(event) => onPlayerNameChange(player.id, event.target.value)}
                    placeholder="Nombre del jugador"
                  />
                  <button className="ghost-btn" onClick={() => onSavePlayerName(player.id)} type="button">
                    Guardar
                  </button>
                  <button className="danger-btn" onClick={() => onRemovePlayer(player.id)} type="button">
                    Quitar
                  </button>
                </>
              ) : (
                <div className="player-pill">
                  <span>{player.name}</span>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="muted-copy">Todavía no hay jugadores en este equipo.</p>
        )}
      </div>

      {isHost ? (
        <div className="inline-form">
          <input
            id={`player-draft-${team.id}`}
            type="text"
            maxLength="24"
            value={playerDraft}
            onChange={(event) => onPlayerDraftChange(team.id, event.target.value)}
            placeholder="Agregar jugador"
          />
          <button className="primary-btn" onClick={() => onAddPlayer(team.id)} type="button">
            Agregar
          </button>
        </div>
      ) : null}

      <p className="team-meta">
        {claimedByMe ? "Este dispositivo está listo para jugar por este equipo." : claimedByOther ? "Otro dispositivo se conecto como celular del equipo." : "Este equipo todavía no tiene celular vinculado."}
      </p>
    </article>
  );
}

function Scoreboard({ room, compact = false }) {
  const leaderboard = getLeaderboard(room);

  return (
    <div className={compact ? "scoreboard compact-scoreboard" : "scoreboard"}>
      {leaderboard.map((team, index) => {
        const stagePoints = Array.isArray(team.score?.stagePoints) ? team.score.stagePoints : [0, 0, 0];
        const total = Number(team.score?.total || 0);
        const roster = getTeamPlayers(room, team.id).map((player) => player.name).join(" · ");
        return (
        <div className="score-row" key={team.id}>
          <div className="score-main">
            <div className="leader-rank">{index + 1}</div>
            <div>
              <strong>{team.name}</strong>
              <p>
                E1 {team.score.stagePoints[0]} · E2 {team.score.stagePoints[1]} · E3 {team.score.stagePoints[2]}
              </p>
            </div>
          </div>
          <div className="score-total">{total}</div>
        </div>
        );
      })}
    </div>
  );
}

function CollectionTeamCard({ room, team }) {
  const progress = getTeamProgress(room, team.id);
  const players = getTeamPlayers(room, team.id);

  return (
    <article className="team-card" style={{ "--team-accent": team.color }}>
      <div className="team-card-head">
        <div>
          <div className="team-dot" style={{ background: team.color }} />
          <h3>{team.name}</h3>
        </div>
        <div className="progress-pill">
          {progress.submitted}/{progress.total}
        </div>
      </div>

      <div className="mini-list">
        {players.map((player) => (
          <div className="mini-row" key={player.id}>
            <span>{player.name}</span>
            <span>{player.words?.length === 5 ? "Listo" : "Pendiente"}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function ActiveTurnPanel({
  room,
  isActiveController,
  controlledTeamId,
  currentWord,
  remainingMs,
  panelRef,
  onStartTurn,
  onCorrect,
  onPass,
  onRaiseFoul,
  onConfirmFoul,
  onRejectFoul,
}) {
  const turn = room.game?.turn;
  const team = room.teams?.[turn?.teamId];
  const reader = room.players?.[turn?.readerPlayerId];
  const stage = STAGES[room.game?.stageIndex || 0];
  const foulPending = Boolean(turn?.foulRequest);
  const turnCorrectCount = Array.isArray(turn?.correctWordIds) ? turn.correctWordIds.length : 0;

  return (
    <section className="panel word-panel" ref={panelRef}>
      <div className="panel-header">
        <div>
          <p className="eyebrow">{stage.title}</p>
          <h2>{stage.cue}</h2>
        </div>
        <div className={`timer-display ${remainingMs <= 10_000 ? "timer-danger" : ""}`}>{formatDuration(remainingMs)}</div>
      </div>

      <div className="stage-copy">
        <p>{stage.description}</p>
        <div className="chip-row">
          <span className="info-chip">Turno de {team?.name}</span>
          <span className="info-chip">Lee {reader?.name || "Sin lector"}</span>
          <span className="info-chip">{turnCorrectCount} aciertos</span>
        </div>
      </div>

      {isActiveController ? (
        turn?.status === "waiting" ? (
          <div className="waiting-card">
            <h3>Listo para arrancar el turno</h3>
            <p>Este equipo es el siguiente. Cuando quieran, inician el turno desde este celular.</p>
            <button className="primary-btn block-btn" onClick={onStartTurn} type="button">
              Empezar turno
            </button>
          </div>
        ) : (
          <div className="word-card">
            <div className="word-kicker">{foulPending ? "FALTA EN REVISIÓN" : "PALABRA ACTUAL"}</div>
            <div className="word-value">{currentWord ? currentWord.text : "Sin palabra"}</div>
            <p className="muted-copy">
              {currentWord ? `La cargó ${currentWord.playerName} (${currentWord.teamName}).` : "Esperando la siguiente palabra."}
            </p>

            {foulPending ? (
              <div className="foul-box">
                <p>Un jugador pidió FALTA!. ¿Confirmás que se rompió la regla?</p>
                <div className="action-grid">
                  <button className="danger-btn" onClick={onConfirmFoul} type="button">
                    Confirmar FALTA!
                  </button>
                  <button className="secondary-btn" onClick={onRejectFoul} type="button">
                    Seguir jugando
                  </button>
                </div>
              </div>
            ) : (
              <div className="action-grid">
                <button className="success-btn" onClick={onCorrect} type="button" disabled={turn?.status !== "running"}>
                  ADIVINADO
                </button>
                <button className="secondary-btn" onClick={onPass} type="button" disabled={turn?.status !== "running"}>
                  → PASAR
                </button>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="spectator-card">
          <h3>{turn?.status === "waiting" ? "Esperando que el equipo active el turno" : "Atento a las fallas!"}</h3>
          <div className="hidden-word">••••••••</div>
          <button className="danger-btn block-btn" onClick={onRaiseFoul} type="button" disabled={turn?.status !== "running" || controlledTeamId === team?.id}>
            ¡FALTA!
          </button>
        </div>
      )}
    </section>
  );
}

function TurnSpotlight({ room, activeTeam, activeReader, stage, remainingMs, currentDeckCount, turnCorrectCount }) {
  return (
    <section className="turn-spotlight">
      <article className="turn-spotlight-card turn-spotlight-stage">
        <span className="spotlight-label">Ronda actual</span>
        <strong>{stage.shortTitle}</strong>
        <p>{stage.cue}</p>
      </article>
      <article className="turn-spotlight-card turn-spotlight-team">
        <span className="spotlight-label">Turno de:</span>
        <strong>{activeTeam?.name || "Sin equipo"}</strong>
        <p>{activeReader?.name ? `JUEGA: ${activeReader.name}` : "Esperando Jugador"}</p>
      </article>
      <article className="turn-spotlight-card turn-spotlight-timer">
        <span className="spotlight-label">Tiempo</span>
        <strong>{formatDuration(remainingMs)}</strong>
        <p>{turnCorrectCount} aciertos · {currentDeckCount} palabras</p>
      </article>
    </section>
  );
}

function StageTransitionOverlay({ transition, teamName, readerName, onClose }) {
  if (!transition) return null;

  return (
    <div className="stage-overlay">
      <div className="stage-overlay-card">
        <p className="section-kicker">Cambio de etapa</p>
        <h2>{transition.title}</h2>
        <p className="hero-copy">{transition.description}</p>
        <div className="stage-summary-grid">
          <div className="stage-summary-card">
            <span className="spotlight-label">Nueva dinámica</span>
            <strong>{transition.cue}</strong>
          </div>
          <div className="stage-summary-card">
            <span className="spotlight-label">Nuevo tiempo</span>
            <strong>{formatDuration(transition.durationMs)}</strong>
          </div>
          <div className="stage-summary-card">
            <span className="spotlight-label">Arranca</span>
            <strong>{teamName || "Siguiente equipo"}</strong>
            <p>{readerName ? `Juega: ${readerName}` : "Jugador por definir"}</p>
          </div>
        </div>
        <button className="primary-btn block-btn" onClick={onClose} type="button">
          Entendido (Esperar que todos lean)
        </button>
      </div>
    </div>
  );
}

function ResultsTableRow({ cells }) {
  return cells.map((cell, index) => (
    <div className="results-cell" key={`${cell}-${index}`}>
      {cell}
    </div>
  ));
}

function ResultsScreen({ room, onLeave, onReplay, onDownloadWords }) {
  const leaderboard = getLeaderboard(room);
  const winner = leaderboard[0];

  return (
    <div className="page-shell">
      <section className="hero hero-results">
        <div className="hero-content">
          <p className="section-kicker">3 Rondas</p>
          <h1>Podio final.</h1>
          <div className="room-code-banner">
            <span className="room-code-label">Sala</span>
            <strong>{room.code}</strong>
          </div>
          <p className="hero-copy">Las tres rondas ya se jugaron completas.</p>
        </div>
        <div className="hero-actions">
          <button className="secondary-btn top-action" onClick={onReplay} type="button">
            Volver a jugar
          </button>
          <button className="ghost-btn top-action" onClick={onLeave} type="button">
            Salir de la sala
          </button>
        </div>
      </section>

      <main className="results-grid">
        <section className="panel champion-panel">
          <p className="eyebrow">Ganador</p>
          <h2>{winner?.name || "Sin ganador"}</h2>
          <p>{winner ? `Terminó con ${winner.score.total} puntos.` : "No hubo datos suficientes para calcular el podio."}</p>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Podio</p>
              <h2>2° y 3°</h2>
            </div>
          </div>
          <Scoreboard room={room} />
        </section>

        <section className="panel span-all">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Detalle</p>
              <h2>Puntos por Rondas</h2>
            </div>
          </div>
          <div className="results-table">
            <div className="results-head">Equipo</div>
            <div className="results-head">Ronda 1</div>
            <div className="results-head">Ronda 2</div>
            <div className="results-head">Ronda 3</div>
            <div className="results-head">Total</div>
            {leaderboard.map((team) => (
              <ResultsTableRow
                key={team.id}
                cells={[
                  team.name,
                  String(team.score.stagePoints[0]),
                  String(team.score.stagePoints[1]),
                  String(team.score.stagePoints[2]),
                  String(team.score.total),
                ]}
              />
            ))}
          </div>
        </section>
        <section className="panel span-all">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Equipos</p>
              <h2>Jugadores por equipo</h2>
            </div>
          </div>
          <div className="team-grid">
            {leaderboard.map((team) => (
              <article className="team-card" key={`result-${team.id}`} style={{ "--team-accent": team.color }}>
                <div className="team-card-head">
                  <div>
                    <div className="team-dot" style={{ background: team.color }} />
                    <h3>{team.name}</h3>
                  </div>
                </div>
                <div className="mini-list">
                  {getTeamPlayers(room, team.id).map((player) => (
                    <div className="mini-row" key={player.id}>
                      <span>{player.name}</span>
                      <span>{team.name}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [room, setRoom] = useState(null);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [banner, setBanner] = useState(null);
  const [teamNameDrafts, setTeamNameDrafts] = useState({});
  const [playerDrafts, setPlayerDrafts] = useState({});
  const [playerNameDrafts, setPlayerNameDrafts] = useState({});
  const [wordDraft, setWordDraft] = useState(["", "", "", "", ""]);
  const [now, setNow] = useState(Date.now());
  const timeoutGuard = useRef("");
  const activeTurnPanelRef = useRef(null);
  const scrollGuard = useRef("");

  if (!db) {
    return (
      <div className="page-shell">
        <section className="hero hero-compact">
          <div className="hero-content">
            <p className="section-kicker">Firebase</p>
            <h1>No pudimos iniciar la app.</h1>
            <p className="hero-copy">
              {firebaseInitError || "La configuración de Firebase no está completa."}
            </p>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  useEffect(() => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    const ticker = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(ticker);
  }, []);

  useEffect(() => {
    if (!session.roomId) {
      setRoom(null);
      setLoadingRoom(false);
      return undefined;
    }

    setLoadingRoom(true);
    const roomRef = ref(db, `rooms/${session.roomId}`);

    const unsubscribe = onValue(
      roomRef,
      (snapshot) => {
        const nextRoom = snapshot.val();
        if (!nextRoom) {
          setRoom(null);
          setLoadingRoom(false);
          setBanner({ tone: "danger", text: `La sala ${session.roomId} no existe o ya no está disponible.` });
          setSession((current) => ({ ...current, roomId: "", teamId: "", mode: "spectator" }));
          return;
        }

        setRoom(nextRoom);
        setLoadingRoom(false);
      },
      (error) => {
        setLoadingRoom(false);
        setBanner({ tone: "danger", text: explainFirebaseError(error) });
      },
    );

    return () => unsubscribe();
  }, [session.roomId]);

  useEffect(() => {
    if (!session.roomId) return undefined;

    const clientRef = ref(db, `rooms/${session.roomId}/clients/${session.clientId}`);
    const disconnectRef = onDisconnect(clientRef);

    set(clientRef, {
      id: session.clientId,
      teamId: session.teamId || "",
      mode: session.mode,
      updatedAt: Date.now(),
    }).catch((error) => {
      console.error(error);
      setBanner({ tone: "danger", text: explainFirebaseError(error) });
    });
    disconnectRef.remove().catch(console.error);

    return () => {
      disconnectRef.cancel().catch(() => {});
      remove(clientRef).catch(() => {});
    };
  }, [session.clientId, session.mode, session.roomId, session.teamId]);

  useEffect(() => {
    if (!room) return;

    setTeamNameDrafts((current) => {
      const next = { ...current };
      getTeams(room).forEach((team) => {
        if (!(team.id in next)) next[team.id] = team.name;
      });
      Object.keys(next).forEach((teamId) => {
        if (!room.teams?.[teamId]) delete next[teamId];
      });
      return next;
    });

    setPlayerNameDrafts((current) => {
      const next = { ...current };
      getPlayers(room).forEach((player) => {
        if (!(player.id in next)) next[player.id] = player.name;
      });
      Object.keys(next).forEach((playerId) => {
        if (!room.players?.[playerId]) delete next[playerId];
      });
      return next;
    });
  }, [room]);

  useEffect(() => {
    if (!room || !session.teamId) return;
    if (!room.teams?.[session.teamId] || getLinkedDeviceClientId(room, session.teamId) !== session.clientId) {
      setSession((current) => ({ ...current, teamId: "", mode: "spectator" }));
    }
  }, [room, session.clientId, session.teamId]);

  const controlledTeamId =
    session.teamId && room?.teams?.[session.teamId] && getLinkedDeviceClientId(room, session.teamId) === session.clientId ? session.teamId : "";
  const pendingPlayer = room && controlledTeamId ? getPendingPlayerForTeam(room, controlledTeamId) : null;

  useEffect(() => {
    setWordDraft(["", "", "", "", ""]);
  }, [pendingPlayer?.id, session.roomId]);

  const isHost = room?.hostClientId === session.clientId;
  const turn = room?.game?.turn || null;
  const activeTeam = turn ? room.teams?.[turn.teamId] : null;
  const activeReader = turn ? room.players?.[turn.readerPlayerId] : null;
  const currentWord = room?.game?.currentWordId ? room.words?.[room.game.currentWordId] : null;
  const stageIndex = room?.game?.stageIndex || 0;
  const stage = STAGES[stageIndex];
  const stageTransition = room?.game?.stageTransition || null;
  const remainingMs = turn ? getTurnRemainingMs(turn, now) : stage.durationMs;
  const turnCorrectCount = Array.isArray(turn?.correctWordIds) ? turn.correctWordIds.length : 0;
  const currentDeckCount = Array.isArray(room?.game?.currentDeck) ? room.game.currentDeck.length : 0;
  const teamLinkedToThisDevice = controlledTeamId && getLinkedDeviceClientId(room, controlledTeamId) === session.clientId;
  const isActiveController = Boolean(teamLinkedToThisDevice && activeTeam?.id === controlledTeamId);
  const turnScrollSignature =
    room?.status === "playing"
      ? [stageIndex, turn?.id || "", turn?.teamId || "", turn?.readerPlayerId || "", turn?.status || "", turnCorrectCount].join(":")
      : "";

  useEffect(() => {
    if (!turn || turn.status !== "running") {
      timeoutGuard.current = "";
      return;
    }

    if (remainingMs > 0 || timeoutGuard.current === turn.id) return;

    timeoutGuard.current = turn.id;
    finishTurnFromTimeout();
  }, [remainingMs, turn]);

  useEffect(() => {
    if (room?.status !== "playing" || !turnScrollSignature) {
      scrollGuard.current = "";
      return;
    }

    if (scrollGuard.current === turnScrollSignature || !activeTurnPanelRef.current) return;

    scrollGuard.current = turnScrollSignature;
    window.requestAnimationFrame(() => {
      activeTurnPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [room?.status, turnScrollSignature]);

  async function mutateRoom(mutator) {
    if (!session.roomId) return null;

    try {
      const roomRef = ref(db, `rooms/${session.roomId}`);
      const snapshot = await get(roomRef);
      const currentRoom = snapshot.val();

      if (!currentRoom) {
        showBanner("La sala ya no existe o no se pudo cargar.", "danger");
        return null;
      }

      const draftRoom = cloneRoomState(currentRoom);
      const result = mutator(draftRoom);
      await set(roomRef, draftRoom);
      return result;
    } catch (error) {
      showBanner(explainFirebaseError(error), "danger");
      return null;
    }
  }

  function showBanner(text, tone = "info") {
    setBanner({ text, tone });
  }

  async function createNewRoom() {
    try {
      const roomCode = randomRoomCode();
      await set(ref(db, `rooms/${roomCode}`), createRoom(roomCode, session.clientId));
      setBanner(null);
      setSession((current) => ({ ...current, roomId: roomCode, teamId: "", mode: "spectator" }));
      setJoinCode(roomCode);
    } catch (error) {
      showBanner(explainFirebaseError(error), "danger");
    }
  }

  function joinExistingRoom() {
    const roomCode = sanitizeText(joinCode, 8);
    if (!roomCode) {
      showBanner("Escribí un código de sala antes de entrar.", "danger");
      return;
    }
    setBanner(null);
    setSession((current) => ({ ...current, roomId: roomCode, teamId: "", mode: "spectator" }));
  }

  async function clearCurrentClaim() {
    if (!session.roomId) return;
    await mutateRoom((currentRoom) => {
      Object.values(currentRoom.teams || {}).forEach((team) => {
        if (team.deviceClientId && !hasActiveClient(currentRoom, team.deviceClientId)) {
          team.deviceClientId = "";
        }
        if (team.deviceClientId === session.clientId) {
          team.deviceClientId = "";
        }
      });
      currentRoom.activity = {
        title: "Dispositivo liberado",
        body: "El celular volvió a modo espectador.",
      };
    });
  }

  async function leaveRoom() {
    await clearCurrentClaim();
    if (session.roomId) {
      await remove(ref(db, `rooms/${session.roomId}/clients/${session.clientId}`)).catch(() => {});
    }
    setRoom(null);
    setJoinCode("");
    setSession((current) => ({ ...current, roomId: "", teamId: "", mode: "spectator" }));
  }

  async function claimTeam(teamId) {
    const result = await mutateRoom((currentRoom) => {
      Object.values(currentRoom.teams || {}).forEach((team) => {
        if (team.deviceClientId && !hasActiveClient(currentRoom, team.deviceClientId)) {
          team.deviceClientId = "";
        }
        if (team.deviceClientId === session.clientId) {
          team.deviceClientId = "";
        }
      });
      const team = currentRoom.teams?.[teamId];
      if (!team) {
        return { ok: false, message: "Ese equipo ya no existe." };
      }

      const linkedDeviceClientId = getLinkedDeviceClientId(currentRoom, teamId);
      if (linkedDeviceClientId && linkedDeviceClientId !== session.clientId) {
        return { ok: false, message: `${team.name} ya tiene un celular vinculado.` };
      }

      team.deviceClientId = session.clientId;
      currentRoom.activity = {
          title: "Celular vinculado",
          body: `${currentRoom.teams[teamId].name} quedó asociado a este dispositivo.`,
        };
      return { ok: true };
    });

    if (!result?.ok) {
      showBanner(result?.message || "No se pudo vincular este celular.", "danger");
      return;
    }

    setSession((current) => ({ ...current, teamId, mode: "team" }));
  }

  async function goSpectator() {
    await clearCurrentClaim();
    setSession((current) => ({ ...current, teamId: "", mode: "spectator" }));
  }

  async function updateTeamsAmount(nextCount) {
    const result = await mutateRoom((currentRoom) => setTeamCount(currentRoom, nextCount));
    if (result && result.ok === false) {
      showBanner(result.message, "danger");
    }
  }

  async function saveTeamLabel(teamId) {
    const nextName = teamNameDrafts[teamId];
    const result = await mutateRoom((currentRoom) => ({ ok: renameTeam(currentRoom, teamId, nextName) }));
    if (!result?.ok) {
      showBanner("Escribí un nombre válido para el equipo.", "danger");
    }
  }

  async function savePlayerLabel(playerId) {
    const nextName = playerNameDrafts[playerId];
    const result = await mutateRoom((currentRoom) => ({ ok: renamePlayer(currentRoom, playerId, nextName) }));
    if (!result?.ok) {
      showBanner("Ese jugador necesita un nombre válido.", "danger");
    }
  }

  async function addPlayerToTeam(teamId) {
    const inputValue = document.querySelector(`#player-draft-${teamId}`)?.value || "";
    const draft = sanitizeText(playerDrafts[teamId] || inputValue, 24);
    if (!draft) {
      showBanner("Escribí un nombre antes de agregar al jugador.", "danger");
      return;
    }

    const result = await mutateRoom((currentRoom) => ({ ok: Boolean(addPlayer(currentRoom, teamId, draft)) }));
    if (result === null) {
      return;
    }
    if (!result.ok) {
      showBanner("Escribí un nombre antes de agregar al jugador.", "danger");
      return;
    }
    setPlayerDrafts((current) => ({ ...current, [teamId]: "" }));
  }

  async function removeTeamPlayer(playerId) {
    await mutateRoom((currentRoom) => {
      removePlayer(currentRoom, playerId);
      currentRoom.activity = {
        title: "Jugador removido",
        body: "La lista del equipo quedó actualizada.",
      };
      return true;
    });
  }

  async function openCollection() {
    if (!isSetupReady(room)) {
      showBanner("Cada equipo necesita nombre y al menos dos jugadores para abrir la carga privada.", "danger");
      return;
    }

    await mutateRoom((currentRoom) => {
      if (!isSetupReady(currentRoom)) return { ok: false };
      currentRoom.status = "collection";
      currentRoom.activity = {
        title: "Carga de palabras",
        body: "Cada jugador carga 5 palabras CALESQUIERA y se pasan el celular entre los del equipo.",
      };
      return { ok: true };
    });
  }

  async function saveWordsForPlayer() {
    if (!pendingPlayer || !controlledTeamId) return;

    const result = await mutateRoom((currentRoom) => {
      const expectedPlayer = getPendingPlayerForTeam(currentRoom, controlledTeamId);
      if (!expectedPlayer || expectedPlayer.id !== pendingPlayer.id) {
        return { ok: false, message: "Ese turno de carga ya cambió en otro dispositivo." };
      }

      const response = savePlayerWords(currentRoom, pendingPlayer.id, wordDraft);
      if (response.ok) {
        currentRoom.activity = {
          title: "Palabras guardadas",
          body: `${currentRoom.players[pendingPlayer.id].name} ya cargó sus cinco palabras.`,
        };
      }
      return response;
    });

    if (!result?.ok) {
      showBanner(result?.message || "No se pudieron guardar las palabras.", "danger");
      return;
    }

    setWordDraft(["", "", "", "", ""]);
  }

  async function startGameFlow() {
    const result = await mutateRoom((currentRoom) => beginGame(currentRoom));
    if (!result?.ok) {
      showBanner(result?.message || "No se pudo iniciar la partida.", "danger");
    }
  }

  async function startCurrentTurn() {
    await mutateRoom((currentRoom) => {
      if (currentRoom.game?.turn?.teamId !== controlledTeamId) return false;
      return startTurn(currentRoom);
    });
  }

  async function markWordAsCorrect() {
    await mutateRoom((currentRoom) => {
      if (currentRoom.game?.turn?.teamId !== controlledTeamId) return false;
      return markCurrentWordCorrect(currentRoom);
    });
  }

  async function passWord() {
    await mutateRoom((currentRoom) => {
      if (currentRoom.game?.turn?.teamId !== controlledTeamId) return false;
      return passCurrentWord(currentRoom);
    });
  }

  async function raiseFoul() {
    await mutateRoom((currentRoom) => requestFoul(currentRoom, session.clientId));
  }

  async function acceptFoul() {
    await mutateRoom((currentRoom) => {
      if (currentRoom.game?.turn?.teamId !== controlledTeamId) return false;
      return confirmFoul(currentRoom);
    });
  }

  async function dismissFoul() {
    await mutateRoom((currentRoom) => {
      if (currentRoom.game?.turn?.teamId !== controlledTeamId) return false;
      return rejectFoul(currentRoom);
    });
  }

  async function finishTurnFromTimeout() {
    await mutateRoom((currentRoom) => {
      if (!currentRoom.game?.turn) return false;
      if (getTurnRemainingMs(currentRoom.game.turn, Date.now()) > 0) return false;
      return finishTurnByTimeout(currentRoom);
    });
  }

  async function acknowledgeStageTransition() {
    await mutateRoom((currentRoom) => dismissStageTransition(currentRoom));
  }

  async function replayConfiguredGame() {
    await mutateRoom((currentRoom) => resetRoomForReplay(currentRoom));
  }

  function downloadWordsArchive() {
    if (!room) return;
    downloadJsonFile(`3-rondas-palabras-sala-${room.code}.json`, buildWordsExport(room));
  }

  const lobbyTeams = useMemo(() => (room ? getTeams(room) : []), [room]);

  if (!room && !session.roomId) {
    return (
      <div className="page-shell">
        <section className="hero">
          <div className="hero-content">
            <p className="section-kicker">Juanito.World</p>
            <h1>3 Rondas.</h1>
            <p className="hero-copy">
              Juego online para 2 a 4 equipos de Adivinanzas con mimicas y palabras en 3 rondas
            </p>
          </div>
        </section>

        <Banner banner={banner} onClose={() => setBanner(null)} />

        <main className="landing-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Sala nueva</p>
                <h2>Crear partida</h2>
              </div>
            </div>
            <p className="muted-copy">Armá una sala, configurá los equipos y comparti el codigo de Sala.</p>
            <button className="primary-btn block-btn" onClick={createNewRoom} type="button">
              Crear sala ahora
            </button>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Ingresar</p>
                <h2>Entrar por código</h2>
              </div>
            </div>
            <div className="inline-form">
              <input
                type="text"
                inputMode="numeric"
                maxLength="4"
                placeholder="Código de sala"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
              />
              <button className="secondary-btn" onClick={joinExistingRoom} type="button">
                Entrar
              </button>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    );
  }

  if (loadingRoom || !room) {
    return (
      <div className="page-shell">
        <section className="hero hero-compact">
          <div className="hero-content">
            <p className="section-kicker">Conectando</p>
            <h1>Sala en sincronización.</h1>
            <p className="hero-copy">Estamos cargando el estado de la partida.</p>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  if (room.status === "finished") {
    return <ResultsScreen room={room} onLeave={leaveRoom} onReplay={replayConfiguredGame} onDownloadWords={downloadWordsArchive} />;
  }

  return (
    <div className="page-shell">
      <section className="hero hero-room">
        <div className="hero-content">
          <p className="section-kicker">Sala activa</p>
          <div className="room-code-banner">
            <span className="room-code-label">Codigo</span>
            <strong>{room.code}</strong>
          </div>
          <h1>{room.status === "lobby" ? "Configuración inicial." : room.status === "collection" ? "Carga privada de palabras." : "Partida en curso."}</h1>
          <p className="hero-copy">{room.activity?.body || "La sala ya está lista para seguir avanzando."}</p>
        </div>
        <div className="hero-actions">
          <div className="room-chip">{isHost ? "Host" : session.mode === "team" ? "Equipo vinculado" : "Espectador"}</div>
          <button className="ghost-btn" onClick={leaveRoom} type="button">
            Salir de la sala
          </button>
        </div>
      </section>

      <Banner banner={banner} onClose={() => setBanner(null)} />

      {room.status === "lobby" ? (
        <main className="screen-grid"> 
          <section className="panel">
            <div className="panel-header panel-header-wrap">
              <div>
                <p className="eyebrow">Formato</p>
                <h2>Equipos y jugadores</h2>
              </div>
              <div className="segmented">
                {[2, 3, 4].map((count) => (
                  <button
                    className={lobbyTeams.length === count ? "active" : ""}
                    key={count}
                    onClick={() => updateTeamsAmount(count)}
                    type="button"
                    disabled={!isHost}
                  >
                    {count} equipos
                  </button>
                ))}
              </div>
            </div>

            <div className="team-grid">
              {lobbyTeams.map((team) => (
                <LobbyTeamCard
                  key={team.id}
                  room={room}
                  session={session}
                  team={team}
                  isHost={isHost}
                  teamName={teamNameDrafts[team.id] ?? team.name}
                  playerDraft={playerDrafts[team.id] ?? ""}
                  playerNameDrafts={playerNameDrafts}
                  onTeamNameChange={(teamId, value) => setTeamNameDrafts((current) => ({ ...current, [teamId]: value }))}
                  onSaveTeamName={saveTeamLabel}
                  onPlayerDraftChange={(teamId, value) => setPlayerDrafts((current) => ({ ...current, [teamId]: value }))}
                  onAddPlayer={addPlayerToTeam}
                  onPlayerNameChange={(playerId, value) => setPlayerNameDrafts((current) => ({ ...current, [playerId]: value }))}
                  onSavePlayerName={savePlayerLabel}
                  onRemovePlayer={removeTeamPlayer}
                />
              ))}
            </div>
          </section>

          <RolePanel room={room} session={session} onClaimTeam={claimTeam} onSpectator={goSpectator} />

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Checklist</p>
                <h2>Comprobá antes de empezar</h2>
              </div>
            </div>
            <div className="mini-list">
              {lobbyTeams.map((team) => (
                <div className="mini-row" key={team.id}>
                  <span>{team.name}</span>
                  <span>{getTeamPlayers(room, team.id).length} jugadores</span>
                </div>
              ))}
            </div>
            <p className="muted-copy">El host empieza la carga de palabras cuando todos los equipos estén configurados.</p>
            <button className="primary-btn block-btn" onClick={openCollection} type="button" disabled={!isHost || !isSetupReady(room)}>
              Abrir carga de palabras
            </button>
          </section>
        </main>
      ) : null}

      {room.status === "collection" ? (
        <main className="screen-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Estado Global</p>
                <h2>Carga de Palabras</h2>
              </div>
            </div>

            <div className="team-grid">
              {getTeams(room).map((team) => (
                <CollectionTeamCard key={team.id} room={room} team={team} />
              ))}
            </div>
          </section>

          <RolePanel room={room} session={session} onClaimTeam={claimTeam} onSpectator={goSpectator} />

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Celular de equipo</p>
                <h2>Carga privada</h2>
              </div>
            </div>

            {controlledTeamId ? (
              pendingPlayer ? (
                <div className="word-entry-shell">
                  <div className="privacy-box">
                    <strong>Turno de: {pendingPlayer.name}</strong>
                    <p>solo vos tenes que ver las palabras que cargas, deben ser aleatoreaslo que se te ocurra.</p>
                    <p>Ej: Automovil, Cama, Luna, Sexo.</p>
                  </div>

                  <div className="word-form">
                    {wordDraft.map((value, index) => (
                      <input
                        key={`${pendingPlayer.id}-${index}`}
                        type="text"
                        maxLength="28"
                        value={value}
                        onChange={(event) =>
                          setWordDraft((current) => current.map((entry, entryIndex) => (entryIndex === index ? event.target.value : entry)))
                        }
                        placeholder={`Palabra ${index + 1}`}
                      />
                    ))}
                  </div>

                  <button className="primary-btn block-btn" onClick={saveWordsForPlayer} type="button">
                    Guardar mis 5 palabras
                  </button>
                </div>
              ) : (
                <div className="waiting-card">
                  <h3>Equipo completo</h3>
                  <p>Este equipo ya terminó su carga privada. Ahora solo queda esperar al resto de quipos.</p>
                </div>
              )
            ) : (
              <div className="waiting-card">
                <h3>Elegí un equipo para este celular</h3>
                <p>Vinculá este dispositivo con un equipo si es posible para cargar las palabras.</p>
              </div>
            )}

            <div className="collection-footer">
              <p className="muted-copy">El host puede avanzar cuando todos los jugadores de todos los equipos ya guardaron sus palabras.</p>
              <button className="primary-btn block-btn" onClick={startGameFlow} type="button" disabled={!isHost || !isCollectionComplete(room)}>
                Empezar Ronda 1
              </button>
            </div>
          </section>
        </main>
      ) : null}

      {room.status === "playing" ? (
        <>
        <TurnSpotlight
          room={room}
          activeTeam={activeTeam}
          activeReader={activeReader}
          stage={stage}
          remainingMs={remainingMs}
          currentDeckCount={currentDeckCount}
          turnCorrectCount={turnCorrectCount}
        />
        <main className="game-layout">
          <ActiveTurnPanel
            room={room}
            isActiveController={isActiveController}
            controlledTeamId={controlledTeamId}
            currentWord={currentWord}
            remainingMs={remainingMs}
            panelRef={activeTurnPanelRef}
            onStartTurn={startCurrentTurn}
            onCorrect={markWordAsCorrect}
            onPass={passWord}
            onRaiseFoul={raiseFoul}
            onConfirmFoul={acceptFoul}
            onRejectFoul={dismissFoul}
          />

          <aside className="stack-lg">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Marcador</p>
                  <h2>Equipos</h2>
                </div>
              </div>
              <Scoreboard room={room} compact />
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Turno</p>
                  <h2>Estado en vivo</h2>
                </div>
              </div>
              <div className="mini-list">
                <div className="mini-row">
                  <span>Equipo actual</span>
                  <strong>{activeTeam?.name || "Sin equipo"}</strong>
                </div>
                <div className="mini-row">
                  <span>Lector</span>
                  <strong>{activeReader?.name || "Sin lector"}</strong>
                </div>
                <div className="mini-row">
                  <span>Aciertos del turno</span>
                  <strong>{turnCorrectCount}</strong>
                </div>
                <div className="mini-row">
                  <span>Palabras restantes</span>
                  <strong>{currentDeckCount}</strong>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Regla activa</p>
                  <h2>{stage.title}</h2>
                </div>
              </div>
              <p>{stage.description}</p>
              <RolePanel room={room} session={session} onClaimTeam={claimTeam} onSpectator={goSpectator} />
            </section>
          </aside>
        </main>
        <StageTransitionOverlay
          transition={stageTransition}
          teamName={room.teams?.[stageTransition?.teamId]?.name}
          readerName={room.players?.[stageTransition?.readerPlayerId]?.name}
          onClose={acknowledgeStageTransition}
        />
        </>
      ) : null}

      <Footer />
    </div>
  );
}
