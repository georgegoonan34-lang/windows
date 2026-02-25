import React from 'react';

function Card({ card, onClick, highlight, highlightColor, disabled, isFaceUpOverride }) {
    const highlightClass = highlight
        ? (highlightColor === 'red' ? 'highlight-red' : highlightColor === 'green' ? 'highlight-green' : 'highlight')
        : '';

    // If card is null, it's an empty slot
    if (!card) {
        return (
            <div
                className={`card-container ${highlightClass}`}
                onClick={!disabled ? onClick : undefined}
                style={{ border: '2px dashed rgba(255,255,255,0.2)', opacity: disabled ? 0.5 : 1 }}
            ></div>
        );
    }

    const isFlipped = isFaceUpOverride || card.isFaceUp || card.knownToPlayer;
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

    const getSuitSymbol = (suit) => {
        switch (suit) {
            case 'hearts': return '♥';
            case 'diamonds': return '♦';
            case 'clubs': return '♣';
            case 'spades': return '♠';
            default: return '🃏'; // Joker
        }
    };

    return (
        <div
            className={`card-container ${isFlipped ? 'flipped' : ''} ${disabled ? 'disabled' : ''} ${highlightClass}`}
            onClick={!disabled ? onClick : undefined}
        >
            <div className="card-inner">
                <div className="card-face card-front">
                    <div style={{ width: '40px', height: '40px', border: '2px solid rgba(255,255,255,0.1)', borderRadius: '50%' }}></div>
                </div>

                <div className={`card-face card-back ${isRed ? 'red-suit' : 'black-suit'}`}>
                    <div style={{ position: 'absolute', top: '10px', left: '10px', fontSize: '1.2rem', lineHeight: '1' }}>
                        {card.value}
                        <div style={{ fontSize: '1rem' }}>{getSuitSymbol(card.suit)}</div>
                    </div>

                    <div className="card-suit" style={{ opacity: 0.8 }}>
                        {getSuitSymbol(card.suit)}
                    </div>

                    <div style={{ position: 'absolute', bottom: '10px', right: '10px', fontSize: '1.2rem', lineHeight: '1', transform: 'rotate(180deg)' }}>
                        {card.value}
                        <div style={{ fontSize: '1rem' }}>{getSuitSymbol(card.suit)}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Card;
