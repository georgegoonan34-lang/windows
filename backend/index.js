const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createDeck, createGameState, dealInitial, calculateScore } = require('./gameLogic');

const app = express();
app.use(cors());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const activeGames = {}; // roomId -> gameState

function getRoom(socket) {
    return Array.from(socket.rooms).find(r => r !== socket.id);
}

// --- Notification helpers ---

function notifyRoom(roomId, message, type = 'info') {
    io.to(roomId).emit('game_notification', { message, type });
}

function notifyPlayer(socketId, message, type = 'info') {
    io.to(socketId).emit('game_notification', { message, type });
}

function getPlayerName(game, socketId) {
    return game.players[socketId]?.name || 'Unknown';
}

function getOpponentId(game, socketId) {
    return game.playerOrder.find(id => id !== socketId);
}

io.on('connection', (socket) => {
    console.log('User connected', socket.id);

    socket.on('join_game', ({ roomId, playerName }) => {
        socket.join(roomId);

        if (!activeGames[roomId]) {
            activeGames[roomId] = createGameState();
        }

        const game = activeGames[roomId];
        if (game.playerOrder.length < 2 && !game.players[socket.id]) {
            const pNum = game.playerOrder.length + 1;
            game.players[socket.id] = {
                id: socket.id,
                number: pNum,
                name: playerName,
                hand: [null, null, null, null],
                score: 0,
                ready: false,
                isFinalTurn: false
            };
            game.playerOrder.push(socket.id);
        }

        sendGameState(game, roomId);
    });

    socket.on('player_ready', () => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game) return;

        game.players[socket.id].ready = true;

        const allReady = game.playerOrder.length === 2 &&
            game.playerOrder.every(id => game.players[id].ready);

        if (allReady && game.status === 'lobby') {
            dealInitial(game);
            game.status = 'phase1';
            sendGameState(game, roomId);

            setTimeout(() => {
                if (activeGames[roomId] && activeGames[roomId].status === 'phase1') {
                    activeGames[roomId].status = 'playing';
                    for (const pId of activeGames[roomId].playerOrder) {
                        const player = activeGames[roomId].players[pId];
                        if (player.hand[2]) player.hand[2].knownToPlayer = false;
                        if (player.hand[3]) player.hand[3].knownToPlayer = false;
                    }
                    sendGameState(activeGames[roomId], roomId);
                    notifyRoom(roomId, `${getPlayerName(activeGames[roomId], activeGames[roomId].playerOrder[0])}'s turn!`, 'info');
                }
            }, 10000);
        } else {
            sendGameState(game, roomId);
        }
    });

    // Action: Draw from deck
    socket.on('draw_deck', () => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || game.playerOrder[game.turnIndex] !== socket.id) return;
        if (game.drawnCard || game.activeAbility) return;

        game.drawnCard = game.deck.pop();
        sendGameState(game, roomId);
    });

    // Action: Draw from discard pile (must swap instantly)
    socket.on('draw_discard', ({ handIndex }) => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || game.playerOrder[game.turnIndex] !== socket.id) return;
        if (game.drawnCard || game.activeAbility || game.discardPile.length === 0) return;

        const discardCard = game.discardPile.pop();
        const player = game.players[socket.id];
        const oldCard = player.hand[handIndex];

        io.to(roomId).emit('card_animation', { movements: [
            { from: 'discard', to: { player: socket.id, index: handIndex } },
            { from: { player: socket.id, index: handIndex }, to: 'discard' }
        ]});

        discardCard.isFaceUp = false;
        discardCard.knownToPlayer = false;
        player.hand[handIndex] = discardCard;

        handleDiscard(game, oldCard, socket.id, roomId);
    });

    // Action: Swap drawn card with hand slot
    socket.on('swap_drawn_card', ({ handIndex }) => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || game.playerOrder[game.turnIndex] !== socket.id) return;
        if (!game.drawnCard) return;

        const player = game.players[socket.id];
        const oldCard = player.hand[handIndex];

        io.to(roomId).emit('card_animation', { movements: [
            { from: 'drawn', to: { player: socket.id, index: handIndex } },
            { from: { player: socket.id, index: handIndex }, to: 'discard' }
        ]});

        game.drawnCard.isFaceUp = false;
        game.drawnCard.knownToPlayer = false;
        player.hand[handIndex] = game.drawnCard;
        game.drawnCard = null;

        handleDiscard(game, oldCard, socket.id, roomId);
    });

    // Action: Discard the card we just drew from deck
    socket.on('discard_drawn_card', () => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || game.playerOrder[game.turnIndex] !== socket.id) return;
        if (!game.drawnCard) return;

        const card = game.drawnCard;
        game.drawnCard = null;

        io.to(roomId).emit('card_animation', { movements: [
            { from: 'drawn', to: 'discard' }
        ]});

        handleDiscard(game, card, socket.id, roomId);
    });

    // Action: Call Stack — can be called by either player at any time there's a discard
    socket.on('call_stack', () => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || game.discardPile.length === 0) return;
        if (game.stackWindow.active) return;

        game.stackWindow.active = true;
        game.stackWindow.caller = socket.id;
        game.stackWindow.targetValue = game.discardPile[game.discardPile.length - 1].value;

        const callerName = getPlayerName(game, socket.id);
        notifyRoom(roomId, `${callerName} called STACK!`, 'info');
        sendGameState(game, roomId);
    });

    // Action: Play Again
    socket.on('play_again', () => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || game.status !== 'finished') return;

        // Reset game state but keep players
        game.status = 'phase1';
        game.turnIndex = 0;
        game.deck = [];
        game.discardPile = [];
        game.drawnCard = null;
        game.activeAbility = null;
        game.stackWindow = { active: false, caller: null, targetValue: null };
        game.endTriggeredBy = null;

        for (const pId of game.playerOrder) {
            const player = game.players[pId];
            player.hand = [null, null, null, null];
            player.score = 0;
            player.isFinalTurn = false;
        }

        dealInitial(game);
        sendGameState(game, roomId);

        setTimeout(() => {
            if (activeGames[roomId] && activeGames[roomId].status === 'phase1') {
                activeGames[roomId].status = 'playing';
                for (const pId of activeGames[roomId].playerOrder) {
                    const player = activeGames[roomId].players[pId];
                    if (player.hand[2]) player.hand[2].knownToPlayer = false;
                    if (player.hand[3]) player.hand[3].knownToPlayer = false;
                }
                sendGameState(activeGames[roomId], roomId);
                notifyRoom(roomId, `${getPlayerName(activeGames[roomId], activeGames[roomId].playerOrder[0])}'s turn!`, 'info');
            }
        }, 10000);
    });

    // Action: Call It (End Game)
    socket.on('call_it', () => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || game.playerOrder[game.turnIndex] !== socket.id) return;
        if (game.drawnCard || game.activeAbility || game.stackWindow.active || game.status !== 'playing') return;

        game.endTriggeredBy = socket.id;
        const callerName = getPlayerName(game, socket.id);
        notifyRoom(roomId, `${callerName} CALLED IT! Final round!`, 'info');
        advanceTurn(game, roomId);
    });

    // Action: Execute Stack
    socket.on('execute_stack', ({ targetPlayerId, handIndex, offensiveGiveIndex }) => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || !game.stackWindow.active || game.stackWindow.caller !== socket.id) return;

        const targetPlayer = game.players[targetPlayerId];
        const chosenCard = targetPlayer.hand[handIndex];
        const callerMatches = chosenCard && chosenCard.value === game.stackWindow.targetValue;
        const callerPlayer = game.players[socket.id];
        const callerName = callerPlayer.name;

        if (callerMatches) {
            const stackMovements = [
                { from: { player: targetPlayerId, index: handIndex }, to: 'discard' }
            ];
            if (targetPlayerId !== socket.id && offensiveGiveIndex !== undefined) {
                stackMovements.push({ from: { player: socket.id, index: offensiveGiveIndex }, to: { player: targetPlayerId, index: handIndex } });
            }
            io.to(roomId).emit('card_animation', { movements: stackMovements });

            // Success — remove the matched card and push to discard
            targetPlayer.hand[handIndex] = null;
            chosenCard.isFaceUp = true;
            game.discardPile.push(chosenCard);

            if (targetPlayerId !== socket.id) {
                // Offensive stack — caller gives opponent one of their cards
                const givenCard = callerPlayer.hand[offensiveGiveIndex];
                if (givenCard) {
                    callerPlayer.hand[offensiveGiveIndex] = null;
                    givenCard.isFaceUp = false;
                    givenCard.knownToPlayer = false;
                    targetPlayer.hand[handIndex] = givenCard;
                }
            }

            // Cancel any in-progress ability — the stack interrupts it
            game.activeAbility = null;

            // If the stacked card is an ability card, the stacker gets the ability
            // But only if they have the cards needed to use it
            if (['K', 'J', '8', '6'].includes(chosenCard.value)) {
                const stackerCards = callerPlayer.hand.filter(c => c !== null);
                const canUseAbility =
                    chosenCard.value === '8' ? true : // peek opponent — always usable
                    stackerCards.length > 0;          // K, J, 6 all need at least 1 own card

                if (canUseAbility) {
                    game.activeAbility = { type: chosenCard.value, player: socket.id };
                }
            }

            notifyRoom(roomId, `Stack successful! ${callerName} matched the ${chosenCard.value}.`, 'success');
        } else {
            // Failed stack — penalty card drawn blind
            if (game.deck.length > 0) {
                const penaltyCard = game.deck.pop();
                penaltyCard.isFaceUp = false;
                penaltyCard.knownToPlayer = false;
                callerPlayer.hand.push(penaltyCard);
            }

            const oppId = getOpponentId(game, socket.id);
            if (chosenCard) {
                io.to(socket.id).emit('stack_reveal', { card: chosenCard });
            }
            notifyPlayer(socket.id, 'Stack failed! You draw a penalty card.', 'error');
            if (oppId) notifyPlayer(oppId, `${callerName}'s stack failed!`, 'info');
        }

        game.stackWindow = { active: false, caller: null, targetValue: null };

        // Check if any player has 0 cards — end game immediately
        if (callerMatches) {
            const anyEmpty = game.playerOrder.some(pId =>
                game.players[pId].hand.every(c => c === null)
            );
            if (anyEmpty) {
                game.activeAbility = null;
                promptEndGame(game, roomId);
                return;
            }
        }

        // If stack cancelled an ability and no new ability was triggered, advance the turn
        if (callerMatches && !game.activeAbility) {
            checkEndGameAndAdvance(game, roomId);
        } else {
            sendGameState(game, roomId);
        }
    });

    // Abilities Handling
    socket.on('play_ability_target', ({ type, targetData }) => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || game.activeAbility?.player !== socket.id || game.activeAbility?.type !== type) return;

        if (type === 'K') {
            io.to(roomId).emit('card_animation', { movements: [
                { from: { player: socket.id, index: targetData.myIndex }, to: { player: targetData.opponentId, index: targetData.oppIndex } },
                { from: { player: targetData.opponentId, index: targetData.oppIndex }, to: { player: socket.id, index: targetData.myIndex } }
            ]});
            const p1 = game.players[socket.id];
            const p2 = game.players[targetData.opponentId];
            const temp = p1.hand[targetData.myIndex];
            p1.hand[targetData.myIndex] = p2.hand[targetData.oppIndex];
            p2.hand[targetData.oppIndex] = temp;
            notifyRoom(roomId, 'Cards swapped!', 'info');
        } else if (type === 'J') {
            // Phase 1: Jack player chose their card, now opponent must choose
            game.activeAbility.jackPhase = 'opponent_choose';
            game.activeAbility.jackMyIndex = targetData.myIndex;
            const oppId = getOpponentId(game, socket.id);
            if (oppId) notifyPlayer(oppId, `${getPlayerName(game, socket.id)} played a Jack! Choose a card to give up.`, 'info');
            sendGameState(game, roomId);
            return; // Don't clear ability or advance turn yet
        } else if (type === '8') {
            const opp = game.players[targetData.opponentId];
            const revealedCard = opp.hand[targetData.oppIndex];
            opp.hand[targetData.oppIndex].knownToOpponent = true;
            socket.emit('ability_reveal', { card: revealedCard, index: targetData.oppIndex, player: targetData.opponentId });
            notifyPlayer(targetData.opponentId, `${getPlayerName(game, socket.id)} peeked at one of your cards!`, 'info');
            setTimeout(() => {
                if (activeGames[roomId]) {
                    revealedCard.knownToOpponent = false;
                    sendGameState(activeGames[roomId], roomId);
                }
            }, 5000);
        } else if (type === '6') {
            const p1 = game.players[socket.id];
            const revealedCard = p1.hand[targetData.myIndex];
            p1.hand[targetData.myIndex].knownToPlayer = true;
            socket.emit('ability_reveal', { card: revealedCard, index: targetData.myIndex, player: socket.id });
            setTimeout(() => {
                if (activeGames[roomId]) {
                    revealedCard.knownToPlayer = false;
                    sendGameState(activeGames[roomId], roomId);
                }
            }, 5000);
        }

        game.activeAbility = null;
        checkEndGameAndAdvance(game, roomId);
    });

    // Jack Phase 2: Opponent responds with their card choice
    socket.on('jack_respond', ({ myIndex }) => {
        const roomId = getRoom(socket);
        const game = activeGames[roomId];
        if (!game || !game.activeAbility || game.activeAbility.type !== 'J') return;
        if (game.activeAbility.jackPhase !== 'opponent_choose') return;

        const jackPlayerId = game.activeAbility.player;
        if (socket.id === jackPlayerId) return;

        const jackPlayer = game.players[jackPlayerId];
        const opponent = game.players[socket.id];
        const jackIndex = game.activeAbility.jackMyIndex;

        io.to(roomId).emit('card_animation', { movements: [
            { from: { player: jackPlayerId, index: jackIndex }, to: { player: socket.id, index: myIndex } },
            { from: { player: socket.id, index: myIndex }, to: { player: jackPlayerId, index: jackIndex } }
        ]});

        const temp = jackPlayer.hand[jackIndex];
        jackPlayer.hand[jackIndex] = opponent.hand[myIndex];
        opponent.hand[myIndex] = temp;

        notifyRoom(roomId, 'Cards swapped!', 'info');

        game.activeAbility = null;
        checkEndGameAndAdvance(game, roomId);
    });

    socket.on('disconnecting', () => {
        const roomId = getRoom(socket);
        if (activeGames[roomId]) {
            // handle disconnect simply for now
        }
    });

});

function handleDiscard(game, card, socketId, roomId) {
    if (!card) {
        checkEndGameAndAdvance(game, roomId);
        return;
    }

    card.isFaceUp = true;
    game.discardPile.push(card);

    // Check for abilities
    if (['K', 'J', '8', '6'].includes(card.value)) {
        game.activeAbility = { type: card.value, player: socketId };
        const playerName = getPlayerName(game, socketId);
        const labels = { 'K': 'King', 'J': 'Jack', '8': '8', '6': '6' };
        notifyRoom(roomId, `${playerName} played a ${labels[card.value]}!`, 'info');
        sendGameState(game, roomId);
        return;
    }

    checkEndGameAndAdvance(game, roomId);
}

function checkEndGameAndAdvance(game, roomId) {
    const currentPlayerId = game.playerOrder[game.turnIndex];
    const player = game.players[currentPlayerId];

    const allFaceUp = player.hand.every(c => c === null || c.isFaceUp);

    if (allFaceUp && !player.isFinalTurn) {
        player.isFinalTurn = true;
        promptEndGame(game, roomId);
        return;
    }

    advanceTurn(game, roomId);
}

function promptEndGame(game, roomId) {
    game.status = 'finished';

    for (const pId of game.playerOrder) {
        game.players[pId].hand.forEach(c => {
            if (c) c.isFaceUp = true;
        });
        game.players[pId].score = calculateScore(game.players[pId].hand);
    }

    sendGameState(game, roomId);
}

function advanceTurn(game, roomId) {
    game.turnIndex = (game.turnIndex + 1) % game.playerOrder.length;
    game.drawnCard = null;

    const nextPlayerId = game.playerOrder[game.turnIndex];
    if (game.endTriggeredBy === nextPlayerId) {
        promptEndGame(game, roomId);
        return;
    }

    const nextName = getPlayerName(game, nextPlayerId);
    notifyRoom(roomId, `${nextName}'s turn`, 'info');
    sendGameState(game, roomId);
}

function sendGameState(game, roomId) {
    for (const socketId of Object.keys(game.players)) {
        io.to(socketId).emit('game_state_update', sanitizeGameState(game, socketId));
    }
}

function sanitizeGameState(game, socketId) {
    const safeGame = JSON.parse(JSON.stringify(game));
    const isPlaying = safeGame.status === 'playing' || safeGame.status === 'phase1' || safeGame.status === 'finished';

    if (isPlaying) {
        for (const [pId, player] of Object.entries(safeGame.players)) {
            player.hand.forEach((card, i) => {
                if (card && !card.isFaceUp && safeGame.status !== 'finished') {
                    let canSee = false;

                    if (safeGame.status === 'phase1' && pId === socketId && (i === 2 || i === 3)) canSee = true;
                    if (card.knownToPlayer && pId === socketId) canSee = true;
                    if (card.knownToOpponent && pId !== socketId) canSee = true;

                    if (!canSee) {
                        card.value = '?';
                        card.suit = '?';
                        card.id = 'hidden_' + i;
                    }
                }
            });
        }

        if (safeGame.drawnCard && safeGame.playerOrder[safeGame.turnIndex] !== socketId && safeGame.status !== 'finished') {
            safeGame.drawnCard.value = '?';
            safeGame.drawnCard.suit = '?';
            safeGame.drawnCard.id = 'hidden_drawn';
        }
    }

    return safeGame;
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log('Backend listening on', PORT);
});
