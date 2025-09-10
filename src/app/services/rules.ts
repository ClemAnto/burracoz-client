import { Injectable } from '@angular/core';
import { Deck, DeckItem } from '../ui/deck/deck';
import { getCardRank } from './cards';

@Injectable({
  providedIn: 'root'
})
export class Rules {

	validateMeld( layOffCards:DeckItem[], tableCards?:DeckItem[]) {
		return this.validateSet(layOffCards, tableCards) || this.validateRun(layOffCards, tableCards);
	}

	validateSet(layOffCards: DeckItem[], tableCards?: DeckItem[]) {

		const cards = layOffCards.concat(tableCards ?? []).sort((a,b)=>+isWild(a) - +isWild(b));
		
		//NOT ENOUGH CARDS?
		if (cards.length < 3) return null;

		//TOO MANY WILDS?
		const wilds = cards.filter(isWild);
		if (wilds.length > 1) return null;

		//SAME VALUE?
		const naturals = cards.filter(c=>!isWild(c));
		const value = naturals[0].value;
		if (naturals.some(c=>c.value != value)) return null;


		console.log("[RULES] Set validated: " + cards);
		return cards;
	}

	validateRun(layOffCards: DeckItem[], tableCards?: DeckItem[]) {
		//CartType
		console.log("[RULES] Validate Run...");
		const cards = layOffCards.concat(tableCards ?? []);
		
		const naturals = cards.filter(c => !isWild(c)).sort((a, b) => getCardRank(a.value) - getCardRank(b.value));

		//ENOUGH NATURALS?
		if (!naturals.length) return null;
		
		//SAME SUIT?
		const suit = naturals[0].suit;
		if (naturals.some(c=>c.suit != suit)) return null;

		
		const wildVal = (card:DeckItem) => (card.value == "2" && card.suit == suit) ? 1 : 0;
		const wilds = cards.filter(isWild).sort((a,b)=>wildVal(a)-wildVal(b));

		
		const run = [naturals.shift()];
		
		const suit2index = wilds.findIndex(w=>w.value == "2" && w.suit == suit);
		if (run[0].value == "A") {
			if (suit2index>=0) {
				const [suit2] = wilds.splice(suit2index, 1);
				run.unshift(suit2);
			}
		}

		if (run[0].value == "4" && wilds.length == 2 && suit2index>=0) {
			run.push(...wilds.splice(0, 2));
		}
		
		var usedWilds = 0;

		do {
			
			const nextCard = naturals.shift();
			if (!nextCard) break;

			const gap = getCardRank(nextCard.value) - getCardRank(run[0].value);

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
		} while (naturals.length)

			
		if (run[run.length-1].value == "3") {
			const suit2index = wilds.findIndex(w=>w.value == "2" && w.suit == suit);
			if (suit2index>=0) {
				const [suit2] = wilds.splice(suit2index, 1);
				run.push(suit2);
			}
		}
		
		//TOO MANY WILD?
		if ((wilds.length + usedWilds) > 1) return null;
		
		if (wilds.length) {
			if (run[run.length-1].value == "A") {
				if (run[0].value == "A") return null;
				run.unshift(...wilds);

			} else {
				run.push(...wilds);
			}
		}
		

		//NOT ENOUGH CARD?
		if (run.length < 3) return null;

		console.log("[RULES] Run validated: " + run);
		return run;
	}
}

export function isWild(card:DeckItem) {
	return card.value == "2" || card.value == "*"
}