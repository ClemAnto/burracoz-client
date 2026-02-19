import { Injectable } from '@angular/core';
import { DeckItem } from '../ui/deck/deck';

export enum Suit {
	Hearts = 'h',
	Diamonds = 'd',
	Clubs = 'c',
	Spades = 's',
}

//export type CardValue = 1|2|3|4|5|6|7|8|9|10|11|12|13|'A'|'J'|'Q'|'K'

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

export type CartType = {
	uid: string;
	suit: Suit;
	value: CardValue;
};

export const STARTER_DECK = `A♥️|2♥️|3♥️|4♥️|5♥️|6♥️|7♥️|8♥️|9♥️|10♥️|J♥️|Q♥️|K♥️|
	 A♦️|2♦️|3♦️|4♦️|5♦️|6♦️|7♦️|8♦️|9♦️|10♦️|J♦️|Q♦️|K♦️|
	 A♠️|2♠️|3♠️|4♠️|5♠️|6♠️|7♠️|8♠️|9♠️|10♠️|J♠️|Q♠️|K♠️|
	 A♣️|2♣️|3♣️|4♣️|5♣️|6♣️|7♣️|8♣️|9♣️|10♣️|J♣️|Q♣️|K♣️|
	 *♠️|*♥️
	`
	.split('|')
	.map((i) => i.trim());

@Injectable({
	providedIn: 'root',
})
export class Cards {}

export function parseCardSuit(suit: string): Suit {
	switch (suit) {
		case '♥️':
			return Suit.Hearts;
		case '♦️':
			return Suit.Diamonds;
		case '♠️':
			return Suit.Spades;
		case '♣️':
			return Suit.Clubs;
	}
	return null;
}

export function parseCardValue(value: string): CardValue {
	return value as CardValue;
}

export function getCardRank(cardValue: CardValue): number {
	const figures: any = { A: 1, J: 11, Q: 12, K: 13 };
	return figures[cardValue] || +cardValue;
}

export function howMany(card:DeckItem, deck:DeckItem[]) {
	return deck.filter(d=>d.tag == card.tag).length;
}