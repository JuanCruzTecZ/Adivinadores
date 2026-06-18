import React, { useState, useEffect, useRef } from "react";
import { ref, onValue, set, update, remove } from "firebase/database";
import { db } from "./lib/firebase";
import {
  createRoom, addPlayer, randomRoomCode, uid, getPlayers, isSetupReady,
  beginGame, selectWordAndStart, getTurnRemainingMs, processGuess,
  reportMimo, finishTurnByTimeout, getLeaderboard, resetRoomForReplay
} from "./lib/game";

function getObfuscatedWord(word, startedAt, now = Date.now()) {
  if (!word || !startedAt) return "";
  const totalDurationMs = 60000;
  const revealIntervalMs = 15000;
  const elapsedMs = Math.min(Math.max(0, now - startedAt), totalDurationMs);
  const remainingMs = totalDurationMs - elapsedMs;

  const chars = word.split("");
  const maxRevealBeforeFinal = Math.max(0, chars.length - 3);
  const baseReveal = Math.min(Math.floor(elapsedMs / revealIntervalMs), maxRevealBeforeFinal);
  let charsToReveal = baseReveal;

  if (remainingMs <= 13000) {
    const hiddenAtFinal = 1;
    const missingBeforeFinal = Math.max(0, chars.length - hiddenAtFinal - baseReveal);
    const extraReveal = Math.floor(((13000 - remainingMs) / 13000) * missingBeforeFinal);
    charsToReveal = Math.min(chars.length - hiddenAtFinal, baseReveal + extraReveal);
  }

  const revealIndices = new Set();
  let seed = word.charCodeAt(0) || 1;
  while (revealIndices.size < charsToReveal) {
    seed = (seed * 9301 + 49297) % 233280;
    const index = Math.floor((seed / 233280) * chars.length);
    revealIndices.add(index);
    if (revealIndices.size >= chars.length - 1) break;
  }

  return chars.map((char, index) => revealIndices.has(index) ? char : "_").join(" ");
}

export default function App() {
  function setCookie(name, value, days = 30) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};path=/;expires=${d.toUTCString()};SameSite=Lax`;
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function deleteCookie(name) {
    document.cookie = `${name}=;path=/;expires=${new Date(0).toUTCString()};SameSite=Lax`;
  }

  function clearAllCookies() {
    document.cookie.split(";").forEach((cookie) => {
      const name = cookie.split("=")[0].trim();
      if (!name) return;
      document.cookie = `${name}=;path=/;expires=${new Date(0).toUTCString()};SameSite=Lax`;
    });
  }

  const [clientId] = useState(() => {
    const fromCookie = typeof document !== "undefined" ? getCookie("mimo_clientId") : null;
    if (fromCookie) return fromCookie;
    const saved = localStorage.getItem("mimo_clientId");
    if (saved) {
      // backfill cookie
      try { setCookie("mimo_clientId", saved); } catch (e) {}
      return saved;
    }
    const newId = uid("client");
    try { setCookie("mimo_clientId", newId); } catch (e) {}
    localStorage.setItem("mimo_clientId", newId);
    return newId;
  });

  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [roundsInput, setRoundsInput] = useState("3");

  useEffect(() => {
    if (room?.maxRounds != null) {
      setRoundsInput(String(room.maxRounds));
    }
  }, [room?.maxRounds]);

  useEffect(() => {
    if (!roomId) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setRoom(data);
    });
    return () => unsubscribe();
  }, [roomId]);

  // Cleanup old rooms and try to revive session by clientId when app mounts
  useEffect(() => {
    const runInit = async () => {
      await cleanupOldRooms();
      await findRoomByClientId();
    };
    runInit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cleanupOldRooms() {
    try {
      const roomsRef = ref(db, "rooms");
      const snapshot = await new Promise((resolve) => onValue(roomsRef, resolve, { onlyOnce: true }));
      const rooms = snapshot.val() || {};
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      for (const key of Object.keys(rooms)) {
        const r = rooms[key];
        if (r?.createdAt && now - r.createdAt > dayMs) {
          await remove(ref(db, `rooms/${key}`));
        }
      }
    } catch (error) {
      // ignore cleanup errors
      console.error("cleanupOldRooms error", error);
    }
  }

  async function findRoomByClientId() {
    try {
      const roomsRef = ref(db, "rooms");
      const snapshot = await new Promise((resolve) => onValue(roomsRef, resolve, { onlyOnce: true }));
      const rooms = snapshot.val() || {};
      for (const key of Object.keys(rooms)) {
        const r = rooms[key];
        if (!r) continue;
        if (r.clients && r.clients[clientId]) {
          setRoomId(key);
          setCurrentPlayerId(r.clients[clientId]);
          return;
        }
        const players = r.players || {};
        const found = Object.values(players).find((p) => p.clientId === clientId);
        if (found) {
          setRoomId(key);
          setCurrentPlayerId(found.id);
          return;
        }
      }
    } catch (error) {
      console.error("findRoomByClientId error", error);
    }
  }

  const handleCreateRoom = async () => {
    if (!playerName.trim()) return;
    const newRoomId = uid("room");
    const code = randomRoomCode();
    const newRoom = createRoom(code, clientId);
    const pId = addPlayer(newRoom, playerName, clientId);
    await set(ref(db, `rooms/${newRoomId}`), newRoom);
    setRoomId(newRoomId);
    setCurrentPlayerId(pId);
  };

  const handleReplayRoom = async () => {
    if (!room || room.hostClientId !== clientId) return alert("Solo el anfitrión puede reiniciar la sala");
    const updatedRoom = JSON.parse(JSON.stringify(room));
    if (resetRoomForReplay(updatedRoom)) {
      await set(ref(db, `rooms/${roomId}`), updatedRoom);
    }
  };

  const handleJoinRoom = async () => {
    if (!playerName.trim() || !joinCode.trim()) return;
    const roomsRef = ref(db, "rooms");
    onValue(roomsRef, async (snapshot) => {
      const rooms = snapshot.val() || {};
      const targetRoomId = Object.keys(rooms).find((key) => rooms[key].code === joinCode);
      if (targetRoomId) {
        const targetRoom = rooms[targetRoomId];
        if (targetRoom.status !== "lobby") return alert("La partida ya comenzó");
        const pId = addPlayer(targetRoom, playerName, clientId);
        await set(ref(db, `rooms/${targetRoomId}`), targetRoom);
        setRoomId(targetRoomId);
        setCurrentPlayerId(pId);
      } else {
        alert("Código inválido");
      }
    }, { onlyOnce: true });
  };

  const handleLeaveTable = () => {
    clearAllCookies();
    localStorage.removeItem("mimo_clientId");
    setRoomId(null);
    setRoom(null);
    setCurrentPlayerId(null);
    setJoinCode("");
  };

  const handleStartGame = async () => {
    if (!room || room.hostClientId !== clientId) return;
    const updatedRoom = { ...room };
    const res = beginGame(updatedRoom);
    if (res.ok) await set(ref(db, `rooms/${roomId}`), updatedRoom);
    else alert(res.message);
  };

  if (!roomId || !room) {
    return (
      <div className="container">
        <h1>Cinefilos</h1>
        <div className="card">
          <input 
            type="text" 
            placeholder="Tu nombre" 
            value={playerName} 
            onChange={(e) => setPlayerName(e.target.value)} 
            maxLength={20}
          />
          
          
          <input 
            type="text" 
            placeholder="Código de sala" 
            value={joinCode} 
            onChange={(e) => setJoinCode(e.target.value)} 
          />
          <button onClick={handleCreateRoom}>Crear Nueva Sala</button>
          <button onClick={handleJoinRoom}>Unirse a Sala</button>
        </div>
      </div>
    );
  }

  if (room.status === "lobby") {
    const players = getPlayers(room);
    
    const handleUpdateRounds = async (e) => {
      const raw = e.target.value;
      setRoundsInput(raw);
      const numeric = raw.replace(/[^0-9]/g, "");
      if (numeric === "") return;
      const parsed = parseInt(numeric, 10);
      const val = Number.isNaN(parsed) ? 1 : Math.max(1, Math.min(10, parsed));
      await update(ref(db, `rooms/${roomId}`), { maxRounds: val });
    };

    return (
      <div className="container">
        <RoomHeader roomCode={room.code} onLeave={handleLeaveTable} />
        <div className="card">
          <div style={{ marginBottom: "20px", background: "#2a2a2a", padding: "10px", borderRadius: "4px" }}>
            <label style={{ marginRight: "10px" }}>Rondas a jugar: </label>
            {room.hostClientId === clientId ? (
              <input 
                type="text" 
                inputMode="numeric" 
                pattern="[0-9]*" 
                min="1" 
                max="10" 
                value={roundsInput} 
                onChange={handleUpdateRounds} 
                style={{ width: "60px", display: "inline-block", margin: 0 }}
              />
            ) : (
              <strong>{room.maxRounds || 3}</strong>
            )}
          </div>
          <h3>Jugadores ({players.length}/20)</h3>
          <ul>{players.map(p => <li key={p.id}>{p.name}</li>)}</ul>
          {room.hostClientId === clientId && (
            <button onClick={handleStartGame} disabled={!isSetupReady(room)}>
              Comenzar Juego
            </button>
          )}
        </div>
      </div>
    );
  }

  if (room.status === "playing") {
    return <GameEngine room={room} roomId={roomId} currentPlayerId={currentPlayerId} clientId={clientId} onReplay={handleReplayRoom} onCreateAnother={() => { setRoomId(null); setRoom(null); }} onLeave={handleLeaveTable} />;
  }

  if (room.status === "finished") {
    return <Scoreboard room={room} final={true} clientId={clientId} onReplay={handleReplayRoom} onCreateAnother={() => { setRoomId(null); setRoom(null); }} onLeave={handleLeaveTable} />;
  }

  return null;
}

function GameEngine({ room, roomId, currentPlayerId, clientId, onReplay, onCreateAnother, onLeave }) {
  const turn = room.game?.turn;
  const isMime = turn?.activeMimeId === currentPlayerId;
  const [timeLeft, setTimeLeft] = useState(0);
  const [guessInput, setGuessInput] = useState("");
  const chatEndRef = useRef(null);
  const targetRef = useRef(null);
  const inputRef = useRef(null);

  const cloneRoom = (r) => JSON.parse(JSON.stringify(r));

  useEffect(() => {
    if (!turn || turn.status !== "running") return;
    const interval = setInterval(() => {
      const remaining = getTurnRemainingMs(turn);
      setTimeLeft(Math.ceil(remaining / 1000));
      if (remaining <= 0 && isMime) {
        const updatedRoom = cloneRoom(room);
        if (finishTurnByTimeout(updatedRoom)) {
          set(ref(db, `rooms/${roomId}`), updatedRoom);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [turn?.status, turn?.startedAt, isMime, room, roomId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turn?.chatLog]);

  // When a word is selected or the turn starts, center the target word and focus input
  useEffect(() => {
    if (!turn) return;
    const t = setTimeout(() => {
      try {
        if (targetRef.current) targetRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        if (inputRef.current) {
          inputRef.current.focus({ preventScroll: true });
          inputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } catch (e) {
        // ignore
      }
    }, 120);
    return () => clearTimeout(t);
  }, [turn?.targetWord, turn?.startedAt]);

  const handleSelectWord = async (word) => {
    const updatedRoom = cloneRoom(room);
    if (selectWordAndStart(updatedRoom, word)) {
      await set(ref(db, `rooms/${roomId}`), updatedRoom);
    }
  };

  const handleSendGuess = async (e) => {
    e.preventDefault();
    if (!guessInput.trim() || isMime || turn?.solvers?.includes(currentPlayerId)) return;
    
    const updatedRoom = cloneRoom(room);
    if (processGuess(updatedRoom, currentPlayerId, guessInput)) {
      await set(ref(db, `rooms/${roomId}`), updatedRoom);
    }
    setGuessInput("");
    // after sending, ensure chat input is visible
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
  };

  const handleReport = async () => {
    const updatedRoom = cloneRoom(room);
    if (reportMimo(updatedRoom, currentPlayerId)) {
      await set(ref(db, `rooms/${roomId}`), updatedRoom);
    }
  };

  if (!turn) return null;

  if (turn.status === "selecting") {
    if (isMime) {
      return (
        <div className="container">
          <RoomHeader roomCode={room.code} onLeave={onLeave} />
          <h2>Tu turno de actuar</h2>
          <p>Selecciona una palabra:</p>
          <div className="word-options">
            {(turn.wordOptions || []).map(word => (
              <button key={word} onClick={() => handleSelectWord(word)}>{word}</button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="container">
        <RoomHeader roomCode={room.code} onLeave={onLeave} />
        <h2>Esperando al mimo...</h2>
        <p>{room.players?.[turn.activeMimeId]?.name} está eligiendo una palabra.</p>
      </div>
    );
  }

  if (turn.status === "finished") {
    return <Scoreboard room={room} final={false} clientId={clientId} onReplay={onReplay} onCreateAnother={onCreateAnother} onLeave={onLeave} />;
  }

  const totalPlayers = Object.keys(room.players || {}).length;
  const reportThreshold = Math.ceil((totalPlayers - 1) / 2);

  const canInput = () => {
    if (!turn) return false;
    if (turn.status !== 'running') return false;
    if (turn.activeMimeId === currentPlayerId) return false;
    if ((turn.solvers || []).includes(currentPlayerId)) return false;
    return true;
  };

  return (
    <div className="container game-board">
      <RoomHeader roomCode={room.code} onLeave={onLeave} />
      <div className="header-status">
        <div className="timer">{timeLeft}s</div>
        <div className="current-mime">
          Mimo actual: {room.players?.[turn.activeMimeId]?.name || "—"}
        </div>
        {isMime ? (
          <div className="target-word" ref={targetRef}>{turn.targetWord}</div>
        ) : (
          <div className="obfuscated-word" ref={targetRef}>
            {getObfuscatedWord(turn.targetWord, turn.startedAt)}
          </div>
        )}
      </div>

      <div className="chat-area">
        <div className="chat-log">
          {(turn.chatLog || []).map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.type}`}>
              <strong>{msg.playerName}:</strong> {msg.text || "¡Adivinó la palabra!"}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        
        {!isMime && !(turn.solvers || []).includes(currentPlayerId) && (
          <form onSubmit={handleSendGuess} className="chat-input-form">
            <input 
              type="text" 
              ref={inputRef}
              value={guessInput} 
              onChange={(e) => setGuessInput(e.target.value)} 
              placeholder="Escribe tu intento..." 
              autoFocus
            />
            <button type="submit">Enviar</button>
          </form>
        )}
      </div>

      <div className="action-bar">
        {!isMime && !(turn.reports || []).includes(currentPlayerId) && (
          <button className="btn-report" onClick={handleReport}>
            Reportar Mimo ({(turn.reports || []).length}/{reportThreshold})
          </button>
        )}
      </div>
        {/* leaderboard displayed at the bottom */}
        <NearbyLeaderboard room={room} currentPlayerId={currentPlayerId} />
    </div>
  );
}

function Scoreboard({ room, final, clientId, onReplay, onCreateAnother, onLeave }) {
  const leaderboard = getLeaderboard(room);
  
  return (
    <div className="container">
      <RoomHeader roomCode={room.code} onLeave={onLeave} />
      <h2>{final ? "Podio Final" : "Resultados del Turno"}</h2>
      <div className="card scoreboard">
        <table>
          <thead>
            <tr>
              <th>Posición</th>
              <th>Jugador</th>
              <th>Puntos del Turno</th>
              <th>Puntaje Total</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((p, index) => (
              <tr key={p.id}>
                <td>{index + 1}</td>
                <td>{p.name}</td>
                <td className="turn-score">+{p.lastTurnScore || 0}</td>
                <td><strong>{p.score || 0}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        {final && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button onClick={onReplay} disabled={!room || room.hostClientId !== clientId}>
              Volver a jugar
            </button>
            <button onClick={onCreateAnother}>
              Crear otra mesa
            </button>
          </div>
        )}
        </div>
        {/* leaderboard displayed at the bottom */}
        <NearbyLeaderboard room={room} currentPlayerId={clientId && room?.clients?.[clientId] ? room.clients[clientId] : null} />
    </div>
  );
}

function RoomHeader({ roomCode, onLeave }) {
  return (
    <div className="room-header">
      <div className="room-code">Mesa {roomCode}</div>
      <button className="btn-exit" onClick={onLeave}>Salir de la mesa</button>
    </div>
  );
}

function NearbyLeaderboard({ room, currentPlayerId }) {
  const leaderboard = getLeaderboard(room || {});
  if (!leaderboard || !leaderboard.length) return null;
  const idx = leaderboard.findIndex((p) => p.id === currentPlayerId);
  const center = idx >= 0 ? idx : 0;
  const start = Math.max(0, center - 2);
  const end = Math.min(leaderboard.length, start + 5);
  const slice = leaderboard.slice(start, end);

  return (
    <aside className="nearby-leaderboard">
      <h4>Clasificación cercana</h4>
      <ul>
        {slice.map((p, i) => {
          const pos = start + i + 1;
          const isYou = p.id === currentPlayerId;
          return (
            <li key={p.id} style={{ fontWeight: isYou ? "700" : "400" }}>
              <span className="pos">{pos}.</span> {p.name} <span className="score">{p.score || 0}</span> <span className="last">(+{p.lastTurnScore || 0})</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}