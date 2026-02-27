import { Injectable } from '@angular/core';
import { DeckItem } from '../ui/deck/deck';
import { aceMayBeHigh, getNaturalNear, isNatural2 } from './rules';

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

export type CardType = {
	uid: string;
	suit: Suit;
	value: CardValue;
	color?: CardColor;
};

export const STARTER_DECK = `A♥️|2♥️|3♥️|4♥️|5♥️|6♥️|7♥️|8♥️|9♥️|10♥️|J♥️|Q♥️|K♥️|
	 A♦️|2♦️|3♦️|4♦️|5♦️|6♦️|7♦️|8♦️|9♦️|10♦️|J♦️|Q♦️|K♦️|
	 A♠️|2♠️|3♠️|4♠️|5♠️|6♠️|7♠️|8♠️|9♠️|10♠️|J♠️|Q♠️|K♠️|
	 A♣️|2♣️|3♣️|4♣️|5♣️|6♣️|7♣️|8♣️|9♣️|10♣️|J♣️|Q♣️|K♣️|
	 *⚫|*🔴
	`
	.split('|')
	.map((i) => i.trim());

@Injectable({
	providedIn: 'root',
})
export class Cards {}

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

export function cardToString(
	value: CardValue,
	suit: Suit = null,
	color: CardColor = null,
): string {
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

export function getCardAbsPos(cardIndex:number, cards:DeckItem[]): number {
	
	let cardValue = cards[cardIndex].value;
	if (+cardValue == 2 && !isNatural2(cards, cardIndex)) cardValue = "*";

	var pos = getCardRank(cardValue, cardValue == "A" && aceMayBeHigh(cards));
	if (!pos) {
		const {card, offset} = getNaturalNear(cards, cardIndex);
		pos = getCardRank(card.value) - offset;
	}
	
	return pos;
}


export function howMany(card: DeckItem, deck: DeckItem[]) {
	return deck.filter((d) => d.tag == card.tag).length;
}
