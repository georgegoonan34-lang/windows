const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Create a standard 54 card deck
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ id: `${value}_${suit}`, suit, value, isFaceUp: false });
    }
  }
  deck.push({ id: 'Joker_1', suit: 'none', value: 'Joker', isFaceUp: false });
  deck.push({ id: 'Joker_2', suit: 'none', value: 'Joker', isFaceUp: false });
  return deck;
}

function shuffle(deck) {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
}

// Player's 4 cards are structured as an array of 4 slots. 
// Index 0: Top Left, Index 1: Top Right, Index 2: Bottom Left, Index 3: Bottom Right
function createGameState() {
  return {
    status: 'lobby', // lobby, phase1 (reveal), playing, finished
    players: {}, // socketId -> { id, number: 1|2, name, hand: [Card|null x4], score: 0, ready: false, isFinalTurn: false }
    playerOrder: [], // [socketId1, socketId2]
    turnIndex: 0,
    deck: [],
    discardPile: [],
    drawnCard: null, // the card currently drawn but not yet placed by the active player
    activeAbility: null, // { type: 'king'|'jack'|'8'|'6', player: socketId } -> state for multi-step abilities
    stackWindow: { active: false, cardMatches: null } // used to track realtime stacking
  };
}

function dealInitial(gameState) {
  let deck = shuffle(createDeck());
  
  // Deal 4 cards to each player
  for (const pId of gameState.playerOrder) {
    const player = gameState.players[pId];
    player.hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    
    // As per rules, bottom two cards (index 2 and 3) are revealed to the player only.
    // In our state, isFaceUp means visible to everyone. We will send a special payload
    // to the player so they know their bottom two cards privately during phase 1,
    // or we can just set a local property 'knownToPlayer: true'
    player.hand[2].knownToPlayer = true;
    player.hand[3].knownToPlayer = true;
  }

  gameState.deck = deck;
}

function getCardValue(card) {
  if (card.value === 'Joker') return -1;
  if (card.value === 'Q' && (card.suit === 'hearts' || card.suit === 'diamonds')) return 0;
  if (card.value === 'A') return 1;
  if (card.value === 'J' || card.value === 'Q' || card.value === 'K') return 10;
  return parseInt(card.value);
}

function calculateScore(hand) {
  return hand.reduce((acc, card) => {
    if (!card) return acc;
    return acc + getCardValue(card);
  }, 0);
}

module.exports = {
  createDeck,
  shuffle,
  createGameState,
  dealInitial,
  getCardValue,
  calculateScore
};
