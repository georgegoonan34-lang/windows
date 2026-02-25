import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import GameBoard from './GameBoard';
import { User, KeyRound, Play } from 'lucide-react';

const socket = io(import.meta.env.DEV ? 'http://localhost:3001' : undefined);

function App() {
  const [gameState, setGameState] = useState(null);
  const [inLobby, setInLobby] = useState(true);

  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('game_state_update', (state) => {
      console.log("State update", state);
      setGameState(state);
      if (state.status === 'phase1' || state.status === 'playing' || state.status === 'finished') {
        setInLobby(false);
      }
    });

    return () => {
      socket.off('connect');
      socket.off('game_state_update');
    };
  }, []);

  const [lobbyMode, setLobbyMode] = useState('menu'); // menu, create, join

  const generateRoomCode = () => {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  };

  const handleCreate = (e) => {
    e.preventDefault();
    if (playerName) {
      const newRoom = generateRoomCode();
      setRoomId(newRoom);
      socket.emit('join_game', { roomId: newRoom, playerName });
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (roomId && playerName) {
      socket.emit('join_game', { roomId: roomId.toUpperCase(), playerName });
    }
  };

  const handleReady = () => {
    socket.emit('player_ready');
    setIsReady(true);
  };

  if (inLobby) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="glass-panel" style={{ width: '400px', textAlign: 'center', padding: '2rem' }}>
          <h1 style={{ marginBottom: '2rem', fontSize: '2.2rem' }}>herro i love you</h1>

          {!gameState ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {lobbyMode === 'menu' && (
                <>
                  <div style={{ position: 'relative', marginBottom: '1rem' }}>
                    <User size={20} style={{ position: 'absolute', top: '12px', left: '12px', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="Enter your Name"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      style={{ width: '100%', padding: '10px 10px 10px 40px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)', color: 'white', fontSize: '1.2rem' }}
                    />
                  </div>

                  <button
                    onClick={() => { if (playerName) setLobbyMode('create') }}
                    className="btn-primary"
                    style={{ opacity: playerName ? 1 : 0.5, padding: '1rem' }}>
                    Create Private Game
                  </button>
                  <button
                    onClick={() => { if (playerName) setLobbyMode('join') }}
                    className="btn-accent"
                    style={{ opacity: playerName ? 1 : 0.5, padding: '1rem' }}>
                    Join Existing Game
                  </button>
                </>
              )}

              {lobbyMode === 'create' && (
                <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <p style={{ color: 'var(--text-muted)' }}>You are creating a new game for you and your partner.</p>
                  <button type="submit" className="btn-primary" style={{ marginTop: '1rem', padding: '1rem' }}>Generate Code & Host</button>
                  <button type="button" onClick={() => setLobbyMode('menu')} style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Back</button>
                </form>
              )}

              {lobbyMode === 'join' && (
                <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ position: 'relative' }}>
                    <KeyRound size={20} style={{ position: 'absolute', top: '12px', left: '12px', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="4-Letter Room Code"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      style={{ width: '100%', padding: '10px 10px 10px 40px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)', color: 'white', textTransform: 'uppercase', fontSize: '1.2rem' }}
                      maxLength={4}
                      required
                    />
                  </div>
                  <button type="submit" className="btn-accent" style={{ marginTop: '1rem', padding: '1rem' }}>Join Room</button>
                  <button type="button" onClick={() => setLobbyMode('menu')} style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Back</button>
                </form>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h3 style={{ color: 'var(--text-muted)' }}>Room: {roomId}</h3>
              <p>Players: {Object.keys(gameState.players).length}/2</p>

              <div style={{ textAlign: 'left', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                {Object.values(gameState.players).map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span>{p.name} {p.id === socket.id ? '(You)' : ''}</span>
                    <span style={{ color: p.ready ? 'var(--primary)' : 'var(--text-muted)' }}>
                      {p.ready ? 'Ready' : 'Waiting...'}
                    </span>
                  </div>
                ))}
              </div>

              {!isReady && Object.keys(gameState.players).length === 2 && (
                <button onClick={handleReady} className="btn-accent" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Play size={18} /> Ready Up
                </button>
              )}
              {isReady && <p style={{ color: 'var(--primary)' }}>Waiting for opponent to ready up...</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return <GameBoard gameState={gameState} socket={socket} playerId={socket.id} />;
}

export default App;
