export enum Suit {
	Hearts = 'h',
	Diamonds = 'd',
	Clubs = 'c',
	Spades = 's',
}

//export type CardValue = 1|2|3|4|5|6|7|8|9|10|11|12|13|'A'|'J'|'Q'|'K'

export type CardColor = '🔴' | '⚫';

export type CardValue =
	| 'A'
	| '2'
	| '3'
	| '4'
	| '5'
	| '6'
	| '7'
	| '8'
	| '9'
	| '10'
	| 'J'
	| 'Q'
	| 'K'
	| '*';

export const CardSuit = {
	'♥️': Suit.Hearts,
	'♦️': Suit.Diamonds,
	'♠️': Suit.Spades,
	'♣️': Suit.Clubs,
};

export const SuitTag = {
	[Suit.Hearts]: '♥️',
	[Suit.Diamonds]: '♦️',
	[Suit.Spades]: '♠️',
	[Suit.Clubs]: '♣️',
};

export const STARTER_DECK = `A♥️|2♥️|3♥️|4♥️|5♥️|6♥️|7♥️|8♥️|9♥️|10♥️|J♥️|Q♥️|K♥️|
	 A♦️|2♦️|3♦️|4♦️|5♦️|6♦️|7♦️|8♦️|9♦️|10♦️|J♦️|Q♦️|K♦️|
	 A♠️|2♠️|3♠️|4♠️|5♠️|6♠️|7♠️|8♠️|9♠️|10♠️|J♠️|Q♠️|K♠️|
	 A♣️|2♣️|3♣️|4♣️|5♣️|6♣️|7♣️|8♣️|9♣️|10♣️|J♣️|Q♣️|K♣️|
	 *⚫|*🔴
	`
	.split('|')
	.map((i) => i.trim());

export function parseCardSuit(card: string): Suit {
	if (!card) return null;
	if (card.includes('♥️') || card == 'h') return Suit.Hearts;
	if (card.includes('♦️') || card == 'd') return Suit.Diamonds;
	if (card.includes('♠️') || card == 's') return Suit.Spades;
	if (card.includes('♣️') || card == 'c') return Suit.Clubs;
	return null;
}

export function parseCardValue(card: string): CardValue {
	const value = card.match(/10|[2-9AJQK]|\*|🃏/u)?.[0];
	if (value == '🃏') return '*';
	return (value ?? '*') as CardValue;
}

export function getSuitColor(suit: Suit): CardColor {
	switch (suit) {
		case Suit.Hearts:
		case Suit.Diamonds:
			return '🔴';
		case Suit.Spades:
		case Suit.Clubs:
			return '⚫';
	}
	return null;
}

export function parseCardColor(cardOrSuit: string | Suit): CardColor {
	if (typeof cardOrSuit === 'string') {
		if (/(?:🔴|♥️|♦️)/u.test(cardOrSuit)) return '🔴';
		if (/(?:⚫|♠️|♣️)/u.test(cardOrSuit)) return '⚫';
		return getSuitColor(parseCardSuit(cardOrSuit));
	}
	return getSuitColor(cardOrSuit);
}

export function cardToString(value: CardValue, suit: Suit = null, color: CardColor = null): string {
	if (value == '*') {
		const jokerColor = color || getSuitColor(suit);
		return jokerColor ? `*${jokerColor}` : '*';
	}
	if (!suit) return value;
	return `${value}${SuitTag[suit]}`;
}

export function getCardRank(cardValue: CardValue, aceHigh = false): number {
	const figures: any = { A: aceHigh ? 14 : 1, J: 11, Q: 12, K: 13 };
	return figures[cardValue] || +cardValue || 0;
}

// NB: `getCardAbsPos` è stato spostato in rules.ts (usa aceMayBeHigh/getNaturalNear/
// isNatural2 definiti lì): così cards.ts non importa più rules.ts né deck.ts e diventa
// una "foglia", eliminando la dipendenza circolare cards↔rules↔deck.

/** Quante carte con lo stesso tag ci sono nel mazzo (tipo strutturale per non dipendere da DeckItem). */
export function howMany(card: { tag: string }, deck: { tag: string }[]) {
	return deck.filter((d) => d.tag == card.tag).length;
}

/**
 * L'entità carta a runtime: identità stabile via `uid` (unico e progressivo),
 * condivisa tra dominio (Round/Rules) e UI (Deck/Card). Nel mazzo doppio ogni
 * `tag` esiste in due copie: alle azioni di gioco si passa sempre l'ISTANZA,
 * mai la stringa. `faceDown` è stato fisico del tavolo, scritto solo dal Round.
 */
export class DeckItem {
	static uid = 0;
	public uid: number;
	public tag: string;
	public faceDown: boolean;
	public value: CardValue;
	public suit: Suit;
	public color?: CardColor;

	constructor(card: string, faceDown: boolean = false) {
		this.uid = DeckItem.uid++;

		this.value = parseCardValue(card);
		this.suit = parseCardSuit(card);
		this.color = parseCardColor(this.suit || card);
		this.faceDown = faceDown;
		this.tag = this.toString();
	}

	toString() {
		return cardToString(this.value, this.suit, this.color);
	}
}

export class DeckItems extends Array<DeckItem> {
	static fromArray(items: DeckItem[] = []): DeckItems {
		return DeckItems.from(items);
	}

	override toString(): string {
		return Array.from(this, (item) => item.toString())
			.reverse()
			.join(' ');
	}
}

const SUIT_ORDER: Partial<Record<Suit, number>> = {
	[Suit.Hearts]: 0,
	[Suit.Diamonds]: 1,
	[Suit.Clubs]: 2,
	[Suit.Spades]: 3,
};

/** Ordinamento canonico di visualizzazione: seme (♥♦♣♠) poi rank crescente. */
export function sortBySuitThenRank(a: DeckItem, b: DeckItem): number {
	const suitA = SUIT_ORDER[a.suit] ?? 4;
	const suitB = SUIT_ORDER[b.suit] ?? 4;
	if (suitA !== suitB) return suitA - suitB;
	return getCardRank(a.value) - getCardRank(b.value);
}
