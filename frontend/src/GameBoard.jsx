import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Card from './Card';
import { Layers } from 'lucide-react';

let toastIdCounter = 0;

// My hand: cards exit upward (towards center), enter from above
const myCardExit = { x: 60, y: -40, opacity: 0, scale: 0.7 };
const myCardEnter = { x: -40, y: -30, opacity: 0, scale: 0.7 };

// Opponent hand: cards exit downward (towards center), enter from below
const oppCardExit = { x: 60, y: 40, opacity: 0, scale: 0.7 };
const oppCardEnter = { x: -40, y: 30, opacity: 0, scale: 0.7 };

const cardAnimate = { x: 0, y: 0, opacity: 1, scale: 1 };
const cardTransition = { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] };

const discardAnim = {
    initial: { scale: 0.6, opacity: 0, y: -20 },
    animate: { scale: 1, opacity: 1, y: 0 },
    exit: { scale: 0.6, opacity: 0, y: 20 },
    transition: { duration: 0.3 },
};

function GameBoard({ gameState, socket, playerId }) {
    const [selectedMyIndex, setSelectedMyIndex] = useState(null);
    const [selectedOppIndex, setSelectedOppIndex] = useState(null);
    const [uiMode, setUiMode] = useState('default');
    const [toasts, setToasts] = useState([]);
    const [revealCard, setRevealCard] = useState(null);
    const [actionCard, setActionCard] = useState(null);
    const toastTimers = useRef({});

    // --- Toast system ---

    const addToast = useCallback((message, type = 'info', duration = 3000) => {
        const id = ++toastIdCounter;
        setToasts(prev => [...prev, { id, message, type }]);
        toastTimers.current[id] = setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
            delete toastTimers.current[id];
        }, duration);
        return id;
    }, []);

    useEffect(() => {
        const handleNotification = ({ message, type }) => addToast(message, type);
        socket.on('game_notification', handleNotification);
        return () => socket.off('game_notification', handleNotification);
    }, [socket, addToast]);

    useEffect(() => {
        const handleReveal = ({ card }) => addToast(`Peek: ${card.value} of ${card.suit}`, 'success', 5000);
        socket.on('ability_reveal', handleReveal);
        return () => socket.off('ability_reveal', handleReveal);
    }, [socket, addToast]);

    useEffect(() => {
        const handleStackReveal = ({ card }) => {
            setRevealCard(card);
            setTimeout(() => setRevealCard(null), 3000);
        };
        socket.on('stack_reveal', handleStackReveal);
        return () => socket.off('stack_reveal', handleStackReveal);
    }, [socket]);

    // Listen for card movements — shows which card was played
    useEffect(() => {
        const handleMovement = ({ playerName, card }) => {
            setActionCard({ playerName, card });
            setTimeout(() => setActionCard(null), 2000);
        };
        socket.on('card_movement', handleMovement);
        return () => socket.off('card_movement', handleMovement);
    }, [socket]);

    useEffect(() => {
        return () => Object.values(toastTimers.current).forEach(clearTimeout);
    }, []);

    // Reset selections when game state changes
    useEffect(() => {
        setSelectedMyIndex(null);
        setSelectedOppIndex(null);
        setUiMode('default');
    }, [gameState.turnIndex, gameState.drawnCard, gameState.activeAbility, gameState.stackWindow.active]);

    const opponentId = Object.keys(gameState.players).find(id => id !== playerId);
    const me = gameState.players[playerId];
    const opp = opponentId ? gameState.players[opponentId] : null;
    const isMyTurn = gameState.playerOrder[gameState.turnIndex] === playerId;

    const topDiscard = gameState.discardPile.length > 0
        ? gameState.discardPile[gameState.discardPile.length - 1]
        : null;

    const ability = gameState.activeAbility;
    const iPlayedAbility = ability?.player === playerId;

    const isJackPhase1 = ability?.type === 'J' && iPlayedAbility && !ability.jackPhase;
    const isJackPhase2Me = ability?.type === 'J' && !iPlayedAbility && ability.jackPhase === 'opponent_choose';
    const isJackWaiting = ability?.type === 'J' && iPlayedAbility && ability.jackPhase === 'opponent_choose';

    const isStackCaller = gameState.stackWindow.active && gameState.stackWindow.caller === playerId;

    // --- Highlight helpers ---

    const getMyCardHighlight = (index) => {
        if (isStackCaller) {
            if (selectedOppIndex !== null) {
                // Offensive stack: selecting card to give
                return selectedMyIndex === index ? 'green' : 'red';
            }
            // Self-stack: selecting card to match
            return selectedMyIndex === index ? 'green' : 'red';
        }
        if (iPlayedAbility && ability.type === 'K') return selectedMyIndex === index ? 'green' : 'red';
        if (isJackPhase1) return selectedMyIndex === index ? 'green' : 'red';
        if (isJackPhase2Me) return selectedMyIndex === index ? 'green' : 'red';
        if (iPlayedAbility && ability.type === '6') return 'red';
        return null;
    };

    const getOppCardHighlight = (index) => {
        if (isStackCaller) {
            return selectedOppIndex === index ? 'green' : 'red';
        }
        if (iPlayedAbility && ability.type === 'K') return selectedOppIndex === index ? 'green' : 'red';
        if (iPlayedAbility && ability.type === '8') return 'red';
        return null;
    };

    // --- Click handlers ---

    const handleClickDeck = () => {
        if (isMyTurn && !gameState.drawnCard && !ability && !gameState.stackWindow.active) {
            socket.emit('draw_deck');
        }
    };

    const handleClickDiscard = () => {
        if (isMyTurn && !gameState.drawnCard && !ability && !gameState.stackWindow.active && topDiscard) {
            setUiMode('select_draw_discard');
        } else if (isMyTurn && gameState.drawnCard && uiMode === 'default') {
            socket.emit('discard_drawn_card');
        }
    };

    const handleMyCardClick = (index) => {
        // Stack mode
        if (isStackCaller) {
            if (selectedOppIndex !== null) {
                // Offensive stack: picking which of our cards to give
                setSelectedMyIndex(selectedMyIndex === index ? null : index);
            } else {
                // Self-stack: picking our card to match
                setSelectedMyIndex(selectedMyIndex === index ? null : index);
            }
            return;
        }

        // Jack phase 2: opponent responds
        if (isJackPhase2Me) {
            setSelectedMyIndex(selectedMyIndex === index ? null : index);
            return;
        }

        // Ability resolution
        if (iPlayedAbility) {
            const type = ability.type;
            if (type === '6') {
                socket.emit('play_ability_target', { type, targetData: { myIndex: index } });
            } else if (type === 'K') {
                setSelectedMyIndex(selectedMyIndex === index ? null : index);
            } else if (type === 'J' && isJackPhase1) {
                setSelectedMyIndex(selectedMyIndex === index ? null : index);
            }
            return;
        }

        if (!isMyTurn) return;

        if (uiMode === 'select_draw_discard') {
            socket.emit('draw_discard', { handIndex: index });
        } else if (gameState.drawnCard) {
            socket.emit('swap_drawn_card', { handIndex: index });
        }
    };

    const handleOppCardClick = (index) => {
        // Stack mode: stacker can target opponent cards (offensive stack)
        if (isStackCaller) {
            // Clear self-stack selection, switch to offensive
            setSelectedMyIndex(null);
            setSelectedOppIndex(selectedOppIndex === index ? null : index);
            return;
        }

        if (gameState.stackWindow.active) return;

        // Ability resolution
        if (iPlayedAbility) {
            const type = ability.type;
            if (type === '8') {
                socket.emit('play_ability_target', { type, targetData: { opponentId, oppIndex: index } });
            } else if (type === 'K') {
                setSelectedOppIndex(selectedOppIndex === index ? null : index);
            }
            return;
        }
    };

    // --- Confirm handlers ---

    const handleConfirmStack = () => {
        if (selectedOppIndex !== null) {
            // Offensive stack
            socket.emit('execute_stack', {
                targetPlayerId: opponentId,
                handIndex: selectedOppIndex,
                offensiveGiveIndex: selectedMyIndex
            });
        } else {
            // Self-stack
            socket.emit('execute_stack', {
                targetPlayerId: playerId,
                handIndex: selectedMyIndex
            });
        }
    };

    const handleConfirmKingSwap = () => {
        socket.emit('play_ability_target', {
            type: 'K',
            targetData: { myIndex: selectedMyIndex, opponentId, oppIndex: selectedOppIndex }
        });
    };

    const handleConfirmJackPhase1 = () => {
        socket.emit('play_ability_target', {
            type: 'J',
            targetData: { myIndex: selectedMyIndex }
        });
    };

    const handleConfirmJackPhase2 = () => {
        socket.emit('jack_respond', { myIndex: selectedMyIndex });
    };

    const handleCallStack = () => {
        socket.emit('call_stack');
    };

    // --- Status message ---

    let statusStr = "";
    if (gameState.status === 'phase1') {
        statusStr = "Memorize your bottom two cards! Game starts in 10s...";
    } else if (gameState.status === 'finished') {
        if (me.score === opp?.score) {
            statusStr = `Game Over! It's a Tie! (${me.score} - ${opp?.score})`;
        } else {
            statusStr = `Game Over! ${me.score < opp?.score ? 'You Win!' : 'You Lose!'} (You: ${me.score}, Opp: ${opp?.score})`;
        }
    } else if (gameState.stackWindow.active) {
        if (isStackCaller) {
            if (selectedOppIndex !== null && selectedMyIndex !== null) {
                statusStr = "Cards selected! Press Confirm to stack.";
            } else if (selectedOppIndex !== null) {
                statusStr = "Opponent's card selected! Now choose one of your cards to give them.";
            } else if (selectedMyIndex !== null) {
                statusStr = "Card selected! Press Confirm to stack.";
            } else {
                statusStr = "You called STACK! Select a card from either hand that matches the discard.";
            }
        } else {
            statusStr = "Opponent called STACK! Waiting for them...";
        }
    } else if (ability) {
        if (isJackPhase2Me) {
            statusStr = selectedMyIndex !== null
                ? "Card selected! Press Confirm to give it up."
                : `${opp?.name} played a Jack! Select one of your cards to give them.`;
        } else if (isJackWaiting) {
            statusStr = `Waiting for ${opp?.name} to choose their card...`;
        } else if (iPlayedAbility) {
            const type = ability.type;
            if (type === 'K') {
                if (selectedMyIndex !== null && selectedOppIndex !== null) {
                    statusStr = "Cards selected! Press Confirm to swap.";
                } else if (selectedMyIndex !== null) {
                    statusStr = "King! Now select an opponent's card to swap with.";
                } else if (selectedOppIndex !== null) {
                    statusStr = "King! Now select one of your cards to swap.";
                } else {
                    statusStr = "You played a King! Select a card from each hand to swap.";
                }
            } else if (isJackPhase1) {
                statusStr = selectedMyIndex !== null
                    ? "Card selected! Press Confirm."
                    : "You played a Jack! Select one of your cards to swap.";
            } else if (type === '8') {
                statusStr = "You played an 8! Select one of your opponent's cards to peek at.";
            } else if (type === '6') {
                statusStr = "You played a 6! Select one of your cards to peek at.";
            }
        } else {
            statusStr = "Waiting for opponent to resolve ability...";
        }
    } else if (uiMode === 'select_draw_discard') {
        statusStr = "Select a card from your hand to replace with the discard.";
    } else if (isMyTurn) {
        statusStr = gameState.drawnCard
            ? "Swap drawn card with your hand, or discard it."
            : `Your Turn: Draw from ${topDiscard ? 'Deck or Discard' : 'the Deck'}.`;
    } else if (gameState.endTriggeredBy && gameState.endTriggeredBy !== playerId) {
        statusStr = "Opponent CALLED IT! You have one final turn!";
    } else {
        statusStr = `Waiting for ${opp?.name}'s turn...`;
    }

    // --- Confirm button visibility ---

    const showStackConfirmSelf = isStackCaller && selectedMyIndex !== null && selectedOppIndex === null;
    const showStackConfirmOffensive = isStackCaller && selectedOppIndex !== null && selectedMyIndex !== null;
    const showStackConfirm = showStackConfirmSelf || showStackConfirmOffensive;

    const showKingConfirm = iPlayedAbility && ability?.type === 'K' &&
        selectedMyIndex !== null && selectedOppIndex !== null;

    const showJackPhase1Confirm = isJackPhase1 && selectedMyIndex !== null;
    const showJackPhase2Confirm = isJackPhase2Me && selectedMyIndex !== null;
    const showAnyConfirm = showStackConfirm || showKingConfirm || showJackPhase1Confirm || showJackPhase2Confirm;

    // --- Card key helper (stable key for animations) ---
    const cardKey = (card, slotIndex, prefix) => {
        if (!card) return `${prefix}-empty-${slotIndex}`;
        return `${prefix}-${card.id}-${card.value}-${card.suit}`;
    };

    return (
        <div className="app-container">
            {/* Toast notifications */}
            <div className="toast-container">
                {toasts.map(t => (
                    <div key={t.id} className={`toast toast-${t.type}`}>
                        {t.message}
                    </div>
                ))}
            </div>

            {/* Failed stack card reveal */}
            {revealCard && (
                <div className="reveal-overlay">
                    <Card card={{ ...revealCard, isFaceUp: true }} />
                    <p className="reveal-label">Not a match!</p>
                </div>
            )}

            {/* Card movement overlay — shows which card was just played */}
            {actionCard && !revealCard && (
                <div className="action-overlay">
                    <Card card={actionCard.card} />
                    <p className="action-label">{actionCard.playerName} played</p>
                </div>
            )}

            <div className="header">
                <div>
                    <h2>{opp?.name}</h2>
                    {gameState.status === 'finished' && <h3>Score: {opp?.score}</h3>}
                </div>
                <div>
                    <h1 style={{ margin: 0 }}>Windows</h1>
                    <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{gameState.deck.length} cards left</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <h2>{me.name} (You)</h2>
                    {gameState.status === 'finished' && <h3>Score: {me.score}</h3>}
                </div>
            </div>

            <div className="status-banner">
                {statusStr}
            </div>

            {/* Opponent Hand */}
            <div className="player-area">
                <p className="hand-label">{opp?.name}'s Hand</p>
                <div className="hand-grid">
                    {opp?.hand.map((card, i) => {
                        const hlColor = getOppCardHighlight(i);
                        return (
                            <AnimatePresence mode="wait" key={`opp-slot-${i}`}>
                                <motion.div
                                    key={cardKey(card, i, 'opp')}
                                    initial={oppCardEnter}
                                    animate={cardAnimate}
                                    exit={oppCardExit}
                                    transition={cardTransition}
                                >
                                    <Card
                                        card={card}
                                        onClick={() => handleOppCardClick(i)}
                                        highlight={!!hlColor}
                                        highlightColor={hlColor}
                                    />
                                </motion.div>
                            </AnimatePresence>
                        );
                    })}
                </div>
            </div>

            {/* Center Table */}
            <div className="center-area glass-panel" style={{ position: 'relative' }}>

                <div
                    className={`pile ${isMyTurn && !gameState.drawnCard && !ability && !gameState.stackWindow.active ? 'highlight' : ''}`}
                    data-label="DECK"
                    onClick={handleClickDeck}
                    style={{ cursor: (isMyTurn && !gameState.drawnCard && !ability) ? 'pointer' : 'default', background: 'rgba(255,255,255,0.05)' }}
                >
                    <div className="card-container" style={{ pointerEvents: 'none' }}>
                        <div className="card-inner">
                            <div className="card-face card-front"></div>
                        </div>
                    </div>
                </div>

                <div
                    className={`pile ${isMyTurn && topDiscard && !gameState.drawnCard && !ability && !gameState.stackWindow.active ? 'highlight' : ''}`}
                    data-label="DISCARD"
                    onClick={handleClickDiscard}
                    style={{ cursor: (isMyTurn && topDiscard) ? 'pointer' : 'default' }}
                >
                    <AnimatePresence mode="wait">
                        {topDiscard && (
                            <motion.div
                                key={`discard-${topDiscard.id}`}
                                {...discardAnim}
                            >
                                <Card card={topDiscard} />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {gameState.drawnCard && (
                    <div className="drawn-card-overlay">
                        <Card card={gameState.drawnCard} isFaceUpOverride={me.id === gameState.playerOrder[gameState.turnIndex]} />
                        {me.id === gameState.playerOrder[gameState.turnIndex] && (
                            <div style={{ textAlign: 'center', marginTop: '10px', display: 'flex', gap: '5px', justifyContent: 'center' }}>
                                <button className="btn-primary" style={{ padding: '0.5rem', fontSize: '0.8rem' }} onClick={() => socket.emit('discard_drawn_card')}>Discard</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Confirm button */}
                {showAnyConfirm && (
                    <div className="confirm-overlay">
                        {showStackConfirm && (
                            <button className="btn-confirm" onClick={handleConfirmStack}>
                                {showStackConfirmOffensive ? 'Confirm Offensive Stack' : 'Confirm Stack'}
                            </button>
                        )}
                        {showKingConfirm && (
                            <button className="btn-confirm" onClick={handleConfirmKingSwap}>Confirm Swap</button>
                        )}
                        {showJackPhase1Confirm && (
                            <button className="btn-confirm" onClick={handleConfirmJackPhase1}>Confirm</button>
                        )}
                        {showJackPhase2Confirm && (
                            <button className="btn-confirm" onClick={handleConfirmJackPhase2}>Confirm</button>
                        )}
                    </div>
                )}
            </div>

            {/* Action Buttons — Stack, Call It */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexShrink: 0 }}>
                {topDiscard && !gameState.stackWindow.active && (
                    <div className="stack-btn-wrapper">
                        <button className="btn-accent" onClick={handleCallStack} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.6rem 1.2rem', fontSize: '1rem' }}>
                            <Layers size={16} /> STACK!
                        </button>
                    </div>
                )}
                {isMyTurn && !gameState.drawnCard && !ability && !gameState.stackWindow.active && gameState.status === 'playing' && (
                    <button className="btn-primary" onClick={() => socket.emit('call_it')} style={{ background: 'var(--accent)', padding: '0.6rem 1.2rem', fontSize: '1rem', boxShadow: '0 4px 15px rgba(225, 29, 72, 0.4)' }}>
                        Call It!
                    </button>
                )}
            </div>

            {/* My Hand */}
            <div className="player-area">
                <p className="hand-label">Your Hand</p>
                <div className="hand-grid">
                    {me.hand.map((card, i) => {
                        const hlColor = getMyCardHighlight(i);
                        return (
                            <AnimatePresence mode="wait" key={`me-slot-${i}`}>
                                <motion.div
                                    key={cardKey(card, i, 'me')}
                                    initial={myCardEnter}
                                    animate={cardAnimate}
                                    exit={myCardExit}
                                    transition={cardTransition}
                                >
                                    <Card
                                        card={card}
                                        onClick={() => handleMyCardClick(i)}
                                        highlight={!!hlColor}
                                        highlightColor={hlColor}
                                        isFaceUpOverride={card?.knownToPlayer}
                                    />
                                </motion.div>
                            </AnimatePresence>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default GameBoard;
