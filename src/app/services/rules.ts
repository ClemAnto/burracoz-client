import { Injectable } from '@angular/core';
import { DeckItem, DeckItems } from '../ui/deck/deck';
import { getCardRank, howMany } from './cards';

type MeldInput = DeckItems | DeckItem[] | string;

@Injectable({
	providedIn: 'root',
})
export class Rules {
	validateMeld(layOffCards: MeldInput, tableCards?: MeldInput): DeckItems | null {
		return (
			this.validateSet(layOffCards, tableCards) || this.validateRun(layOffCards, tableCards)
		);
	}

	validateSet(layOffCards: MeldInput, tableCards?: MeldInput): DeckItems | null {
		const cards = DeckItems.fromArray(
			this.toDeckItems(layOffCards).concat(this.toDeckItems(tableCards)),
		).sort((a, b) => +isWild(a) - +isWild(b));

		//NOT ENOUGH CARDS?
		if (cards.length < 3) return null;

		//TOO MANY WILDS?
		const wilds = cards.filter(isWild);
		if (wilds.length > 1) return null;

		//SAME VALUE?
		const naturals = cards.filter((c) => !isWild(c));
		const value = naturals[0].value;
		if (naturals.some((c) => c.value != value)) return null;

		//TOO MANY EQUAL CARDS!
		if (naturals.some((c) => howMany(c, naturals) > 2)) return null;

		//console.log('[RULES] Set validated: ' + cards);
		return cards;
	}

	validateRun(layOffCards: MeldInput, tableCards?: MeldInput): DeckItems | null {
		//CardType
		//console.log('[RULES] Validate Run...');

		//1) Se nelle tableCards c'è un jolly e nelle layOffCards c'è la carta che lo può liberare,
		//	 questa prende il suo posto ed il jolly va nelle layOffCards
		//2) Un 2 naturale, se non ci sono altri jollu in tableCards, è mobile e va nelle layOffCards
		//3) I jolly liberi occupano sempre la posizione più bassa a meno che non sia presente già un A
		//	 ed in quel caso il jolly andrà nella posizione più alta

		const cards = DeckItems.fromArray(
			this.toDeckItems(layOffCards).concat(this.toDeckItems(tableCards)),
		);

		const aceHigh = aceMayBeHigh(cards);
		
		const naturals = cards
			.filter((c) => !isWild(c))
			.sort((a, b) => getCardRank(a.value, aceHigh) - getCardRank(b.value, aceHigh));

		//ENOUGH NATURALS?
		if (!naturals.length) return null;

		//SAME SUIT?
		const suit = naturals[0].suit;
		if (naturals.some((c) => c.suit != suit)) return null;

		const wildVal = (card: DeckItem) => (card.value == '2' && card.suit == suit ? 1 : 0);
		const wilds = cards.filter(isWild).sort((a, b) => wildVal(a) - wildVal(b));

		const run = DeckItems.fromArray([naturals.shift()]);

		const suit2index = wilds.findIndex((w) => w.value == '2' && w.suit == suit);
		if (run[0].value == 'A') {
			if (suit2index >= 0) {
				const [suit2] = wilds.splice(suit2index, 1);
				run.unshift(suit2);
			}
		}

		if (run[0].value == '4' && wilds.length == 2 && suit2index >= 0) {
			run.push(...wilds.splice(0, 2));
		}

		var usedWilds = 0;

		do {
			const nextCard = naturals.shift();
			if (!nextCard) break;

			const gap = getCardRank(nextCard.value, aceHigh) - getCardRank(run[0].value, aceHigh);

			//GAP TOO HIGH?
			if (gap > 2) return null; //GAP TOO HIGH

			//SAME VALUE?
			if (gap < 1) return null;
			if (gap == 2) {
				const wild = wilds.shift();
				//NEED WILD?
				if (wild) {
					usedWilds++;
					run.unshift(wild);
				} else return null;
			}
			run.unshift(nextCard);
		} while (naturals.length);

		if (run[run.length - 1].value == '3') {
			const suit2index = wilds.findIndex((w) => w.value == '2' && w.suit == suit);
			if (suit2index >= 0) {
				const [suit2] = wilds.splice(suit2index, 1);
				run.push(suit2);
			}
		}

		//TOO MANY WILD?
		if (wilds.length + usedWilds > 1) return null;

		if (wilds.length) {
			if (run[run.length - 1].value == 'A') {
				if (run[0].value == 'A') return null;
				run.unshift(...wilds);
			} else {
				run.push(...wilds);
			}
		}

		//NOT ENOUGH CARD?
		if (run.length < 3) return null;

		//console.log('[RULES] Run validated: ' + run);
		return run;
	}

	private toDeckItems(cards?: MeldInput): DeckItems {
		if (!cards) return new DeckItems();
		if (cards instanceof DeckItems) return cards;
		if (typeof cards == 'string') {
			const tokenPattern =
				/(?:10|[2-9AJQK])(?:♥️|♦️|♠️|♣️)|(?:\*|🃏)(?:⚫|🔴|♥️|♦️|♠️|♣️)?/gu;
			return DeckItems.fromArray(
				(cards.match(tokenPattern) ?? []).map((tag) => new DeckItem(tag)),
			);
		}
		return DeckItems.fromArray(cards);
	}
}

export function isWild(card: DeckItem) {
	return card.value == '2' || card.value == '*';
}

export function aceMayBeHigh(cards: DeckItems) {
	const thereIsK = cards.some(c=>c.value=='K');
	if (thereIsK) return true;
	
	const thereIsQ = cards.find(c=>c.value=='Q');
	if (!thereIsQ) return false;

	const wilds = cards.filter(c=>isWild(c));
	if (!wilds.length) return false;

	//if (wilds.length > 1) return false;


	const sameSuit = cards.every(c=>(c.suit === thereIsQ.suit));
	const allValues = [2,3,4,5,6,7,8,9,'J','Q'].every(v=>cards.find(c=>c.value==v));
	const mayBeCleanCanasta = sameSuit && allValues;
	
	 
	return !mayBeCleanCanasta;
}
