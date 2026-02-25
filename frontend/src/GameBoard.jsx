import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Card from './Card';
import { Layers } from 'lucide-react';

let toastIdCounter = 0;
let flyingIdCounter = 0;

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
    const [flyingCards, setFlyingCards] = useState([]);

    const toastTimers = useRef({});
    const mySlotRefs = useRef({});
    const oppSlotRefs = useRef({});
    const discardRef = useRef(null);
    const deckRef = useRef(null);

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

    useEffect(() => {
        return () => Object.values(toastTimers.current).forEach(clearTimeout);
    }, []);

    // --- Flying card animation system ---

    const getPositionFor = useCallback((loc) => {
        if (loc === 'discard' && discardRef.current) {
            const rect = discardRef.current.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        if (loc === 'drawn') {
            // Drawn card overlay is centered on screen at 1.4x scale
            return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        }
        if (typeof loc === 'object' && loc.player !== undefined) {
            const isMe = loc.player === playerId;
            const refs = isMe ? mySlotRefs.current : oppSlotRefs.current;
            const el = refs[loc.index];
            if (el) {
                const rect = el.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
        }
        return null;
    }, [playerId]);

    useEffect(() => {
        const handleAnimation = ({ movements }) => {
            const newFlyers = [];
            for (const move of movements) {
                const fromPos = getPositionFor(move.from);
                const toPos = getPositionFor(move.to);
                if (!fromPos || !toPos) continue;

                const id = ++flyingIdCounter;
                newFlyers.push({ id, fromPos, toPos });
            }
            if (newFlyers.length === 0) return;

            setFlyingCards(prev => [...prev, ...newFlyers]);

            // Remove after animation completes
            setTimeout(() => {
                setFlyingCards(prev => prev.filter(fc => !newFlyers.some(nf => nf.id === fc.id)));
            }, 650);
        };
        socket.on('card_animation', handleAnimation);
        return () => socket.off('card_animation', handleAnimation);
    }, [socket, getPositionFor]);

    // Reset selections when game state changes (use stable keys to avoid spurious resets)
    const abilityKey = gameState.activeAbility
        ? `${gameState.activeAbility.type}-${gameState.activeAbility.player}-${gameState.activeAbility.jackPhase || ''}`
        : null;
    const hasDrawnCard = !!gameState.drawnCard;

    useEffect(() => {
        setSelectedMyIndex(null);
        setSelectedOppIndex(null);
        setUiMode('default');
    }, [gameState.turnIndex, hasDrawnCard, abilityKey, gameState.stackWindow.active]);

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
                return selectedMyIndex === index ? 'green' : 'red';
            }
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
        if (isStackCaller) {
            if (selectedOppIndex !== null) {
                setSelectedMyIndex(selectedMyIndex === index ? null : index);
            } else {
                setSelectedMyIndex(selectedMyIndex === index ? null : index);
            }
            return;
        }

        if (isJackPhase2Me) {
            setSelectedMyIndex(selectedMyIndex === index ? null : index);
            return;
        }

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
        if (isStackCaller) {
            setSelectedMyIndex(null);
            setSelectedOppIndex(selectedOppIndex === index ? null : index);
            return;
        }

        if (gameState.stackWindow.active) return;

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
            socket.emit('execute_stack', {
                targetPlayerId: opponentId,
                handIndex: selectedOppIndex,
                offensiveGiveIndex: selectedMyIndex
            });
        } else {
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

    // --- Flying card dimensions ---
    const CARD_W = 80;
    const CARD_H = 112;

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

            {/* Flying card animations */}
            {flyingCards.map(fc => (
                <motion.div
                    key={fc.id}
                    initial={{
                        position: 'fixed',
                        left: fc.fromPos.x - CARD_W / 2,
                        top: fc.fromPos.y - CARD_H / 2,
                        width: CARD_W,
                        height: CARD_H,
                        zIndex: 500,
                        opacity: 1,
                    }}
                    animate={{
                        left: fc.toPos.x - CARD_W / 2,
                        top: fc.toPos.y - CARD_H / 2,
                        opacity: 1,
                    }}
                    transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
                    style={{ position: 'fixed', pointerEvents: 'none', zIndex: 500 }}
                >
                    <div className="card-container" style={{ pointerEvents: 'none' }}>
                        <div className="card-inner">
                            <div className="card-face card-front"></div>
                        </div>
                    </div>
                </motion.div>
            ))}

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
                {gameState.status === 'finished' && (
                    <button
                        className="btn-primary"
                        onClick={() => socket.emit('play_again')}
                        style={{ marginLeft: '1rem', padding: '0.3rem 1rem', fontSize: '0.85rem' }}
                    >
                        Play Again
                    </button>
                )}
            </div>

            {/* Opponent Hand */}
            <div className="player-area">
                <p className="hand-label">{opp?.name}'s Hand</p>
                <div className="hand-grid">
                    {opp?.hand.map((card, i) => {
                        const hlColor = getOppCardHighlight(i);
                        return (
                            <div key={`opp-slot-${i}`} ref={el => { oppSlotRefs.current[i] = el; }}>
                                <Card
                                    card={card}
                                    onClick={() => handleOppCardClick(i)}
                                    highlight={!!hlColor}
                                    highlightColor={hlColor}
                                    isFaceUpOverride={card?.knownToOpponent}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Center Table */}
            <div className="center-area glass-panel" style={{ position: 'relative' }}>

                <div
                    ref={deckRef}
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
                    ref={discardRef}
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
                            <div key={`me-slot-${i}`} ref={el => { mySlotRefs.current[i] = el; }}>
                                <Card
                                    card={card}
                                    onClick={() => handleMyCardClick(i)}
                                    highlight={!!hlColor}
                                    highlightColor={hlColor}
                                    isFaceUpOverride={card?.knownToPlayer}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default GameBoard;
